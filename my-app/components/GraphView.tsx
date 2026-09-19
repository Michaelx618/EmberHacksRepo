"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphLink, GraphNode } from "@/app/api/graph/route";
import {
  CONTRADICTION_COLOR, GHOST_COLOR, KIND_GLYPH, RELATION_COLOR,
  RELATION_DIRECTED, getLatexImage, lodFor, nodeFill, nodeRadius,
} from "@/lib/graph-style";

// force-graph mutates links, replacing the id strings with node objects.
type RuntimeLink = Omit<GraphLink, "source" | "target"> & {
  source: string | GraphNode;
  target: string | GraphNode;
};
type PositionedNode = GraphNode & {
  x?: number; y?: number; fx?: number; fy?: number;
  /** set when the user drags a node, so the web layout stops re-solving it */
  __pinned?: boolean;
};

/** The handful of imperative methods we drive on the force-graph instance. */
type ForceGraphInstance = {
  centerAt: (x?: number, y?: number, durationMs?: number) => void;
  zoom: { (k: number, durationMs?: number): void; (): number };
  zoomToFit: (durationMs?: number, padding?: number) => void;
};

type ForceGraphComponent = React.ComponentType<Record<string, unknown>>;

const endId = (v: string | GraphNode) => (typeof v === "string" ? v : v.id);

export type Layout = "web" | "path";

type Props = {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId: string | null;
  rootId: string | null;
  focusNoteId: string | null;
  layout: Layout;
  expanded: Set<string>;
  onSelect: (id: string | null) => void;
  onEnter: (id: string) => void;
  onExpand: (id: string) => void;
};

export default function GraphView({
  nodes, links, selectedId, rootId, focusNoteId, layout, expanded,
  onSelect, onEnter, onExpand,
}: Props) {
  const fgRef = useRef<ForceGraphInstance | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [ForceGraph, setForceGraph] = useState<ForceGraphComponent | null>(null);

  // react-force-graph touches window at import time.
  useEffect(() => {
    let alive = true;
    import("react-force-graph-2d").then((m) => {
      if (alive) setForceGraph(() => m.default);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- adjacency -----------------------------------------------------------
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of links) {
      const s = endId(l.source as string);
      const t = endId(l.target as string);
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t);
      map.get(t)!.add(s);
    }
    return map;
  }, [links]);

  // --- progressive disclosure ---------------------------------------------
  // The graph never renders everything when a root or note filter is active.
  const visible = useMemo(() => {
    const all = new Set(nodes.map((n) => n.id));
    let base: Set<string>;

    if (rootId) {
      base = new Set([rootId]);
      let frontier = [rootId];
      for (let depth = 0; depth < 2; depth++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const nb of adjacency.get(id) ?? []) {
            if (!base.has(nb)) {
              base.add(nb);
              next.push(nb);
            }
          }
        }
        frontier = next;
      }
    } else if (focusNoteId) {
      base = new Set(nodes.filter((n) => n.noteIds.includes(focusNoteId)).map((n) => n.id));
    } else {
      base = all;
    }

    for (const id of expanded) {
      if (!base.has(id)) continue;
      for (const nb of adjacency.get(id) ?? []) base.add(nb);
    }
    return base;
  }, [nodes, adjacency, rootId, focusNoteId, expanded]);

  const hiddenNeighbourCount = useCallback(
    (id: string) => {
      let n = 0;
      for (const nb of adjacency.get(id) ?? []) if (!visible.has(nb)) n++;
      return n;
    },
    [adjacency, visible],
  );

  // --- what actually gets drawn -------------------------------------------
  const graphData = useMemo(() => {
    let visibleNodes = nodes.filter((n) => visible.has(n.id));
    let visibleLinks = links.filter((l) => visible.has(endId(l.source as string)) && visible.has(endId(l.target as string)));

    // Path view: prerequisites only, arranged into left-to-right tiers.
    // Concepts with no prerequisite links at all are dropped -- otherwise
    // they pile up in tier 0 and drown out the actual learning order.
    if (layout === "path") {
      visibleLinks = visibleLinks.filter((l) => l.relation === "prerequisite");
      const inChain = new Set<string>();
      for (const l of visibleLinks) {
        inChain.add(endId(l.source as string));
        inChain.add(endId(l.target as string));
      }
      visibleNodes = visibleNodes.filter((n) => inChain.has(n.id));

      const depth = computeDepths(visibleNodes, visibleLinks);
      const maxDepth = Math.max(0, ...depth.values());
      for (const n of visibleNodes as PositionedNode[]) {
        n.fx = ((depth.get(n.id) ?? 0) - maxDepth / 2) * 165;
      }
    } else {
      for (const n of visibleNodes as PositionedNode[]) {
        if (!n.__pinned) n.fx = undefined;
      }
    }

    // Deep-copy the links: force-graph mutates them in place, and reusing
    // mutated objects across renders corrupts the layout.
    return {
      nodes: visibleNodes,
      links: visibleLinks.map((l) => ({ ...l, source: endId(l.source as string), target: endId(l.target as string) })),
    };
  }, [nodes, links, visible, layout]);

  // --- focus dimming -------------------------------------------------------
  const focusSet = useMemo(() => {
    const anchor = hoverId ?? selectedId;
    if (!anchor) return null;
    const s = new Set<string>([anchor]);
    for (const nb of adjacency.get(anchor) ?? []) s.add(nb);
    return s;
  }, [hoverId, selectedId, adjacency]);

  // Fit the view ourselves from the node bounding box: zoomToFit's behaviour
  // depends on internals we don't control, and a graph that opens too small
  // is the difference between a readable demo and a smudge.
  const fittedFor = useRef<string>("");
  const viewKey = `${rootId ?? ""}|${focusNoteId ?? ""}|${layout}|${graphData.nodes.length}`;

  useEffect(() => {
    fittedFor.current = "";
  }, [viewKey]);

  const fitView = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || size.width === 0) return;

    const positioned = graphData.nodes.filter(
      (n) => typeof (n as PositionedNode).x === "number",
    ) as PositionedNode[];
    if (positioned.length === 0) return;

    const xs = positioned.map((n) => n.x!);
    const ys = positioned.map((n) => n.y!);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const pad = 70; // room for labels, which sit below each node
    const k = Math.min(
      size.width / Math.max(60, maxX - minX + pad),
      size.height / Math.max(60, maxY - minY + pad),
    );

    fg.centerAt((minX + maxX) / 2, (minY + maxY) / 2, 500);
    fg.zoom(Math.min(Math.max(k, 0.4), 6), 500);
  }, [graphData.nodes, size.width, size.height]);

  const handleEngineStop = useCallback(() => {
    if (fittedFor.current === viewKey) return;
    fittedFor.current = viewKey;
    fitView();
  }, [viewKey, fitView]);

  const centerOn = useCallback((id: string) => {
    const node = graphData.nodes.find((n) => n.id === id) as PositionedNode | undefined;
    if (!node || node.x === undefined || !fgRef.current) return;
    fgRef.current.centerAt(node.x, node.y, 450);
    fgRef.current.zoom(2.2, 450);
  }, [graphData.nodes]);

  useEffect(() => {
    if (selectedId) setTimeout(() => centerOn(selectedId), 30);
  }, [selectedId, centerOn]);

  // --- keyboard navigation -------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "Escape") {
        fgRef.current?.zoomToFit(450, 60);
        onSelect(null);
        return;
      }
      if (e.key === "Enter" && selectedId) {
        onEnter(selectedId);
        return;
      }
      if (!selectedId || !e.key.startsWith("Arrow")) return;

      const current = graphData.nodes.find((n) => n.id === selectedId) as PositionedNode | undefined;
      if (!current || current.x === undefined) return;

      // Step to the neighbour whose direction best matches the arrow.
      const want: Record<string, [number, number]> = {
        ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1],
      };
      const [wx, wy] = want[e.key] ?? [0, 0];
      let best: { id: string; score: number } | null = null;

      for (const nb of adjacency.get(selectedId) ?? []) {
        const n = graphData.nodes.find((x) => x.id === nb) as PositionedNode | undefined;
        if (!n || n.x === undefined) continue;
        const dx = n.x - current.x!;
        const dy = (n.y ?? 0) - (current.y ?? 0);
        const len = Math.hypot(dx, dy) || 1;
        const score = (dx / len) * wx + (dy / len) * wy;
        if (score > 0.25 && (!best || score > best.score)) best = { id: nb, score };
      }
      if (best) {
        e.preventDefault();
        onSelect(best.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, graphData.nodes, adjacency, onSelect, onEnter]);

  // --- node painting -------------------------------------------------------
  const paintNode = useCallback(
    (node: PositionedNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const lod = lodFor(globalScale);
      const r = nodeRadius(node.degree);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const isGhost = node.status === "ghost";
      const dimmed = focusSet ? !focusSet.has(node.id) : false;
      const isSelected = node.id === selectedId;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.15 : 1;

      // fill: retrievability
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (!isGhost) {
        ctx.fillStyle = nodeFill(node.status, node.retrievability);
        ctx.fill();
      }

      if (lod !== "far" || isSelected) {
        // ring: status
        ctx.lineWidth = isSelected ? 2.4 / globalScale : 1.6 / globalScale;
        if (node.hasContradiction) {
          ctx.strokeStyle = CONTRADICTION_COLOR;
          ctx.setLineDash([]);
        } else if (isGhost) {
          ctx.strokeStyle = GHOST_COLOR;
          ctx.setLineDash([3 / globalScale, 2.5 / globalScale]);
        } else if (isSelected) {
          ctx.strokeStyle = "#ffffff";
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = "rgba(255,255,255,0.22)";
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (lod !== "far" && !isGhost) {
        // face: rendered LaTeX when available, otherwise the kind glyph
        const latexImg = node.kind === "formula" && node.latex ? getLatexImage(node.latex) : null;
        if (latexImg) {
          const w = r * 1.85;
          const h = (w * latexImg.height) / latexImg.width;
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, r * 0.95, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(latexImg, x - w / 2, y - h / 2, w, h);
          ctx.restore();
        } else {
          ctx.fillStyle = "rgba(10,12,18,0.85)";
          ctx.font = `${r * 1.15}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(KIND_GLYPH[node.kind] ?? "▪", x, y + r * 0.04);
        }
      }

      // badge: source count, only when it means something
      if (lod !== "far" && node.sourceCount >= 2) {
        const bx = x + r * 0.78;
        const by = y - r * 0.78;
        const br = Math.max(2.6, r * 0.42);
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = "#7c9cff";
        ctx.fill();
        if (globalScale > 1.1) {
          ctx.fillStyle = "#07090e";
          ctx.font = `bold ${br * 1.35}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(node.sourceCount), bx, by + br * 0.06);
        }
      }

      // "+n" affordance for neighbours we're not showing
      const hidden = hiddenNeighbourCount(node.id);
      if (lod !== "far" && hidden > 0) {
        ctx.fillStyle = "rgba(124,156,255,0.9)";
        ctx.font = `${Math.max(3.4, r * 0.62)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`+${hidden}`, x, y + r + 1.4 / globalScale);
      }

      if (lod === "near") {
        ctx.fillStyle = dimmed ? "rgba(230,232,238,0.35)" : "#e6e8ee";
        ctx.font = `${Math.max(3, 11 / globalScale)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const offset = hidden > 0 ? r + 6.5 / globalScale : r + 2.5 / globalScale;
        ctx.fillText(truncate(node.title, 26), x, y + offset);

        if (!isGhost) {
          const w = r * 2;
          const h = 1.6 / globalScale;
          const by = y + offset + 12 / globalScale;
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.fillRect(x - w / 2, by, w, h);
          ctx.fillStyle = nodeFill(node.status, node.retrievability);
          ctx.fillRect(x - w / 2, by, w * node.retrievability, h);
        }
      }

      ctx.restore();
    },
    [focusSet, selectedId, hiddenNeighbourCount],
  );

  // Custom painting kills built-in hit detection unless this mirrors it.
  const paintPointerArea = useCallback(
    (node: PositionedNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node.degree) + 3, 0, Math.PI * 2);
      ctx.fill();
    },
    [],
  );

  const linkColor = useCallback(
    (link: RuntimeLink) => {
      const base = RELATION_COLOR[link.relation] ?? RELATION_COLOR.related;
      if (!focusSet) return base;
      const lit = focusSet.has(endId(link.source)) && focusSet.has(endId(link.target));
      return lit ? base : withAlpha(base, 0.12);
    },
    [focusSet],
  );

  return (
    <div ref={wrapRef} className="h-full w-full relative">
      {(!ForceGraph || size.width === 0) && (
        <div className="absolute inset-0 grid place-items-center text-muted text-sm">Loading graph…</div>
      )}
      {ForceGraph && size.width > 0 && (
      <ForceGraph
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        nodeLabel={(n: GraphNode) =>
          `<div style="background:#171b25;border:1px solid #2e3647;border-radius:8px;padding:8px 10px;max-width:280px;font-family:ui-sans-serif,system-ui;color:#e6e8ee">
             <div style="font-weight:600;margin-bottom:3px">${escapeHtml(n.title)}</div>
             <div style="color:#8b93a7;font-size:12px;line-height:1.45">${escapeHtml(n.summary)}</div>
             <div style="color:#5b8def;font-size:11px;margin-top:6px">${n.status === "ghost" ? "never defined in your notes" : `${Math.round(n.retrievability * 100)}% recall · ${n.sourceCount} source${n.sourceCount === 1 ? "" : "s"} · ${n.degree} link${n.degree === 1 ? "" : "s"}`}</div>
           </div>`
        }
        linkColor={linkColor}
        linkWidth={(l: RuntimeLink) => 0.5 + l.strength * 2}
        linkLineDash={(l: RuntimeLink) => (l.relation === "contradicts" ? [4, 3] : null)}
        linkDirectionalArrowLength={(l: RuntimeLink) => (RELATION_DIRECTED[l.relation] ? 3.5 : 0)}
        linkDirectionalArrowRelPos={0.98}
        linkDirectionalParticles={(l: RuntimeLink) => (l.relation === "contradicts" && !l.resolved ? 3 : 0)}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleColor={() => CONTRADICTION_COLOR}
        linkCurvature={(l: RuntimeLink) => (l.relation === "related" ? 0.12 : 0)}
        onNodeClick={(n: GraphNode) => {
          if (hiddenNeighbourCount(n.id) > 0 && n.id === selectedId) onExpand(n.id);
          else onSelect(n.id);
        }}
        onNodeRightClick={(n: GraphNode) => onEnter(n.id)}
        onNodeHover={(n: GraphNode | null) => setHoverId(n?.id ?? null)}
        onBackgroundClick={() => onSelect(null)}
        onNodeDragEnd={(n: PositionedNode) => {
          n.fx = n.x;
          n.fy = n.y;
          n.__pinned = true;
        }}
        onEngineStop={handleEngineStop}
        cooldownTicks={layout === "path" ? 80 : 120}
        d3VelocityDecay={0.28}
      />
      )}
    </div>
  );
}

/** Longest-path depth over prerequisite edges, for the Path layout. */
function computeDepths(nodes: GraphNode[], links: GraphLink[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const l of links) {
    const s = endId(l.source as string);
    const t = endId(l.target as string);
    incoming.get(t)?.push(s);
  }

  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const walk = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let d = 0;
    for (const p of incoming.get(id) ?? []) d = Math.max(d, walk(p) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  for (const n of nodes) walk(n.id);
  return depth;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
