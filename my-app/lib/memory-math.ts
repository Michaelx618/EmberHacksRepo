// Pure memory-strength math. No DB, no network -- unit-testable on its own.

/** Cosine above this means "you already have this concept", not a new one.
 *  The single most sensitive constant in the app:
 *    too low  -> distinct ideas merge and the graph collapses
 *    too high -> everything duplicates and reinforcement never fires */
export const DEDUP_THRESHOLD = 0.88;

/** Cosine above this is worth considering as a relation between concepts. */
export const LINK_THRESHOLD = 0.72;

/** How many neighbours to consider linking a new concept to. */
export const LINK_CANDIDATES = 5;

export const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * How durable a memory is, in days. Repetition across notes (encounterCount)
 * and active recall (reviewCount) both extend it, recall more strongly.
 */
export function halfLife(encounterCount: number, reviewCount: number): number {
  return 1 + 2 * encounterCount + 3 * reviewCount;
}

/**
 * How well you'd recall this right now: mastery decayed by time since review.
 * Drives node colour, quiz targeting and spaced repetition all at once.
 */
export function retrievability(
  concept: {
    mastery: number;
    encounterCount: number;
    reviewCount: number;
    lastReviewedAt: Date | null;
  },
  now: Date = new Date(),
): number {
  const { mastery, encounterCount, reviewCount, lastReviewedAt } = concept;
  if (mastery <= 0) return 0;

  // Never reviewed: nothing has decayed yet, but nothing was ever consolidated
  // either -- mastery is whatever reading it gave you.
  if (!lastReviewedAt) return mastery;

  const days = Math.max(0, (now.getTime() - lastReviewedAt.getTime()) / DAY_MS);
  return mastery * Math.exp(-days / halfLife(encounterCount, reviewCount));
}

/** EMA update after a graded quiz answer. */
export function updateMastery(current: number, score: number): number {
  const next = 0.6 * current + 0.4 * clamp01(score);
  return clamp01(next);
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Node fill: grey (cold) -> amber -> green (solid). */
export function masteryColor(r: number): string {
  const t = clamp01(r);
  if (t < 0.5) return lerpHex("#6b7280", "#f59e0b", t / 0.5);
  return lerpHex("#f59e0b", "#10b981", (t - 0.5) / 0.5);
}

function lerpHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * clamp01(t));
  return `rgb(${mix(a[0], b[0])}, ${mix(a[1], b[1])}, ${mix(a[2], b[2])})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
