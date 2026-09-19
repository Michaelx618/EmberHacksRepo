"use client";

import { useMemo, useState } from "react";
import type { GraphLink, GraphNode } from "@/app/api/graph/route";
import { KIND_GLYPH, KIND_LABEL } from "@/lib/graph-style";
import Latex from "./Latex";

type Props = {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const endId = (v: string | GraphNode) => (typeof v === "string" ? v : v.id);

export default function FlashcardsView({ nodes, links, selectedId, onSelect }: Props) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // The deck: the selected concept first, then whatever it's directly linked
  // to. Ghosts are excluded -- they have no definition to quiz on.
  const deck = useMemo(() => {
    if (!selectedId) return [];
    const selected = byId.get(selectedId);
    if (!selected) return [];

    const neighbourIds = new Set<string>();
    for (const l of links) {
      const s = endId(l.source as string);
      const t = endId(l.target as string);
      if (s === selectedId) neighbourIds.add(t);
      else if (t === selectedId) neighbourIds.add(s);
    }

    const neighbours = [...neighbourIds]
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => Boolean(n) && n!.status !== "ghost");

    const cards = selected.status !== "ghost" ? [selected, ...neighbours] : neighbours;
    return cards;
  }, [selectedId, byId, links]);

  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setFlipped((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!selectedId) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div className="max-w-xs text-sm text-muted leading-relaxed">
          <p className="font-medium text-foreground mb-1.5">No concept selected</p>
          <p>Pick a node from Web or Study path, then come back here for its flashcards.</p>
        </div>
      </div>
    );
  }

  if (deck.length === 0) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div className="max-w-xs text-sm text-muted leading-relaxed">
          <p className="font-medium text-foreground mb-1.5">Nothing to study yet</p>
          <p>This concept has no definition and no defined neighbours.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-foreground">
            Flashcards <span className="text-muted font-normal">— {byId.get(selectedId)?.title}</span>
          </h2>
          <span className="text-[11px] text-muted">{deck.length} card{deck.length === 1 ? "" : "s"} · click to flip</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {deck.map((c) => (
            <Card
              key={c.id}
              node={c}
              isFlipped={flipped.has(c.id)}
              isPrimary={c.id === selectedId}
              onFlip={() => toggle(c.id)}
              onOpen={() => onSelect(c.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({
  node, isFlipped, isPrimary, onFlip, onOpen,
}: {
  node: GraphNode;
  isFlipped: boolean;
  isPrimary: boolean;
  onFlip: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={`flip-card h-48 cursor-pointer ${isFlipped ? "flipped" : ""}`}
      onClick={onFlip}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFlip();
        }
      }}
    >
      <div className="flip-card-inner">
        {/* Front: the term */}
        <div
          className={`flip-card-face rounded-xl border p-4 flex flex-col ${
            isPrimary ? "border-accent/40 bg-accent-dim" : "border-border bg-panel"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-panel-raised border border-border text-muted">
              {KIND_LABEL[node.kind] ?? node.kind}
            </span>
            {isPrimary && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                selected
              </span>
            )}
          </div>
          <div className="flex-1 grid place-items-center text-center px-2">
            <div>
              <div className="text-2xl mb-1.5 opacity-70">{KIND_GLYPH[node.kind] ?? "▪"}</div>
              <div className="font-semibold leading-snug">{node.title}</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>{Math.round(node.retrievability * 100)}% recall</span>
            <span>flip →</span>
          </div>
        </div>

        {/* Back: the definition */}
        <div className="flip-card-face flip-card-back rounded-xl border border-border bg-panel-raised p-4 flex flex-col">
          <div className="flex-1 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap">
            {node.kind === "formula" && node.latex ? (
              <div className="mb-2"><Latex tex={node.latex} display /></div>
            ) : null}
            {node.body || node.summary}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="mt-2 text-[11px] text-accent hover:underline text-left"
          >
            Open in inspector →
          </button>
        </div>
      </div>
    </div>
  );
}
