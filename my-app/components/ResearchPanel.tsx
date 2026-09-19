"use client";

import { useState } from "react";

type ResearchResult = {
  refinedSummary: string;
  corrections: { claim: string; correction: string; confidence: number }[];
  openQuestions: string[];
  confirmed: string[];
  sources: { url: string; title: string }[];
};

/** A proposal, never a silent overwrite -- the learner decides. */
export default function ResearchPanel({
  conceptId, onAccepted,
}: {
  conceptId: string;
  onAccepted: () => void;
}) {
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Research failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!result) return;
    setAccepting(true);
    try {
      await fetch("/api/research", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId,
          refinedSummary: result.refinedSummary,
          sources: result.sources,
        }),
      });
      setResult(null);
      onAccepted();
    } finally {
      setAccepting(false);
    }
  }

  if (!result) {
    return (
      <>
        <button
          onClick={run}
          disabled={busy}
          className="flex-1 text-sm px-3 py-2 rounded-lg border border-border hover:border-border-strong text-muted hover:text-foreground transition disabled:opacity-50"
        >
          {busy ? "Searching…" : "Fact-check"}
        </button>
        {error && <p className="text-xs text-contradicts mt-1 w-full">{error}</p>}
      </>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-lg border border-border bg-panel-raised p-3 fade-up">
      <div className="flex justify-between items-center">
        <span className="text-[11px] uppercase tracking-wider text-muted">Proposed revision</span>
        <button onClick={() => setResult(null)} className="text-muted hover:text-foreground text-xs">✕</button>
      </div>

      {result.corrections.length > 0 ? (
        <div className="space-y-2">
          {result.corrections.map((c, i) => (
            <div key={i} className="text-xs border-l-2 border-contradicts pl-2.5">
              <div className="text-muted line-through decoration-contradicts/50">{c.claim}</div>
              <div className="text-foreground mt-0.5">{c.correction}</div>
              <div className="text-[10px] text-muted mt-0.5">{Math.round(c.confidence * 100)}% confidence</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-example">No errors found — your note checks out.</p>
      )}

      {result.confirmed.length > 0 && (
        <div className="text-xs">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Confirmed</div>
          <ul className="space-y-0.5 text-muted">
            {result.confirmed.map((c, i) => <li key={i}>✓ {c}</li>)}
          </ul>
        </div>
      )}

      {result.openQuestions.length > 0 && (
        <div className="text-xs">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Worth exploring next</div>
          <ul className="space-y-0.5 text-muted">
            {result.openQuestions.map((q, i) => <li key={i}>· {q}</li>)}
          </ul>
        </div>
      )}

      {result.sources.length > 0 && (
        <div className="text-xs">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Sources</div>
          {result.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
               className="block text-accent hover:underline truncate">{s.title}</a>
          ))}
        </div>
      )}

      <button
        onClick={accept}
        disabled={accepting}
        className="w-full text-xs px-3 py-2 rounded-lg bg-accent-dim border border-accent/40 text-accent hover:bg-accent/20 transition disabled:opacity-50"
      >
        {accepting ? "Applying…" : "Accept revision"}
      </button>
    </div>
  );
}
