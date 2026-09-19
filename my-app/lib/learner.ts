// The learner model: how this person likes to be taught. One row in the DB,
// six numbers, and a system prompt generated from them.

export const STYLE_DIMENSIONS = [
  "abstraction", // 0 concrete examples .. 1 formal/general
  "verbosity", //   0 terse             .. 1 elaborate
  "formalism", //   0 plain language    .. 1 notation-heavy
  "socratic", //    0 just tell me      .. 1 ask me questions first
  "analogy", //     0 literal           .. 1 analogy-driven
  "pace", //        0 scaffold slowly   .. 1 move fast
] as const;

export type StyleDimension = (typeof STYLE_DIMENSIONS)[number];
export type Style = Record<StyleDimension, number>;

/** Fast enough that three consistent turns visibly move the needle. A slower
 *  EMA makes the adaptation invisible inside a short demo. */
export const STYLE_EMA_ALPHA = 0.2;

export const NEUTRAL_STYLE: Style = {
  abstraction: 0.5,
  verbosity: 0.5,
  formalism: 0.5,
  socratic: 0.5,
  analogy: 0.5,
  pace: 0.5,
};

export type ConfusionEntry = {
  conceptId: string | null;
  evidence: string;
  rung: number;
  at: string;
};

export function parseStyle(json: string | null | undefined): Style {
  if (!json) return { ...NEUTRAL_STYLE };
  try {
    const raw = JSON.parse(json) as Partial<Record<StyleDimension, unknown>>;
    const style = { ...NEUTRAL_STYLE };
    for (const dim of STYLE_DIMENSIONS) {
      const v = raw[dim];
      if (typeof v === "number" && Number.isFinite(v)) {
        style[dim] = Math.min(1, Math.max(0, v));
      }
    }
    return style;
  } catch {
    return { ...NEUTRAL_STYLE };
  }
}

export function parseConfusion(json: string | null | undefined): ConfusionEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ConfusionEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * EMA the observed style into the stored profile.
 * Dimensions the model had no evidence for are omitted upstream and left
 * untouched here -- averaging in a guessed 0.5 every turn is what makes an
 * adaptive tutor silently regress to neutral.
 */
export function applyStyleSignals(
  current: Style,
  observed: Partial<Style>,
  alpha = STYLE_EMA_ALPHA,
): Style {
  const next = { ...current };
  for (const dim of STYLE_DIMENSIONS) {
    const o = observed[dim];
    if (typeof o !== "number" || !Number.isFinite(o)) continue;
    next[dim] = (1 - alpha) * current[dim] + alpha * Math.min(1, Math.max(0, o));
  }
  return next;
}

/** Escalation ladder: on repeat confusion, change strategy rather than repeat. */
export const LADDER = [
  "Rephrase the idea more simply and more briefly than last time.",
  "Give a concrete worked example with real numbers or a specific case.",
  "Build an analogy from a concept this learner already knows well (listed above as solid ground). Name the concept you are drawing from.",
  "Stop explaining this directly. Drop down to its prerequisite and check whether THAT is actually solid first.",
] as const;

export function nextRung(currentRung: number): number {
  return Math.min(currentRung + 1, LADDER.length - 1);
}

/** Picks the phrasing for one dimension, or null if it's near neutral. */
function describe(
  value: number,
  low: string,
  high: string,
  deadzone = 0.15,
): string | null {
  if (Math.abs(value - 0.5) < deadzone) return null;
  return value < 0.5 ? low : high;
}

export type PromptContext = {
  style: Style;
  /** Concepts retrieved from the user's own notes, already ranked. */
  context: { title: string; body: string; noteTitle?: string }[];
  /** High-mastery concepts usable as analogy source material. */
  solidGround?: string[];
  /** Missing prerequisites surfaced by the graph walk. */
  weakPrerequisites?: string[];
  /** Escalation rung, if the learner is stuck on something. */
  rung?: number;
  stuckOn?: string;
  /** Ghost concepts the tutor may fill with editGraph. */
  ghosts?: string[];
};

/**
 * The whole adaptation mechanism: the system prompt is GENERATED from the
 * style numbers each turn rather than being a fixed string.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const { style } = ctx;
  const lines: string[] = [];

  lines.push(
    "You are a tutor for one specific learner. You teach ONLY from their own handwritten notes, reproduced below.",
    "Never introduce material that is not grounded in those notes; if they haven't written about something, say so plainly.",
    "When you use an idea from their notes, refer to it by name so they can find it.",
    "",
    "FORMAT: Use short paragraphs. Prefer bullet lists for steps or cases. Bold key terms with **like this**. Write math as $...$ (inline) or $$...$$ (display). Keep replies scannable — no walls of text.",
    "",
    "HOW THIS LEARNER WANTS TO BE TAUGHT (inferred from how they ask; honour it):",
  );

  const prefs = [
    describe(style.socratic, "Give them the answer first, then the reasoning. Do NOT quiz them or ask leading questions - they find it irritating.", "Lead with a question before explaining. Let them attempt it first."),
    describe(style.abstraction, "Start from concrete cases, not general statements.", "Lead with the general principle; they are comfortable with abstraction."),
    describe(style.verbosity, "Be terse. Two or three sentences.", "Be thorough; they want the full picture."),
    describe(style.formalism, "Use plain language. Avoid notation unless they used it first.", "Use precise notation and formal terms; they prefer rigour."),
    describe(style.analogy, "Stay literal. Analogies annoy them.", "Reach for analogies - they think by comparison."),
    describe(style.pace, "Scaffold in small steps and check in as you go.", "Move quickly; skip the basics."),
  ].filter((p): p is string => p !== null);

  if (prefs.length === 0) {
    lines.push("- No strong signal yet. Teach in a balanced way and watch how they respond.");
  } else {
    for (const p of prefs) lines.push(`- ${p}`);
  }

  if (ctx.stuckOn && typeof ctx.rung === "number" && ctx.rung > 0) {
    lines.push(
      "",
      `THEY ARE STUCK ON: ${ctx.stuckOn}. Previous explanations did not land.`,
      `Change strategy now: ${LADDER[Math.min(ctx.rung, LADDER.length - 1)]}`,
    );
  }

  if (ctx.solidGround?.length) {
    lines.push("", `SOLID GROUND (they know these well, safe to build on): ${ctx.solidGround.join(", ")}`);
  }

  if (ctx.weakPrerequisites?.length) {
    lines.push(
      "",
      `MISSING FOUNDATION: their notes depend on ${ctx.weakPrerequisites.join(", ")}, which they have not mastered.`,
      "If the confusion traces back to one of these, say so and address it first.",
    );
  }

  lines.push(
    "",
    "TOOLS (optional JSON fields — use when they clearly help the demo of adaptive teaching):",
    "- searchNotes: string — look up another concept in their notes mid-reply.",
    "- editGraph: { title, body, reason } — fill a GHOST gap listed below when they lack a foundation. Short honest body.",
    "- proposeLink: { sourceTitle, targetTitle, relation, rationale } — propose an edge (prerequisite|elaborates|example_of|contradicts|related). Learner clicks Accept.",
    "- youtube: [{ title, url, why }] — 1 YouTube tutorial when stuck, asks for a video, or needs a visual. Prefer real watch URLs (3Blue1Brown etc).",
    "If they say the graph is wrong / missing something / they never learned a prerequisite, USE editGraph and/or proposeLink — don't only explain in prose.",
  );

  if (ctx.ghosts?.length) {
    lines.push(`GHOSTS YOU MAY FILL: ${ctx.ghosts.join(", ")}`);
  }

  lines.push("", "THEIR NOTES:");
  if (ctx.context.length === 0) {
    lines.push("(nothing relevant found - tell them their notes don't cover this yet)");
  } else {
    for (const c of ctx.context) {
      lines.push(`## ${c.title}${c.noteTitle ? ` (from "${c.noteTitle}")` : ""}`, c.body, "");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Heuristic signals
// ---------------------------------------------------------------------------

/**
 * Read the learner's style straight off the wording of their question.
 * These run on EVERY turn and are merged with whatever the model reports, so
 * the profile always has a reliable floor -- a model that keeps emitting
 * nothing can never leave the tutor stuck at neutral.
 */
export function heuristicSignals(text: string): Partial<Style> {
  const t = text.toLowerCase();
  const out: Partial<Style> = {};

  // "stop quizzing me" is the highest-value signal in the whole model.
  if (/\b(just (give|tell)|stop (asking|quizzing)|don'?t quiz|no questions|answer it|straight answer)\b/.test(t)) {
    out.socratic = 0;
  } else if (/\b(quiz me|test me|ask me|let me try|check my|i want to work)\b/.test(t)) {
    out.socratic = 1;
  }

  if (/\b(example|concretely|for instance|show me a case|worked)\b/.test(t)) out.abstraction = 0.1;
  if (/\b(in general|generally|abstract|the general (case|principle)|formally)\b/.test(t)) out.abstraction = 0.9;

  if (/\b(brief|briefly|short|shorter|tldr|quickly|in a sentence|concise)\b/.test(t)) out.verbosity = 0;
  if (/\b(elaborate|in detail|more detail|explain fully|walk me through|thorough)\b/.test(t)) out.verbosity = 1;

  if (/\b(prove|proof|rigorous|rigor|notation|theorem|lemma|formal)\b/.test(t)) out.formalism = 0.9;
  if (/\b(plain english|simply|simple terms|layman|without the math|no notation)\b/.test(t)) out.formalism = 0;

  if (/\b(like|analogy|analogous|similar to|think of it as|intuition|intuitively)\b/.test(t)) out.analogy = 0.9;
  if (/\b(no analog|literally|precisely|exactly what)\b/.test(t)) out.analogy = 0.1;

  if (/\b(slow down|step by step|one at a time|back up|from the start|basics)\b/.test(t)) out.pace = 0;
  if (/\b(skip|i know|obviously|get to the point|already know|fast)\b/.test(t)) out.pace = 1;

  // Unprompted notation use is strong evidence of comfort with formalism.
  const mathiness = (text.match(/[λμσΣ∫∂∀∃≤≥≠∈⊆→⟹\\^_{}=]/g) ?? []).length;
  if (mathiness >= 3 && out.formalism === undefined) out.formalism = 0.85;

  // Consistently terse questions mean they want terse answers.
  const words = text.trim().split(/\s+/).length;
  if (words <= 6 && out.verbosity === undefined) out.verbosity = 0.2;
  if (words >= 40 && out.verbosity === undefined) out.verbosity = 0.8;

  return out;
}

const CONFUSION_PATTERNS =
  /\b(i (still )?don'?t (get|understand|follow)|confused|lost|makes no sense|what\??$|huh|unclear|why does that work|i'?m not following|wait,? (what|why))\b/i;

export function detectConfusion(text: string): boolean {
  return CONFUSION_PATTERNS.test(text.trim());
}

/** Model signals win where present; heuristics fill every gap. */
export function mergeSignals(heuristic: Partial<Style>, model: Partial<Style>): Partial<Style> {
  return { ...heuristic, ...model };
}
