import { createStore } from "solid-js";
import type { GraphProps } from "./Graph";
import type { Connection, GraphEdge, GraphNode, Selection, Viewport, XY } from "./types";

export interface GraphStoreState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selection: Selection;
  viewport?: Viewport;
}

let seq = 0;
const edgeId = (c: Connection) => `e-${c.source}-${c.sourceHandle ?? ""}-${c.target}-${c.targetHandle ?? ""}-${(seq++).toString(36)}`;

/**
 * Batteries-included state for <Graph>: a Solid store plus handlers that
 * apply every change the canvas reports. Spread `store.props` onto <Graph>
 * and override any handler to add your own rules:
 *
 *   const graph = createGraphStore({ nodes, edges });
 *   <Graph {...graph.props} nodeTypes={…} />
 *
 * Apps with their own document model (undo history, validation, saving)
 * usually skip this and pass nodes/edges/handlers directly.
 */
/** Default node for "Add node": a labelled node, or a sized, resizable group for "group". */
export function defaultNodeFactory(type: string, position: XY): GraphNode {
  const id = `${type}-${Date.now().toString(36)}${(seq++).toString(36)}`;
  if (type === "group") return { id, type, position, container: true, resizable: true, width: 320, height: 200, data: { label: "Group" } };
  return { id, type, position, data: { label: type[0].toUpperCase() + type.slice(1) } };
}

export function createGraphStore(
  initial: {
    nodes?: GraphNode[];
    edges?: GraphEdge[];
    viewport?: Viewport;
    /** Builds nodes for "Add node" (context menu). */
    createNode?: (type: string, position: XY) => GraphNode;
  } = {},
) {
  const [state, setState] = createStore<GraphStoreState>({
    nodes: initial.nodes ?? [],
    edges: initial.edges ?? [],
    selection: { nodes: [], edges: [] },
    viewport: initial.viewport,
  });

  const props = {
    get nodes() {
      return state.nodes;
    },
    get edges() {
      return state.edges;
    },
    get selection() {
      return state.selection;
    },
    defaultViewport: initial.viewport,
    onSelectionChange: (s) => setState((d) => void (d.selection = s)),
    onViewportChange: (v) => setState((d) => void (d.viewport = v)),
    onNodesMove: (moves) =>
      setState((d) => {
        const byId = new Map(d.nodes.map((n) => [n.id, n]));
        for (const m of moves) {
          const n = byId.get(m.id);
          if (!n) continue;
          n.position = m.position;
          if (m.parentId !== undefined) n.parentId = m.parentId ?? undefined;
        }
      }),
    onNodeResize: (r) =>
      setState((d) => {
        const n = d.nodes.find((x) => x.id === r.id);
        if (n) {
          n.width = r.width;
          n.height = r.height;
        }
      }),
    onNodeDataChange: (id, patch) => updateNode(id, (n) => void (n.data = { ...n.data, ...patch })),
    onConnect: (c) => addEdge({ id: edgeId(c), ...c }),
    onAddNode: (type, position) => {
      const node = (initial.createNode ?? defaultNodeFactory)(type, position);
      addNode(node);
      return node.id;
    },
    onDelete: (s) => {
      removeEdges(s.edges);
      removeNodes(s.nodes);
    },
    onEdgeDetach: (id) => removeEdges([id]),
  } satisfies Partial<GraphProps>;

  function addNode(node: GraphNode) {
    setState((d) => void d.nodes.push(node));
  }
  function updateNode(id: string, fn: (node: GraphNode) => void) {
    setState((d) => {
      const n = d.nodes.find((x) => x.id === id);
      if (n) fn(n);
    });
  }
  function addEdge(edge: GraphEdge) {
    setState((d) => void d.edges.push(edge));
  }
  function removeEdges(ids: string[]) {
    const drop = new Set(ids);
    setState((d) => {
      d.edges = d.edges.filter((e) => !drop.has(e.id));
      d.selection = { nodes: d.selection.nodes, edges: d.selection.edges.filter((e) => !drop.has(e)) };
    });
  }
  /** Removes nodes with their edges; children of removed containers are kept and released. */
  function removeNodes(ids: string[]) {
    const drop = new Set(ids);
    setState((d) => {
      d.nodes = d.nodes.filter((n) => !drop.has(n.id));
      for (const n of d.nodes) if (n.parentId && drop.has(n.parentId)) n.parentId = undefined;
      d.edges = d.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target));
      d.selection = { nodes: d.selection.nodes.filter((x) => !drop.has(x)), edges: [] };
    });
  }
  /** Deletes the selected nodes and edges. */
  function deleteSelection() {
    const { nodes, edges } = state.selection;
    removeEdges(edges);
    removeNodes(nodes);
  }

  return { state, setState, props, addNode, updateNode, addEdge, removeEdges, removeNodes, deleteSelection };
}

export type GraphStore = ReturnType<typeof createGraphStore>;
