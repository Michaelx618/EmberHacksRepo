"use client";

import { useEffect, useState } from "react";
import { KIND_LABEL, RELATION_COLOR, RELATION_LABEL } from "@/lib/graph-style";
import { masteryColor } from "@/lib/memory-math";
import Latex from "./Latex";
import ResearchPanel from "./ResearchPanel";
import RichText from "./RichText";

type Related = {
  id: string; title: string; kind: string; status: string;
  relation: string; rationale: string; strength: number;
  resolved: boolean; direction: "incoming" | "outgoing";
};

export type ConceptDetail = {
  id: string; title: string; summary: string; body: string; kind: string;
  latex: string | null; status: string; tags: string[];
  mastery: number; retrievability: number;
  encounterCount: number; reviewCount: number; lastReviewedAt: string | null;
  sourcesJson: { url: string; title: string }[];
  sources: { id: string; quote: string | null; note: { id: string; title: string; sourceType: string; createdAt: string } }[];
  revisions: { id: string; body: string; reason: string; createdAt: string }[];
  related: Related[];
};

export default function ConceptInspector({
  conceptId, onNavigate, onTeach, onRefresh, refreshKey,
}: {
  conceptId: string | null;
  onNavigate: (id: string) => void;
  onTeach: (c: ConceptDetail) => void;
  onRefresh: () => void;
  refreshKey: number;
}) {
  const [loaded, setDetail] = useState<ConceptDetail | null>(null);

  useEffect(() => {
    if (!conceptId) return;
    let alive = true;
    fetch(`/api/concepts/${conceptId}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setDetail(d.error ? null : d);
      });
    return () => {
      alive = false;
    };
  }, [conceptId, refreshKey]);

  // Derive rather than setting state in an effect: avoids cascading renders
  // and stops the previous concept flashing while the next one loads.
  const detail = conceptId && loaded?.id === conceptId ? loaded : null;
  const loading = conceptId !== null && detail === null;

  if (!conceptId) {
    return (
      <div className="p-5 text-sm text-muted leading-relaxed">
        <p className="font-medium text-foreground mb-2">Nothing selected</p>
        <p>Click a node to inspect it. Right-click (or press Enter) to explore its local neighbourhood.</p>
        <ul className="mt-4 space-y-1.5 text-xs">
          <li><Key>⌘K</Key> jump to any concept</li>
          <li><Key>↑↓←→</Key> walk between linked concepts</li>
          <li><Key>Esc</Key> zoom back out</li>
        </ul>
      </div>
    );
  }

  if (loading && !detail) return <div className="p-5 text-sm text-muted">Loading…</div>;
  if (!detail) return <div className="p-5 text-sm text-muted">Not found.</div>;

  const isGhost = detail.status === "ghost";
  const grouped = groupBy(detail.related, (r) => r.relation);

  return (
    <div className="p-5 space-y-5 fade-up">
      <header>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-panel-raised border border-border text-muted">
            {KIND_LABEL[detail.kind] ?? detail.kind}
          </span>
          {isGhost && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-dashed border-muted text-muted">
              undefined
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold leading-snug">{detail.title}</h2>
        <p className="text-sm text-muted mt-1">{detail.summary}</p>
      </header>

      {!isGhost && (
        <div>
          <div className="flex justify-between text-[11px] text-muted mb-1">
            <span>recall strength</span>
            <span>{Math.round(detail.retrievability * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-panel-raised overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${detail.retrievability * 100}%`, background: masteryColor(detail.retrievability) }}
            />
          </div>
          <p className="text-[11px] text-muted mt-1.5">
            seen in {detail.encounterCount} note{detail.encounterCount === 1 ? "" : "s"} · quizzed {detail.reviewCount}×
            {detail.lastReviewedAt && ` · last ${relativeDays(detail.lastReviewedAt)}`}
          </p>
        </div>
      )}

      {detail.latex && (
        <div className="rounded-lg border border-border bg-panel-raised px-3 py-3 overflow-x-auto">
          <Latex tex={detail.latex} display />
        </div>
      )}

      {isGhost ? (
        <p className="text-sm text-muted leading-relaxed border border-dashed border-border rounded-lg p-3">
          Your notes reference this as a prerequisite, but never define it. This is a gap in your
          knowledge graph — research it to fill it in.
        </p>
      ) : (
        <RichText text={detail.body} className="text-sm text-foreground/90" />
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => onTeach(detail)}
          className="flex-1 text-sm px-3 py-2 rounded-lg bg-accent-dim border border-accent/40 text-accent hover:bg-accent/20 transition"
        >
          Teach me this
        </button>
        <ResearchPanel conceptId={detail.id} onAccepted={onRefresh} />
      </div>

      {detail.sources.length > 0 && (
        <Section title={`From your notes (${detail.sources.length})`}>
          {detail.sources.map((s) => (
            <div key={s.id} className="text-xs border-l-2 border-border pl-2.5 py-0.5">
              <div className="text-foreground">{s.note.title}</div>
              {s.quote && <div className="text-muted italic mt-0.5">{s.quote}</div>}
            </div>
          ))}
        </Section>
      )}

      {Object.entries(grouped).map(([relation, items]) => (
        <Section
          key={relation}
          title={relation === "contradicts" ? "⚠ Conflicts with" : capitalize(RELATION_LABEL[relation] ?? relation)}
          accent={RELATION_COLOR[relation]}
        >
          {items.map((r) => (
            <button
              key={`${r.id}-${r.relation}-${r.direction}`}
              onClick={() => onNavigate(r.id)}
              className="w-full text-left text-xs rounded-md px-2 py-1.5 hover:bg-panel-raised transition group"
            >
              <span className="text-muted">{r.direction === "incoming" ? "← " : "→ "}</span>
              <span className="group-hover:text-accent transition">{r.title}</span>
              {r.rationale && <div className="text-muted mt-0.5 leading-snug">{r.rationale}</div>}
            </button>
          ))}
        </Section>
      ))}

      {detail.sourcesJson.length > 0 && (
        <Section title="Verified against">
          {detail.sourcesJson.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
               className="block text-xs text-accent hover:underline truncate">
              {s.title || s.url}
            </a>
          ))}
        </Section>
      )}

      {detail.revisions.length > 0 && (
        <Section title="How your understanding changed">
          {detail.revisions.map((r) => (
            <details key={r.id} className="text-xs">
              <summary className="cursor-pointer text-muted hover:text-foreground transition">
                {relativeDays(r.createdAt)} — {r.reason}
              </summary>
              <p className="mt-1.5 pl-2.5 border-l-2 border-border text-muted leading-relaxed line-through decoration-muted/40">
                {r.body}
              </p>
            </details>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider mb-1.5" style={{ color: accent ?? "var(--muted)" }}>
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1.5 py-0.5 rounded bg-panel-raised border border-border text-[10px] mr-1.5">{children}</kbd>;
}

function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const i of items) (out[key(i)] ??= []).push(i);
  return out;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
