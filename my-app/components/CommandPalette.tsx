"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_GLYPH } from "@/lib/graph-style";
import type { GraphNode } from "@/app/api/graph/route";

export default function CommandPalette({
  nodes, onPick,
}: {
  nodes: GraphNode[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setCursor(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? nodes.filter((n) => n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q))
      : [...nodes].sort((a, b) => b.degree - a.degree);
    return pool.slice(0, 8);
  }, [query, nodes]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/50 backdrop-blur-sm"
         onClick={() => setOpen(false)}>
      <div className="w-[min(560px,92vw)] rounded-xl border border-border-strong bg-panel shadow-2xl overflow-hidden fade-up"
           onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === "Enter" && results[cursor]) {
              onPick(results[cursor].id);
              setOpen(false);
            }
          }}
          placeholder="Jump to a concept…"
          className="w-full bg-transparent px-4 py-3.5 text-sm outline-none border-b border-border placeholder:text-muted"
        />
        <div className="max-h-[320px] overflow-y-auto py-1">
          {results.length === 0 && <div className="px-4 py-6 text-sm text-muted text-center">No matches</div>}
          {results.map((n, i) => (
            <button
              key={n.id}
              onMouseEnter={() => setCursor(i)}
              onClick={() => {
                onPick(n.id);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2 flex items-center gap-3 transition ${i === cursor ? "bg-panel-raised" : ""}`}
            >
              <span className="text-muted w-4 text-center">{KIND_GLYPH[n.kind] ?? "▪"}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{n.title}</span>
                <span className="block text-xs text-muted truncate">{n.summary}</span>
              </span>
              {n.status === "ghost" && <span className="text-[10px] text-muted border border-dashed border-muted rounded px-1">gap</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
