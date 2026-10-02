import { createMemo, onSettled, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useGraphContext, useNodeId } from "./context";
import type { HandlePosition, HandleType } from "./types";

export interface HandleProps {
  type: HandleType;
  /** Distinguishes several handles of the same type on one node. */
  id?: string;
  /** Side the wire leaves from (default: right for sources, left for targets). */
  position?: HandlePosition;
  /** false: shown, but can't start or receive connections. */
  connectable?: boolean;
  /** Colour when connected, hovered or targeted (e.g. the port's type colour). Default: the edge colour. */
  color?: string;
  /** Replaces the default look (a tab on the node's edge). */
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

/** A tab sitting on the inside of the node's edge, rounded on the side facing in. */
const SIDE: Record<HandlePosition, string> = {
  left: "left-0 top-1/2 -translate-y-1/2 size-4 rounded-r-[3px]",
  right: "right-0 top-1/2 -translate-y-1/2 size-4 rounded-l-[3px]",
  top: "top-0 left-1/2 -translate-x-1/2 size-4 rounded-b-[3px]",
  bottom: "bottom-0 left-1/2 -translate-x-1/2 size-4 rounded-t-[3px]",
};

/**
 * A connection point. Place it anywhere inside a node component; the canvas
 * measures where it ends up. While a connection is being dragged, the handle
 * that would receive it gets `data-connect-target`, and every handle that
 * could gets `data-connectable` (style them with `data-[connect-target]:…`).
 */
export function Handle(props: HandleProps) {
  const ctx = useGraphContext();
  const nodeId = useNodeId();
  const position = () => props.position ?? (props.type === "source" ? "right" : "left");
  const ref = () => ({ nodeId, handleId: props.id, type: props.type });
  // separate memos, so dragging a wire only updates the handles whose state changes
  const isTarget = createMemo(() => {
    const h = ctx.connectTarget();
    return !!h && h.nodeId === nodeId && h.type === props.type && h.handleId === props.id;
  });
  const connectable = createMemo(() => ctx.isConnectable(ref()));
  const connected = createMemo(() => ctx.isConnected(ref()));
  // handles that appear or move after the node first rendered need a fresh measurement
  onSettled(() => untrack(() => ctx.measure(nodeId)));

  return (
    <div
      data-handle
      data-handle-node={nodeId}
      data-handle-id={props.id ?? ""}
      data-handle-type={props.type}
      data-handle-position={position()}
      data-connectable={connectable() ? "" : undefined}
      data-connect-target={isTarget() ? "" : undefined}
      data-connected={connected() ? "" : undefined}
      class={
        props.class ?? [
          "absolute z-10 cursor-crosshair bg-[var(--sg-handle-idle)] transition-colors",
          "hover:bg-[var(--sg-handle-color)] data-[connected]:bg-[var(--sg-handle-color)] data-[connect-target]:bg-[var(--sg-handle-color)]",
          SIDE[position()],
        ]
      }
      style={{ "--sg-handle-color": props.color ?? "var(--sg-edge)", ...props.style }}
      onPointerDown={(e) => props.connectable !== false && ctx.startConnect(e, ref())}
    >
      {props.children}
    </div>
  );
}
