"use client";

import { useState } from "react";
import { masteryColor } from "@/lib/memory-math";
import RichText from "./RichText";

export type QuizQuestion = {
  conceptId: string;
  conceptTitle: string;
  question: string;
  retrievability: number;
};

type Grade = {
  score: number; feedback: string; missedPoints: string[];
  misconception: string | null; masteryBefore: number; masteryAfter: number;
};

/** Compact header trigger — starts a quiz without owning session state. */
export function QuizTrigger({
  busy, onStart, error,
}: {
  busy: boolean;
  onStart: () => void;
  error?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="text-[10px] px-2 py-1 rounded-md border border-border hover:border-border-strong text-muted hover:text-foreground transition disabled:opacity-50"
      >
        {busy ? "…" : "Quiz me"}
      </button>
      {error && <span className="text-[10px] text-contradicts max-w-[8rem] truncate">{error}</span>}
    </span>
  );
}

/** Full-panel quiz session. Parent hides chat while this is mounted. */
export default function QuizCard({
  question, onClose, onGraded, onNext,
}: {
  question: QuizQuestion;
  onClose: () => void;
  onGraded: () => void;
  onNext: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId: question.conceptId,
          question: question.question,
          answer,
        }),
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

  return (
    <div className="flex-1 flex flex-col min-h-0 fade-up">
      <div className="px-3 py-2 border-b border-border flex justify-between items-center gap-2 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted truncate">
          Quiz · {question.conceptTitle} · {Math.round(question.retrievability * 100)}% recall
        </span>
        <button onClick={onClose} className="text-muted hover:text-foreground text-[11px] leading-none shrink-0">
          ✕ back to chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        <RichText text={question.question} className="text-[13px] text-foreground/95" />

        {!grade ? (
          <>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={4}
              placeholder="Answer in your own words…"
              className="w-full resize-none bg-panel-raised rounded-lg px-2.5 py-2 text-xs outline-none border border-border focus:border-accent/50 transition placeholder:text-muted"
            />
            {error && <p className="text-[11px] text-contradicts">{error}</p>}
            <button
              onClick={submit}
              disabled={busy || !answer.trim()}
              className="w-full text-xs px-3 py-2 rounded-lg bg-accent-dim border border-accent/40 text-accent hover:bg-accent/20 transition disabled:opacity-40"
            >
              {busy ? "Grading…" : "Submit"}
            </button>
          </>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold" style={{ color: masteryColor(grade.score) }}>
                {Math.round(grade.score * 100)}%
              </span>
              <span className="text-[10px] text-muted">
                mastery {Math.round(grade.masteryBefore * 100)}% → {Math.round(grade.masteryAfter * 100)}%
              </span>
            </div>
            <RichText text={grade.feedback} className="text-xs text-muted" />
            {grade.missedPoints.length > 0 && (
              <ul className="text-[11px] text-muted space-y-1">
                {grade.missedPoints.map((m, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="shrink-0">·</span>
                    <RichText text={m} className="text-[11px]" />
                  </li>
                ))}
              </ul>
            )}
            {grade.misconception && (
              <div className="text-[11px] text-contradicts border-l-2 border-contradicts pl-2">
                <RichText text={grade.misconception} className="text-[11px] text-contradicts" />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setGrade(null);
                  setAnswer("");
                  onNext();
                }}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-border hover:border-border-strong transition"
              >
                Next question
              </button>
              <button
                onClick={onClose}
                className="text-xs px-3 py-2 rounded-lg text-muted hover:text-foreground transition"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
