import { For, createMemo } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useGraphContext } from "./context";
import { boundsOf, clamp, screenToFlow } from "./geometry";
import type { GraphNode, Rect } from "./types";

export type PanelPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "bottom-center";

const PLACE: Record<PanelPosition, string> = {
  "top-left": "top-3 left-3",
  "top-right": "top-3 right-3",
  "bottom-left": "bottom-3 left-3",
  "bottom-right": "bottom-3 right-3",
  "top-center": "top-3 left-1/2 -translate-x-1/2",
  "bottom-center": "bottom-3 left-1/2 -translate-x-1/2",
};

/** Anything floating over the canvas. Presses and wheel events on it don't reach the canvas. */
export function Panel(props: { position?: PanelPosition; class?: string; children?: JSX.Element }) {
  return (
    <div data-sg-overlay class={["absolute z-[5]", PLACE[props.position ?? "top-left"], props.class]}>
      {props.children}
    </div>
  );
}

// ---------------------------------------------------------------------------

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d={d} />
  </svg>
);

/** Zoom in / out / fit buttons. */
export function Controls(props: { position?: PanelPosition; class?: string; showFitView?: boolean; children?: JSX.Element }) {
  const ctx = useGraphContext();
  const btn =
    "flex size-8 items-center justify-center text-[var(--sg-node-fg)] hover:bg-[var(--sg-hover)] disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <Panel position={props.position ?? "bottom-left"} class={props.class}>
      <div class="flex flex-col overflow-hidden rounded-md border border-[var(--sg-border)] bg-[var(--sg-node-bg)] shadow-sm [&>*+*]:border-t [&>*+*]:border-[var(--sg-border)]">
        <button type="button" aria-label="Zoom in" title="Zoom in" class={btn} onClick={() => ctx.api.zoomBy(1.2)}>
          {icon("M12 5v14M5 12h14")}
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out" class={btn} onClick={() => ctx.api.zoomBy(1 / 1.2)}>
          {icon("M5 12h14")}
        </button>
        {props.showFitView !== false && (
          <button type="button" aria-label="Fit view" title="Fit view" class={btn} onClick={() => ctx.api.fitView()}>
            {icon("M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4")}
          </button>
        )}
        {props.children}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export interface MiniMapProps {
  position?: PanelPosition;
  width?: number;
  height?: number;
  /** Fill of a node (default: theme colours; containers lighter). */
  nodeColor?: (node: GraphNode) => string | undefined;
  /** Drag (or click) on the map to move the view (default: true). */
  pannable?: boolean;
  /** Wheel over the map zooms the view (default: true). */
  zoomable?: boolean;
  class?: string;
}

/** Overview of every node, with the visible area outlined. */
export function MiniMap(props: MiniMapProps) {
  const ctx = useGraphContext();
  const W = () => props.width ?? 200;
  const H = () => props.height ?? 140;

  const visible = createMemo((): Rect => {
    const v = ctx.viewport();
    const size = ctx.canvasSize();
    const tl = screenToFlow(v, { x: 0, y: 0 });
    return { x: tl.x, y: tl.y, width: size.width / v.zoom, height: size.height / v.zoom };
  });
  const rects = createMemo(() =>
    ctx
      .nodes()
      .map((n) => ({ node: n, rect: ctx.api.nodeRect(n.id)! }))
      .filter((x) => x.rect && x.rect.width > 0),
  );
  /** Flow-space area shown by the map, stretched to the map's aspect ratio. */
  const world = createMemo((): Rect => {
    const b = boundsOf([...rects().map((r) => r.rect), visible()])!;
    const pad = Math.max(b.width, b.height) * 0.05;
    const r = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
    const aspect = W() / H();
    if (r.width / r.height > aspect) {
      const h = r.width / aspect;
      return { ...r, y: r.y - (h - r.height) / 2, height: h };
    }
    const w = r.height * aspect;
    return { ...r, x: r.x - (w - r.width) / 2, width: w };
  });

  let svg: SVGSVGElement | undefined;
  /** Centre the view on a flow point. */
  const centreOn = (p: { x: number; y: number }) => {
    const v = ctx.viewport();
    const size = ctx.canvasSize();
    ctx.api.setViewport({ ...v, x: size.width / 2 - p.x * v.zoom, y: size.height / 2 - p.y * v.zoom });
  };

  const onDown = (e: PointerEvent) => {
    if (props.pannable === false || e.button !== 0) return;
    e.preventDefault();
    // world() follows the view while dragging; pin the mapping from the press
    const frozen = world();
    const b = svg!.getBoundingClientRect();
    const at = (ev: PointerEvent) => ({
      x: frozen.x + clamp((ev.clientX - b.left) / b.width, 0, 1) * frozen.width,
      y: frozen.y + clamp((ev.clientY - b.top) / b.height, 0, 1) * frozen.height,
    });
    centreOn(at(e));
    const move = (ev: PointerEvent) => centreOn(at(ev));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onWheel = (e: WheelEvent) => {
    if (props.zoomable === false) return;
    e.preventDefault();
    const size = ctx.canvasSize();
    ctx.api.zoomBy(Math.exp(-e.deltaY * 0.0015), { x: size.width / 2, y: size.height / 2 });
  };

  const fill = (n: GraphNode) => props.nodeColor?.(n) ?? (n.container ? "var(--sg-minimap-group)" : "var(--sg-minimap-node)");

  return (
    <Panel position={props.position ?? "bottom-right"} class={props.class}>
      <svg
        ref={svg}
        width={W()}
        height={H()}
        viewBox={`${world().x} ${world().y} ${world().width} ${world().height}`}
        class={["block rounded-md border border-[var(--sg-border)] bg-[var(--sg-minimap-bg)] shadow-sm", props.pannable === false ? "" : "cursor-pointer"]}
        onPointerDown={onDown}
        onWheel={onWheel}
        role="img"
        aria-label="Minimap"
      >
        <For each={rects()}>
          {(r) => (
            <rect
              x={r.rect.x}
              y={r.rect.y}
              width={r.rect.width}
              height={r.rect.height}
              rx={Math.min(r.rect.width, r.rect.height) * 0.08}
              fill={fill(r.node)}
              stroke={ctx.isNodeSelected(r.node.id) ? "var(--sg-selection)" : "none"}
              stroke-width={world().width / W()}
            />
          )}
        </For>
        {/* everything outside the visible area is dimmed */}
        <path
          fill="var(--sg-minimap-mask)"
          fill-rule="evenodd"
          d={`M${world().x} ${world().y}h${world().width}v${world().height}h${-world().width}z M${visible().x} ${visible().y}h${visible().width}v${visible().height}h${-visible().width}z`}
        />
        <rect
          x={visible().x}
          y={visible().y}
          width={visible().width}
          height={visible().height}
          fill="none"
          stroke="var(--sg-selection)"
          stroke-width={(world().width / W()) * 1.5}
        />
      </svg>
    </Panel>
  );
}
