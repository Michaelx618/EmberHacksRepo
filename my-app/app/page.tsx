"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphLink, GraphNode } from "@/app/api/graph/route";
import CommandPalette from "@/components/CommandPalette";
import ConceptInspector, { type ConceptDetail } from "@/components/ConceptInspector";
import FlashcardsView from "@/components/FlashcardsView";
import LiveCapture from "@/components/LiveCapture";
import NoteUploader, { type IngestSummary } from "@/components/NoteUploader";
import TutorChat from "@/components/TutorChat";
import { RenameDialog, DeleteDialog } from "@/components/NoteDialog";
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<Layout>("web");
  const [view, setView] = useState<"graph" | "quiz">("graph");
  const [refreshKey, setRefreshKey] = useState(0);
  const [teachTarget, setTeachTarget] = useState<ConceptDetail | null>(null);
  const [teachKey, setTeachKey] = useState(0);
  const [banner, setBanner] = useState<IngestSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<Note | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);

  // Close note menu when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
                onClick={() => {
                  setLayout(l);
                  setView("graph");
                }}
                className={`px-2.5 py-1 transition ${
                  view === "graph" && layout === l ? "bg-panel-raised text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {l === "web" ? "Web" : "Study path"}
              </button>
            ))}
            <button
              onClick={() => setView("quiz")}
              className={`px-2.5 py-1 transition ${
                view === "quiz" ? "bg-panel-raised text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              Quiz
            </button>
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
          <LiveCapture
            onSessionStart={(n) => {
              // Focus the new note straight away, so the graph is already
              // showing the (empty) page the camera is about to fill.
              setBanner(null);
              setFocusNoteId(n.id);
              setRootId(null);
              setTrail([]);
              setView("graph");
              setRefreshKey((k) => k + 1);
            }}
            onGraphChanged={() => setRefreshKey((k) => k + 1)}
            onSessionEnd={(n, { deleted }) => {
              if (deleted && focusNoteId === n.id) setFocusNoteId(null);
              setRefreshKey((k) => k + 1);
            }}
          />
          <div className="px-3 pb-1 text-[11px] uppercase tracking-wider text-muted">Notes</div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5" ref={menuRef}>
            {(data?.notes ?? []).map((n) => (
              <div key={n.id} className="relative group">
                <button
                  onClick={() => {
                    setFocusNoteId((cur) => (cur === n.id ? null : n.id));
                    setRootId(null);
                    setTrail([]);
                  }}
                  className={`w-full text-left px-2 py-1.5 pr-7 rounded-md text-xs transition ${
                    focusNoteId === n.id ? "bg-accent-dim text-accent" : "hover:bg-panel-raised text-muted hover:text-foreground"
                  }`}
                >
                  <span className="block truncate">{n.title}</span>
                  <span className="block text-[10px] opacity-60">{n.sourceType}</span>
                </button>

                {/* Three-dot menu button */}
                <button
                  id={`note-menu-btn-${n.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId((cur) => (cur === n.id ? null : n.id));
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition text-muted hover:text-foreground hover:bg-panel-raised"
                  aria-label="Note options"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <circle cx="6" cy="2" r="1.2"/>
                    <circle cx="6" cy="6" r="1.2"/>
                    <circle cx="6" cy="10" r="1.2"/>
                  </svg>
                </button>

                {/* Dropdown menu */}
                {openMenuId === n.id && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-lg border border-border-strong bg-panel shadow-lg overflow-hidden">
                    <button
                      id={`note-rename-${n.id}`}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-panel-raised transition flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        setRenameTarget(n);
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L4 10H1.5V7.5L8.5 1.5z"/>
                      </svg>
                      Rename
                    </button>
                    <button
                      id={`note-delete-${n.id}`}
                      className="w-full text-left px-3 py-2 text-xs text-contradicts hover:bg-contradicts/10 transition flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        setDeleteTarget(n);
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M1.5 3h9M4.5 3V1.5h3V3M10 3l-.75 7.5h-6.5L2 3"/>
                      </svg>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-border text-[10px] text-muted leading-relaxed">
            <Legend />
          </div>
        </aside>

        {/* Center: the graph, or the flashcards page */}
        <main className="flex-1 min-w-0 relative">
          {view === "graph" && (trail.length > 0 || focusNoteId) && (
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

          {data && view === "quiz" ? (
            <FlashcardsView
              nodes={data.nodes}
              links={data.links}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : data ? (
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

      {/* Note dialogs */}
      {renameTarget && (
        <RenameDialog
          initialTitle={renameTarget.title}
          onConfirm={async (newTitle) => {
            await fetch(`/api/notes/${renameTarget.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: newTitle }),
            });
            setRenameTarget(null);
            setRefreshKey((k) => k + 1);
          }}
          onCancel={() => setRenameTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          noteTitle={deleteTarget.title}
          onConfirm={async () => {
            await fetch(`/api/notes/${deleteTarget.id}`, { method: "DELETE" });
            if (focusNoteId === deleteTarget.id) setFocusNoteId(null);
            setDeleteTarget(null);
            setRefreshKey((k) => k + 1);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
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
