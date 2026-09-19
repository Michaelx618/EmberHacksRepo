import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retrievability } from "@/lib/memory-math";

export const dynamic = "force-dynamic";

export type GraphNode = {
  id: string;
  title: string;
  summary: string;
  body: string;
  kind: string;
  latex: string | null;
  status: string;
  mastery: number;
  retrievability: number;
  degree: number;
  sourceCount: number;
  noteIds: string[];
  hasContradiction: boolean;
};

export type GraphLink = {
  source: string;
  target: string;
  relation: string;
  strength: number;
  rationale: string;
  resolved: boolean;
};

/** All derived numbers are computed here, never in the render loop. */
export async function GET() {
  const [concepts, edges, notes] = await Promise.all([
    db.concept.findMany({
      select: {
        id: true, title: true, summary: true, body: true, kind: true, latex: true, status: true,
        mastery: true, encounterCount: true, reviewCount: true, lastReviewedAt: true,
        sources: { select: { noteId: true } },
      },
    }),
    db.edge.findMany({
      select: {
        sourceId: true, targetId: true, relation: true,
        strength: true, rationale: true, resolved: true,
      },
    }),
    db.note.findMany({
      select: { id: true, title: true, sourceType: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const degree = new Map<string, number>();
  const contradicted = new Set<string>();
  for (const e of edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
    if (e.relation === "contradicts" && !e.resolved) {
      contradicted.add(e.sourceId);
      contradicted.add(e.targetId);
    }
  }

  const now = new Date();
  const nodes: GraphNode[] = concepts.map((c) => ({
    id: c.id,
    title: c.title,
    summary: c.summary,
    body: c.body,
    kind: c.kind,
    latex: c.latex,
    status: c.status,
    mastery: c.mastery,
    retrievability: c.status === "ghost" ? 0 : retrievability(c, now),
    degree: degree.get(c.id) ?? 0,
    sourceCount: c.sources.length,
    noteIds: c.sources.map((s) => s.noteId),
    hasContradiction: contradicted.has(c.id),
  }));

  const links: GraphLink[] = edges.map((e) => ({
    source: e.sourceId,
    target: e.targetId,
    relation: e.relation,
    strength: e.strength,
    rationale: e.rationale,
    resolved: e.resolved,
  }));

  return NextResponse.json({
    nodes,
    links,
    notes,
    unresolvedContradictions: edges.filter((e) => e.relation === "contradicts" && !e.resolved).length,
  });
}
