"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RenameDialogProps = {
  initialTitle: string;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
};

type DeleteDialogProps = {
  noteTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
};

// ---------------------------------------------------------------------------
// Shared backdrop + panel shell
// ---------------------------------------------------------------------------

function DialogShell({
  children,
  onBackdropClick,
}: {
  children: React.ReactNode;
  onBackdropClick: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onBackdropClick();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBackdropClick]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onBackdropClick();
      }}
    >
      <div
        className="outline-none w-[380px] rounded-xl border border-[#3a3a50] shadow-2xl"
        style={{
          background: "#1a1a22",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
          animation: "dialog-in 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rename dialog
// ---------------------------------------------------------------------------

export function RenameDialog({ initialTitle, onConfirm, onCancel }: RenameDialogProps) {
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function submit() {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  }

  return (
    <DialogShell onBackdropClick={onCancel}>
      <div className="p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(124,107,255,0.15)" }}>
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="#7c6bff" strokeWidth="1.6">
              <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L4 10H1.5V7.5L8.5 1.5z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#e8e8f0]">Rename note</h2>
            <p className="text-[11px] text-[#6a6a8a] mt-0.5">Enter a new name for this note</p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all"
          style={{
            background: "#12121a",
            border: "1px solid #3a3a50",
            color: "#e8e8f0",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#7c6bff")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#3a3a50")}
          autoFocus
        />
      </div>

      <div className="flex justify-end gap-2 px-6 pb-6">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{ background: "#252530", color: "#8a8aaa", border: "1px solid #32323f" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#e8e8f0"; e.currentTarget.style.borderColor = "#4a4a60"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#8a8aaa"; e.currentTarget.style.borderColor = "#32323f"; }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!value.trim() || value.trim() === initialTitle}
          className="px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "#7c6bff", color: "#fff" }}
          onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#9080ff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#7c6bff"; }}
        >
          Rename
        </button>
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

export function DeleteDialog({ noteTitle, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <DialogShell onBackdropClick={onCancel}>
      <div className="p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: "rgba(239,68,68,0.12)" }}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="#ef4444" strokeWidth="1.6">
              <path d="M2 4h11M5 4V2.5h5V4M12 4l-.8 8H3.8L3 4"/>
              <path d="M6 7v3M9 7v3"/>
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#e8e8f0] mb-1.5">Delete note?</h2>
            <p className="text-[11px] leading-relaxed text-[#6a6a8a]">
              <span className="text-[#c0c0d8] font-medium">&ldquo;{noteTitle}&rdquo;</span>
              {" "}will be permanently deleted. Concepts sourced only from this note will also be removed from your graph.
            </p>
          </div>
        </div>

        <div className="rounded-lg p-3 text-[11px] text-[#8a5a5a]"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
          ⚠ This action cannot be undone.
        </div>
      </div>

      <div className="flex justify-end gap-2 px-6 pb-6">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{ background: "#252530", color: "#8a8aaa", border: "1px solid #32323f" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#e8e8f0"; e.currentTarget.style.borderColor = "#4a4a60"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#8a8aaa"; e.currentTarget.style.borderColor = "#32323f"; }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 rounded-lg text-xs font-semibold transition-all"
          style={{ background: "#dc2626", color: "#fff" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#ef4444"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#dc2626"; }}
        >
          Delete
        </button>
      </div>
    </DialogShell>
  );
}
