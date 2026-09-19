// All Gemini access goes through here. Every function has a deterministic
// offline fallback, so Phases 0-3 run with no API key and Phase 4 just lets
// the real branch take over.

import { GoogleGenAI } from "@google/genai";
import { hashEmbed } from "./vector";

export const MODEL = "gemini-3.6-flash";
export const EMBED_MODEL = "gemini-embedding-2";
export const EMBED_DIM = 768;

export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** The SDK/docs use snake_case; some builds also expose camelCase. Read both. */
function outputText(r: unknown): string {
  const o = r as { output_text?: string; outputText?: string };
  return o?.output_text ?? o?.outputText ?? "";
}

function parseJson<T>(text: string, fallback: T): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Models occasionally wrap JSON in prose; grab the outermost braces.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    return fallback;
  }
}

/** One structured-output call. */
export async function generateJSON<T>(
  input: unknown,
  schema: object,
  fallback: T,
  opts: { tools?: object[]; system?: string } = {},
): Promise<T> {
  const r = await ai().interactions.create({
    model: MODEL,
    input: opts.system ? [{ type: "text", text: opts.system }, input] : input,
    response_format: { type: "text", mime_type: "application/json", schema },
    ...(opts.tools ? { tools: opts.tools } : {}),
  } as never);
  return parseJson<T>(outputText(r), fallback);
}

export async function generateText(input: unknown, system?: string): Promise<string> {
  const r = await ai().interactions.create({
    model: MODEL,
    input: system ? [{ type: "text", text: system }, input] : input,
  } as never);
  return outputText(r);
}

/** Batch embeddings. Offline: deterministic per-text vectors so dedup still
 *  behaves sensibly against the fixture graph. */
/** Embed a single text with exponential backoff on 429. */
async function embedOne_(text: string): Promise<number[]> {
  const RETRIES = 4;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY!,
        },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
        }),
      },
    );
    if (res.status === 429) {
      // Exponential backoff: 2s, 4s, 8s, 16s
      const delay = 2000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    if (!res.ok) throw new Error(`embed failed ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { embedding?: { values: number[] } };
    return (data.embedding?.values ?? []).slice(0, EMBED_DIM);
  }
  throw new Error("embed failed: max retries exceeded (429 rate limit)");
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!hasApiKey()) return texts.map((t) => hashEmbed(t, EMBED_DIM));

  // Process in chunks of 3 to stay within rate limits, with backoff on each.
  const CHUNK = 3;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += CHUNK) {
    const chunk = texts.slice(i, i + CHUNK);
    const chunkResults = await Promise.all(chunk.map(embedOne_));
    results.push(...chunkResults);
    // Small pause between chunks to avoid bursting the quota
    if (i + CHUNK < texts.length) await new Promise((r) => setTimeout(r, 500));
  }
  return results;
}

export async function embedOne(text: string): Promise<number[]> {
  return (await embedBatch([text]))[0] ?? [];
}

// ---------------------------------------------------------------------------
// Consolidation decisions
// ---------------------------------------------------------------------------

export type ReconcileAction = "reinforce" | "supersede" | "contradict" | "distinct";

export type ReconcileResult = {
  action: ReconcileAction;
  rationale: string;
  /** Present for reinforce/supersede: the merged explanation to store. */
  mergedBody?: string;
};

const RECONCILE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["reinforce", "supersede", "contradict", "distinct"] },
    rationale: { type: "string" },
    mergedBody: { type: "string" },
  },
  required: ["action", "rationale"],
};

/**
 * The core memory decision: what happened when a new note covered ground the
 * learner already has?
 */
export async function reconcile(
  incoming: { title: string; body: string },
  existing: { title: string; body: string },
  similarity: number,
): Promise<ReconcileResult> {
  if (!hasApiKey()) {
    // Offline heuristic: identical-ish text reinforces, longer text supersedes.
    if (similarity > 0.97) return { action: "reinforce", rationale: "[offline] near-identical restatement" };
    if (incoming.body.length > existing.body.length * 1.4)
      return { action: "supersede", rationale: "[offline] incoming explanation is substantially fuller", mergedBody: incoming.body };
    return { action: "reinforce", rationale: "[offline] same concept restated" };
  }

  return generateJSON<ReconcileResult>(
    {
      type: "text",
      text: `A learner already has this concept in their notes:

EXISTING — ${existing.title}
${existing.body}

Their new notes contain this:

INCOMING — ${incoming.title}
${incoming.body}

Embedding similarity: ${similarity.toFixed(3)}.

Decide what happened:
- "reinforce": the same idea restated. Return mergedBody combining both, keeping any new detail.
- "supersede": their understanding has genuinely developed; the incoming version is more correct or complete. Return mergedBody = the better explanation.
- "contradict": the two make incompatible claims. Be strict — only when they cannot both be true. Explain the conflict in one sentence.
- "distinct": related but genuinely different ideas that the embedding confused.`,
    },
    RECONCILE_SCHEMA,
    { action: "reinforce", rationale: "fallback" },
  );
}

// ---------------------------------------------------------------------------
// Relation classification
// ---------------------------------------------------------------------------

export const RELATIONS = ["prerequisite", "elaborates", "example_of", "contradicts", "related"] as const;
export type Relation = (typeof RELATIONS)[number];

export type RelationPair = {
  sourceTitle: string;
  sourceBody: string;
  targetTitle: string;
  targetBody: string;
  similarity: number;
};

export type ClassifiedRelation = { index: number; relation: Relation; strength: number; rationale: string };

const RELATIONS_SCHEMA = {
  type: "object",
  properties: {
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          relation: { type: "string", enum: [...RELATIONS] },
          strength: { type: "number" },
          rationale: { type: "string" },
        },
        required: ["index", "relation", "strength", "rationale"],
      },
    },
  },
  required: ["relations"],
};

/** One batched call for every candidate pair, not one call per pair. */
export async function classifyRelations(pairs: RelationPair[]): Promise<ClassifiedRelation[]> {
  if (pairs.length === 0) return [];

  if (!hasApiKey()) {
    return pairs.map((p, index) => ({
      index,
      relation: "related" as Relation,
      strength: p.similarity,
      rationale: "[offline] similarity only",
    }));
  }

  const listing = pairs
    .map(
      (p, i) =>
        `[${i}] A = "${p.sourceTitle}": ${p.sourceBody.slice(0, 300)}\n    B = "${p.targetTitle}": ${p.targetBody.slice(0, 300)}`,
    )
    .join("\n\n");

  const result = await generateJSON<{ relations: ClassifiedRelation[] }>(
    {
      type: "text",
      text: `For each pair below, classify how A relates to B. Direction matters.

- prerequisite: A must be understood before B
- elaborates: A adds detail or nuance to B
- example_of: A is a concrete instance of B
- contradicts: A and B make incompatible claims (be strict — only if they cannot both be true)
- related: connected, but none of the above

Give strength 0-1 and a rationale of at most 12 words.

${listing}`,
    },
    RELATIONS_SCHEMA,
    { relations: [] },
  );

  return result.relations ?? [];
}

// ---------------------------------------------------------------------------
// Capture: OCR and concept extraction in ONE call
// ---------------------------------------------------------------------------

export const CONCEPT_KINDS = ["definition", "formula", "theorem", "example", "process", "fact"] as const;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    markdown: { type: "string" },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          body: { type: "string" },
          kind: { type: "string", enum: [...CONCEPT_KINDS] },
          latex: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          quote: { type: "string" },
        },
        required: ["title", "summary", "body", "kind"],
      },
    },
  },
  required: ["title", "markdown", "concepts"],
};

const EXTRACT_PROMPT = `These are a student's handwritten (or tablet-written) notes.

Do two things in one pass.

1. TRANSCRIBE into clean markdown. Be faithful to what is actually written —
   do not correct their mistakes, do not add material they did not write.
   Render every equation as LaTeX. Where a word is genuinely illegible write
   [?] rather than guessing: a plausible invention is far worse than a gap.

2. EXTRACT the atomic concepts. Each concept must be ONE self-contained idea,
   understandable on its own without the surrounding note. Split compound
   ideas apart; skip administrative scribble (dates, page numbers, "see p.42").
   For each concept give:
   - title: the canonical name of the idea, not a sentence
   - summary: one line, under 90 characters
   - body: a teachable explanation in your own words, grounded strictly in
     what they wrote. If their note is wrong, preserve the claim as written —
     contradictions get caught later, and silently correcting them here would
     hide the mistake from the student.
   - kind: definition | formula | theorem | example | process | fact
   - latex: the central equation, when kind is "formula"
   - tags: two or three subject tags
   - quote: the short phrase from the note this came from

Typical page yields 4-10 concepts. Prefer fewer, sharper concepts over many vague ones.`;

export type ExtractedNote = {
  title: string;
  markdown: string;
  concepts: {
    title: string; summary: string; body: string; kind: string;
    latex?: string; tags?: string[]; quote?: string;
  }[];
};

/** One call does OCR and distillation together -- a second round trip for
 *  extraction would roughly double the wait the user sits through. */
export async function extractFromFile(
  base64: string,
  mimeType: string,
): Promise<ExtractedNote> {
  const isPdf = mimeType === "application/pdf";
  return generateJSON<ExtractedNote>(
    [
      { type: isPdf ? "document" : "image", data: base64, mime_type: mimeType },
      { type: "text", text: EXTRACT_PROMPT },
    ],
    EXTRACT_SCHEMA,
    { title: "Untitled note", markdown: "", concepts: [] },
  );
}

// ---------------------------------------------------------------------------
// Research: Google Search grounding
// ---------------------------------------------------------------------------

export type ResearchResult = {
  refinedSummary: string;
  corrections: { claim: string; correction: string; confidence: number }[];
  openQuestions: string[];
  confirmed: string[];
  sources: { url: string; title: string }[];
};

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    refinedSummary: { type: "string" },
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          correction: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["claim", "correction", "confidence"],
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
    confirmed: { type: "array", items: { type: "string" } },
  },
  required: ["refinedSummary", "corrections", "openQuestions", "confirmed"],
};

/** Structured output and google_search combine in one call. */
export async function research(concept: { title: string; body: string }): Promise<ResearchResult> {
  if (!hasApiKey()) {
    return {
      refinedSummary: "[offline] Set GEMINI_API_KEY to fact-check this against live sources.",
      corrections: [], openQuestions: [], confirmed: [], sources: [],
    };
  }

  const r = await ai().interactions.create({
    model: MODEL,
    input: [
      {
        type: "text",
        text: `Fact-check and enrich a student's own note. Search for authoritative sources.

CONCEPT: ${concept.title}
THEIR NOTE: ${concept.body}

Report:
- refinedSummary: a corrected, better-sourced version of their explanation
- corrections: anything they got wrong or imprecise. Quote their exact claim.
  Be strict: only list genuine errors, not stylistic differences. confidence 0-1.
- confirmed: claims of theirs that the sources support
- openQuestions: what their note leaves unresolved and is worth exploring next`,
      },
    ],
    tools: [{ type: "google_search" }],
    response_format: { type: "text", mime_type: "application/json", schema: RESEARCH_SCHEMA },
  } as never);

  const parsed = parseJson<ResearchResult>(outputText(r), {
    refinedSummary: "", corrections: [], openQuestions: [], confirmed: [], sources: [],
  });

  return { ...parsed, sources: extractCitations(r) };
}

/** Citations live on annotations attached to the model_output steps. */
function extractCitations(r: unknown): { url: string; title: string }[] {
  const steps = (r as { steps?: unknown[] })?.steps ?? [];
  const seen = new Map<string, string>();

  for (const step of steps) {
    const s = step as { type?: string; content?: unknown[] };
    if (s?.type !== "model_output") continue;
    for (const part of s.content ?? []) {
      const annotations = (part as { annotations?: unknown[] })?.annotations ?? [];
      for (const a of annotations) {
        const ann = a as { type?: string; url?: string; title?: string };
        if (ann?.type === "url_citation" && ann.url && !seen.has(ann.url)) {
          seen.set(ann.url, ann.title ?? new URL(ann.url).hostname);
        }
      }
    }
  }

  return [...seen].map(([url, title]) => ({ url, title }));
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

const QUESTION_SCHEMA = {
  type: "object",
  properties: { question: { type: "string" }, idealAnswer: { type: "string" } },
  required: ["question", "idealAnswer"],
};

export async function generateQuestion(concept: { title: string; body: string }, misconception?: string) {
  if (!hasApiKey()) {
    return {
      question: `In your own words: what is "${concept.title}", and why does it matter?`,
      idealAnswer: concept.body,
    };
  }
  return generateJSON<{ question: string; idealAnswer: string }>(
    {
      type: "text",
      text: `Write ONE free-response question testing real understanding of this concept — not recall of its wording.

CONCEPT: ${concept.title}
${concept.body}
${misconception ? `\nThey previously showed this misunderstanding, so probe it: ${misconception}` : ""}

Keep it to one or two sentences. Also give the ideal answer.`,
    },
    QUESTION_SCHEMA,
    { question: `Explain ${concept.title} in your own words.`, idealAnswer: concept.body },
  );
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    feedback: { type: "string" },
    missedPoints: { type: "array", items: { type: "string" } },
    misconception: { type: "string" },
  },
  required: ["score", "feedback", "missedPoints"],
};

export async function gradeAnswer(
  concept: { title: string; body: string },
  question: string,
  answer: string,
) {
  if (!hasApiKey()) {
    // Length-based stand-in: enough to exercise the mastery writeback offline.
    const score = Math.min(1, answer.trim().split(/\s+/).length / 35);
    return {
      score,
      feedback: "[offline] Set GEMINI_API_KEY for real grading. Mastery still updated so you can see the graph recolour.",
      missedPoints: [] as string[],
      misconception: undefined as string | undefined,
    };
  }

  return generateJSON<{ score: number; feedback: string; missedPoints: string[]; misconception?: string }>(
    {
      type: "text",
      text: `Grade this answer against the concept. Be fair but honest — inflated scores make the spaced-repetition scheduling useless.

CONCEPT: ${concept.title}
${concept.body}

QUESTION: ${question}
THEIR ANSWER: ${answer}

score 0-1 on understanding, not wording. feedback: two sentences, addressed to them directly.
missedPoints: what they left out. misconception: if their answer reveals a specific wrong belief, state it in one sentence; otherwise omit.`,
    },
    GRADE_SCHEMA,
    { score: 0.5, feedback: "Could not grade.", missedPoints: [] },
  );
}
