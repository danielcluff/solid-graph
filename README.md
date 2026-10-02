# solid-graph

Node graph UI for [SolidJS](https://github.com/solidjs/solid) 2: a pan/zoom canvas with your own node components,
handles, connections, selection, groups, resizing, custom edges with labels, a minimap and zoom controls. Styled with
Tailwind v4; themed through CSS variables.

```tsx
import { Controls, Graph, MiniMap, createGraphStore } from "solid-graph";

const graph = createGraphStore({
  nodes: [
    { id: "a", type: "input", position: { x: 0, y: 0 }, data: { label: "A" } },
    { id: "b", position: { x: 220, y: 80 }, data: { label: "B" } },
  ],
  edges: [{ id: "a-b", source: "a", target: "b", label: "hello" }],
});

<div style={{ height: "600px" }}>
  <Graph {...graph.props}>
    <Controls />
    <MiniMap />
  </Graph>
</div>;
```

```css
/* your Tailwind entry */
@import "tailwindcss";
@import "solid-graph/styles.css";
```

`pnpm dev` runs the sandbox at http://localhost:5175: every element on one canvas, a palette to spawn each node type
(click or drag in), a node builder (name, style, typed inputs and outputs, live preview; saved to the palette), and
switches for the default edge type, edge-type overrides, the context menu and canvas options.

## State: your app owns it

`<Graph>` renders the `nodes` and `edges` you give it and reports what the user does; your app applies the changes.
That keeps undo history, validation and persistence in your hands.

| Prop                                     | When                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `onNodesMove(moves, phase)`              | dragging nodes. `"start"` (record history), `"move"`, `"end"` (positions rounded; `parentId` set when the node was dropped into or out of a container) |
| `onNodeResize(size, phase)`              | resizing a `resizable` node                                                          |
| `onConnect(connection)`                  | a connection was dropped on a valid handle                                           |
| `onConnectEnd({ from, connected, … })`   | any connection drag ended (e.g. open a node picker when dropped on empty canvas)    |
| `onEdgeDetach(id)`                       | with `pickUpEdges`: an existing wire was picked up from its target handle           |
| `onSelectionChange` / `selection`        | controlled selection (omit both to let the canvas keep it)                           |
| `onViewportChange` / `viewport`          | controlled viewport (or `defaultViewport`; fits all nodes on start otherwise)        |
| `onContextMenu(target, e)`, `onDoubleClick(target, e)`, `onPaneClick(e)` | `target` is the pane, a node or an edge          |
| `onAddNode(type, position, from?)`, `onDelete(selection)` | the built-in context menu's "Add node" (return the new id) and "Delete" (left out when not handled) |
| `onDrop`, `onDragOver`                   | drag & drop from outside (use `api.screenToFlow` for the position)                 |
| `onInit(api)`                            | the imperative API: `fitView`, `zoomBy`, `setViewport`, `screenToFlow`, `nodeRect`, … |

`createGraphStore()` is the batteries-included option: a Solid store plus handlers that apply everything (and
`addNode`, `removeNodes`, `deleteSelection`, …). Spread `graph.props` and override any handler. Its `createNode(type,
position)` option builds the nodes "Add node" creates (default: `defaultNodeFactory`).

## Nodes

```ts
interface GraphNode<D> {
  id: string;
  type?: string;            // key into nodeTypes ("default", "input", "output", "group", or yours)
  position: { x; y };       // absolute, also inside containers
  data: D;
  width?; height?;          // fixed size; otherwise measured from the content
  parentId?: string;        // container membership
  container?: boolean;      // holds nodes: drawn behind edges, children move with it, drops join it
  resizable?: boolean; minWidth?; minHeight?;
  dragHandle?: string;      // CSS selector: only presses on it start a drag
  draggable?; selectable?; connectable?; zIndex?; class?;
}
```

A node type is a component receiving `{ node, data, selected, dragging }`. Put `<Handle>`s wherever connections go:

```tsx
function MathNode(props: NodeProps<{ title: string }>) {
  return (
    <div class="rounded-lg border bg-white px-3 py-2">
      <Handle type="target" id="x" />
      {props.data.title}
      <Handle type="source" id="out" />
    </div>
  );
}
<Graph nodeTypes={{ math: MathNode }} … />
```

`<Handle type id position class style connectable>`: `position` (left/right/top/bottom) is the side the wire leaves
from; a `class` replaces the default dot, so a handle can sit inline in a row. While connecting, the handle under the
pointer has `data-connect-target` and every valid one `data-connectable`. Elements marked `data-nodrag` (and inputs,
buttons, …) don't start node drags.

**Connections** go from a `source` to a `target` handle on another node. `isValidConnection(connection)` filters them
(e.g. by port type); while dragging, the canvas snaps to the nearest valid handle within `snapRadius` (28px).
`connectionColor(from)` colours the wire being drawn.

**Groups**: `container: true` nodes (the built-in `group` type, or your own). Give them `dragHandle` so their inside
stays free for box selection, and usually `resizable: true`. Dropping a node into one reports `parentId`;
`canContain(container, node)` restricts what may join.

## Edges

`{ id, source, sourceHandle?, target, targetHandle?, type?, label?, color?, animated?, data? }`.

An edge's look comes from its `type`, else from the canvas's `defaultEdgeType` (default `"bezier"`). Built-in types:
`bezier`, `straight`, `step`, `smoothstep`. Register your own with `edgeTypes={{ name: Component }}`; a registered type
with a built-in's name replaces it. A custom edge type receives the end points and renders `<BaseEdge>` (hit area,
stroke, label) with a path from `getBezierPath` / `getStepPath` / `getStraightPath` or your own. `color`, `animated` and
`label` are per edge; the line drawn while connecting is always a bezier.

## Interaction

Wheel or pinch zooms around the pointer, trackpad scroll pans, Space+drag or middle-drag pans from anywhere. Dragging
empty canvas box-selects (containers only when fully inside); with `panOnDrag` it pans and Shift+drag box-selects.
Click / Shift+click selects nodes and edges. Keyboard shortcuts (delete, copy, …) are the app's: the canvas only
handles Space for panning.

## Context menu

Right-click shows a built-in menu: on the canvas, "Add node" (one entry per registered node type, with `onAddNode`),
Select all, Fit view; on a node, Zoom to selection and Delete (with `onDelete`); on an edge, Delete. Swap it with
`contextMenu={MyMenu}` or turn it off with `contextMenu={false}`. A menu component receives `ContextMenuProps`: the
`target`, the click `position` (flow coordinates), `nodeTypes`, `api`, `close()` and ready-made `actions`. Build it from
`Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator` to match, or wrap `DefaultContextMenu`. `onContextMenu` fires either way.

**Dropping a wire on empty canvas** opens the same menu with target `{ kind: "connection", from }` ("Add connected
node"), when the app handles `onAddNode`. Picking a type calls `onAddNode(type, position, from)`; return the new node's
id and, once it has rendered, the canvas connects the wire to its first handle that `isValidConnection` accepts (through
`onConnect`). The node is placed right of the drop point for a wire from an output, left of it for one from an input.
All registered types are listed; a type without a matching handle is added unconnected.

## Overlays

Children of `<Graph>` float over the canvas: `<Controls />` (zoom in/out/fit), `<MiniMap nodeColor pannable zoomable />`
(click/drag to move the view), and `<Panel position>` for anything else. `useGraph()` gives overlays and node
components the API.

## Theming

All colours are CSS variables on `.solid-graph` (`--sg-edge`, `--sg-selection`, `--sg-grid`, `--sg-node-bg`, …; see
`src/styles.css`), with dark values under your Tailwind `dark` variant. Override them on the canvas or any ancestor.
`background="dots" | "lines" | "none"`, `gridSize`.
