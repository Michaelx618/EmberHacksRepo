import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retrieve, solidGround, weakPrerequisitesFor } from "@/lib/memory";
import { embedOne, generateJSON, hasApiKey } from "@/lib/gemini";
import {
  applyStyleSignals, buildSystemPrompt, detectConfusion, heuristicSignals,
  mergeSignals, nextRung, parseConfusion, parseStyle,
  type ConfusionEntry, type Style,
} from "@/lib/learner";
import {
  applyGraphEdit,
  normalizeYoutube,
  resolveProposeLink,
  runRetrieve,
  type ToolEvent,
  type TutorActions,
} from "@/lib/tutor-actions";

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
    searchNotes: { type: "string" },
    editGraph: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        reason: { type: "string" },
      },
    },
    proposeLink: {
      type: "object",
      properties: {
        sourceTitle: { type: "string" },
        targetTitle: { type: "string" },
        relation: { type: "string" },
        rationale: { type: "string" },
      },
    },
    youtube: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          why: { type: "string" },
        },
      },
    },
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

type TutorPayload = TutorActions & {
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

  const confusedNow = detectConfusion(message);
  const anchorId = conceptId ?? (confusedNow ? profileRow.lastConceptId : null);
  const anchor = anchorId ? await db.concept.findUnique({ where: { id: anchorId } }) : null;
  const retrievalText = anchor ? `${anchor.title}. ${anchor.summary} ${message}` : message;

  const events: ToolEvent[] = [];

  // Automatic retrieve — always shown as a tool event for the demo.
  const auto = await runRetrieve(retrievalText, 6);
  let context = auto.concepts;
  events.push(auto.event);

  if (anchor && !context.some((c) => c.id === anchor.id)) {
    context.unshift({
      id: anchor.id,
      title: anchor.title,
      summary: anchor.summary,
      body: anchor.body,
      kind: anchor.kind,
      mastery: anchor.mastery,
      retrievability: 1,
      similarity: 1,
      viaGraph: false,
      score: 1,
    });
  }

  const stuckId = anchorId ?? context[0]?.id ?? null;
  const prior = confusionLog.find((c) => c.conceptId === stuckId);
  const rung = confusedNow ? (prior ? nextRung(prior.rung) : 1) : 0;
  const stuckOn =
    rung > 0
      ? anchor?.title ?? context.find((c) => c.id === stuckId)?.title ?? undefined
      : undefined;

  const [ground, weak] = await Promise.all([
    solidGround(5),
    weakPrerequisitesFor(conceptId ? [conceptId] : context.slice(0, 3).map((c) => c.id)),
  ]);

  // Ghost titles the tutor is allowed to fill this turn.
  const ghosts = await db.concept.findMany({
    where: { status: "ghost" },
    select: { title: true },
    take: 8,
  });

  const system = buildSystemPrompt({
    style,
    context: context.map((c) => ({ title: c.title, body: c.body, noteTitle: c.noteTitle })),
    solidGround: ground,
    weakPrerequisites: weak,
    rung,
    stuckOn,
    ghosts: ghosts.map((g) => g.title),
  });

  const transcript = history.map((h) => `${h.role === "user" ? "Learner" : "You"}: ${h.content}`).join("\n");

  let payload: TutorPayload;

  if (hasApiKey()) {
    payload = await generateJSON<TutorPayload>(
      {
        type: "text",
        text: `${transcript ? `${transcript}\n\n` : ""}Learner: ${message}

Reply as the tutor, following the style rules and TOOLS section above.
Also report style signals ONLY when this message gives real evidence.
Omit dimensions you are guessing at.`,
      },
      TUTOR_SCHEMA,
      { reply: "I couldn't generate a response." },
      { system },
    );
  } else {
    payload = offlineTutor(message, context, weak, rung, ghosts.map((g) => g.title));
  }

  // Extra retrieve if the model asked to look something else up.
  if (payload.searchNotes?.trim()) {
    const extra = await runRetrieve(payload.searchNotes.trim(), 4);
    events.push(extra.event);
    for (const c of extra.concepts) {
      if (!context.some((x) => x.id === c.id)) context.push(c);
    }
  }

  let graphChanged = false;

  if (payload.editGraph?.title && payload.editGraph?.body) {
    const ev = await applyGraphEdit(payload.editGraph);
    if (ev) {
      events.push(ev);
      graphChanged = true;
    }
  }

  if (payload.proposeLink?.sourceTitle && payload.proposeLink?.targetTitle) {
    const ev = await resolveProposeLink(payload.proposeLink);
    if (ev) events.push(ev);
  }

  const youtube = normalizeYoutube(payload.youtube);
  if (youtube.length) events.push({ tool: "youtube", items: youtube });

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

  const contextIds = context.map((c) => c.id);

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
    tools: events,
    youtube,
    style: nextStyle,
    turnCount: profileRow.turnCount + 1,
    confusedAbout: [...new Set(nextLog.filter((c) => c.rung > 0).map((c) => c.evidence))].slice(0, 3),
    rung,
    graphChanged,
    offline: !hasApiKey(),
  });
}

function offlineTutor(
  message: string,
  context: { title: string; summary: string; viaGraph: boolean }[],
  weak: string[],
  rung: number,
  ghosts: string[],
): TutorPayload {
  const lines = [
    "_Offline demo — tools still run against your graph._",
    "",
  ];

  if (context.length === 0) {
    lines.push("Nothing in your notes matches that yet.");
  } else {
    lines.push("**From your notes:**", "");
    for (const c of context.slice(0, 4)) {
      const via = c.viaGraph ? " _(via graph)_" : "";
      lines.push(`- **${c.title}**${via} — ${c.summary}`);
    }
  }

  if (weak.length > 0) {
    lines.push("", `**Missing foundation:** ${weak.join(", ")}.`);
  }
  if (rung > 0) {
    lines.push("", `Escalation rung ${rung}: changing strategy.`);
  }

  const topic = context[0]?.title ?? "this topic";
  const ghost = ghosts[0];
  const wantVideo = /video|youtube|watch|visual|explain|stuck|don'?t (get|understand)|confused/i.test(message)
    || /teach me/i.test(message);

  const out: TutorPayload = {
    reply: lines.join("\n"),
    youtube: wantVideo
      ? [{
          title: `${topic} — visual explanation`,
          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${topic} 3blue1brown OR essence explained`)}`,
          why: "A short visual when the notes alone aren't clicking.",
        }]
      : undefined,
  };

  // Demo: if there's a ghost and they're stuck / asking to learn, propose filling it.
  if (ghost && (rung > 0 || /teach|missing|gap|don't know|never learned/i.test(message))) {
    out.editGraph = {
      title: ghost,
      body: `${ghost} is a prerequisite your notes reference but never define. (Filled by the tutor during this lesson — replace with a real definition when you capture notes on it.)`,
      reason: "filled ghost so we can keep teaching",
    };
    out.reply += `\n\nI'm filling in **${ghost}** on your graph so we have something to stand on.`;
  }

  if (context.length >= 2) {
    out.proposeLink = {
      sourceTitle: context[1].title,
      targetTitle: context[0].title,
      relation: "prerequisite",
      rationale: "These came up together in retrieval — worth linking if one depends on the other.",
    };
  }

  return out;
}
