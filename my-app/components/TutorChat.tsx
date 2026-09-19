"use client";

import { useEffect, useRef, useState } from "react";
import type { ConceptDetail } from "./ConceptInspector";
import { NEUTRAL_STYLE, type Style } from "@/lib/learner";
import LearnerPanel from "./LearnerPanel";
import QuizCard from "./QuizCard";

type Msg = { role: "user" | "model"; content: string; grounded?: string[] };

export default function TutorChat({
  target, onMasteryChange,
}: {
  target: ConceptDetail | null;
  onMasteryChange: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<Style>(NEUTRAL_STYLE);
  const [turnCount, setTurnCount] = useState(0);
  const [confused, setConfused] = useState<string[]>([]);
  const [showProfile, setShowProfile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // "Teach me this" from the inspector kicks off a turn.
  useEffect(() => {
    if (target) void send(`Teach me "${target.title}".`, target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  useEffect(() => {
    fetch("/api/tutor")
      .then((r) => r.json())
      .then((d) => {
        if (d.style) setStyle(d.style);
        if (typeof d.turnCount === "number") setTurnCount(d.turnCount);
        if (d.confusedAbout) setConfused(d.confusedAbout);
      })
      .catch(() => {});
  }, []);

  async function send(text: string, conceptId?: string) {
    if (!text.trim() || busy) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conceptId,
          history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Tutor failed (${res.status})`);

      setMessages((m) => [...m, { role: "model", content: data.reply, grounded: data.grounded }]);
      if (data.style) setStyle(data.style);
      if (typeof data.turnCount === "number") setTurnCount(data.turnCount);
      if (data.confusedAbout) setConfused(data.confusedAbout);
      if (data.masteryChanged) onMasteryChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border flex flex-col shrink-0 min-h-0" style={{ height: "46%" }}>
      <button
        onClick={() => setShowProfile((v) => !v)}
        className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted hover:text-foreground transition text-left border-b border-border flex justify-between"
      >
        <span>Tutor</span>
        <span>{showProfile ? "hide profile ▾" : "show profile ▸"}</span>
      </button>

      <div className="flex-1 overflow-y-auto min-h-0">
        {showProfile && (
          <div className="border-b border-border pt-2">
            <LearnerPanel style={style} turnCount={turnCount} confusedAbout={confused} />
          </div>
        )}

        <QuizCard
          onClose={() => {}}
          onGraded={() => {
            onMasteryChange();
            void fetch("/api/tutor").then((r) => r.json()).then((d) => {
              if (d.confusedAbout) setConfused(d.confusedAbout);
            });
          }}
        />

        <div className="px-3 py-2.5 space-y-2.5">
        {messages.length === 0 && !busy && (
          <p className="text-xs text-muted leading-relaxed">
            Ask about your notes, or hit <span className="text-foreground">Teach me this</span> on a concept.
            It adapts to how you ask.
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block text-xs leading-relaxed rounded-lg px-2.5 py-1.5 max-w-[92%] text-left whitespace-pre-wrap ${
                m.role === "user" ? "bg-accent-dim text-foreground" : "bg-panel-raised"
              }`}
            >
              {m.content}
            </div>
            {m.grounded && m.grounded.length > 0 && (
              <div className="text-[10px] text-muted mt-1">from: {m.grounded.join(" · ")}</div>
            )}
          </div>
        ))}

        {busy && <div className="text-xs text-muted">thinking…</div>}
        {error && <div className="text-xs text-contradicts">{error}</div>}
        <div ref={bottomRef} />
        </div>
      </div>

      <div className="p-2 border-t border-border">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Ask about your notes…"
          className="w-full resize-none bg-panel-raised rounded-lg px-2.5 py-2 text-xs outline-none border border-border focus:border-accent/50 transition placeholder:text-muted"
        />
      </div>
    </div>
  );
}
