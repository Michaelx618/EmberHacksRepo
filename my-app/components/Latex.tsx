"use client";

import { useEffect, useRef } from "react";

/** KaTeX renders to HTML, so this injects into a ref rather than using JSX. */
export default function Latex({ tex, display = false }: { tex: string; display?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const katex = (await import("katex")).default;
      if (!alive || !ref.current) return;
      try {
        katex.render(tex, ref.current, { throwOnError: false, displayMode: display });
      } catch {
        ref.current.textContent = tex; // degrade to raw source
      }
    })();
    return () => {
      alive = false;
    };
  }, [tex, display]);

  return <span ref={ref} className="katex-host">{tex}</span>;
}
