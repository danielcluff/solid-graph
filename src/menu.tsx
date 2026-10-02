import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ContextMenuProps } from "./types";

// Menu building blocks (used by the default context menu; handy for your own).

export function Menu(props: { class?: string; children?: JSX.Element }) {
  return (
    <div
      role="menu"
      class={[
        "min-w-44 rounded-md border border-[var(--sg-border)] bg-[var(--sg-node-bg)] p-1 text-sm text-[var(--sg-node-fg)] shadow-lg",
        props.class,
      ]}
    >
      {props.children}
    </div>
  );
}

export function MenuItem(props: { onSelect: () => void; shortcut?: string; destructive?: boolean; disabled?: boolean; children?: JSX.Element }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={props.disabled}
      class={[
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-[var(--sg-hover)] focus-visible:bg-[var(--sg-hover)] disabled:opacity-40 disabled:hover:bg-transparent",
        props.destructive && "text-red-500",
      ]}
      onClick={() => props.onSelect()}
    >
      <span class="flex-1">{props.children}</span>
      <Show when={props.shortcut}>
        <span class="text-xs tracking-widest text-[var(--sg-muted)]">{props.shortcut}</span>
      </Show>
    </button>
  );
}

export function MenuLabel(props: { children?: JSX.Element }) {
  return <div class="px-2 pt-1.5 pb-1 text-xs font-medium text-[var(--sg-muted)]">{props.children}</div>;
}

export function MenuSeparator() {
  return <div class="-mx-1 my-1 h-px bg-[var(--sg-border)]" />;
}

/**
 * The context menu <Graph> shows by default. Actions the app doesn't handle
 * (no `onAddNode` / `onDelete`) are left out. Replace it with `contextMenu`.
 */
export function DefaultContextMenu(props: ContextMenuProps) {
  const a = props.actions;
  return (
    <Menu>
      <Show when={props.target.kind === "connection" && a.addNode}>
        <MenuLabel>Add connected node</MenuLabel>
        <For each={props.nodeTypes}>{(type) => <MenuItem onSelect={() => a.addNode!(type)}>{type}</MenuItem>}</For>
      </Show>
      <Show when={props.target.kind === "pane"}>
        <Show when={a.addNode}>
          <MenuLabel>Add node</MenuLabel>
          <For each={props.nodeTypes}>{(type) => <MenuItem onSelect={() => a.addNode!(type)}>{type}</MenuItem>}</For>
          <MenuSeparator />
        </Show>
        <MenuItem onSelect={a.selectAll}>Select all</MenuItem>
        <MenuItem onSelect={a.fitView}>Fit view</MenuItem>
      </Show>
      <Show when={props.target.kind === "node"}>
        <MenuItem onSelect={a.fitSelection}>Zoom to selection</MenuItem>
        <Show when={a.deleteSelection}>
          <MenuSeparator />
          <MenuItem destructive onSelect={a.deleteSelection!}>
            Delete
          </MenuItem>
        </Show>
      </Show>
      <Show when={props.target.kind === "edge"}>
        <Show when={a.deleteSelection} fallback={<MenuLabel>Edge {(props.target as { id: string }).id}</MenuLabel>}>
          <MenuItem destructive onSelect={a.deleteSelection!}>
            Delete connection
          </MenuItem>
        </Show>
      </Show>
    </Menu>
  );
}
