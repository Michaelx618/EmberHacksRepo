"use client";

import { useState } from "react";
import { masteryColor } from "@/lib/memory-math";

type Question = { conceptId: string; conceptTitle: string; question: string; retrievability: number };
type Grade = {
  score: number; feedback: string; missedPoints: string[];
  misconception: string | null; masteryBefore: number; masteryAfter: number;
};

/** Grading writes mastery back, which recolours the node in the graph --
 *  that writeback is what makes the tutor and the memory one product. */
export default function QuizCard({
  conceptId, onClose, onGraded,
}: {
  conceptId?: string;
  onClose: () => void;
  onGraded: () => void;
}) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    setGrade(null);
    setAnswer("");
    try {
      const res = await fetch(`/api/quiz${conceptId ? `?conceptId=${conceptId}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not build a question");
      setQuestion(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!question || !answer.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId: question.conceptId, question: question.question, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Grading failed");
      setGrade(data);
      onGraded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!question) {
    return (
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <button
          onClick={load}
          disabled={busy}
          className="text-[11px] px-2 py-1 rounded-md border border-border hover:border-border-strong text-muted hover:text-foreground transition disabled:opacity-50"
        >
          {busy ? "…" : "Quiz me on my weakest concept"}
        </button>
        {error && <span className="text-[10px] text-contradicts">{error}</span>}
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 border-b border-border space-y-2 fade-up">
      <div className="flex justify-between items-start gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {question.conceptTitle} · {Math.round(question.retrievability * 100)}% recall
        </span>
        <button onClick={() => { setQuestion(null); onClose(); }} className="text-muted hover:text-foreground text-xs leading-none">✕</button>
      </div>

      <p className="text-xs leading-relaxed">{question.question}</p>

      {!grade ? (
        <>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            placeholder="Answer in your own words…"
            className="w-full resize-none bg-panel-raised rounded-lg px-2.5 py-2 text-xs outline-none border border-border focus:border-accent/50 transition placeholder:text-muted"
          />
          <button
            onClick={submit}
            disabled={busy || !answer.trim()}
            className="w-full text-xs px-3 py-1.5 rounded-lg bg-accent-dim border border-accent/40 text-accent hover:bg-accent/20 transition disabled:opacity-40"
          >
            {busy ? "Grading…" : "Submit"}
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold" style={{ color: masteryColor(grade.score) }}>
              {Math.round(grade.score * 100)}%
            </span>
            <span className="text-[10px] text-muted">
              mastery {Math.round(grade.masteryBefore * 100)}% → {Math.round(grade.masteryAfter * 100)}%
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted">{grade.feedback}</p>
          {grade.missedPoints.length > 0 && (
            <ul className="text-[11px] text-muted space-y-0.5">
              {grade.missedPoints.map((m, i) => <li key={i}>· {m}</li>)}
            </ul>
          )}
          {grade.misconception && (
            <p className="text-[11px] text-contradicts border-l-2 border-contradicts pl-2">{grade.misconception}</p>
          )}
          <button onClick={load} className="w-full text-xs px-3 py-1.5 rounded-lg border border-border hover:border-border-strong transition">
            Next question
          </button>
        </div>
      )}
    </div>
  );
}
