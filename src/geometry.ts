import type { HandlePosition, Rect, Viewport, XY } from "./types";

// Pure geometry: edge paths, viewport maths, hit tests. No DOM, no Solid.

export interface PathParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: HandlePosition;
  targetPosition?: HandlePosition;
}

/** [svg path, label x, label y] */
export type EdgePath = [path: string, labelX: number, labelY: number];

const DIR: Record<HandlePosition, XY> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

/** Smooth S-curve leaving each end in its handle's direction. */
export function getBezierPath(p: PathParams, curvature = 0.5): EdgePath {
  const sd = DIR[p.sourcePosition ?? "right"];
  const td = DIR[p.targetPosition ?? "left"];
  const horizontal = sd.x !== 0;
  const span = horizontal ? Math.abs(p.targetX - p.sourceX) : Math.abs(p.targetY - p.sourceY);
  const k = Math.max(40, span * curvature);
  const c1 = { x: p.sourceX + sd.x * k, y: p.sourceY + sd.y * k };
  const c2 = { x: p.targetX + td.x * k, y: p.targetY + td.y * k };
  // the cubic's midpoint (t = 0.5)
  const lx = 0.125 * p.sourceX + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p.targetX;
  const ly = 0.125 * p.sourceY + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p.targetY;
  return [`M ${p.sourceX} ${p.sourceY} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p.targetX} ${p.targetY}`, lx, ly];
}

export function getStraightPath(p: PathParams): EdgePath {
  return [`M ${p.sourceX} ${p.sourceY} L ${p.targetX} ${p.targetY}`, (p.sourceX + p.targetX) / 2, (p.sourceY + p.targetY) / 2];
}

/**
 * Orthogonal path with a single bend line halfway between the ends, along the
 * source handle's axis. `radius` rounds the corners (0 = sharp "step").
 */
export function getStepPath(p: PathParams, radius = 8): EdgePath {
  const horizontal = DIR[p.sourcePosition ?? "right"].x !== 0;
  const pts: XY[] = horizontal
    ? (() => {
        const mx = (p.sourceX + p.targetX) / 2;
        return [
          { x: p.sourceX, y: p.sourceY },
          { x: mx, y: p.sourceY },
          { x: mx, y: p.targetY },
          { x: p.targetX, y: p.targetY },
        ];
      })()
    : (() => {
        const my = (p.sourceY + p.targetY) / 2;
        return [
          { x: p.sourceX, y: p.sourceY },
          { x: p.sourceX, y: my },
          { x: p.targetX, y: my },
          { x: p.targetX, y: p.targetY },
        ];
      })();
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const r = Math.min(radius, dist(a, b) / 2, dist(b, c) / 2);
    if (r <= 0) {
      d += ` L ${b.x} ${b.y}`;
      continue;
    }
    const p1 = toward(b, a, r);
    const p2 = toward(b, c, r);
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  d += ` L ${pts[3].x} ${pts[3].y}`;
  return [d, (pts[1].x + pts[2].x) / 2, (pts[1].y + pts[2].y) / 2];
}

const dist = (a: XY, b: XY) => Math.hypot(b.x - a.x, b.y - a.y);
function toward(from: XY, to: XY, by: number): XY {
  const d = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / d) * by, y: from.y + ((to.y - from.y) / d) * by };
}

// ---- viewport ---------------------------------------------------------------

export const screenToFlow = (v: Viewport, p: XY): XY => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom });
export const flowToScreen = (v: Viewport, p: XY): XY => ({ x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y });

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Zoom by `factor`, keeping the flow point under `around` (screen coords, relative to the canvas) still. */
export function zoomAround(v: Viewport, factor: number, around: XY, minZoom: number, maxZoom: number): Viewport {
  const zoom = clamp(v.zoom * factor, minZoom, maxZoom);
  return { zoom, x: around.x - ((around.x - v.x) / v.zoom) * zoom, y: around.y - ((around.y - v.y) / v.zoom) * zoom };
}

/** Viewport that centres `bounds` in a `size` canvas with `padding` px around it. */
export function fitBounds(
  bounds: Rect,
  size: { width: number; height: number },
  opts: { padding?: number; minZoom?: number; maxZoom?: number } = {},
): Viewport {
  const padding = opts.padding ?? 80;
  const zoom = clamp(
    Math.min((size.width - padding * 2) / Math.max(1, bounds.width), (size.height - padding * 2) / Math.max(1, bounds.height)),
    opts.minZoom ?? 0.1,
    opts.maxZoom ?? 1.5,
  );
  return {
    zoom,
    x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

/** Smallest rect around `rects` (undefined for none). */
export function boundsOf(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const containsPoint = (r: Rect, p: XY) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;

/** Normalised rect from two corners. */
export const rectFrom = (a: XY, b: XY): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});

/**
 * The container a node of `rect` belongs to after a drop: the smallest
 * container holding the node's centre (so nested groups pick the inner one).
 */
export function containerAt(rect: Rect, containers: { id: string; rect: Rect }[], exclude?: Set<string>): string | null {
  const c = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  let best: { id: string; area: number } | null = null;
  for (const k of containers) {
    if (exclude?.has(k.id) || !containsPoint(k.rect, c)) continue;
    const area = k.rect.width * k.rect.height;
    if (!best || area < best.area) best = { id: k.id, area };
  }
  return best?.id ?? null;
}

/** Nearest point within `radius` (or undefined). */
export function nearest<T extends { point: XY }>(candidates: T[], p: XY, radius: number): T | undefined {
  let best: T | undefined;
  let bestD = radius;
  for (const c of candidates) {
    const d = dist(c.point, p);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
