import { Show, createMemo } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Dynamic } from "@solidjs/web";
import { useGraphContext, type PendingConnection } from "./context";
import { getBezierPath, getStepPath, getStraightPath } from "./geometry";
import type { EdgeProps, EdgeTypes, GraphEdge } from "./types";

export interface BaseEdgeProps {
  id: string;
  path: string;
  color: string;
  selected?: boolean;
  animated?: boolean;
  label?: JSX.Element;
  labelX?: number;
  labelY?: number;
  /** Clickable width of the invisible hit area (default 14). */
  hitWidth?: number;
  class?: string;
  style?: JSX.CSSProperties;
  selectable?: boolean;
}

/**
 * Building block for edge components: a wide invisible hit path (select,
 * context menu), the visible stroke, and an optional HTML label centred on
 * (labelX, labelY).
 */
export function BaseEdge(props: BaseEdgeProps) {
  const ctx = useGraphContext();
  return (
    <g>
      <path
        d={props.path}
        data-edge-id={props.id}
        fill="none"
        stroke="transparent"
        stroke-width={props.hitWidth ?? 14}
        class="cursor-pointer"
        style={{ "pointer-events": props.selectable === false ? "none" : "stroke" }}
        onPointerDown={(e) => {
          if (e.button !== 0 || props.selectable === false) return;
          e.stopPropagation();
          const cur = ctx.peekSelection();
          const edges = e.shiftKey
            ? cur.edges.includes(props.id)
              ? cur.edges.filter((x) => x !== props.id)
              : [...cur.edges, props.id]
            : [props.id];
          ctx.select({ nodes: e.shiftKey ? cur.nodes : [], edges });
        }}
      />
      <path
        d={props.path}
        fill="none"
        stroke={props.color}
        stroke-width={props.selected ? 3 : 2}
        opacity={props.selected ? 1 : 0.85}
        class={[
          { "sg-edge-animated": !!props.animated, "drop-shadow-[0_0_3px_var(--sg-selection)]": !!props.selected },
          props.class,
        ]}
        style={props.style}
      />
      <Show when={props.label !== undefined && props.label !== null}>
        <foreignObject x={props.labelX ?? 0} y={props.labelY ?? 0} width="1" height="1" class="overflow-visible">
          <div
            data-edge-id={props.id}
            class="pointer-events-auto absolute w-max -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--sg-border)] bg-[var(--sg-label-bg)] px-1.5 py-0.5 text-[11px] leading-tight text-[var(--sg-label-fg)] shadow-sm"
          >
            {props.label}
          </div>
        </foreignObject>
      </Show>
    </g>
  );
}

export function BezierEdge(props: EdgeProps) {
  const p = createMemo(() => getBezierPath(props));
  return <BuiltIn props={props} path={p()} />;
}
export function StraightEdge(props: EdgeProps) {
  const p = createMemo(() => getStraightPath(props));
  return <BuiltIn props={props} path={p()} />;
}
export function StepEdge(props: EdgeProps) {
  const p = createMemo(() => getStepPath(props, 0));
  return <BuiltIn props={props} path={p()} />;
}
export function SmoothStepEdge(props: EdgeProps) {
  const p = createMemo(() => getStepPath(props, 10));
  return <BuiltIn props={props} path={p()} />;
}

function BuiltIn(props: { props: EdgeProps; path: [string, number, number] }) {
  return (
    <BaseEdge
      id={props.props.edge.id}
      path={props.path[0]}
      labelX={props.path[1]}
      labelY={props.path[2]}
      label={props.props.edge.label}
      color={props.props.color}
      selected={props.props.selected}
      animated={props.props.edge.animated}
      selectable={props.props.edge.selectable}
      class={props.props.edge.class}
    />
  );
}

/** Resolves an edge's end points and renders its edge type. */
export function EdgeRenderer(props: { edge: GraphEdge; types: EdgeTypes; defaultType: string }) {
  const ctx = useGraphContext();
  const a = createMemo(() => ctx.handlePoint({ nodeId: props.edge.source, handleId: props.edge.sourceHandle, type: "source" }));
  const b = createMemo(() => ctx.handlePoint({ nodeId: props.edge.target, handleId: props.edge.targetHandle, type: "target" }));
  // an unknown type falls back to the default type, then to the bezier
  const component = () => props.types[props.edge.type ?? props.defaultType] ?? props.types[props.defaultType] ?? props.types.bezier;
  return (
    <Show when={a() && b()}>
      <Dynamic
        component={component()}
        edge={props.edge}
        sourceX={a()!.x}
        sourceY={a()!.y}
        targetX={b()!.x}
        targetY={b()!.y}
        sourcePosition={a()!.position}
        targetPosition={b()!.position}
        selected={ctx.isEdgeSelected(props.edge.id)}
        color={props.edge.color ?? "var(--sg-edge)"}
      />
    </Show>
  );
}

/** The wire following the pointer while connecting (dashed until it would land on a handle). */
export function ConnectionLine(props: { connection: PendingConnection; color?: string }) {
  const ctx = useGraphContext();
  const d = createMemo(() => {
    const c = props.connection;
    const from = ctx.handlePoint(c.from);
    if (!from) return "";
    const snapped = c.hover ? ctx.handlePoint(c.hover) : null;
    const to = snapped ?? { ...c.to, position: from.position === "right" ? "left" : from.position === "left" ? "right" : from.position === "top" ? "bottom" : "top" };
    const [path] =
      c.from.type === "source"
        ? getBezierPath({ sourceX: from.x, sourceY: from.y, sourcePosition: from.position, targetX: to.x, targetY: to.y, targetPosition: to.position })
        : getBezierPath({ sourceX: to.x, sourceY: to.y, sourcePosition: to.position, targetX: from.x, targetY: from.y, targetPosition: from.position });
    return path;
  });
  return (
    <path
      d={d()}
      fill="none"
      stroke={props.color ?? "var(--sg-edge)"}
      stroke-width="2"
      stroke-dasharray={props.connection.hover ? undefined : "6 4"}
      opacity="0.9"
    />
  );
}
