// Folding repeated full-page transcriptions into one note.
//
// Live capture re-reads the whole page on every frame it sends, which is what
// makes "hold up a finished page" work at all -- but it means the same page
// arrives as a transcription over and over.

const PAGE_BREAK = "\n\n---\n\n";

/**
 * Fold a full-page transcription into the note's existing one.
 *
 * The page in frame is almost always the one we transcribed last, and it only
 * ever grows, so the last block is replaced rather than added to. A genuinely
 * different page -- they turned to the next one -- shares little text with
 * that block and starts a new one.
 */
export function mergeTranscript(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const blocks = existing.split(PAGE_BREAK);
  const last = blocks[blocks.length - 1];

  if (samePage(last, incoming)) {
    // Keep whichever reading is fuller: a frame where a hand covered half the
    // page must not overwrite a clean shot of the whole thing.
    blocks[blocks.length - 1] = incoming.length >= last.length ? incoming : last;
    return blocks.join(PAGE_BREAK);
  }

  return existing + PAGE_BREAK + incoming;
}

/** Two transcriptions of the same page, allowing for OCR drift and new lines. */
function samePage(a: string, b: string): boolean {
  const before = new Set(words(a));
  const after = new Set(words(b));
  if (before.size === 0 || after.size === 0) return false;

  // Asymmetric on purpose: `b` is the newer and usually longer reading, so the
  // question is how much of the OLD page survives in it. Measuring the other
  // way round would call a page that gained a paragraph a different page.
  const shared = [...after].filter((w) => before.has(w)).length;
  return shared / before.size > 0.6;
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}
