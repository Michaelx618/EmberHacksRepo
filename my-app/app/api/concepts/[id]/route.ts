import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retrievability } from "@/lib/memory-math";

export const dynamic = "force-dynamic";

/** Full detail for the inspector panel. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const concept = await db.concept.findUnique({
    where: { id },
    include: {
      sources: { include: { note: { select: { id: true, title: true, sourceType: true, createdAt: true } } } },
      revisions: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!concept) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const edges = await db.edge.findMany({
    where: { OR: [{ sourceId: id }, { targetId: id }] },
  });

  const otherIds = edges.map((e) => (e.sourceId === id ? e.targetId : e.sourceId));
  const others = await db.concept.findMany({
    where: { id: { in: otherIds } },
    select: { id: true, title: true, kind: true, status: true },
  });
  const byId = new Map(others.map((o) => [o.id, o]));

  const related = edges
    .map((e) => {
      const outward = e.sourceId === id ? e.targetId : e.sourceId;
      const other = byId.get(outward);
      if (!other) return null;
      return {
        id: other.id,
        title: other.title,
        kind: other.kind,
        status: other.status,
        relation: e.relation,
        rationale: e.rationale,
        strength: e.strength,
        resolved: e.resolved,
        // "incoming" reads as: other --relation--> this
        direction: e.sourceId === id ? "outgoing" : "incoming",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return NextResponse.json({
    ...concept,
    tags: JSON.parse(concept.tags || "[]"),
    sourcesJson: concept.sourcesJson ? JSON.parse(concept.sourcesJson) : [],
    embedding: undefined, // never ship 768 floats to the client
    retrievability: concept.status === "ghost" ? 0 : retrievability(concept),
    related,
  });
}
