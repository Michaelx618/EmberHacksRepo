import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retrieve, solidGround, weakPrerequisitesFor } from "@/lib/memory";
import { embedOne, generateJSON, hasApiKey } from "@/lib/gemini";
import {
  applyStyleSignals, buildSystemPrompt, detectConfusion, heuristicSignals,
  mergeSignals, nextRung, parseConfusion, parseStyle,
  type ConfusionEntry, type Style,
} from "@/lib/learner";

export const dynamic = "force-dynamic";

async function profile() {
  return db.learnerProfile.upsert({ where: { id: "me" }, create: {}, update: {} });
}

export async function GET() {
  const p = await profile();
  const confusion = parseConfusion(p.confusion);
  return NextResponse.json({
    style: parseStyle(p.style),
    turnCount: p.turnCount,
    confusedAbout: [...new Set(confusion.filter((c) => c.rung > 0).map((c) => c.evidence))].slice(0, 3),
  });
}

const TUTOR_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    signals: {
      type: "object",
      properties: {
        styleObserved: {
          type: "object",
          properties: {
            abstraction: { type: "number" }, verbosity: { type: "number" },
            formalism: { type: "number" }, socratic: { type: "number" },
            analogy: { type: "number" }, pace: { type: "number" },
          },
        },
        confused: { type: "boolean" },
        confusionEvidence: { type: "string" },
      },
    },
  },
  required: ["reply"],
};

type TutorPayload = {
  reply: string;
  signals?: {
    styleObserved?: Partial<Style>;
    confused?: boolean;
    confusionEvidence?: string;
  };
};

export async function POST(request: Request) {
  const { message, conceptId, history = [] } = (await request.json()) as {
    message: string;
    conceptId?: string;
    history?: { role: string; content: string }[];
  };

  if (!message?.trim()) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const profileRow = await profile();
  const style = parseStyle(profileRow.style);
  const confusionLog = parseConfusion(profileRow.confusion);

  // --- retrieve: vector search, then expand through the graph ---------------
  const confusedNow = detectConfusion(message);

  // "I still don't get it" carries no retrievable content of its own, so
  // retrieving on it would silently switch topics. Anchor to what we were
  // last discussing instead.
  const anchorId = conceptId ?? (confusedNow ? profileRow.lastConceptId : null);
  const anchor = anchorId ? await db.concept.findUnique({ where: { id: anchorId } }) : null;
  const retrievalText = anchor ? `${anchor.title}. ${anchor.summary} ${message}` : message;

  const context = await retrieve(await embedOne(retrievalText), 6);
  const contextIds = context.map((c) => c.id);

  // Escalate if they're stuck on the same thing again.
  const stuckId = anchorId ?? contextIds[0] ?? null;
  const prior = confusionLog.find((c) => c.conceptId === stuckId);
  const rung = confusedNow ? (prior ? nextRung(prior.rung) : 1) : 0;
  const stuckOn =
    rung > 0
      ? anchor?.title ?? context.find((c) => c.id === stuckId)?.title ?? undefined
      : undefined;

  const [ground, weak] = await Promise.all([
    solidGround(5),
    weakPrerequisitesFor(conceptId ? [conceptId] : contextIds.slice(0, 3)),
  ]);

  const system = buildSystemPrompt({
    style,
    context: context.map((c) => ({ title: c.title, body: c.body, noteTitle: c.noteTitle })),
    solidGround: ground,
    weakPrerequisites: weak,
    rung,
    stuckOn,
  });

  const transcript = history.map((h) => `${h.role === "user" ? "Learner" : "You"}: ${h.content}`).join("\n");

  // --- generate -------------------------------------------------------------
  let payload: TutorPayload;

  if (hasApiKey()) {
    payload = await generateJSON<TutorPayload>(
      {
        type: "text",
        text: `${transcript ? `${transcript}\n\n` : ""}Learner: ${message}

Reply as the tutor, following the style rules above.
Also report what this message reveals about how they like to be taught:
include a dimension in styleObserved ONLY if this message gives real evidence for it.
Omit dimensions you are guessing at — a guessed 0.5 corrupts the profile.`,
      },
      TUTOR_SCHEMA,
      { reply: "I couldn't generate a response." },
      { system },
    );
  } else {
    payload = { reply: offlineReply(message, context, weak, rung) };
  }

  // --- learn from the turn --------------------------------------------------
  // Heuristics always run; model signals override them where present.
  const merged = mergeSignals(heuristicSignals(message), payload.signals?.styleObserved ?? {});
  const nextStyle = applyStyleSignals(style, merged);

  let nextLog = confusionLog;
  if (confusedNow || payload.signals?.confused) {
    const entry: ConfusionEntry = {
      conceptId: stuckId,
      evidence: stuckOn ?? payload.signals?.confusionEvidence ?? message.slice(0, 60),
      rung: Math.max(rung, 1),
      at: new Date().toISOString(),
    };
    nextLog = [entry, ...confusionLog.filter((c) => c.conceptId !== stuckId)].slice(0, 12);
  }

  await db.learnerProfile.update({
    where: { id: "me" },
    data: {
      style: JSON.stringify(nextStyle),
      confusion: JSON.stringify(nextLog),
      lastConceptId: stuckId ?? contextIds[0] ?? profileRow.lastConceptId,
      turnCount: { increment: 1 },
    },
  });

  return NextResponse.json({
    reply: payload.reply,
    grounded: context.slice(0, 3).map((c) => c.title),
    style: nextStyle,
    turnCount: profileRow.turnCount + 1,
    confusedAbout: [...new Set(nextLog.filter((c) => c.rung > 0).map((c) => c.evidence))].slice(0, 3),
    rung,
    offline: !hasApiKey(),
  });
}

/** Without a key we can't generate prose, but retrieval, the graph walk and
 *  the style model all still work -- so show exactly what they produced. */
function offlineReply(
  message: string,
  context: { title: string; summary: string; viaGraph: boolean; noteTitle?: string }[],
  weak: string[],
  rung: number,
): string {
  const lines = ["[No GEMINI_API_KEY set — showing what the memory retrieved instead of a generated answer.]", ""];

  if (context.length === 0) {
    lines.push("Nothing in your notes matches that yet.");
    return lines.join("\n");
  }

  lines.push("From your notes:");
  for (const c of context.slice(0, 4)) {
    lines.push(`• ${c.title}${c.viaGraph ? " (pulled in via the graph)" : ""} — ${c.summary}`);
  }
  if (weak.length > 0) {
    lines.push("", `Missing foundation: ${weak.join(", ")}. That's likely where the confusion starts.`);
  }
  if (rung > 0) {
    lines.push("", `Escalation rung ${rung}: the tutor would change strategy here rather than repeat itself.`);
  }
  return lines.join("\n");
}
