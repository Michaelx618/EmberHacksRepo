// Every visual channel on a node carries exactly one meaning. No decoration.

import { masteryColor } from "./memory-math";

export const KIND_GLYPH: Record<string, string> = {
  definition: "≡", // identical to
  formula: "ƒ", // f
  theorem: "⊢", // turnstile
  example: "◆", // diamond
  process: "⟳", // cycle
  fact: "▪", // square
};

export const KIND_LABEL: Record<string, string> = {
  definition: "Definition",
  formula: "Formula",
  theorem: "Theorem",
  example: "Example",
  process: "Process",
  fact: "Fact",
};

export const RELATION_COLOR: Record<string, string> = {
  prerequisite: "#5b8def",
  elaborates: "#8b93a7",
  example_of: "#34d399",
  contradicts: "#f04a5e",
  related: "#3a4152",
};

export const RELATION_LABEL: Record<string, string> = {
  prerequisite: "needed for",
  elaborates: "elaborates",
  example_of: "example of",
  contradicts: "contradicts",
  related: "related to",
};

/** Directed relations get an arrowhead; symmetric ones don't. */
export const RELATION_DIRECTED: Record<string, boolean> = {
  prerequisite: true,
  elaborates: true,
  example_of: true,
  contradicts: false,
  related: false,
};

export const GHOST_COLOR = "#4b5366";
export const CONTRADICTION_COLOR = RELATION_COLOR.contradicts;

/** Size encodes degree: hubs stand out without swamping the canvas. */
export function nodeRadius(degree: number): number {
  return Math.min(14, 4 + Math.sqrt(degree) * 2.4);
}

export function nodeFill(status: string, retrievability: number): string {
  return status === "ghost" ? "transparent" : masteryColor(retrievability);
}

// --- LaTeX node faces -------------------------------------------------------
// KaTeX renders HTML; we wrap it in an SVG foreignObject and load it as an
// image so it can be drawn onto the canvas. If anything in that chain fails
// the node silently falls back to its kind glyph.

type CacheEntry = { img: HTMLImageElement | null; state: "loading" | "ready" | "failed" };
const latexCache = new Map<string, CacheEntry>();

export function getLatexImage(latex: string): HTMLImageElement | null {
  const hit = latexCache.get(latex);
  if (hit) return hit.state === "ready" ? hit.img : null;

  const entry: CacheEntry = { img: null, state: "loading" };
  latexCache.set(latex, entry);

  void (async () => {
    try {
      const katex = (await import("katex")).default;
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
        output: "html",
      });
      const css = await loadKatexCss();

      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="80">` +
        `<foreignObject width="100%" height="100%">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;height:80px;color:#e6e8ee;font-size:22px">` +
        `<style>${css}</style>${html}</div></foreignObject></svg>`;

      const img = new Image();
      img.onload = () => {
        entry.img = img;
        entry.state = "ready";
      };
      img.onerror = () => {
        entry.state = "failed";
      };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch {
      entry.state = "failed";
    }
  })();

  return null;
}

let katexCssPromise: Promise<string> | null = null;
function loadKatexCss(): Promise<string> {
  // Fonts can't be inlined into the foreignObject, so KaTeX falls back to the
  // system serif -- still legible, and the layout rules are what matter.
  katexCssPromise ??= fetch("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css")
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  return katexCssPromise;
}

// --- Level of detail --------------------------------------------------------
// Without this, 200 nodes is an unreadable hairball; with it, zooming out
// becomes a genuine overview where cluster shapes read as topics.

export type Lod = "far" | "mid" | "near";

export function lodFor(globalScale: number): Lod {
  if (globalScale < 0.7) return "far";
  if (globalScale < 1.8) return "mid";
  return "near";
}
