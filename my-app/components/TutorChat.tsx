"use client";

import { useEffect, useRef, useState } from "react";
import type { ConceptDetail } from "./ConceptInspector";
import { NEUTRAL_STYLE, type Style } from "@/lib/learner";
import { youtubeThumb, type ToolEvent, type YoutubeRec } from "@/lib/tutor-types";
import LearnerPanel from "./LearnerPanel";
import QuizCard, { QuizTrigger, type QuizQuestion } from "./QuizCard";
import RichText from "./RichText";

type Msg = {
  role: "user" | "model";
  content: string;
  grounded?: string[];
  tools?: ToolEvent[];
  youtube?: YoutubeRec[];
};

export default function TutorChat({
  target, teachKey = 0, onMasteryChange,
}: {
  target: ConceptDetail | null;
  teachKey?: number;
  onMasteryChange: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<Style>(NEUTRAL_STYLE);
  const [turnCount, setTurnCount] = useState(0);
  const [confused, setConfused] = useState<string[]>([]);
  const [showProfile, setShowProfile] = useState(false);
  const [quizActive, setQuizActive] = useState(false);
  const [quizQuestion, setQuizQuestion] = useState<QuizQuestion | null>(null);
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!quizActive) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, quizActive]);

  useEffect(() => {
    if (target && teachKey > 0) {
      setQuizQuestion(null);
      setQuizActive(false);
      void send(`Teach me "${target.title}".`, target.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teachKey]);

  async function startQuiz() {
    setQuizBusy(true);
    setQuizError(null);
    try {
      const res = await fetch("/api/quiz");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not build a question");
      setQuizQuestion(data);
      setQuizActive(true);
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : "Failed");
    } finally {
      setQuizBusy(false);
    }
  }

  function endQuiz() {
    setQuizQuestion(null);
    setQuizActive(false);
    setQuizError(null);
  }

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
    if (!text.trim() || busy || quizActive) return;
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

      setMessages((m) => [
        ...m,
        {
          role: "model",
          content: data.reply,
          grounded: data.grounded,
          tools: data.tools,
          youtube: data.youtube,
        },
      ]);
      if (data.style) setStyle(data.style);
      if (typeof data.turnCount === "number") setTurnCount(data.turnCount);
      if (data.confusedAbout) setConfused(data.confusedAbout);
      if (data.graphChanged || data.masteryChanged) onMasteryChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function acceptLink(ev: Extract<ToolEvent, { tool: "propose_link" }>) {
    const key = `${ev.sourceId}-${ev.targetId}-${ev.relation}`;
    setAccepting(key);
    try {
      const res = await fetch("/api/tutor/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: ev.sourceId,
          targetId: ev.targetId,
          relation: ev.relation,
          rationale: ev.rationale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add link");
      onMasteryChange();
      setMessages((m) => [
        ...m,
        {
          role: "model",
          content: `Linked **${ev.sourceTitle}** → **${ev.targetTitle}** (${ev.relation.replace(/_/g, " ")}).`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed");
    } finally {
      setAccepting(null);
    }
  }

  const onQuizGraded = () => {
    onMasteryChange();
    void fetch("/api/tutor").then((r) => r.json()).then((d) => {
      if (d.confusedAbout) setConfused(d.confusedAbout);
    });
  };

  return (
    <div className="border-t border-border flex flex-col shrink-0 min-h-0" style={{ height: "46%" }}>
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <div className="flex-1 min-w-0 text-[10px] uppercase tracking-wider text-muted">
          <span className="text-foreground/80">Tutor</span>
          {quizActive ? (
            <span className="normal-case tracking-normal text-accent ml-2">quiz</span>
          ) : (
            turnCount > 0 && (
              <span className="normal-case tracking-normal text-muted/80 ml-2">{turnCount} turns</span>
            )
          )}
        </div>

        {!quizActive && (
          <>
            <QuizTrigger busy={quizBusy} onStart={startQuiz} error={quizError} />
            <button
              onClick={() => setShowProfile((v) => !v)}
              className="text-[10px] uppercase tracking-wider text-muted hover:text-foreground transition"
            >
              {showProfile ? "style ▾" : "style ▸"}
            </button>
          </>
        )}
      </div>

      {quizActive && quizQuestion ? (
        <QuizCard
          key={quizQuestion.question}
          question={quizQuestion}
          onClose={endQuiz}
          onGraded={onQuizGraded}
          onNext={startQuiz}
        />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto min-h-0">
            {showProfile && (
              <div className="border-b border-border pt-2">
                <LearnerPanel style={style} turnCount={turnCount} confusedAbout={confused} />
              </div>
            )}

            <div className="px-3 py-3 space-y-3">
              {messages.length === 0 && !busy && (
                <p className="text-xs text-muted leading-relaxed">
                  Ask about your notes, or hit <span className="text-foreground">Teach me this</span> on a concept.
                  Tap <span className="text-foreground">Quiz me</span> when you want to be tested.
                </p>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`text-[13px] leading-relaxed rounded-xl px-3 py-2.5 max-w-[95%] text-left ${
                      m.role === "user"
                        ? "bg-accent-dim text-foreground"
                        : "bg-panel-raised border border-border/70"
                    }`}
                  >
                    {m.role === "model" ? (
                      <RichText text={m.content} className="text-[13px] text-foreground/95" />
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                  </div>

                  {m.role === "model" && m.tools && m.tools.length > 0 && (
                    <div className="w-full max-w-[95%] space-y-1.5">
                      {m.tools.map((t, j) => (
                        <ToolCard key={j} event={t} accepting={accepting} onAcceptLink={acceptLink} />
                      ))}
                    </div>
                  )}

                  {m.grounded && m.grounded.length > 0 && (
                    <div className="flex flex-wrap gap-1 max-w-[95%]">
                      {m.grounded.map((g) => (
                        <span
                          key={g}
                          className="text-[10px] px-1.5 py-0.5 rounded-md bg-panel border border-border text-muted"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {busy && (
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  thinking…
                </div>
              )}
              {error && <div className="text-xs text-contradicts">{error}</div>}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="p-2 border-t border-border shrink-0">
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
        </>
      )}
    </div>
  );
}

function ToolCard({
  event,
  accepting,
  onAcceptLink,
}: {
  event: ToolEvent;
  accepting: string | null;
  onAcceptLink: (ev: Extract<ToolEvent, { tool: "propose_link" }>) => void;
}) {
  if (event.tool === "retrieve") {
    return (
      <div className="rounded-lg border border-border/80 bg-background/40 px-2.5 py-2 text-[11px]">
        <div className="text-accent font-medium mb-1">retrieve · {event.hits.length} hits</div>
        <div className="text-muted truncate mb-1">{event.query.slice(0, 80)}</div>
        <ul className="space-y-0.5 text-foreground/80">
          {event.hits.slice(0, 3).map((h) => (
            <li key={h.title} className="truncate">· {h.title}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (event.tool === "edit_graph") {
    return (
      <div className="rounded-lg border border-example/40 bg-example/10 px-2.5 py-2 text-[11px]">
        <div className="text-example font-medium mb-0.5">
          edit graph · {event.wasGhost ? "filled gap" : "updated"}
        </div>
        <div className="text-foreground">{event.title}</div>
        <div className="text-muted mt-0.5">{event.reason}</div>
      </div>
    );
  }

  if (event.tool === "propose_link") {
    const key = `${event.sourceId}-${event.targetId}-${event.relation}`;
    return (
      <div className="rounded-lg border border-accent/40 bg-accent-dim/40 px-2.5 py-2 text-[11px]">
        <div className="text-accent font-medium mb-1">propose link</div>
        <div className="text-foreground leading-snug">
          {event.sourceTitle}
          <span className="text-muted"> → </span>
          {event.targetTitle}
          <span className="text-muted"> · {event.relation.replace(/_/g, " ")}</span>
        </div>
        <div className="text-muted mt-0.5 mb-2">{event.rationale}</div>
        <button
          onClick={() => onAcceptLink(event)}
          disabled={accepting === key}
          className="text-[11px] px-2.5 py-1 rounded-md bg-accent/20 border border-accent/50 text-accent hover:bg-accent/30 transition disabled:opacity-50"
        >
          {accepting === key ? "adding…" : "Add to graph"}
        </button>
      </div>
    );
  }

  if (event.tool === "youtube") {
    return (
      <div className="space-y-1.5">
        {event.items.map((y) => (
          <YoutubeCard key={y.url + y.title} item={y} />
        ))}
      </div>
    );
  }

  return null;
}

function YoutubeCard({ item }: { item: YoutubeRec }) {
  const thumb = youtubeThumb(item.url);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="flex gap-2.5 rounded-lg border border-border/80 bg-background/50 px-2 py-2 hover:border-accent/40 transition group"
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="w-20 h-12 object-cover rounded-md shrink-0 opacity-90 group-hover:opacity-100" />
      ) : (
        <div className="w-20 h-12 rounded-md bg-panel-raised border border-border grid place-items-center text-[10px] text-muted shrink-0">
          YouTube
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-foreground leading-snug line-clamp-2 group-hover:text-accent transition">
          {item.title}
        </div>
        <div className="text-[10px] text-muted mt-0.5 line-clamp-2">{item.why}</div>
      </div>
    </a>
  );
}
