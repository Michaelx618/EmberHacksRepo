import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { embedOne, research } from "@/lib/gemini";
import { conceptEmbedText, linkConcepts } from "@/lib/memory";

export const dynamic = "force-dynamic";

/** Fact-check a concept against live sources. Returns a PROPOSAL -- the
 *  learner's own words are never overwritten without them accepting. */
export async function POST(request: Request) {
  const { conceptId } = (await request.json()) as { conceptId: string };

  const concept = await db.concept.findUnique({ where: { id: conceptId } });
  if (!concept) return NextResponse.json({ error: "Unknown concept" }, { status: 404 });

  try {
    const result = await research({
      title: concept.title,
      body: concept.body || concept.summary,
    });
    return NextResponse.json({ conceptId, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Research failed" },
      { status: 502 },
    );
  }
}

/** Accept a proposal: keep the old body as a revision, then re-embed. */
export async function PATCH(request: Request) {
  const { conceptId, refinedSummary, sources } = (await request.json()) as {
    conceptId: string;
    refinedSummary: string;
    sources: { url: string; title: string }[];
  };

  const concept = await db.concept.findUnique({ where: { id: conceptId } });
  if (!concept) return NextResponse.json({ error: "Unknown concept" }, { status: 404 });
  if (!refinedSummary?.trim()) return NextResponse.json({ error: "Nothing to apply" }, { status: 400 });

  await db.conceptRevision.create({
    data: {
      conceptId,
      body: concept.body,
      reason: "accepted research correction",
    },
  });

  // Ghost nodes become real once they have a definition.
  const embedding = await embedOne(
    conceptEmbedText({ title: concept.title, summary: concept.summary, body: refinedSummary }),
  );

  await db.concept.update({
    where: { id: conceptId },
    data: {
      body: refinedSummary,
      sourcesJson: JSON.stringify(sources ?? []),
      embedding: JSON.stringify(embedding),
      ...(concept.status === "ghost" ? { status: "active" } : {}),
    },
  });

  // Its meaning changed, so its neighbours may have too.
  await linkConcepts([conceptId]);

  return NextResponse.json({ ok: true });
}
