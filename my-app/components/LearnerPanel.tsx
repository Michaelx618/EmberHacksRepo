"use client";

import { STYLE_DIMENSIONS, type Style } from "@/lib/learner";

const POLES: Record<string, [string, string]> = {
  abstraction: ["concrete", "formal"],
  verbosity: ["terse", "thorough"],
  formalism: ["plain", "notation"],
  socratic: ["tell me", "ask me"],
  analogy: ["literal", "analogies"],
  pace: ["slow", "fast"],
};

/** Adaptive teaching is invisible unless you show it. These move live. */
export default function LearnerPanel({
  style, turnCount, confusedAbout,
}: {
  style: Style;
  turnCount: number;
  confusedAbout: string[];
}) {
  return (
    <div className="px-3 pb-3 space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
        <span>How it&apos;s teaching you</span>
        <span>{turnCount} turn{turnCount === 1 ? "" : "s"}</span>
      </div>

      <div className="space-y-1.5">
        {STYLE_DIMENSIONS.map((dim) => {
          const v = style[dim];
          const [low, high] = POLES[dim];
          const off = Math.abs(v - 0.5) > 0.15;
          return (
            <div key={dim} className="flex items-center gap-2 text-[10px]">
              <span className={`w-14 text-right shrink-0 ${v < 0.35 ? "text-accent" : "text-muted"}`}>{low}</span>
              <div className="flex-1 h-[3px] rounded-full bg-panel-raised relative">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
                <div
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full transition-all duration-700 ${
                    off ? "w-2 h-2 bg-accent" : "w-1.5 h-1.5 bg-muted"
                  }`}
                  style={{ left: `${v * 100}%` }}
                />
              </div>
              <span className={`w-14 shrink-0 ${v > 0.65 ? "text-accent" : "text-muted"}`}>{high}</span>
            </div>
          );
        })}
      </div>

      {confusedAbout.length > 0 && (
        <div className="text-[10px] text-muted pt-1.5 border-t border-border">
          <span className="text-contradicts">stuck on:</span> {confusedAbout.join(", ")}
        </div>
      )}
    </div>
  );
}
