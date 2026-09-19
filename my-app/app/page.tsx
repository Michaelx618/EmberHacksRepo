"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphLink, GraphNode } from "@/app/api/graph/route";
import CommandPalette from "@/components/CommandPalette";
import ConceptInspector, { type ConceptDetail } from "@/components/ConceptInspector";
import NoteUploader, { type IngestSummary } from "@/components/NoteUploader";
import TutorChat from "@/components/TutorChat";
import type { Layout } from "@/components/GraphView";
import { KIND_GLYPH, RELATION_COLOR, RELATION_LABEL } from "@/lib/graph-style";

// react-force-graph touches `window`, so it can't be server-rendered.
const GraphView = dynamic(() => import("@/components/GraphView"), {
  ssr: false,
  loading: () => <div className="h-full grid place-items-center text-sm text-muted">Loading graph…</div>,
});

type Note = { id: string; title: string; sourceType: string; createdAt: string };
type GraphPayload = {
  nodes: GraphNode[];
  links: GraphLink[];
  notes: Note[];
  unresolvedContradictions: number;
};

export default function Page() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<Layout>("web");
  const [refreshKey, setRefreshKey] = useState(0);
  const [teachTarget, setTeachTarget] = useState<ConceptDetail | null>(null);
  const [teachKey, setTeachKey] = useState(0);
  const [banner, setBanner] = useState<IngestSummary | null>(null);

  // Bumping refreshKey reloads the graph -- that's how mastery changes from
  // the quiz make it back onto the canvas.
  useEffect(() => {
    let alive = true;
    fetch("/api/graph")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const byId = useMemo(
    () => new Map((data?.nodes ?? []).map((n) => [n.id, n])),
    [data?.nodes],
  );

  const enter = useCallback((id: string) => {
    setRootId(id);
    setSelectedId(id);
    setFocusNoteId(null);
    setTrail((t) => (t[t.length - 1] === id ? t : [...t, id]));
  }, []);

  const popTrail = useCallback(() => {
    setTrail((t) => {
      const next = t.slice(0, -1);
      const last = next[next.length - 1] ?? null;
      setRootId(last);
      setSelectedId(last);
      return next;
    });
  }, []);

  const resetView = useCallback(() => {
    setRootId(null);
    setTrail([]);
    setFocusNoteId(null);
    setExpanded(new Set());
    setSelectedId(null);
  }, []);

  const stats = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const ghosts = nodes.filter((n) => n.status === "ghost").length;
    const avg = nodes.length
      ? nodes.filter((n) => n.status !== "ghost").reduce((s, n) => s + n.retrievability, 0) /
        Math.max(1, nodes.filter((n) => n.status !== "ghost").length)
      : 0;
    return { total: nodes.length, ghosts, avg };
  }, [data?.nodes]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex items-center gap-4 px-4 h-12 border-b border-border shrink-0">
        <span className="font-semibold text-sm tracking-tight">Recall</span>
        <span className="text-[11px] text-muted hidden sm:inline">
          {stats.total} concepts · {Math.round(stats.avg * 100)}% avg recall
          {stats.ghosts > 0 && ` · ${stats.ghosts} gap${stats.ghosts === 1 ? "" : "s"}`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {data && data.unresolvedContradictions > 0 && (
            <span className="text-[11px] px-2 py-1 rounded-md border border-contradicts/50 text-contradicts bg-contradicts/10">
              ⚠ {data.unresolvedContradictions} contradiction{data.unresolvedContradictions === 1 ? "" : "s"}
            </span>
          )}
          <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
            {(["web", "path"] as Layout[]).map((l) => (
              <button
                key={l}
                onClick={() => setLayout(l)}
                className={`px-2.5 py-1 transition ${layout === l ? "bg-panel-raised text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {l === "web" ? "Web" : "Study path"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left: capture + notes */}
        <aside className="w-60 shrink-0 border-r border-border flex flex-col min-h-0">
          <NoteUploader
            onIngested={(s) => {
              setBanner(s);
              setRefreshKey((k) => k + 1);
            }}
          />
          <div className="px-3 pb-1 text-[11px] uppercase tracking-wider text-muted">Notes</div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            {(data?.notes ?? []).map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setFocusNoteId((cur) => (cur === n.id ? null : n.id));
                  setRootId(null);
                  setTrail([]);
                }}
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition ${
                  focusNoteId === n.id ? "bg-accent-dim text-accent" : "hover:bg-panel-raised text-muted hover:text-foreground"
                }`}
              >
                <span className="block truncate">{n.title}</span>
                <span className="block text-[10px] opacity-60">{n.sourceType}</span>
              </button>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-border text-[10px] text-muted leading-relaxed">
            <Legend />
          </div>
        </aside>

        {/* Center: the graph */}
        <main className="flex-1 min-w-0 relative">
          {(trail.length > 0 || focusNoteId) && (
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 text-[11px] fade-up">
              <button onClick={resetView} className="px-2 py-1 rounded-md bg-panel border border-border hover:border-border-strong transition">
                Whole graph
              </button>
              {focusNoteId && (
                <>
                  <span className="text-muted">/</span>
                  <span className="px-2 py-1 rounded-md bg-panel border border-border text-accent">
                    {data?.notes.find((n) => n.id === focusNoteId)?.title}
                  </span>
                </>
              )}
              {trail.map((id, i) => (
                <span key={id} className="flex items-center gap-1.5">
                  <span className="text-muted">/</span>
                  <button
                    onClick={() => {
                      setTrail(trail.slice(0, i + 1));
                      setRootId(id);
                      setSelectedId(id);
                    }}
                    className={`px-2 py-1 rounded-md bg-panel border transition ${
                      i === trail.length - 1 ? "border-accent/50 text-accent" : "border-border hover:border-border-strong"
                    }`}
                  >
                    {byId.get(id)?.title ?? "…"}
                  </button>
                </span>
              ))}
              {trail.length > 0 && (
                <button onClick={popTrail} className="px-2 py-1 rounded-md bg-panel border border-border hover:border-border-strong transition">
                  ← back
                </button>
              )}
            </div>
          )}

          {banner && (
            <div className="absolute top-3 right-3 z-10 w-72 rounded-lg border border-border-strong bg-panel p-3 text-xs fade-up">
              <div className="flex justify-between items-start mb-1.5">
                <span className="font-medium">{banner.noteTitle}</span>
                <button onClick={() => setBanner(null)} className="text-muted hover:text-foreground">✕</button>
              </div>
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {banner.outcomes.map((o, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className={outcomeColor(o.action)}>{outcomeIcon(o.action)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{o.title}</span>
                      {o.action !== "created" && o.rationale && (
                        <span className="block text-muted text-[10px] leading-snug">{o.rationale}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 pt-2 border-t border-border text-muted">{banner.edgesCreated} links formed</div>
            </div>
          )}

          {data ? (
            <GraphView
              nodes={data.nodes}
              links={data.links}
              selectedId={selectedId}
              rootId={rootId}
              focusNoteId={focusNoteId}
              layout={layout}
              expanded={expanded}
              onSelect={setSelectedId}
              onEnter={enter}
              onExpand={(id) => setExpanded((s) => new Set(s).add(id))}
            />
          ) : (
            <div className="h-full grid place-items-center text-sm text-muted">Loading…</div>
          )}
        </main>

        {/* Right: inspector + tutor */}
        <aside className="w-[360px] shrink-0 border-l border-border flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <ConceptInspector
              conceptId={selectedId}
              refreshKey={refreshKey}
              onNavigate={(id) => setSelectedId(id)}
              onTeach={(c) => {
                setTeachTarget(c);
                setTeachKey((k) => k + 1);
              }}
              onRefresh={() => setRefreshKey((k) => k + 1)}
            />
          </div>
          <TutorChat
            target={teachTarget}
            teachKey={teachKey}
            onMasteryChange={() => setRefreshKey((k) => k + 1)}
          />
        </aside>
      </div>

      {data && <CommandPalette nodes={data.nodes} onPick={(id) => setSelectedId(id)} />}
    </div>
  );
}

function Legend() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {Object.entries(KIND_GLYPH).map(([kind, glyph]) => (
          <span key={kind} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-panel-raised border border-border text-[10px] text-foreground/90">
              {glyph}
            </span>
            <span>{kind}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 pt-1.5 border-t border-border">
        {Object.entries(RELATION_LABEL).map(([rel, label]) => (
          <span key={rel} className="whitespace-nowrap inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-px" style={{ background: RELATION_COLOR[rel] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

const outcomeIcon = (a: string) =>
  ({ created: "+", reinforced: "↑", superseded: "⟳", contradicted: "⚠" }[a] ?? "•");

const outcomeColor = (a: string) =>
  ({
    created: "text-accent",
    reinforced: "text-example",
    superseded: "text-prerequisite",
    contradicted: "text-contradicts",
  }[a] ?? "text-muted");
