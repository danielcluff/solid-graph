import { createContext, useContext } from "solid-js";
import type { GraphApi, GraphEdge, GraphNode, HandlePosition, HandleRef, HandleType, Selection, Viewport, XY } from "./types";

/** A handle's anchor, relative to its node's top-left corner. */
export interface MeasuredHandle {
  type: HandleType;
  id?: string;
  position: HandlePosition;
  x: number;
  y: number;
}

export interface MeasuredNode {
  width: number;
  height: number;
  handles: Record<string, MeasuredHandle>;
}

export interface PendingConnection {
  from: HandleRef;
  /** Pointer, in flow coordinates. */
  to: XY;
  /** Valid handle under / near the pointer. */
  hover: HandleRef | null;
}

export const handleKey = (type: HandleType, id?: string) => `${type}:${id ?? ""}`;

/** Internal state shared by the canvas, nodes, handles, edges and overlays. */
export interface GraphContextValue {
  api: GraphApi;
  nodes(): GraphNode[];
  edges(): GraphEdge[];
  nodeById(): Map<string, GraphNode>;
  /** Reactive: for rendering. */
  selection(): Selection;
  /** Latest selection including one just reported but not yet applied by the host: for event handlers. */
  peekSelection(): Selection;
  /** Reactive, O(1): for per-node and per-edge rendering. */
  isNodeSelected(id: string): boolean;
  isEdgeSelected(id: string): boolean;
  select(selection: Selection): void;
  viewport(): Viewport;
  canvasSize(): { width: number; height: number };
  measured: Record<string, MeasuredNode>;
  /** Re-measure a node (batched: runs once per node in a microtask). */
  measure(id: string): void;
  /** NodeRenderer registers its element (undefined when it unmounts). */
  registerNode(id: string, el: HTMLElement | undefined): void;
  connection(): PendingConnection | null;
  /** Start of the wire being dragged: changes only when a drag starts or ends, not as the pointer moves. */
  connectingFrom(): HandleRef | null;
  /** The handle the wire would land on: changes only when that handle changes. */
  connectTarget(): HandleRef | null;
  /** Whether an edge ends at this handle. */
  isConnected(ref: HandleRef): boolean;
  isDragging(id: string): boolean;
  handlePoint(ref: HandleRef): (XY & { position: HandlePosition }) | null;
  startConnect(e: PointerEvent, ref: HandleRef): void;
  startResize(e: PointerEvent, id: string): void;
  /** Whether a handle accepts the pending connection (for styling). */
  isConnectable(ref: HandleRef): boolean;
}

export const GraphContext = createContext<GraphContextValue>();
export const NodeIdContext = createContext<string>();

export function useGraphContext(): GraphContextValue {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error("solid-graph: used outside <Graph>");
  return ctx;
}

/** Imperative API of the surrounding <Graph> (inside nodes, edges and overlays). */
export function useGraph(): GraphApi {
  return useGraphContext().api;
}

/** Id of the node this component is rendered in. */
export function useNodeId(): string {
  const id = useContext(NodeIdContext);
  if (!id) throw new Error("solid-graph: used outside a node");
  return id;
}
