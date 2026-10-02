import { For, Show, createEffect, createMemo, createSignal, createStore, onSettled, untrack, type Component } from "solid-js";
import { Dynamic } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { GraphContext, handleKey, type GraphContextValue, type MeasuredNode, type PendingConnection } from "./context";
import { EdgeRenderer, ConnectionLine } from "./edges";
import { boundsOf, containerAt, fitBounds, flowToScreen, nearest, rectFrom, rectsIntersect, screenToFlow, zoomAround } from "./geometry";
import { NodeRenderer } from "./NodeRenderer";
import { defaultEdgeTypes, defaultNodeTypes } from "./defaults";
import { DefaultContextMenu } from "./menu";
import type {
  Connection,
  ContextMenuProps,
  ContextTarget,
  EdgeTypes,
  GesturePhase,
  GraphApi,
  GraphEdge,
  GraphNode,
  HandleRef,
  NodeMove,
  NodeResize,
  NodeTypes,
  Rect,
  Selection,
  Viewport,
  XY,
} from "./types";

export interface GraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeTypes?: NodeTypes;
  /** Your edge types, added to the built-ins (bezier, straight, step, smoothstep); same names replace them. */
  edgeTypes?: EdgeTypes;
  /** Type of edges that don't set one (default "bezier"). */
  defaultEdgeType?: string;

  /** Controlled selection. Omit to let the canvas keep its own. */
  selection?: Selection;
  onSelectionChange?: (selection: Selection) => void;

  /** Controlled viewport. Omit to let the canvas keep its own (starting at `defaultViewport`, or fitted). */
  viewport?: Viewport;
  defaultViewport?: Viewport;
  onViewportChange?: (viewport: Viewport) => void;
  /** Fit all nodes into view once they've been measured (default: true unless a viewport is given). */
  fitViewOnInit?: boolean;
  minZoom?: number;
  maxZoom?: number;

  /** Nodes being dragged. "start" reports current positions (a good moment to record undo history); "end" adds the drop container. */
  onNodesMove?: (moves: NodeMove[], phase: GesturePhase) => void;
  onNodeResize?: (resize: NodeResize, phase: GesturePhase) => void;
  /** A node component edited its own data (e.g. a group renamed), via `api.updateNodeData`. */
  onNodeDataChange?: (id: string, patch: Record<string, unknown>) => void;
  /** May `node` be dropped into `container`? (default: yes) */
  canContain?: (container: GraphNode, node: GraphNode) => boolean;

  onConnect?: (connection: Connection) => void;
  /** A connection drag ended. `connected` is false when it was dropped away from a valid handle. */
  onConnectEnd?: (info: { from: HandleRef; connected: boolean; client: XY; flow: XY; overPane: boolean }) => void;
  /** Reject connections (default: any source → target on different nodes). */
  isValidConnection?: (connection: Connection) => boolean;
  /**
   * Pressing a target handle that already has an edge picks that edge up:
   * `onEdgeDetach` fires and the drag continues from the edge's source.
   */
  pickUpEdges?: boolean;
  onEdgeDetach?: (edgeId: string) => void;
  /** Colour of the line while connecting. */
  connectionColor?: (from: HandleRef) => string | undefined;
  /** Snap to the nearest valid handle within this many screen px (default 28). */
  snapRadius?: number;

  /** Right-click (after the canvas selected the target). Fires whether or not a menu is shown. */
  onContextMenu?: (target: ContextTarget, event: MouseEvent) => void;
  /** Menu shown on right-click: the built-in one (default), your component, or false for none. */
  contextMenu?: false | Component<ContextMenuProps>;
  /**
   * "Add node" in the context menu: create a node of `type` at `position` (flow coordinates).
   * After a wire was dropped on empty canvas, `from` is its loose end: return the new node's id
   * and the canvas connects the wire to the node's first valid handle once it has rendered.
   */
  onAddNode?: (type: string, position: XY, from?: HandleRef) => string | void;
  /** "Delete" in the context menu (wire your Delete key to the same thing). */
  onDelete?: (selection: Selection) => void;
  onDoubleClick?: (target: ContextTarget, event: MouseEvent) => void;
  onPaneClick?: (event: PointerEvent) => void;
  onDrop?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;

  /** Left-drag on empty canvas pans (Shift+drag box-selects) instead of box-selecting. */
  panOnDrag?: boolean;
  background?: "dots" | "lines" | "none";
  /** Grid spacing in flow units (default 20). */
  gridSize?: number;

  onInit?: (api: GraphApi) => void;
  class?: string;
  /** Overlays: <MiniMap />, <Controls />, <Panel />. */
  children?: JSX.Element;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Selector for elements inside a node that never start a drag. */
const NO_DRAG = "[data-handle],[data-nodrag],input,textarea,select,button,a,[contenteditable='true']";

export function Graph(props: GraphProps) {
  let el: HTMLDivElement | undefined;
  const minZoom = () => props.minZoom ?? 0.1;
  const maxZoom = () => props.maxZoom ?? 2.5;

  // ---- controlled-or-internal state ----------------------------------------
  const [localViewport, setLocalViewport] = createSignal<Viewport>(untrack(() => props.defaultViewport) ?? { x: 0, y: 0, zoom: 1 });
  const viewport = () => props.viewport ?? localViewport();
  const setViewport = (v: Viewport) => {
    setLocalViewport(v);
    props.onViewportChange?.(v);
  };
  const [localSelection, setLocalSelection] = createSignal<Selection>({ nodes: [], edges: [] });
  const selection = () => props.selection ?? localSelection();
  /** Latest selection we reported, readable synchronously while the host's update is pending. */
  let lastSelection: Selection | null = null;
  const currentSelection = () => lastSelection ?? selection();
  const setSelection = (s: Selection) => {
    const cur = currentSelection();
    if (sameIds(cur.nodes, s.nodes) && sameIds(cur.edges, s.edges)) return;
    lastSelection = s;
    queueMicrotask(() => (lastSelection = null));
    setLocalSelection(s);
    props.onSelectionChange?.(s);
  };

  const nodeById = createMemo(() => new Map(props.nodes.map((n) => [n.id, n])));
  const [measured, setMeasured] = createStore<Record<string, MeasuredNode>>({});
  const [canvasSize, setCanvasSize] = createSignal({ width: 0, height: 0 });
  const [connection, setConnection] = createSignal<PendingConnection | null>(null);
  const [dragging, setDragging] = createSignal<Set<string>>(new Set());
  const [box, setBox] = createSignal<{ a: XY; b: XY } | null>(null);
  const [spaceDown, setSpaceDown] = createSignal(false);
  /** Open context menu: what was clicked, where (canvas-relative and flow coordinates). */
  const [menu, setMenu] = createSignal<{ target: ContextTarget; at: XY; flow: XY } | null>(null);
  const closeMenu = () => setMenu(null);
  const [panning, setPanning] = createSignal(false);

  // ---- geometry helpers -------------------------------------------------------
  const nodeSize = (id: string) => {
    const n = nodeById().get(id);
    const m = measured[id];
    return { width: n?.width ?? m?.width ?? 0, height: n?.height ?? m?.height ?? 0 };
  };
  const nodeRect = (id: string): Rect | undefined => {
    const n = nodeById().get(id);
    return n && { ...n.position, ...nodeSize(id) };
  };
  const local = (clientX: number, clientY: number): XY => {
    const r = el!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const toFlow = (clientX: number, clientY: number) => screenToFlow(viewport(), local(clientX, clientY));

  const fitView: GraphApi["fitView"] = (opts = {}) => {
    const ids = opts.nodes ?? props.nodes.map((n) => n.id);
    const b = boundsOf(ids.map(nodeRect).filter((r): r is Rect => !!r && r.width > 0));
    const size = canvasSize();
    if (!b || !size.width) return void setViewport({ x: 0, y: 0, zoom: 1 });
    setViewport(fitBounds(b, size, { padding: opts.padding, maxZoom: opts.maxZoom, minZoom: minZoom() }));
  };

  const api: GraphApi = {
    viewport,
    setViewport,
    fitView,
    zoomBy: (factor, around) => {
      const size = canvasSize();
      setViewport(zoomAround(viewport(), factor, around ?? { x: size.width / 2, y: size.height / 2 }, minZoom(), maxZoom()));
    },
    screenToFlow: (p) => toFlow(p.x, p.y),
    flowToScreen: (p) => {
      const r = el!.getBoundingClientRect();
      const s = flowToScreen(viewport(), p);
      return { x: s.x + r.left, y: s.y + r.top };
    },
    nodeSize,
    nodeRect,
    updateNodeData: (id, patch) => props.onNodeDataChange?.(id, patch),
    element: () => el,
  };

  // ---- measurement ------------------------------------------------------------
  /** Size and handle anchors of a node's element (relative to the node, in flow units). */
  const measure = (id: string) => {
    const node = el?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
    if (!node) return;
    const zoom = viewport().zoom;
    const base = node.getBoundingClientRect();
    const handles: MeasuredNode["handles"] = {};
    for (const h of node.querySelectorAll<HTMLElement>("[data-handle]")) {
      if (h.closest("[data-node-id]") !== node) continue; // handles of nested nodes belong to them
      const r = h.getBoundingClientRect();
      const type = h.dataset.handleType as "source" | "target";
      const position = (h.dataset.handlePosition ?? (type === "source" ? "right" : "left")) as MeasuredNode["handles"][string]["position"];
      const cx = (r.left + r.width / 2 - base.left) / zoom;
      const cy = (r.top + r.height / 2 - base.top) / zoom;
      const hw = r.width / 2 / zoom;
      const hh = r.height / 2 / zoom;
      handles[handleKey(type, h.dataset.handleId || undefined)] = {
        type,
        id: h.dataset.handleId || undefined,
        position,
        // anchor on the handle's outer edge, where the wire leaves
        x: cx + (position === "left" ? -hw : position === "right" ? hw : 0),
        y: cy + (position === "top" ? -hh : position === "bottom" ? hh : 0),
      };
    }
    setMeasured((m) => {
      m[id] = { width: node.offsetWidth, height: node.offsetHeight, handles };
    });
  };

  const handlePoint: GraphContextValue["handlePoint"] = (ref) => {
    const n = nodeById().get(ref.nodeId);
    if (!n) return null;
    const m = measured[ref.nodeId];
    const h = m?.handles[handleKey(ref.type, ref.handleId)] ?? (ref.handleId === undefined ? undefined : m?.handles[handleKey(ref.type)]);
    if (h) return { x: n.position.x + h.x, y: n.position.y + h.y, position: h.position };
    const s = nodeSize(ref.nodeId);
    return ref.type === "source"
      ? { x: n.position.x + s.width, y: n.position.y + s.height / 2, position: "right" }
      : { x: n.position.x, y: n.position.y + s.height / 2, position: "left" };
  };

  // ---- connections --------------------------------------------------------------
  const toConnection = (from: HandleRef, to: HandleRef): Connection =>
    from.type === "source"
      ? { source: from.nodeId, sourceHandle: from.handleId, target: to.nodeId, targetHandle: to.handleId }
      : { source: to.nodeId, sourceHandle: to.handleId, target: from.nodeId, targetHandle: from.handleId };

  const valid = (from: HandleRef, to: HandleRef) => {
    if (to.type === from.type || to.nodeId === from.nodeId) return false;
    const n = nodeById().get(to.nodeId);
    if (n?.connectable === false) return false;
    return props.isValidConnection?.(toConnection(from, to)) ?? true;
  };

  /** The valid handle under the pointer, else the nearest valid one within the snap radius. */
  const findTarget = (clientX: number, clientY: number, from: HandleRef): HandleRef | null => {
    const h = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-handle]");
    if (h?.dataset.handleNode) {
      const ref: HandleRef = { nodeId: h.dataset.handleNode, handleId: h.dataset.handleId || undefined, type: h.dataset.handleType as HandleRef["type"] };
      if (valid(from, ref)) return ref;
    }
    const p = toFlow(clientX, clientY);
    const candidates: { ref: HandleRef; point: XY }[] = [];
    for (const n of props.nodes) {
      const m = measured[n.id];
      if (!m) continue;
      for (const hm of Object.values(m.handles)) {
        const ref: HandleRef = { nodeId: n.id, handleId: hm.id, type: hm.type };
        if (valid(from, ref)) candidates.push({ ref, point: { x: n.position.x + hm.x, y: n.position.y + hm.y } });
      }
    }
    return nearest(candidates, p, (props.snapRadius ?? 28) / viewport().zoom)?.ref ?? null;
  };

  const startConnect = (e: PointerEvent, ref: HandleRef) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    let from = ref;
    if (props.pickUpEdges && ref.type === "target") {
      const existing = props.edges.find((x) => x.target === ref.nodeId && (x.targetHandle ?? undefined) === ref.handleId);
      if (existing) {
        props.onEdgeDetach?.(existing.id);
        from = { nodeId: existing.source, handleId: existing.sourceHandle, type: "source" };
      }
    }
    setConnection({ from, to: toFlow(e.clientX, e.clientY), hover: null });
    const move = (ev: PointerEvent) => setConnection({ from, to: toFlow(ev.clientX, ev.clientY), hover: findTarget(ev.clientX, ev.clientY, from) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setConnection(null);
      const target = findTarget(ev.clientX, ev.clientY, from);
      if (target) props.onConnect?.(toConnection(from, target));
      const over = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const overPane = !!over && !!el?.contains(over) && !over.closest("[data-node-id],[data-sg-overlay]");
      props.onConnectEnd?.({ from, connected: !!target, client: { x: ev.clientX, y: ev.clientY }, flow: toFlow(ev.clientX, ev.clientY), overPane });
      // dropped on empty canvas: offer to add a node there, connected to the wire
      if (!target && overPane && props.onAddNode && props.contextMenu !== false)
        setMenu({ target: { kind: "connection", from }, at: local(ev.clientX, ev.clientY), flow: toFlow(ev.clientX, ev.clientY) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const isConnectable: GraphContextValue["isConnectable"] = (ref) => {
    const c = connection();
    return !!c && valid(c.from, ref);
  };

  // ---- node drag ------------------------------------------------------------------
  /** `ids` plus everything inside them (containers carry their children). */
  const withDescendants = (ids: string[]) => {
    const all = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of props.nodes) if (n.parentId && all.has(n.parentId) && !all.has(n.id)) (all.add(n.id), (grew = true));
    }
    return all;
  };

  const startNodeDrag = (e: PointerEvent, node: GraphNode) => {
    const id = node.id;
    const cur = currentSelection();
    const isSelected = cur.nodes.includes(id);
    let ids: string[];
    if (e.shiftKey) {
      ids = isSelected ? cur.nodes.filter((x) => x !== id) : [...cur.nodes, id];
      setSelection({ nodes: ids, edges: cur.edges });
      if (isSelected) return;
    } else if (isSelected) ids = cur.nodes;
    else {
      ids = [id];
      setSelection({ nodes: ids, edges: [] });
    }
    if (node.draggable === false) return;
    ids = ids.filter((x) => nodeById().get(x)?.draggable !== false);
    const moving = withDescendants(ids);
    const start = new Map([...moving].map((x) => [x, { ...nodeById().get(x)!.position }]));
    const p0 = { x: e.clientX, y: e.clientY };
    let active = false;
    const at = (dx: number, dy: number, round = false): NodeMove[] =>
      [...start].map(([x, p]) => {
        const q = { x: p.x + dx, y: p.y + dy };
        return { id: x, position: round ? { x: Math.round(q.x), y: Math.round(q.y) } : q };
      });
    const move = (ev: PointerEvent) => {
      const z = viewport().zoom;
      const dx = (ev.clientX - p0.x) / z;
      const dy = (ev.clientY - p0.y) / z;
      if (!active) {
        if (Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y) < 3) return;
        active = true;
        setDragging(moving);
        props.onNodesMove?.(at(0, 0), "start");
      }
      props.onNodesMove?.(at(dx, dy), "move");
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!active) return;
      setDragging(new Set<string>());
      const z = viewport().zoom;
      const moves = at((ev.clientX - p0.x) / z, (ev.clientY - p0.y) / z, true);
      // the dragged nodes (not the children they carry) may change container
      const containers = props.nodes.filter((n) => n.container);
      for (const m of moves) {
        if (!ids.includes(m.id)) continue;
        const n = nodeById().get(m.id)!;
        const own = withDescendants([m.id]);
        const rect = { ...m.position, ...nodeSize(m.id) };
        const candidates = containers
          .filter((c) => !own.has(c.id) && (props.canContain?.(c, n) ?? true))
          .map((c) => {
            // containers moving along keep their relative place
            const s = start.get(c.id);
            const pos = s ? moves.find((x) => x.id === c.id)!.position : c.position;
            return { id: c.id, rect: { ...pos, ...nodeSize(c.id) } };
          });
        const parent = containerAt(rect, candidates);
        if (parent !== (n.parentId ?? null)) m.parentId = parent;
      }
      props.onNodesMove?.(moves, "end");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const n = nodeById().get(id);
    if (!n) return;
    const s0 = nodeSize(id);
    const p0 = { x: e.clientX, y: e.clientY };
    const minW = n.minWidth ?? 40;
    const minH = n.minHeight ?? 30;
    const size = (ev: PointerEvent): NodeResize => {
      const z = viewport().zoom;
      return {
        id,
        width: Math.round(Math.max(minW, s0.width + (ev.clientX - p0.x) / z)),
        height: Math.round(Math.max(minH, s0.height + (ev.clientY - p0.y) / z)),
      };
    };
    props.onNodeResize?.({ id, ...s0 }, "start");
    const move = (ev: PointerEvent) => props.onNodeResize?.(size(ev), "move");
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      props.onNodeResize?.(size(ev), "end");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---- pane: pan, box select ------------------------------------------------------
  const startPan = (e: PointerEvent, clickClears: boolean) => {
    e.preventDefault();
    const p0 = { x: e.clientX, y: e.clientY };
    const v0 = viewport();
    let moved = false;
    setPanning(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - p0.x;
      const dy = ev.clientY - p0.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      setViewport({ ...v0, x: v0.x + dx, y: v0.y + dy });
    };
    const up = (ev: PointerEvent) => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved && clickClears) {
        setSelection({ nodes: [], edges: [] });
        props.onPaneClick?.(ev);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startBox = (e: PointerEvent) => {
    const a = local(e.clientX, e.clientY);
    const additive = e.shiftKey;
    const initial = additive ? currentSelection() : { nodes: [], edges: [] };
    setBox({ a, b: a });
    const move = (ev: PointerEvent) => {
      const b = local(ev.clientX, ev.clientY);
      setBox({ a, b });
      const v = viewport();
      const r = rectFrom(screenToFlow(v, a), screenToFlow(v, b));
      const hits = props.nodes
        .filter((n) => {
          if (n.selectable === false) return false;
          const nr = nodeRect(n.id)!;
          // containers only when fully inside, so a box can be drawn within a group
          return n.container
            ? nr.x >= r.x && nr.y >= r.y && nr.x + nr.width <= r.x + r.width && nr.y + nr.height <= r.y + r.height
            : rectsIntersect(nr, r);
        })
        .map((n) => n.id);
      setSelection({ nodes: [...new Set([...initial.nodes, ...hits])], edges: initial.edges });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const b = box();
      setBox(null);
      if (b && Math.abs(b.b.x - b.a.x) + Math.abs(b.b.y - b.a.y) < 3) {
        if (!additive) setSelection({ nodes: [], edges: [] });
        props.onPaneClick?.(ev);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Selector limiting where a node can be grabbed: its `dragHandle`, else any `[data-drag-handle]` it renders. */
  const dragHandleOf = (n: GraphNode, nodeEl: HTMLElement) =>
    n.dragHandle ?? (nodeEl.querySelector("[data-drag-handle]") ? "[data-drag-handle]" : undefined);

  /** The node a pointer press belongs to, or null when it should act on the pane. */
  const pressedNode = (target: HTMLElement): { node: GraphNode; handle?: string } | null => {
    const nodeEl = target.closest<HTMLElement>("[data-node-id]");
    if (!nodeEl) return null;
    const n = nodeById().get(nodeEl.dataset.nodeId!);
    if (!n) return null;
    const handle = dragHandleOf(n, nodeEl);
    // a container's body (outside its drag handle) behaves like empty canvas
    if (n.container && handle && !target.closest(handle) && !target.closest(NO_DRAG)) return null;
    return { node: n, handle };
  };

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-sg-overlay]")) return;
    if (t.closest("[data-edge-id]")) return; // edges select themselves
    const pressed = pressedNode(t);
    if (pressed) {
      const node = pressed.node;
      if (e.button !== 0 || t.closest(NO_DRAG)) return;
      if (node.selectable === false && node.draggable === false) return;
      if (pressed.handle && !t.closest(pressed.handle)) {
        // outside the drag handle: select only
        if (node.selectable !== false) setSelection({ nodes: [node.id], edges: [] });
        return;
      }
      e.stopPropagation();
      startNodeDrag(e, node);
      return;
    }
    if (e.button !== 0) return;
    if (props.panOnDrag && !e.shiftKey) startPan(e, true);
    else startBox(e);
  };

  /** Space+drag and middle-drag pan from anywhere, before nodes and handles see the press. */
  const onPanCapture = (e: PointerEvent) => {
    if (!(e.button === 1 || (e.button === 0 && spaceDown()))) return;
    if ((e.target as HTMLElement).closest("[data-sg-overlay]")) return;
    e.stopPropagation();
    startPan(e, !(e.target as HTMLElement).closest("[data-node-id],[data-edge-id]"));
  };

  const targetOf = (e: MouseEvent): ContextTarget => {
    const t = e.target as HTMLElement;
    const edge = t.closest<HTMLElement>("[data-edge-id]");
    if (edge) return { kind: "edge", id: edge.dataset.edgeId! };
    const pressed = pressedNode(t);
    return pressed ? { kind: "node", id: pressed.node.id } : { kind: "pane" };
  };

  // ---- lifecycle -----------------------------------------------------------------
  onSettled(() => {
    const canvas = el!;
    const ro = new ResizeObserver(() => setCanvasSize({ width: canvas.clientWidth, height: canvas.clientHeight }));
    ro.observe(canvas);
    setCanvasSize({ width: canvas.clientWidth, height: canvas.clientHeight });
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-sg-overlay],[data-sg-scroll]")) return;
      e.preventDefault();
      const v = viewport();
      // trackpad two-finger scroll pans; the wheel and pinch (ctrlKey) zoom
      const pinch = e.ctrlKey;
      if (!pinch && e.deltaMode === 0 && Math.abs(e.deltaX) > 0 && Math.abs(e.deltaY) < 50) {
        setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
        return;
      }
      setViewport(zoomAround(v, Math.exp(-e.deltaY * (pinch ? 0.01 : 0.0015)), local(e.clientX, e.clientY), minZoom(), maxZoom()));
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable='true']")) setSpaceDown(true);
    };
    const keyup = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    const blockDbl = (e: MouseEvent) => spaceDown() && e.stopPropagation();
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("pointerdown", onPanCapture, { capture: true });
    canvas.addEventListener("dblclick", blockDbl, { capture: true });
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);

    // the API works right away; only the initial fit waits until nodes have rendered and been measured
    // (animation frames don't run in background tabs, so onInit mustn't wait for them)
    untrack(() => props.onInit?.(api));
    const shouldFit = untrack(() => props.fitViewOnInit ?? (!props.viewport && !props.defaultViewport));
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        if (shouldFit) fitView();
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointerdown", onPanCapture, { capture: true });
      canvas.removeEventListener("dblclick", blockDbl, { capture: true });
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  });

  // ---- context menu -------------------------------------------------------------------
  createEffect(
    () => !!menu(),
    (open) => {
      if (!open) return;
      const down = (e: PointerEvent) => !(e.target as HTMLElement).closest("[data-sg-menu]") && closeMenu();
      const key = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
      const t = setTimeout(() => window.addEventListener("pointerdown", down, true));
      window.addEventListener("keydown", key, true);
      el?.addEventListener("wheel", closeMenu, { passive: true });
      return () => {
        clearTimeout(t);
        window.removeEventListener("pointerdown", down, true);
        window.removeEventListener("keydown", key, true);
        el?.removeEventListener("wheel", closeMenu);
      };
    },
  );

  /** Connect a dropped wire to a node added for it, once the node has rendered and been measured. */
  const connectWhenReady = (id: string, from: HandleRef, tries = 0) => {
    setTimeout(() => {
      const n = nodeById().get(id);
      const m = measured[id];
      if (!n || !m) {
        if (tries < 60) connectWhenReady(id, from, tries + 1); // ~1s
        return;
      }
      const target = Object.values(m.handles)
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((h): HandleRef => ({ nodeId: id, handleId: h.id, type: h.type }))
        .find((ref) => valid(from, ref));
      if (target) props.onConnect?.(toConnection(from, target));
    }, 16);
  };

  const menuProps = (m: { target: ContextTarget; flow: XY }): ContextMenuProps => {
    const run = (fn: () => void) => () => {
      closeMenu();
      fn();
    };
    return {
      target: m.target,
      position: m.flow,
      nodeTypes: Object.keys(nodeTypes()),
      api,
      close: closeMenu,
      actions: {
        addNode: props.onAddNode
          ? (type) =>
              run(() => {
                const t = m.target;
                if (t.kind !== "connection") return void props.onAddNode!(type, m.flow);
                // a wire from an output gets the new node to its right, one from an input to its left
                const at = t.from.type === "source" ? { x: m.flow.x + 20, y: m.flow.y - 20 } : { x: m.flow.x - 220, y: m.flow.y - 20 };
                const id = props.onAddNode!(type, at, t.from);
                if (id) connectWhenReady(id, t.from);
              })()
          : undefined,
        deleteSelection: props.onDelete ? run(() => props.onDelete!(currentSelection())) : undefined,
        selectAll: run(() => setSelection({ nodes: props.nodes.filter((n) => n.selectable !== false).map((n) => n.id), edges: [] })),
        fitView: run(() => fitView()),
        fitSelection: run(() => fitView({ nodes: currentSelection().nodes, maxZoom: 1.5 })),
      },
    };
  };

  /** Keep the menu inside the canvas. */
  const placeMenu = (box: HTMLElement, at: XY) => {
    const size = canvasSize();
    box.style.left = `${Math.max(4, Math.min(at.x, size.width - box.offsetWidth - 4))}px`;
    box.style.top = `${Math.max(4, Math.min(at.y, size.height - box.offsetHeight - 4))}px`;
  };

  // ---- render ------------------------------------------------------------------------
  const nodeTypes = createMemo(() => ({ ...defaultNodeTypes, ...props.nodeTypes }));
  const edgeTypes = createMemo(() => ({ ...defaultEdgeTypes, ...props.edgeTypes }));

  /** Containers deepest-last, so nested groups draw over their parents. */
  const containers = createMemo(() => {
    const depth = (n: GraphNode) => {
      let d = 0;
      for (let p = n.parentId; p && d < 32; p = nodeById().get(p)?.parentId) d++;
      return d;
    };
    return props.nodes.filter((n) => n.container).sort((a, b) => depth(a) - depth(b) || (a.zIndex ?? 0) - (b.zIndex ?? 0));
  });
  const regular = createMemo(() => props.nodes.filter((n) => !n.container));

  const grid = () => {
    let step = (props.gridSize ?? 20) * viewport().zoom;
    while (step < 10) step *= 2;
    return step;
  };
  const backgroundImage = () =>
    props.background === "none"
      ? undefined
      : props.background === "lines"
        ? "linear-gradient(var(--sg-grid) 1px, transparent 1px), linear-gradient(90deg, var(--sg-grid) 1px, transparent 1px)"
        : "radial-gradient(var(--sg-grid) 1px, transparent 1px)";

  const ctx: GraphContextValue = {
    api,
    nodes: () => props.nodes,
    edges: () => props.edges,
    nodeById,
    selection,
    peekSelection: currentSelection,
    select: setSelection,
    viewport,
    canvasSize,
    measured,
    measure,
    connection,
    isDragging: (id) => dragging().has(id),
    handlePoint,
    startConnect,
    startResize,
    isConnectable,
  };

  return (
    <GraphContext value={ctx}>
      <div
        ref={el}
        class={[
          "solid-graph relative h-full w-full overflow-hidden bg-[var(--sg-bg)] outline-none select-none",
          panning() ? "cursor-grabbing" : props.panOnDrag || spaceDown() ? "cursor-grab" : "cursor-default",
          { "[&_*]:!cursor-grab": spaceDown() && !panning(), "[&_*]:!cursor-grabbing": panning() },
          props.class,
        ]}
        style={{
          "background-image": backgroundImage(),
          "background-size": `${grid()}px ${grid()}px`,
          "background-position": `${viewport().x}px ${viewport().y}px`,
        }}
        tabindex="0"
        onPointerDown={onPointerDown}
        onDblClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-sg-overlay]")) return;
          props.onDoubleClick?.(targetOf(e), e);
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("[data-sg-overlay],[data-sg-menu]")) return;
          if (!props.onContextMenu && props.contextMenu === false) return;
          e.preventDefault();
          const target = targetOf(e);
          if (target.kind === "node" && !currentSelection().nodes.includes(target.id)) setSelection({ nodes: [target.id], edges: [] });
          if (target.kind === "edge") setSelection({ nodes: [], edges: [target.id] });
          props.onContextMenu?.(target, e);
          if (props.contextMenu !== false) setMenu({ target, at: local(e.clientX, e.clientY), flow: toFlow(e.clientX, e.clientY) });
        }}
        onDragOver={(e) => props.onDragOver?.(e)}
        onDrop={(e) => props.onDrop?.(e)}
      >
        <div class="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${viewport().x}px, ${viewport().y}px) scale(${viewport().zoom})` }}>
          <For each={containers()} keyed={(n) => n.id}>{(n) => <NodeRenderer node={n()} types={nodeTypes()} />}</For>
          <svg class="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
            <For each={props.edges} keyed={(e) => e.id}>{(edge) => <EdgeRenderer edge={edge()} types={edgeTypes()} defaultType={props.defaultEdgeType ?? "bezier"} />}</For>
            <Show when={connection()}>{(c) => <ConnectionLine connection={c()} color={props.connectionColor?.(c().from)} />}</Show>
          </svg>
          <For each={regular()} keyed={(n) => n.id}>{(n) => <NodeRenderer node={n()} types={nodeTypes()} />}</For>
        </div>
        <Show when={box()}>
          {(b) => {
            const r = () => rectFrom(b().a, b().b);
            return (
              <div
                class="pointer-events-none absolute border border-[var(--sg-selection)] bg-[color-mix(in_oklab,var(--sg-selection)_10%,transparent)]"
                style={{ left: `${r().x}px`, top: `${r().y}px`, width: `${r().width}px`, height: `${r().height}px` }}
              />
            );
          }}
        </Show>
        {props.children}
        <Show when={props.contextMenu !== false && menu()} keyed>
          {(m) => (
            <div
              data-sg-menu
              class="absolute z-20"
              style={{ left: `${m.at.x}px`, top: `${m.at.y}px` }}
              ref={(box) => requestAnimationFrame(() => placeMenu(box, m.at))}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Dynamic component={props.contextMenu || DefaultContextMenu} {...menuProps(m)} />
            </div>
          )}
        </Show>
      </div>
    </GraphContext>
  );
}

