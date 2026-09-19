"use client";

import { Fragment, type ReactNode } from "react";
import { repairLatexEscapes } from "@/lib/text";
import Latex from "./Latex";

/**
 * Lightweight markdown + KaTeX for tutor replies and concept bodies.
 * Handles the subset the model actually emits: paragraphs, bullets, bold,
 * italic, inline/display math. No full CommonMark — keeps the client small.
 */
export default function RichText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const cleaned = repairLatexEscapes(text).trim();
  if (!cleaned) return null;

  const blocks = splitBlocks(cleaned);

  return (
    <div className={`rich-text space-y-2.5 ${className}`}>
      {blocks.map((block, i) => {
        if (block.type === "list") {
          return (
            <ul key={i} className="space-y-1 pl-3.5 list-disc marker:text-muted">
              {block.items.map((item, j) => (
                <li key={j} className="leading-relaxed pl-0.5">
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "math") {
          return (
            <div
              key={i}
              className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2 overflow-x-auto"
            >
              <Latex tex={block.tex} display />
            </div>
          );
        }
        if (block.type === "heading") {
          return (
            <p key={i} className="text-[11px] font-semibold uppercase tracking-wider text-muted pt-0.5">
              {renderInline(block.text)}
            </p>
          );
        }
        return (
          <p key={i} className="leading-relaxed">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: "para"; text: string }
  | { type: "list"; items: string[] }
  | { type: "math"; tex: string }
  | { type: "heading"; text: string };

function splitBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  // Display math as its own block first so list/para splitting doesn't break it.
  const parts = src.split(/(\$\$[\s\S]+?\$\$)/);

  for (const part of parts) {
    if (!part.trim()) continue;
    if (part.startsWith("$$") && part.endsWith("$$")) {
      blocks.push({ type: "math", tex: part.slice(2, -2).trim() });
      continue;
    }

    const chunks = part.split(/\n\s*\n/);
    for (const chunk of chunks) {
      const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
      if (lines.length === 0) continue;

      if (lines.every((l) => /^[-•*]\s+/.test(l.trim()) || /^\d+\.\s+/.test(l.trim()))) {
        blocks.push({
          type: "list",
          items: lines.map((l) => l.trim().replace(/^([-•*]|\d+\.)\s+/, "")),
        });
        continue;
      }

      // Consecutive bullet lines mixed into a paragraph chunk.
      let buf: string[] = [];
      let listBuf: string[] = [];
      const flushPara = () => {
        if (buf.length) {
          const text = buf.join(" ").trim();
          if (/^#{1,3}\s+/.test(text)) {
            blocks.push({ type: "heading", text: text.replace(/^#{1,3}\s+/, "") });
          } else {
            blocks.push({ type: "para", text });
          }
          buf = [];
        }
      };
      const flushList = () => {
        if (listBuf.length) {
          blocks.push({ type: "list", items: listBuf });
          listBuf = [];
        }
      };

      for (const line of lines) {
        const t = line.trim();
        if (/^[-•*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
          flushPara();
          listBuf.push(t.replace(/^([-•*]|\d+\.)\s+/, ""));
        } else {
          flushList();
          buf.push(t);
        }
      }
      flushList();
      flushPara();
    }
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  // Math first (incl. \(…\)), then bold/italic/code. Underscore italic is
  // restricted so `\mathbb{R}` outside math isn't eaten.
  const tokens = text.split(
    /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\*\*[^*]+\*\*|__[a-zA-Z][^_\n]*__|_[a-zA-Z][^_\n]*[a-zA-Z]_|\*[^*]+\*|`[^`]+`)/,
  );
  return tokens.map((tok, i) => {
    if (!tok) return <Fragment key={i} />;
    if (tok.startsWith("$$") && tok.endsWith("$$") && tok.length > 4) {
      return <Latex key={i} tex={tok.slice(2, -2)} display />;
    }
    if (tok.startsWith("$") && tok.endsWith("$") && tok.length > 2) {
      return <Latex key={i} tex={tok.slice(1, -1)} />;
    }
    if (tok.startsWith("\\(") && tok.endsWith("\\)")) {
      return <Latex key={i} tex={tok.slice(2, -2)} />;
    }
    if (tok.startsWith("**") && tok.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {renderInline(tok.slice(2, -2))}
        </strong>
      );
    }
    if (tok.startsWith("__") && tok.endsWith("__")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2 && !tok.startsWith("**")) {
      return (
        <em key={i} className="italic text-muted">
          {tok.slice(1, -1)}
        </em>
      );
    }
    if (tok.startsWith("_") && tok.endsWith("_") && tok.length > 2) {
      return (
        <em key={i} className="italic text-muted">
          {tok.slice(1, -1)}
        </em>
      );
    }
    if (tok.startsWith("`") && tok.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded px-1 py-0.5 text-[0.92em] bg-background/50 border border-border/50 font-mono"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{tok}</Fragment>;
  });
}
