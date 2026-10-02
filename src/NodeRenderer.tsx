import { Show, onSettled, untrack } from "solid-js";
import { Dynamic } from "@solidjs/web";
import { NodeIdContext, useGraphContext } from "./context";
import type { GraphNode, NodeTypes } from "./types";

/** Positions, measures and wraps one node; the node's look comes from `nodeTypes`. */
export function NodeRenderer(props: { node: GraphNode; types: NodeTypes }) {
  const ctx = useGraphContext();
  const id = untrack(() => props.node.id);
  let el: HTMLDivElement | undefined;
  const selected = () => ctx.selection().nodes.includes(props.node.id);
  const dragging = () => ctx.isDragging(props.node.id);
  const component = () => props.types[props.node.type ?? "default"] ?? props.types.default;

  onSettled(() => {
    // size and handle anchors follow the content
    const ro = new ResizeObserver(() => ctx.measure(id));
    ro.observe(el!);
    ctx.measure(id);
    return () => ro.disconnect();
  });

  return (
    <div
      ref={el}
      data-node-id={props.node.id}
      data-selected={selected() ? "" : undefined}
      class={["absolute top-0 left-0", props.node.class]}
      style={{
        transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)`,
        width: props.node.width === undefined ? undefined : `${props.node.width}px`,
        height: props.node.height === undefined ? undefined : `${props.node.height}px`,
        // the selection floats above the rest of its layer
        "z-index": (props.node.zIndex ?? 0) + (selected() && !props.node.container ? 1000 : 1),
      }}
    >
      <NodeIdContext value={id}>
        <Dynamic component={component()} node={props.node} data={props.node.data} selected={selected()} dragging={dragging()} />
      </NodeIdContext>
      <Show when={props.node.resizable}>
        <div
          data-nodrag
          aria-label="Resize"
          class="absolute right-0 bottom-0 z-10 size-4 cursor-se-resize text-[var(--sg-muted)]"
          onPointerDown={(e) => ctx.startResize(e, id)}
        >
          <svg viewBox="0 0 10 10" class="size-full p-1">
            <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" stroke-width="1" />
          </svg>
        </div>
      </Show>
    </div>
  );
}
