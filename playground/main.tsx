// solid-graph sandbox: every element and option on one canvas, with a sidebar to play with them.
import { For, Show, createEffect, createMemo, createSignal, onSettled, type Component } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import {
  BaseEdge,
  Controls,
  Graph,
  Handle,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MiniMap,
  createGraphStore,
  useGraph,
  defaultEdgeTypes,
  defaultNodeFactory,
  getBezierPath,
  type ContextMenuProps,
  type EdgeProps,
  type GraphApi,
  type GraphEdge,
  type GraphNode,
  type NodeProps,
  type XY,
} from "../src";
import "./styles.css";

// ---- custom node types ----------------------------------------------------------

type PortType = "float" | "color" | "vec3" | "any";
const PORT_TYPES: PortType[] = ["float", "color", "vec3", "any"];
const PORT_COLOR: Record<PortType, string> = { float: "#60a5fa", color: "#f472b6", vec3: "#34d399", any: "#a3a3a3" };
interface Port {
  id: string;
  label: string;
  type: PortType;
  /** Inline value of an unconnected input, shown as "(value)". */
  value?: string | number;
}
type NodeShape = "card" | "compact" | "pill";
const SHAPES: NodeShape[] = ["card", "compact", "pill"];
interface PortData {
  title: string;
  /** Header / accent colour. */
  accent?: string;
  shape?: NodeShape;
  inputs: Port[];
  outputs: Port[];
}

/** Typed ports (connections only between matching types, see isValidConnection), in three styles. */
function PortNode(props: NodeProps<PortData>) {
  const accent = () => props.data.accent ?? "#f43f5e";
  const shape = () => props.data.shape ?? "card";
  const rows = createMemo(() =>
    Array.from({ length: Math.max(props.data.inputs.length, props.data.outputs.length) }, (_, i) => ({
      input: props.data.inputs[i],
      output: props.data.outputs[i],
    })),
  );
  // dim until connected or hovered (the handle marks itself data-connected)
  const label =
    "px-1 text-[10px] font-medium tracking-wider uppercase transition-colors text-[var(--sg-muted)] group-hover:text-[var(--sg-node-fg)] group-has-[[data-connected]]:text-[var(--sg-node-fg)]";
  return (
    <div
      class={[
        "w-48 overflow-hidden border bg-[var(--sg-node-bg)] text-xs shadow-md",
        shape() === "pill" ? "rounded-3xl" : "rounded-xl",
        props.selected ? "border-[var(--sg-node-border-selected)] ring-1 ring-[var(--sg-node-border-selected)]" : "border-[var(--sg-border)]",
      ]}
      style={shape() === "compact" ? { "border-left": `4px solid ${accent()}` } : undefined}
    >
      <Show
        when={shape() === "card"}
        fallback={
          <div class={["px-3 pt-2 font-semibold", shape() === "pill" ? "text-center" : ""]} style={{ color: shape() === "pill" ? accent() : undefined }}>
            {props.data.title}
          </div>
        }
      >
        <div class="px-3 py-2 text-[11px] font-semibold tracking-wide uppercase" style={{ background: `color-mix(in oklab, ${accent()} 18%, transparent)` }}>
          {props.data.title}
        </div>
      </Show>
      {/* tsl-graph's layout: row i holds input i (left) and output i (right); a row
          with only an input uses the full width, so long input labels aren't cut */}
      <div class="flex flex-col py-1.5">
        <For each={rows()}>
          {(row) => (
            <div class="flex min-h-[22px] items-center justify-between gap-2">
              <div class="relative flex min-w-0 flex-1 items-center">
                <Show when={row.input}>
                  {(p) => (
                    <div class="group flex min-w-0 items-center pl-5">
                      <Handle type="target" id={p().id} color={PORT_COLOR[p().type]} />
                      <span class={[label, "truncate"]}>{p().label}</span>
                      <Show when={p().value !== undefined}>
                        <span class="shrink-0 font-mono text-[9px] text-[var(--sg-muted)] tabular-nums">({p().value})</span>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
              <div class="relative flex shrink-0 items-center">
                <Show when={row.output}>
                  {(p) => (
                    <div class="group flex items-center pr-5">
                      <span class={[label, "whitespace-nowrap"]}>{p().label}</span>
                      <Handle type="source" id={p().id} color={PORT_COLOR[p().type]} />
                    </div>
                  )}
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** A resizable sticky note: double-click to edit, click away or Escape to save. */
function NoteNode(props: NodeProps<{ text: string }>) {
  const api = useGraph();
  const [editing, setEditing] = createSignal(false);
  return (
    <div
      class={[
        "h-full w-full overflow-hidden rounded-lg border bg-amber-100/90 text-xs text-amber-950 shadow-md dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-50",
        props.selected && "ring-2 ring-[var(--sg-node-border-selected)]",
      ]}
      onDblClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <Show
        when={editing()}
        fallback={
          <div class="h-full overflow-auto p-3 whitespace-pre-wrap">
            {props.data.text || <span class="opacity-50">Double-click to write…</span>}
          </div>
        }
      >
        <textarea
          class="h-full w-full resize-none bg-transparent p-3 outline-none"
          value={props.data.text}
          placeholder="Write a note…"
          ref={(t) => requestAnimationFrame(() => t.focus())}
          onBlur={(e) => {
            const text = e.currentTarget.value;
            setEditing(false);
            if (text !== props.data.text) api.updateNodeData(props.node.id, { text });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
            e.stopPropagation();
          }}
        />
      </Show>
    </div>
  );
}

/** Vertical flow: handles on top and bottom. */
function VerticalNode(props: NodeProps<{ label: string }>) {
  return (
    <div
      class={[
        "relative w-36 rounded-lg border bg-[var(--sg-node-bg)] px-3 py-4 text-center text-sm shadow-sm",
        props.selected ? "border-[var(--sg-node-border-selected)] ring-1 ring-[var(--sg-node-border-selected)]" : "border-[var(--sg-border)]",
      ]}
    >
      <Handle type="target" position="top" />
      {props.data.label}
      <Handle type="source" position="bottom" />
    </div>
  );
}

const nodeTypes = { ports: PortNode, note: NoteNode, vertical: VerticalNode };

// ---- custom edge types -----------------------------------------------------------

/** A registered type of its own. */
function DashedEdge(props: EdgeProps) {
  const p = createMemo(() => getBezierPath(props));
  return (
    <BaseEdge
      id={props.edge.id}
      path={p()[0]}
      labelX={p()[1]}
      labelY={p()[2]}
      label={props.edge.label}
      color={props.color}
      selected={props.selected}
      style={{ "stroke-dasharray": "2 6", "stroke-linecap": "round", "stroke-width": "3" }}
    />
  );
}

/** Registered as "bezier" to show that registered types replace built-ins of the same name. */
function GlowBezierEdge(props: EdgeProps) {
  const p = createMemo(() => getBezierPath(props, 0.8));
  return (
    <BaseEdge
      id={props.edge.id}
      path={p()[0]}
      labelX={p()[1]}
      labelY={p()[2]}
      label={props.edge.label}
      color={props.color}
      selected={props.selected}
      style={{ filter: "drop-shadow(0 0 4px var(--sg-selection))", "stroke-width": "3" }}
    />
  );
}

// ---- templates: what the palette and "Add node" create ------------------------------

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;
const math = (title: string, inputs: Port[], outputs: Port[]): PortData => ({ title, inputs, outputs });

interface Template {
  label: string;
  create(position: XY): GraphNode;
}

const TEMPLATES: { group: string; items: Template[] }[] = [
  {
    group: "Built-in",
    items: [
      { label: "Default", create: (p) => defaultNodeFactory("default", p) },
      { label: "Input", create: (p) => defaultNodeFactory("input", p) },
      { label: "Output", create: (p) => defaultNodeFactory("output", p) },
      { label: "Group", create: (p) => ({ ...defaultNodeFactory("group", p), minWidth: 200, minHeight: 120 }) },
    ],
  },
  {
    group: "Typed (math)",
    items: [
      { label: "Time", create: (p) => ({ id: uid("time"), type: "ports", position: p, data: math("Time", [], [{ id: "t", label: "seconds", type: "float" }]) }) },
      { label: "Sin", create: (p) => ({ id: uid("sin"), type: "ports", position: p, data: math("Sin", [{ id: "x", label: "x", type: "float" }], [{ id: "out", label: "out", type: "float" }]) }) },
      { label: "Colour", create: (p) => ({ id: uid("col"), type: "ports", position: p, data: math("Colour", [], [{ id: "c", label: "colour", type: "color" }]) }) },
      {
        label: "Mix colour",
        create: (p) => ({
          id: uid("mix"),
          type: "ports",
          position: p,
          data: math("Mix colour", [{ id: "a", label: "a", type: "color" }, { id: "b", label: "b", type: "color" }, { id: "t", label: "t", type: "float" }], [{ id: "out", label: "colour", type: "color" }]),
        }),
      },
      {
        label: "Remap",
        create: (p) => ({
          id: uid("remap"),
          type: "ports",
          position: p,
          data: math(
            "Remap",
            [
              { id: "in", label: "In", type: "float" },
              { id: "inLow", label: "In low", type: "float", value: 0 },
              { id: "inHigh", label: "In high", type: "float", value: 1 },
              { id: "outLow", label: "Out low", type: "float", value: 0.75 },
              { id: "outHigh", label: "Out high", type: "float", value: 1 },
            ],
            [{ id: "out", label: "Out", type: "float" }],
          ),
        }),
      },
      { label: "Position", create: (p) => ({ id: uid("pos"), type: "ports", position: p, data: math("Position", [], [{ id: "p", label: "xyz", type: "vec3" }]) }) },
    ],
  },
  {
    group: "Other",
    items: [
      { label: "Vertical", create: (p) => ({ id: uid("v"), type: "vertical", position: p, data: { label: "Vertical" } }) },
      { label: "Note", create: (p) => ({ id: uid("note"), type: "note", resizable: true, minWidth: 140, minHeight: 60, width: 220, height: 110, position: p, data: { text: "" } }) },
    ],
  },
];

/** "Add node" in the context menu gets a type name; give each type a sensible node. */
const createByType = (type: string, position: XY): GraphNode => {
  const all = TEMPLATES.flatMap((g) => g.items);
  const byLabel = (label: string) => all.find((t) => t.label === label)!;
  if (type === "ports") return byLabel("Sin").create(position);
  if (type === "note") return byLabel("Note").create(position);
  if (type === "vertical") return byLabel("Vertical").create(position);
  if (type === "group") return byLabel("Group").create(position);
  return defaultNodeFactory(type, position);
};

// ---- initial graph ------------------------------------------------------------------

const initialNodes: GraphNode[] = [
  { id: "group", type: "group", container: true, resizable: true, position: { x: -40, y: 180 }, width: 520, height: 260, minWidth: 240, minHeight: 140, data: { label: "Group" } },
  { id: "time", type: "ports", parentId: "group", position: { x: 0, y: 240 }, data: math("Time", [], [{ id: "t", label: "seconds", type: "float" }]) },
  { id: "sin", type: "ports", parentId: "group", position: { x: 240, y: 230 }, data: math("Sin", [{ id: "x", label: "x", type: "float" }], [{ id: "out", label: "out", type: "float" }]) },
  {
    id: "mix",
    type: "ports",
    position: { x: 620, y: 200 },
    data: math("Mix colour", [{ id: "a", label: "a", type: "color" }, { id: "b", label: "b", type: "color" }, { id: "t", label: "t", type: "float" }], [{ id: "out", label: "colour", type: "color" }]),
  },
  { id: "red", type: "ports", position: { x: 300, y: 20 }, data: math("Colour", [], [{ id: "c", label: "red", type: "color" }]) },
  { id: "pos", type: "ports", position: { x: 300, y: 500 }, data: math("Position", [], [{ id: "p", label: "xyz", type: "vec3" }]) },
  { id: "in", type: "input", position: { x: 0, y: 0 }, data: { label: "Input" } },
  { id: "def", position: { x: 0, y: 90 }, data: { label: "Default" } },
  { id: "out", type: "output", position: { x: 920, y: 40 }, data: { label: "Output" } },
  { id: "v1", type: "vertical", position: { x: 920, y: 200 }, data: { label: "Vertical A" } },
  { id: "v2", type: "vertical", position: { x: 940, y: 360 }, data: { label: "Vertical B" } },
];

const initialEdges: GraphEdge[] = [
  { id: "e1", source: "time", sourceHandle: "t", target: "sin", targetHandle: "x", color: PORT_COLOR.float, animated: true },
  { id: "e2", source: "sin", sourceHandle: "out", target: "mix", targetHandle: "t", color: PORT_COLOR.float, label: "default type" },
  { id: "e3", source: "red", sourceHandle: "c", target: "mix", targetHandle: "a", color: PORT_COLOR.color },
  { id: "e4", source: "in", target: "def", type: "step", label: "type: step" },
  { id: "e5", source: "mix", sourceHandle: "out", target: "out", type: "straight", label: "type: straight" },
  { id: "e6", source: "v1", target: "v2", type: "dashed", label: "type: dashed (custom)" },
];

// ---- a swapped-in context menu --------------------------------------------------------

/** Built from the same Menu pieces as the default one. */
function CustomMenu(props: ContextMenuProps & { onLog(msg: string): void; onAdd(t: Template, at: XY): void }) {
  const t = () => props.target;
  const describe = () => {
    const x = t();
    return x.kind === "pane" ? "canvas" : x.kind === "connection" ? `wire from ${x.from.nodeId}` : `${x.kind} ${x.id}`;
  };
  return (
    <Menu class="w-56">
      <MenuLabel>Custom menu · {describe()}</MenuLabel>
      <Show when={t().kind === "pane"}>
        <For each={TEMPLATES.flatMap((g) => g.items).slice(0, 6)}>
          {(tpl) => (
            <MenuItem
              onSelect={() => {
                props.onAdd(tpl, props.position);
                props.close();
              }}
            >
              Add {tpl.label}
            </MenuItem>
          )}
        </For>
      </Show>
      <Show when={t().kind === "connection" && props.actions.addNode}>
        <For each={props.nodeTypes}>{(type) => <MenuItem onSelect={() => props.actions.addNode!(type)}>Connect a new {type}</MenuItem>}</For>
      </Show>
      <Show when={(t().kind === "node" || t().kind === "edge") && props.actions.deleteSelection}>
        <MenuItem destructive shortcut="Del" onSelect={() => props.actions.deleteSelection!()}>
          Delete
        </MenuItem>
      </Show>
      <MenuSeparator />
      <MenuItem
        onSelect={() => {
          props.onLog(`custom menu at ${Math.round(props.position.x)}, ${Math.round(props.position.y)}`);
          props.close();
        }}
      >
        Log click position
      </MenuItem>
    </Menu>
  );
}

// ---- node creation tool ---------------------------------------------------------------

const CUSTOM_KEY = "solid-graph-sandbox-nodes";
function loadCustom(): PortData[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveCustom(list: PortData[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable: keep them for this session only
  }
}

/** Unique, readable handle ids from the port labels. */
function withIds(ports: Port[]): Port[] {
  const used = new Set<string>();
  return ports.map((p, i) => {
    let id = p.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `p${i}`;
    while (used.has(id)) id += "_";
    used.add(id);
    return { ...p, id };
  });
}

const field = "rounded-md border border-black/15 bg-transparent px-1.5 py-1 dark:border-white/15 dark:bg-[#0b0f18]";
const input = `${field} w-full min-w-0`;

/** `onChange` takes an updater: signal reads stay stale until the update flushes, so build on the latest value. */
function PortList(props: { title: string; ports: Port[]; withValues?: boolean; onChange: (update: (ports: Port[]) => Port[]) => void }) {
  const set = (i: number, patch: Partial<Port>) => props.onChange((ports) => ports.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <span class="opacity-60">{props.title}</span>
        <button
          type="button"
          class="rounded px-1.5 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => props.onChange((ports) => [...ports, { id: "", label: props.title === "Inputs" ? "in" : "out", type: "float" }])}
        >
          + add
        </button>
      </div>
      {/* keyed by position, not identity: edits replace the port object, and a re-created row would lose focus */}
      <For each={props.ports} keyed={false}>
        {(p, i) => (
          <div class="flex items-center gap-1">
            <input class={`${field} min-w-0 flex-1`} value={p().label} aria-label={`${props.title} label`} onInput={(e) => set(i, { label: e.currentTarget.value })} />
            <Show when={props.withValues}>
              <input
                class={`${field} w-11 shrink-0 font-mono`}
                value={p().value ?? ""}
                placeholder="—"
                aria-label={`${props.title} value`}
                title="Value shown while the input is unconnected (empty: none)"
                onInput={(e) => {
                  const v = e.currentTarget.value.trim();
                  set(i, { value: v === "" ? undefined : v });
                }}
              />
            </Show>
            <select class={`${field} w-[4.5rem] shrink-0`} value={p().type} aria-label={`${props.title} type`} onChange={(e) => set(i, { type: e.currentTarget.value as PortType })}>
              <For each={PORT_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
            </select>
            <span class="size-2.5 shrink-0 rounded-sm" style={{ background: PORT_COLOR[p().type] }} />
            <button type="button" aria-label="Remove" class="shrink-0 rounded px-1 opacity-60 hover:opacity-100" onClick={() => props.onChange((ports) => ports.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
}

/** Design a node (name, style, ports) with a live preview; "Create" adds it to the palette. */
function NodeBuilder(props: { onCreate: (data: PortData) => void }) {
  const blank = (): PortData => ({
    title: "My node",
    accent: "#8b5cf6",
    shape: "card",
    inputs: [{ id: "", label: "in", type: "float", value: 0 }],
    outputs: [{ id: "", label: "out", type: "float" }],
  });
  const [draft, setDraft] = createSignal<PortData>(blank());
  const update = (patch: Partial<PortData>) => setDraft((d) => ({ ...d, ...patch }));
  const data = createMemo(() => ({ ...draft(), inputs: withIds(draft().inputs), outputs: withIds(draft().outputs) }));
  const [preview, setPreview] = createSignal<GraphApi>();
  // keep the preview framed as the node grows or shrinks
  createEffect(
    () => [data(), preview()] as const,
    ([, api]) => void (api && requestAnimationFrame(() => requestAnimationFrame(() => api.fitView({ padding: 16, maxZoom: 1 })))),
  );
  return (
    <>
      <div class="h-40 overflow-hidden rounded-md border border-black/10 dark:border-white/10">
        <Graph
          nodes={[{ id: "preview", type: "ports", position: { x: 0, y: 0 }, data: data(), draggable: false }]}
          edges={[]}
          nodeTypes={nodeTypes}
          contextMenu={false}
          background="dots"
          onInit={setPreview}
        />
      </div>
      <label class="flex items-center gap-2">
        <span class="w-12 shrink-0">Name</span>
        <input class={input} value={draft().title} onInput={(e) => update({ title: e.currentTarget.value })} />
      </label>
      <label class="flex items-center gap-2">
        <span class="w-12 shrink-0">Style</span>
        <select class={input} value={draft().shape} onChange={(e) => update({ shape: e.currentTarget.value as NodeShape })}>
          <For each={SHAPES}>{(s) => <option value={s}>{s}</option>}</For>
        </select>
        <input type="color" aria-label="Accent colour" class="h-7 w-9 shrink-0 cursor-pointer rounded border border-black/15 bg-transparent dark:border-white/15" value={draft().accent} onInput={(e) => update({ accent: e.currentTarget.value })} />
      </label>
      <PortList title="Inputs" withValues ports={draft().inputs} onChange={(fn) => setDraft((d) => ({ ...d, inputs: fn(d.inputs) }))} />
      <PortList title="Outputs" ports={draft().outputs} onChange={(fn) => setDraft((d) => ({ ...d, outputs: fn(d.outputs) }))} />
      <div class="flex gap-1">
        <button type="button" class={`${button} flex-1 font-medium`} onClick={() => props.onCreate(structuredClone(data()))}>
          Create
        </button>
        <button type="button" class={button} onClick={() => setDraft(blank())}>
          Reset
        </button>
      </div>
    </>
  );
}

// ---- sandbox UI ---------------------------------------------------------------------

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="border-b border-black/10 px-3 py-3 dark:border-white/10">
      <div class="mb-2 text-[11px] font-semibold tracking-wider uppercase opacity-60">{props.title}</div>
      <div class="flex flex-col gap-2 text-xs">{props.children}</div>
    </section>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="flex items-center gap-2">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} /> {props.label}
    </label>
  );
}

function Choice<T extends string>(props: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label class="flex items-center justify-between gap-2">
      <span class="font-mono">{props.label}</span>
      <select
        class="rounded-md border border-black/15 bg-transparent px-1.5 py-1 dark:border-white/15 dark:bg-[#0b0f18]"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value as T)}
      >
        <For each={props.options}>{(o) => <option value={o}>{o}</option>}</For>
      </select>
    </label>
  );
}

const button = "rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10";
const NODE_MIME = "application/x-sandbox-template";

function App() {
  const graph = createGraphStore({ nodes: structuredClone(initialNodes), edges: structuredClone(initialEdges), createNode: createByType });
  const [api, setApi] = createSignal<GraphApi>();
  const [dark, setDark] = createSignal(true);
  const [defaultEdgeType, setDefaultEdgeType] = createSignal("bezier");
  const [overrideBezier, setOverrideBezier] = createSignal(false);
  const [menuKind, setMenuKind] = createSignal<"default" | "custom" | "off">("default");
  const [panOnDrag, setPanOnDrag] = createSignal(false);
  const [pickUp, setPickUp] = createSignal(true);
  const [background, setBackground] = createSignal<"dots" | "lines" | "none">("dots");
  const [showMinimap, setShowMinimap] = createSignal(true);
  const [showControls, setShowControls] = createSignal(true);
  const [snap, setSnap] = createSignal(28);
  const [log, setLog] = createSignal<string[]>([]);
  const note = (msg: string) => setLog((l) => [msg, ...l].slice(0, 8));
  const [custom, setCustom] = createSignal<PortData[]>(loadCustom());
  const customTemplate = (d: PortData): Template => ({
    label: d.title,
    create: (p) => ({ id: uid("custom"), type: "ports", position: p, data: structuredClone(d) }),
  });
  const palette = createMemo(() =>
    custom().length ? [...TEMPLATES, { group: "Custom", items: custom().map(customTemplate) }] : TEMPLATES,
  );

  const edgeTypes = createMemo(() => ({ dashed: DashedEdge, ...(overrideBezier() ? { bezier: GlowBezierEdge } : {}) }));
  const edgeTypeNames = createMemo(() => [...new Set([...Object.keys(defaultEdgeTypes), ...Object.keys(edgeTypes())])]);

  const typeOf = (nodeId: string, handleId: string | undefined, side: "inputs" | "outputs"): PortType | undefined =>
    (graph.state.nodes.find((n) => n.id === nodeId)?.data as Partial<PortData> | undefined)?.[side]?.find((p) => p.id === handleId)?.type;

  const spawn = (tpl: Template, at?: XY) => {
    const a = api();
    if (!a) return;
    // at the given point, else the middle of the view (staggered so repeated clicks don't stack)
    const rect = a.element()!.getBoundingClientRect();
    const k = seq % 5;
    const p = at ?? a.screenToFlow({ x: rect.left + rect.width / 2 - 60 + k * 24, y: rect.top + rect.height / 2 - 30 + k * 24 });
    const node = tpl.create(p);
    graph.addNode(node);
    graph.props.onSelectionChange({ nodes: [node.id], edges: [] });
    note(`added ${tpl.label}`);
  };

  const reset = () => {
    graph.setState((d) => {
      d.nodes = structuredClone(initialNodes);
      d.edges = structuredClone(initialEdges);
      d.selection = { nodes: [], edges: [] };
    });
    requestAnimationFrame(() => api()?.fitView());
  };

  onSettled(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === "Delete" || e.key === "Backspace") graph.deleteSelection();
      if (e.key === "f") api()?.fitView();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const Custom: Component<ContextMenuProps> = (p) => <CustomMenu {...p} onLog={note} onAdd={(t, at) => spawn(t, at)} />;
  const contextMenu = () => (menuKind() === "off" ? false : menuKind() === "custom" ? Custom : undefined);

  return (
    <div class="flex h-full flex-col">
      <header class="flex items-center gap-3 border-b border-black/10 px-4 py-2 text-sm dark:border-white/10">
        <strong>solid-graph</strong>
        <span class="opacity-60">sandbox</span>
        <div class="flex-1" />
        <button
          type="button"
          class={button}
          onClick={() => {
            // signal reads stay stale until the update flushes, so use the new value directly
            const next = !dark();
            setDark(next);
            document.documentElement.classList.toggle("dark", next);
          }}
        >
          {dark() ? "Light" : "Dark"}
        </button>
      </header>
      <div class="flex min-h-0 flex-1">
        <aside class="w-64 shrink-0 overflow-y-auto border-r border-black/10 dark:border-white/10">
          <Section title="Nodes · click or drag in">
            <For each={palette()}>
              {(g, gi) => (
                <div>
                  <div class="mb-1 opacity-60">{g.group}</div>
                  <div class="flex flex-wrap gap-1">
                    <For each={g.items}>
                      {(tpl, ti) => (
                        <span class="inline-flex">
                          <button
                            type="button"
                            draggable="true"
                            class={[button, "cursor-grab", g.group === "Custom" && "rounded-r-none"]}
                            onClick={() => spawn(tpl)}
                            onDragStart={(e) => {
                              e.dataTransfer!.setData(NODE_MIME, `${gi()}:${ti()}`);
                              e.dataTransfer!.effectAllowed = "copy";
                            }}
                          >
                            {tpl.label}
                          </button>
                          <Show when={g.group === "Custom"}>
                            <button
                              type="button"
                              aria-label={`Remove ${tpl.label} from the palette`}
                              class={`${button} -ml-px rounded-l-none px-1.5 opacity-70`}
                              onClick={() => {
                                const next = custom().filter((_, j) => j !== ti());
                                setCustom(next);
                                saveCustom(next);
                              }}
                            >
                              ×
                            </button>
                          </Show>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Section>

          <Section title="Create node">
            <NodeBuilder
              onCreate={(d) => {
                const next = [...custom(), d];
                setCustom(next);
                saveCustom(next);
                spawn(customTemplate(d));
              }}
            />
          </Section>

          <Section title="Edges">
            <Choice label="defaultEdgeType" value={defaultEdgeType()} options={edgeTypeNames()} onChange={setDefaultEdgeType} />
            <Toggle label='Register my own "bezier" (replaces the built-in)' checked={overrideBezier()} onChange={setOverrideBezier} />
            <p class="opacity-60">Edges without a type follow the default; "step", "straight" and "dashed" are set on their edge and win.</p>
          </Section>

          <Section title="Context menu">
            <Choice label="contextMenu" value={menuKind()} options={["default", "custom", "off"] as const} onChange={setMenuKind} />
          </Section>

          <Section title="Canvas">
            <Choice label="background" value={background()} options={["dots", "lines", "none"] as const} onChange={setBackground} />
            <Toggle label="panOnDrag (Shift+drag box-selects)" checked={panOnDrag()} onChange={setPanOnDrag} />
            <Toggle label="pickUpEdges" checked={pickUp()} onChange={setPickUp} />
            <Toggle label="MiniMap" checked={showMinimap()} onChange={setShowMinimap} />
            <Toggle label="Controls" checked={showControls()} onChange={setShowControls} />
            <label class="flex items-center justify-between gap-2">
              <span class="font-mono">snapRadius {snap()}</span>
              <input type="range" min="0" max="80" value={snap()} onInput={(e) => setSnap(Number(e.currentTarget.value))} />
            </label>
          </Section>

          <Section title="Actions">
            <div class="flex flex-wrap gap-1">
              <button type="button" class={button} onClick={() => api()?.fitView()}>
                Fit view
              </button>
              <button type="button" class={button} onClick={() => graph.deleteSelection()}>
                Delete selection
              </button>
              <button type="button" class={button} onClick={reset}>
                Reset
              </button>
              <button type="button" class={button} onClick={() => graph.setState((d) => ({ ...d, nodes: [], edges: [], selection: { nodes: [], edges: [] } }))}>
                Clear
              </button>
            </div>
          </Section>

          <Section title="Events">
            <Show when={log().length} fallback={<div class="opacity-50">Interact with the graph…</div>}>
              <For each={log()}>{(l) => <div class="truncate opacity-80">{l}</div>}</For>
            </Show>
            <div class="opacity-60">
              selected: {graph.state.selection.nodes.join(", ") || "—"}
              {graph.state.selection.edges.length ? ` · edges ${graph.state.selection.edges.join(", ")}` : ""}
            </div>
          </Section>
        </aside>

        <main class="relative min-w-0 flex-1">
          <Graph
            {...graph.props}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes()}
            defaultEdgeType={defaultEdgeType()}
            contextMenu={contextMenu()}
            panOnDrag={panOnDrag()}
            pickUpEdges={pickUp()}
            background={background()}
            snapRadius={snap()}
            isValidConnection={(c) => {
              const from = typeOf(c.source, c.sourceHandle, "outputs");
              const to = typeOf(c.target, c.targetHandle, "inputs");
              // typed ports must match; "any" and untyped nodes connect to anything
              return !from || !to || from === "any" || to === "any" || from === to;
            }}
            connectionColor={(h) => {
              const t = typeOf(h.nodeId, h.handleId, h.type === "source" ? "outputs" : "inputs");
              return t && PORT_COLOR[t];
            }}
            onConnect={(c) => {
              // an input takes one wire: replace what was there
              const t = typeOf(c.source, c.sourceHandle, "outputs");
              graph.removeEdges(graph.state.edges.filter((e) => e.target === c.target && e.targetHandle === c.targetHandle).map((e) => e.id));
              graph.addEdge({ id: uid("e"), ...c, color: t && PORT_COLOR[t] });
              note(`connected ${c.source} → ${c.target}`);
            }}
            onConnectEnd={(info) => {
              // the built-in "Add connected node" menu opens on its own; just log it
              if (!info.connected && info.overPane) note(`wire from ${info.from.nodeId} dropped on the canvas`);
            }}
            onNodesMove={(moves, phase) => {
              graph.props.onNodesMove(moves);
              if (phase === "end") {
                const joined = moves.filter((m) => m.parentId !== undefined);
                note(`moved ${moves.length}${joined.length ? `; ${joined.map((m) => `${m.id} → ${m.parentId ?? "no group"}`).join(", ")}` : ""}`);
              }
            }}
            onAddNode={(type, p, from) => {
              note(from ? `added ${type}, connecting it to ${from.nodeId}` : `context menu: added ${type}`);
              return graph.props.onAddNode(type, p);
            }}
            onDelete={(s) => {
              graph.props.onDelete(s);
              note(`deleted ${s.nodes.length} node(s), ${s.edges.length} edge(s)`);
            }}
            onDoubleClick={(t, e) => {
              if (t.kind === "pane") spawn(TEMPLATES[0].items[0], api()!.screenToFlow({ x: e.clientX, y: e.clientY }));
            }}
            onDragOver={(e) => {
              if (e.dataTransfer?.types.includes(NODE_MIME)) e.preventDefault();
            }}
            onDrop={(e) => {
              const ref = e.dataTransfer?.getData(NODE_MIME);
              if (!ref) return;
              e.preventDefault();
              const [g, i] = ref.split(":").map(Number);
              const tpl = palette()[g]?.items[i];
              if (tpl) spawn(tpl, api()!.screenToFlow({ x: e.clientX, y: e.clientY }));
            }}
            onInit={setApi}
          >
            <Show when={showControls()}>
              <Controls />
            </Show>
            <Show when={showMinimap()}>
              <MiniMap nodeColor={(n) => (n.type === "note" ? "rgb(245 158 11 / 0.6)" : undefined)} />
            </Show>
          </Graph>
        </main>
      </div>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
