import { Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useGraph } from "./context";
import { BezierEdge, SmoothStepEdge, StepEdge, StraightEdge } from "./edges";
import { Handle } from "./Handle";
import type { EdgeTypes, NodeProps, NodeTypes } from "./types";

export interface DefaultNodeData {
  label?: JSX.Element;
}

const card = (selected: boolean) => [
  "relative min-w-32 rounded-lg border bg-[var(--sg-node-bg)] px-6 py-2 whitespace-nowrap text-sm text-[var(--sg-node-fg)] shadow-sm",
  selected ? "border-[var(--sg-node-border-selected)] ring-1 ring-[var(--sg-node-border-selected)]" : "border-[var(--sg-border)]",
];

/** A labelled card with one input on the left and one output on the right. */
export function DefaultNode(props: NodeProps<DefaultNodeData>) {
  return (
    <div class={card(props.selected)}>
      <Handle type="target" />
      {props.data?.label ?? props.node.id}
      <Handle type="source" />
    </div>
  );
}

/** Output only. */
export function InputNode(props: NodeProps<DefaultNodeData>) {
  return (
    <div class={card(props.selected)}>
      {props.data?.label ?? props.node.id}
      <Handle type="source" />
    </div>
  );
}

/** Input only. */
export function OutputNode(props: NodeProps<DefaultNodeData>) {
  return (
    <div class={card(props.selected)}>
      <Handle type="target" />
      {props.data?.label ?? props.node.id}
    </div>
  );
}

// Icons are functions: a JSX expression evaluated once is a single DOM element, which
// every group would then fight over.
const svgIcon = (paths: JSX.Element) => (
  <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    {paths}
  </svg>
);
const GroupIcon = () => svgIcon(
  <>
    <path d="M3 7V5c0-1.1.9-2 2-2h2" />
    <path d="M17 3h2c1.1 0 2 .9 2 2v2" />
    <path d="M21 17v2c0 1.1-.9 2-2 2h-2" />
    <path d="M7 21H5c-1.1 0-2-.9-2-2v-2" />
    <rect width="7" height="5" x="7" y="7" rx="1" />
    <rect width="7" height="5" x="10" y="12" rx="1" />
  </>,
);
const PencilIcon = () => svgIcon(
  <>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </>,
);

/** Rounded-rect path for clip-path. */
function roundRect(x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + k} ${y}H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + h - k}A${k} ${k} 0 0 1 ${x + w - k} ${y + h}H${x + k}A${k} ${k} 0 0 1 ${x} ${y + h - k}V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`;
}

/**
 * A container. Give the node `container: true`, a width/height and usually
 * `resizable: true`. The 1rem frame inside the border and the icon above it
 * move the group; the inside stays free for box selection. Click the name to
 * rename it (reported through `onNodeDataChange`).
 */
export function GroupNode(props: NodeProps<DefaultNodeData & { label?: string }>) {
  const api = useGraph();
  const [editing, setEditing] = createSignal(false);
  const size = () => api.nodeSize(props.node.id);
  // The frame is one element clipped to a ring, so the whole ring hovers together and only the ring
  // takes the pointer (clip-path also clips hit testing). Sizes are inside the 2px border.
  const ring = createMemo(() => {
    const w = size().width - 4;
    const h = size().height - 4;
    const t = 16; // 1rem
    return `path(evenodd, "${roundRect(0, 0, w, h, 12)} ${roundRect(t, t, w - 2 * t, h - 2 * t, 6)}")`;
  });
  const label = () => (typeof props.data?.label === "string" ? props.data.label : undefined);
  return (
    <div
      class={[
        "relative h-full w-full rounded-xl border-2 border-dashed bg-[var(--sg-group-bg)] transition-colors",
        props.selected ? "border-[var(--sg-group-border-selected)]" : "border-[var(--sg-group-border)]",
      ]}
    >
      <div
        data-drag-handle
        class="absolute inset-0 cursor-grab bg-[var(--sg-group-grip)] transition-colors hover:bg-[var(--sg-group-grip-hover)] active:cursor-grabbing"
        style={{ "clip-path": ring() }}
      />
      {/* icon and name, above the box */}
      <div class="absolute bottom-full left-0 mb-2 flex max-w-full items-center gap-3">
        <div
          data-drag-handle
          title="Drag to move the group"
          class="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-lg bg-[var(--sg-group-grip)] text-[var(--sg-group-fg)] opacity-80 active:cursor-grabbing"
        >
          <GroupIcon />
        </div>
        <Show
          when={editing()}
          fallback={
            <div data-nodrag class="group/name flex min-w-0 cursor-text items-center gap-2" title="Rename group" onClick={() => setEditing(true)}>
              <span class={["truncate text-lg font-medium", label() ? "text-[var(--sg-group-fg)]" : "text-[var(--sg-group-placeholder)]"]}>
                {props.data?.label ?? "Group"}
              </span>
              <span class="shrink-0 text-[var(--sg-group-fg)] opacity-0 transition-opacity group-hover/name:opacity-70">
                <PencilIcon />
              </span>
            </div>
          }
        >
          {/* pulled left by its padding + border so the text doesn't move when editing starts */}
          <input
            data-nodrag
            class="-ml-[7.5px] w-56 rounded-md border-[1.5px] border-[var(--sg-node-border-selected)] bg-[var(--sg-node-bg)] px-1.5 py-0 text-lg font-medium text-[var(--sg-node-fg)] outline-none"
            value={label() ?? ""}
            placeholder="Group name..."
            ref={(i) => requestAnimationFrame(() => i.select())}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              setEditing(false);
              if (v !== (label() ?? "")) api.updateNodeData(props.node.id, { label: v || undefined });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              e.stopPropagation();
            }}
          />
        </Show>
      </div>
    </div>
  );
}

export const defaultNodeTypes: NodeTypes = { default: DefaultNode, input: InputNode, output: OutputNode, group: GroupNode };
/** Built-in edge types. Registering a type with the same name (`edgeTypes`) replaces it. */
export const defaultEdgeTypes: EdgeTypes = { bezier: BezierEdge, straight: StraightEdge, step: StepEdge, smoothstep: SmoothStepEdge };
