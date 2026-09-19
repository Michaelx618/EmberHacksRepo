"use client";

import { useRef, useState } from "react";

/** Honest about latency: the stages are what the pipeline is actually doing. */
const STAGES = [
  "Reading your handwriting…",
  "Recalling what you already know…",
  "Reconciling against your notes…",
  "Linking into your graph…",
];

export type IngestSummary = {
  noteTitle: string;
  outcomes: { action: string; title: string; matchedTitle?: string; rationale?: string }[];
  edgesCreated: number;
};

export default function NoteUploader({ onIngested }: { onIngested: (s: IngestSummary) => void }) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setStage(0);

    // The stages advance on a timer -- the server does them in one pass, so
    // there are no real per-stage callbacks to wait on.
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2600);

    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/notes", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      onIngested(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  }

  return (
    <div className="p-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`rounded-lg border border-dashed px-3 py-5 text-center cursor-pointer transition ${
          dragging ? "border-accent bg-accent-dim/40" : "border-border hover:border-border-strong"
        } ${busy ? "pointer-events-none" : ""}`}
      >
        {busy ? (
          <div className="space-y-2">
            <div className="text-xs text-accent">{STAGES[stage]}</div>
            <div className="h-1 rounded-full bg-panel-raised overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-700"
                style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="text-sm">Drop notes here</div>
            <div className="text-[11px] text-muted mt-1">photo of handwriting, or an iPad PDF</div>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />

      {error && <p className="mt-2 text-xs text-contradicts">{error}</p>}
    </div>
  );
}
