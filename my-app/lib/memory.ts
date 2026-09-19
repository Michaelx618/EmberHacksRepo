// The memory: write path (consolidation) and read path (graph-augmented
// retrieval). Concepts are the memory; Notes are provenance; Edges are
// its structure.

import { db } from "./db";
import { cosine, parseEmbedding, topK } from "./vector";
import { DEDUP_THRESHOLD, LINK_CANDIDATES, LINK_THRESHOLD, retrievability } from "./memory-math";
import { classifyRelations, embedBatch, embedOne, hasApiKey, reconcile, type RelationPair } from "./gemini";

/**
 * The canonical text we embed for a concept. Used by ingestion, the seed and
 * re-embedding after research, so they all land in the same vector space.
 * The title is repeated deliberately: a concept's name says far more about
 * what it is than a passing mention buried in some other concept's body.
 */
export function conceptEmbedText(c: { title: string; summary: string; body: string }): string {
  return `${c.title}. ${c.title}. ${c.summary} ${c.body}`;
}

export type ExtractedConcept = {
  title: string;
  summary: string;
  body: string;
  kind: string;
  latex?: string | null;
  tags?: string[];
  quote?: string | null;
  bbox?: number[] | null;
};

export type ConsolidationOutcome = {
  action: "created" | "reinforced" | "superseded" | "contradicted";
  conceptId: string;
  title: string;
  /** For reinforced/superseded/contradicted: what it matched against. */
  matchedTitle?: string;
  similarity?: number;
  rationale?: string;
};

export type ConsolidationResult = {
  outcomes: ConsolidationOutcome[];
  edgesCreated: number;
};

type ExistingRow = { id: string; title: string; body: string; embedding: string; encounterCount: number };

/**
 * Write path. Storage appends; memory reconciles. For each extracted concept:
 * embed, look for something you already have, and decide what happened.
 */
export async function consolidate(
  noteId: string,
  candidates: ExtractedConcept[],
  embeddings?: number[][],
): Promise<ConsolidationResult> {
  if (candidates.length === 0) return { outcomes: [], edgesCreated: 0 };

  const vectors =
    embeddings ??
    (await embedBatch(candidates.map(conceptEmbedText)));

  const existing = (await db.concept.findMany({
    where: { status: { not: "ghost" } },
    select: { id: true, title: true, body: true, embedding: true, encounterCount: true },
  })) as ExistingRow[];

  const outcomes: ConsolidationOutcome[] = [];
  const touched: string[] = []; // concepts to link afterwards

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const vector = vectors[i] ?? [];

    const [best] = topK(vector, existing, (e) => parseEmbedding(e.embedding), 1, DEDUP_THRESHOLD);

    if (!best) {
      const created = await createConcept(noteId, candidate, vector);
      existing.push({
        id: created.id,
        title: created.title,
        body: created.body,
        embedding: created.embedding,
        encounterCount: 1,
      });
      touched.push(created.id);
      outcomes.push({ action: "created", conceptId: created.id, title: created.title });
      continue;
    }

    const decision = await reconcile(
      { title: candidate.title, body: candidate.body },
      { title: best.item.title, body: best.item.body },
      best.similarity,
    );

    if (decision.action === "distinct") {
      const created = await createConcept(noteId, candidate, vector);
      existing.push({
        id: created.id,
        title: created.title,
        body: created.body,
        embedding: created.embedding,
        encounterCount: 1,
      });
      touched.push(created.id);
      outcomes.push({ action: "created", conceptId: created.id, title: created.title });
      continue;
    }

    if (decision.action === "contradict") {
      // Keep both and record the conflict loudly.
      const created = await createConcept(noteId, candidate, vector);
      await db.edge.upsert({
        where: {
          sourceId_targetId_relation: {
            sourceId: created.id,
            targetId: best.item.id,
            relation: "contradicts",
          },
        },
        create: {
          sourceId: created.id,
          targetId: best.item.id,
          relation: "contradicts",
          strength: 0.95,
          rationale: decision.rationale,
        },
        update: { rationale: decision.rationale, resolved: false },
      });
      existing.push({
        id: created.id,
        title: created.title,
        body: created.body,
        embedding: created.embedding,
        encounterCount: 1,
      });
      touched.push(created.id);
      outcomes.push({
        action: "contradicted",
        conceptId: created.id,
        title: created.title,
        matchedTitle: best.item.title,
        similarity: best.similarity,
        rationale: decision.rationale,
      });
      continue;
    }

    // reinforce | supersede -> no new node; strengthen the one you have.
    const isSupersede = decision.action === "supersede";

    if (isSupersede && decision.mergedBody) {
      await db.conceptRevision.create({
        data: { conceptId: best.item.id, body: best.item.body, reason: decision.rationale },
      });
    }

    await db.concept.update({
      where: { id: best.item.id },
      data: {
        encounterCount: { increment: 1 },
        ...(decision.mergedBody ? { body: decision.mergedBody } : {}),
        ...(isSupersede ? { embedding: JSON.stringify(vector) } : {}),
      },
    });

    // Attaching the note is what makes re-reading strengthen rather than duplicate.
    await db.conceptSource.upsert({
      where: { conceptId_noteId: { conceptId: best.item.id, noteId } },
      create: { conceptId: best.item.id, noteId, quote: candidate.quote ?? null, bbox: candidate.bbox ? JSON.stringify(candidate.bbox) : null },
      update: {},
    });

    touched.push(best.item.id);
    outcomes.push({
      action: isSupersede ? "superseded" : "reinforced",
      conceptId: best.item.id,
      title: best.item.title,
      matchedTitle: best.item.title,
      similarity: best.similarity,
      rationale: decision.rationale,
    });
  }

  const edgesCreated = await linkConcepts(touched);
  return { outcomes, edgesCreated };
}

async function createConcept(noteId: string, c: ExtractedConcept, vector: number[]) {
  const created = await db.concept.create({
    data: {
      title: c.title,
      summary: c.summary,
      body: c.body,
      kind: c.kind || "fact",
      latex: c.latex ?? null,
      tags: JSON.stringify(c.tags ?? []),
      embedding: JSON.stringify(vector),
      sources: {
        create: {
          noteId,
          quote: c.quote ?? null,
          bbox: c.bbox ? JSON.stringify(c.bbox) : null,
        },
      },
    },
  });
  return created;
}

/** Link the given concepts to their nearest neighbours, one batched call. */
export async function linkConcepts(conceptIds: string[]): Promise<number> {
  if (conceptIds.length === 0) return 0;

  const all = await db.concept.findMany({
    where: { status: { not: "ghost" } },
    select: { id: true, title: true, body: true, embedding: true },
  });
  const byId = new Map(all.map((c) => [c.id, c]));

  const pairs: RelationPair[] = [];
  const meta: { sourceId: string; targetId: string }[] = [];
  const seen = new Set<string>();

  for (const id of conceptIds) {
    const self = byId.get(id);
    if (!self) continue;
    const vector = parseEmbedding(self.embedding);
    const neighbours = topK(
      vector,
      all.filter((c) => c.id !== id),
      (c) => parseEmbedding(c.embedding),
      LINK_CANDIDATES,
      LINK_THRESHOLD,
    );

    for (const n of neighbours) {
      const key = [id, n.item.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        sourceTitle: self.title,
        sourceBody: self.body,
        targetTitle: n.item.title,
        targetBody: n.item.body,
        similarity: n.similarity,
      });
      meta.push({ sourceId: id, targetId: n.item.id });
    }
  }

  if (pairs.length === 0) return 0;

  const classified = await classifyRelations(pairs);
  let count = 0;

  for (const rel of classified) {
    const m = meta[rel.index];
    if (!m) continue;
    await db.edge.upsert({
      where: {
        sourceId_targetId_relation: {
          sourceId: m.sourceId,
          targetId: m.targetId,
          relation: rel.relation,
        },
      },
      create: {
        sourceId: m.sourceId,
        targetId: m.targetId,
        relation: rel.relation,
        strength: rel.strength,
        rationale: rel.rationale,
      },
      update: { strength: rel.strength, rationale: rel.rationale },
    });
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

export type ScoredConcept = {
  id: string;
  title: string;
  summary: string;
  body: string;
  kind: string;
  mastery: number;
  retrievability: number;
  similarity: number;
  score: number;
  /** true when it arrived via the graph rather than direct similarity */
  viaGraph: boolean;
  noteTitle?: string;
};

const SEED_COUNT = 8;

/** Real embeddings and the offline hashed-bag-of-words stand-in have very
 *  different similarity scales: a short query against a long concept body
 *  scores ~0.6 with a real model but ~0.19 with bag-of-words. Ranking is
 *  correct either way; only the cutoff has to move. */
function seedThreshold(): number {
  return hasApiKey() ? 0.6 : 0.08;
}

/**
 * Graph-augmented retrieval: vector search for seeds, then pull in their
 * 1-hop neighbours. That expansion is why the tutor can notice a missing
 * prerequisite instead of only answering the question asked.
 */
export async function retrieve(queryVector: number[], k = 6): Promise<ScoredConcept[]> {
  const concepts = await db.concept.findMany({
    where: { status: "active" },
    select: {
      id: true, title: true, summary: true, body: true, kind: true,
      mastery: true, encounterCount: true, reviewCount: true, lastReviewedAt: true,
      embedding: true,
      sources: { select: { note: { select: { title: true } } }, take: 1 },
    },
  });
  if (concepts.length === 0) return [];

  const seeds = topK(queryVector, concepts, (c) => parseEmbedding(c.embedding), SEED_COUNT, seedThreshold());
  const seedIds = new Set(seeds.map((s) => s.item.id));
  if (seedIds.size === 0) return [];

  const edges = await db.edge.findMany({
    where: { OR: [{ sourceId: { in: [...seedIds] } }, { targetId: { in: [...seedIds] } }] },
    select: { sourceId: true, targetId: true, strength: true },
  });

  // Best edge strength connecting each neighbour back to the seed set.
  const neighbourStrength = new Map<string, number>();
  for (const e of edges) {
    const outward = seedIds.has(e.sourceId) ? e.targetId : e.sourceId;
    if (seedIds.has(outward)) continue;
    neighbourStrength.set(outward, Math.max(neighbourStrength.get(outward) ?? 0, e.strength));
  }

  const byId = new Map(concepts.map((c) => [c.id, c]));
  const now = new Date();

  type Candidate = { c: (typeof concepts)[number]; similarity: number; edgeStrength: number; viaGraph: boolean };
  const candidates: Candidate[] = seeds.map((s) => ({
    c: s.item, similarity: s.similarity, edgeStrength: 0, viaGraph: false,
  }));

  for (const [id, edgeStrength] of neighbourStrength) {
    const c = byId.get(id);
    if (!c) continue;
    candidates.push({ c, similarity: cosine(queryVector, parseEmbedding(c.embedding)), edgeStrength, viaGraph: true });
  }

  // Normalise similarity across the candidate set before blending. Raw cosine
  // spans a different range for every embedding model, and when those values
  // cluster tightly the retrievability term quietly takes over the ranking --
  // turning "what is relevant" into "what you happen to know best".
  const sims = candidates.map((x) => x.similarity);
  const lo = Math.min(...sims);
  const hi = Math.max(...sims);
  const spread = hi - lo;
  const relevance = (s: number) => (spread < 1e-6 ? 1 : (s - lo) / spread);

  const results: ScoredConcept[] = candidates.map(({ c, similarity, edgeStrength, viaGraph }) => {
    const r = retrievability(c, now);
    return {
      id: c.id, title: c.title, summary: c.summary, body: c.body, kind: c.kind,
      mastery: c.mastery, retrievability: r, similarity, viaGraph,
      score: 0.7 * relevance(similarity) + 0.2 * r + 0.1 * edgeStrength,
      noteTitle: c.sources[0]?.note.title,
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

export async function retrieveByText(query: string, k = 6): Promise<ScoredConcept[]> {
  return retrieve(await embedOne(query), k);
}

/**
 * Concepts the learner depends on but hasn't mastered -- the graph walk's
 * other payoff. Used to tell them which foundation is actually missing.
 */
export async function weakPrerequisitesFor(conceptIds: string[], limit = 3): Promise<string[]> {
  if (conceptIds.length === 0) return [];

  const edges = await db.edge.findMany({
    where: { relation: "prerequisite", targetId: { in: conceptIds } },
    select: { sourceId: true },
  });
  if (edges.length === 0) return [];

  const prereqs = await db.concept.findMany({
    where: { id: { in: edges.map((e) => e.sourceId) } },
    select: {
      id: true, title: true, mastery: true, encounterCount: true,
      reviewCount: true, lastReviewedAt: true, status: true,
    },
  });

  const now = new Date();
  return prereqs
    .map((p) => ({ title: p.title, r: p.status === "ghost" ? 0 : retrievability(p, now) }))
    .filter((p) => p.r < 0.4)
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map((p) => p.title);
}

/** High-retrievability concepts, usable as analogy source material. */
export async function solidGround(limit = 5): Promise<string[]> {
  const concepts = await db.concept.findMany({
    where: { status: "active", mastery: { gte: 0.6 } },
    select: {
      title: true, mastery: true, encounterCount: true,
      reviewCount: true, lastReviewedAt: true,
    },
  });
  const now = new Date();
  return concepts
    .map((c) => ({ title: c.title, r: retrievability(c, now) }))
    .filter((c) => c.r >= 0.5)
    .sort((a, b) => b.r - a.r)
    .slice(0, limit)
    .map((c) => c.title);
}
