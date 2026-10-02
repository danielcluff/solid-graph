import type { Component } from "solid-js";
import type { JSX } from "@solidjs/web";

export interface XY {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen = flow * zoom + (x, y). */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type HandleType = "source" | "target";
export type HandlePosition = "left" | "right" | "top" | "bottom";

/**
 * A node. Positions are absolute flow coordinates, also for nodes inside a
 * container (`parentId` only records membership).
 */
export interface GraphNode<D = any> {
  id: string;
  /** Key into `nodeTypes` (default: "default"). */
  type?: string;
  position: XY;
  data: D;
  /** Fixed size. Without it the node is measured from its content. */
  width?: number;
  height?: number;
  /** Container (group) this node belongs to. */
  parentId?: string;
  /** Holds other nodes: drawn behind edges, children move with it, nodes dropped onto it join it. */
  container?: boolean;
  /** Shows a resize grip in the bottom-right corner (needs width/height to start from, else the measured size). */
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  /**
   * CSS selector: only presses on matching elements inside the node start a
   * drag. Node components can instead mark elements with `data-drag-handle`.
   */
  dragHandle?: string;
  draggable?: boolean;
  selectable?: boolean;
  connectable?: boolean;
  /** Stacking within its layer (containers, nodes). */
  zIndex?: number;
  class?: string;
}

export interface GraphEdge<D = any> {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  /** Key into `edgeTypes`. Omit to use the canvas's `defaultEdgeType`. */
  type?: string;
  label?: JSX.Element;
  /** Stroke colour (any CSS colour). Defaults to the theme's edge colour. */
  color?: string;
  animated?: boolean;
  selectable?: boolean;
  data?: D;
  class?: string;
}

/** One end of a connection. */
export interface HandleRef {
  nodeId: string;
  handleId?: string;
  type: HandleType;
}

export interface Connection {
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
}

export interface Selection {
  nodes: string[];
  edges: string[];
}

/** Phases of a continuous gesture (drag, resize). */
export type GesturePhase = "start" | "move" | "end";

export interface NodeMove {
  id: string;
  position: XY;
  /** Only on "end": the container the node was dropped into (null = none). Undefined = unchanged. */
  parentId?: string | null;
}

export interface NodeResize {
  id: string;
  width: number;
  height: number;
}

export type ContextTarget =
  | { kind: "pane" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  /** A wire dropped on empty canvas: "Add node" creates a node and connects it. */
  | { kind: "connection"; from: HandleRef };

export interface NodeProps<D = any> {
  node: GraphNode<D>;
  data: D;
  selected: boolean;
  dragging: boolean;
}

export interface EdgeProps<D = any> {
  edge: GraphEdge<D>;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: HandlePosition;
  targetPosition: HandlePosition;
  selected: boolean;
  color: string;
}

/** What a context menu component receives. */
export interface ContextMenuProps {
  /** What was right-clicked (it has been selected). */
  target: ContextTarget;
  /** The click point, in flow coordinates (e.g. where to add a node). */
  position: XY;
  /** Registered node types (built-in and yours). */
  nodeTypes: string[];
  api: GraphApi;
  close(): void;
  /** Ready-made actions; each closes the menu. Optional ones exist only when the app handles them. */
  actions: {
    /** With `onAddNode`: add a node of `type` at `position` (for a dropped wire, also connect it). */
    addNode?(type: string): void;
    /** With `onDelete`: delete the selection. */
    deleteSelection?(): void;
    selectAll(): void;
    fitView(): void;
    fitSelection(): void;
  };
}

export type NodeTypes = Record<string, Component<NodeProps>>;
export type EdgeTypes = Record<string, Component<EdgeProps>>;

/** Imperative helpers, from `onInit` or `useGraph()` inside the canvas. */
export interface GraphApi {
  viewport(): Viewport;
  setViewport(v: Viewport): void;
  /** Fit nodes (default: all) into view. */
  fitView(opts?: { nodes?: string[]; padding?: number; maxZoom?: number }): void;
  zoomBy(factor: number, around?: XY): void;
  screenToFlow(p: XY): XY;
  flowToScreen(p: XY): XY;
  /** Size of a node: its width/height, else as measured. */
  nodeSize(id: string): { width: number; height: number };
  nodeRect(id: string): Rect | undefined;
  /** Ask the app to merge `patch` into a node's data (reported through `onNodeDataChange`). */
  updateNodeData(id: string, patch: Record<string, unknown>): void;
  /** The canvas element (for host-level drag & drop, focus, …). */
  element(): HTMLElement | undefined;
}
