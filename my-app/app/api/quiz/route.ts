import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateQuestion, gradeAnswer } from "@/lib/gemini";
import { retrievability, updateMastery } from "@/lib/memory-math";
import { parseConfusion, type ConfusionEntry } from "@/lib/learner";

export const dynamic = "force-dynamic";

/** Next question: whichever concept you're closest to forgetting. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("conceptId");

  let concept = requested
    ? await db.concept.findUnique({ where: { id: requested } })
    : null;

  if (!concept) {
    const candidates = await db.concept.findMany({ where: { status: "active" } });
    if (candidates.length === 0) {
      return NextResponse.json({ error: "No concepts to quiz yet." }, { status: 404 });
    }
    const now = new Date();
    concept = candidates
      .map((c) => ({ c, r: retrievability(c, now) }))
      .sort((a, b) => a.r - b.r)[0].c;
  }

  // Target a known misconception for this concept when there is one.
  const profile = await db.learnerProfile.upsert({ where: { id: "me" }, create: {}, update: {} });
  const misconception = parseConfusion(profile.confusion).find((c) => c.conceptId === concept!.id)?.evidence;

  const { question, idealAnswer } = await generateQuestion(concept, misconception);

  return NextResponse.json({
    conceptId: concept.id,
    conceptTitle: concept.title,
    question,
    idealAnswer,
    retrievability: retrievability(concept),
  });
}

/** Grade, then write mastery back so the graph recolours. */
export async function POST(request: Request) {
  const { conceptId, question, answer } = (await request.json()) as {
    conceptId: string;
    question: string;
    answer: string;
  };

  const concept = await db.concept.findUnique({ where: { id: conceptId } });
  if (!concept) return NextResponse.json({ error: "Unknown concept" }, { status: 404 });
  if (!answer?.trim()) return NextResponse.json({ error: "Empty answer" }, { status: 400 });

  const grade = await gradeAnswer(concept, question, answer);
  const mastery = updateMastery(concept.mastery, grade.score);

  const updated = await db.concept.update({
    where: { id: conceptId },
    data: {
      mastery,
      reviewCount: { increment: 1 },
      lastReviewedAt: new Date(),
    },
  });

  // A failure is a confusion signal; a pass resolves it.
  const profile = await db.learnerProfile.upsert({ where: { id: "me" }, create: {}, update: {} });
  const log = parseConfusion(profile.confusion);
  let nextLog: ConfusionEntry[];

  if (grade.score < 0.5) {
    const prior = log.find((c) => c.conceptId === conceptId);
    nextLog = [
      {
        conceptId,
        evidence: grade.misconception ?? concept.title,
        rung: Math.min((prior?.rung ?? 0) + 1, 3),
        at: new Date().toISOString(),
      },
      ...log.filter((c) => c.conceptId !== conceptId),
    ].slice(0, 12);
  } else {
    nextLog = log.filter((c) => c.conceptId !== conceptId);
  }

  await db.learnerProfile.update({
    where: { id: "me" },
    data: { confusion: JSON.stringify(nextLog) },
  });

  return NextResponse.json({
    score: grade.score,
    feedback: grade.feedback,
    missedPoints: grade.missedPoints,
    misconception: grade.misconception ?? null,
    masteryBefore: concept.mastery,
    masteryAfter: mastery,
    retrievability: retrievability(updated),
  });
}
