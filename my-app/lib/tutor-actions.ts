// Demo-facing tutor actions. Kept small on purpose: retrieve, edit, propose
// link, YouTube. Flash fills a JSON schema; we execute and surface cards.

import { db } from "./db";
import { embedOne } from "./gemini";
import { conceptEmbedText, retrieve, type ScoredConcept } from "./memory";
import type { ToolEvent, YoutubeRec } from "./tutor-types";

export type { ToolEvent, YoutubeRec } from "./tutor-types";

export type ProposeLink = {
  sourceTitle: string;
  targetTitle: string;
  relation: string;
  rationale: string;
  sourceId?: string;
  targetId?: string;
};

export type GraphEdit = {
  title: string;
  body: string;
  reason: string;
  conceptId?: string;
  wasGhost?: boolean;
};

export type TutorActions = {
  searchNotes?: string;
  editGraph?: GraphEdit;
  proposeLink?: ProposeLink;
  youtube?: YoutubeRec[];
};

const ALLOWED_RELATIONS = new Set([
  "prerequisite",
  "elaborates",
  "example_of",
  "contradicts",
  "related",
]);

export async function findConceptByTitle(title: string) {
  const all = await db.concept.findMany({
    select: { id: true, title: true, body: true, summary: true, status: true, kind: true },
  });
  const needle = title.trim().toLowerCase();
  return (
    all.find((c) => c.title.toLowerCase() === needle) ??
    all.find((c) => c.title.toLowerCase().includes(needle) || needle.includes(c.title.toLowerCase())) ??
    null
  );
}

export async function runRetrieve(query: string, k = 4): Promise<{
  concepts: ScoredConcept[];
  event: ToolEvent;
}> {
  const concepts = await retrieve(await embedOne(query), k);
  return {
    concepts,
    event: {
      tool: "retrieve",
      query,
      hits: concepts.slice(0, 4).map((c) => ({ title: c.title, summary: c.summary })),
    },
  };
}

export async function applyGraphEdit(edit: GraphEdit): Promise<ToolEvent | null> {
  const concept = await findConceptByTitle(edit.title);
  if (!concept || !edit.body?.trim()) return null;

  const wasGhost = concept.status === "ghost";
  await db.conceptRevision.create({
    data: {
      conceptId: concept.id,
      body: concept.body || "(empty)",
      reason: edit.reason?.trim() || (wasGhost ? "tutor filled gap during lesson" : "tutor clarified during lesson"),
    },
  });

  const summary = concept.summary || edit.body.trim().slice(0, 120);
  const embedding = await embedOne(
    conceptEmbedText({ title: concept.title, summary, body: edit.body.trim() }),
  );

  await db.concept.update({
    where: { id: concept.id },
    data: {
      body: edit.body.trim(),
      embedding: JSON.stringify(embedding),
      ...(wasGhost ? { status: "active", mastery: 0.15 } : {}),
    },
  });

  return {
    tool: "edit_graph",
    title: concept.title,
    wasGhost,
    reason: edit.reason?.trim() || (wasGhost ? "filled a gap" : "updated during lesson"),
  };
}

export async function resolveProposeLink(link: ProposeLink): Promise<ToolEvent | null> {
  const source = await findConceptByTitle(link.sourceTitle);
  const target = await findConceptByTitle(link.targetTitle);
  if (!source || !target || source.id === target.id) return null;

  const relation = ALLOWED_RELATIONS.has(link.relation) ? link.relation : "related";
  return {
    tool: "propose_link",
    sourceTitle: source.title,
    targetTitle: target.title,
    relation,
    rationale: link.rationale?.trim() || "tutor suggested this link",
    sourceId: source.id,
    targetId: target.id,
  };
}

export async function acceptProposeLink(input: {
  sourceId: string;
  targetId: string;
  relation: string;
  rationale: string;
}): Promise<{ ok: true } | { error: string }> {
  const relation = ALLOWED_RELATIONS.has(input.relation) ? input.relation : "related";
  if (!input.sourceId || !input.targetId) return { error: "Missing concepts" };

  await db.edge.upsert({
    where: {
      sourceId_targetId_relation: {
        sourceId: input.sourceId,
        targetId: input.targetId,
        relation,
      },
    },
    create: {
      sourceId: input.sourceId,
      targetId: input.targetId,
      relation,
      strength: 0.7,
      rationale: input.rationale || "accepted tutor proposal",
    },
    update: {
      strength: 0.7,
      rationale: input.rationale || "accepted tutor proposal",
      ...(relation === "contradicts" ? { resolved: true } : {}),
    },
  });

  return { ok: true };
}

export function normalizeYoutube(items: YoutubeRec[] | undefined): YoutubeRec[] {
  if (!items?.length) return [];
  return items
    .map((y) => {
      const url = tidyYoutubeUrl(y.url, y.title);
      if (!url) return null;
      return {
        title: y.title?.trim() || "YouTube tutorial",
        url,
        why: y.why?.trim() || "Helpful visual for this concept",
      };
    })
    .filter((y): y is YoutubeRec => y !== null)
    .slice(0, 3);
}

function tidyYoutubeUrl(url: string, title: string): string | null {
  const raw = (url || "").trim();
  if (/youtube\.com\/watch\?v=|youtu\.be\//i.test(raw)) return raw;
  const q = raw || title;
  if (!q) return null;
  if (/^https?:\/\//i.test(raw) && !/youtube|youtu\.be/i.test(raw)) return null;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q.replace(/^https?:\/\/\S+\s*/, "") || title)}`;
}
