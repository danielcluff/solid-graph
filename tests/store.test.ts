import { flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { createGraphStore } from "../src/store";

const make = () =>
  createGraphStore({
    nodes: [
      { id: "g", container: true, position: { x: 0, y: 0 }, width: 300, height: 200, data: {} },
      { id: "a", parentId: "g", position: { x: 10, y: 10 }, data: {} },
      { id: "b", position: { x: 400, y: 0 }, data: {} },
    ],
    edges: [{ id: "e", source: "a", target: "b" }],
  });

describe("createGraphStore", () => {
  it("applies moves, including container changes", () => {
    const g = make();
    g.props.onNodesMove([{ id: "a", position: { x: 500, y: 20 }, parentId: null }]);
    flush();
    const a = g.state.nodes.find((n) => n.id === "a")!;
    expect(a.position).toEqual({ x: 500, y: 20 });
    expect(a.parentId).toBeUndefined();
    g.props.onNodesMove([{ id: "b", position: { x: 50, y: 50 }, parentId: "g" }]);
    flush();
    expect(g.state.nodes.find((n) => n.id === "b")!.parentId).toBe("g");
  });

  it("connects, detaches and resizes", () => {
    const g = make();
    g.props.onConnect({ source: "b", target: "a" });
    flush();
    expect(g.state.edges).toHaveLength(2);
    g.props.onEdgeDetach("e");
    flush();
    expect(g.state.edges.map((e) => e.source)).toEqual(["b"]);
    g.props.onNodeResize({ id: "g", width: 320, height: 240 });
    flush();
    expect(g.state.nodes[0]).toMatchObject({ width: 320, height: 240 });
  });

  it("deletes the selection with its edges, releasing children of deleted containers", () => {
    const g = make();
    g.props.onSelectionChange({ nodes: ["g", "b"], edges: [] });
    flush();
    g.deleteSelection();
    flush();
    expect(g.state.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(g.state.nodes[0].parentId).toBeUndefined();
    expect(g.state.edges).toHaveLength(0);
    expect(g.state.selection).toEqual({ nodes: [], edges: [] });
  });

  it("adds nodes through the factory and deletes a selection", () => {
    const g = make();
    const id = g.props.onAddNode("group", { x: 5, y: 6 });
    flush();
    const added = g.state.nodes.at(-1)!;
    // returned so the canvas can connect a dropped wire to it
    expect(id).toBe(added.id);
    expect(added).toMatchObject({ type: "group", container: true, position: { x: 5, y: 6 } });
    g.props.onDelete({ nodes: ["b"], edges: [] });
    flush();
    expect(g.state.nodes.map((n) => n.id)).not.toContain("b");
    expect(g.state.edges).toHaveLength(0);
  });

  it("uses a custom node factory", () => {
    const g = createGraphStore({ createNode: (type, position) => ({ id: "custom", type, position, data: { made: true } }) });
    g.props.onAddNode("math", { x: 0, y: 0 });
    flush();
    expect(g.state.nodes[0]).toMatchObject({ id: "custom", type: "math", data: { made: true } });
  });
});
