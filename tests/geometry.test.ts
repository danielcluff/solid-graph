import { describe, expect, it } from "vitest";
import {
  boundsOf,
  containerAt,
  fitBounds,
  flowToScreen,
  getBezierPath,
  getStepPath,
  getStraightPath,
  nearest,
  rectFrom,
  rectsIntersect,
  screenToFlow,
  zoomAround,
} from "../src/geometry";

describe("edge paths", () => {
  const p = { sourceX: 0, sourceY: 0, targetX: 200, targetY: 100 };

  it("bezier leaves each end along its handle and labels the midpoint", () => {
    const [d, lx, ly] = getBezierPath({ ...p, sourcePosition: "right", targetPosition: "left" });
    expect(d).toBe("M 0 0 C 100 0, 100 100, 200 100");
    expect([lx, ly]).toEqual([100, 50]);
  });

  it("bezier keeps a minimum curvature for close handles", () => {
    const [d] = getBezierPath({ sourceX: 0, sourceY: 0, targetX: 10, targetY: 0 });
    expect(d).toBe("M 0 0 C 40 0, -30 0, 10 0");
  });

  it("vertical handles bend vertically", () => {
    const [d] = getBezierPath({ ...p, sourcePosition: "bottom", targetPosition: "top" });
    expect(d).toBe("M 0 0 C 0 50, 200 50, 200 100");
  });

  it("straight", () => {
    expect(getStraightPath(p)).toEqual(["M 0 0 L 200 100", 100, 50]);
  });

  it("step bends halfway, sharp or rounded", () => {
    const [sharp, lx, ly] = getStepPath(p, 0);
    expect(sharp).toBe("M 0 0 L 100 0 L 100 100 L 200 100");
    expect([lx, ly]).toEqual([100, 50]);
    const [round] = getStepPath(p, 10);
    expect(round).toContain("Q 100 0 100 10");
    expect(round.endsWith("L 200 100")).toBe(true);
  });
});

describe("viewport", () => {
  it("converts between screen and flow", () => {
    const v = { x: 50, y: -20, zoom: 2 };
    const f = screenToFlow(v, { x: 150, y: 80 });
    expect(f).toEqual({ x: 50, y: 50 });
    expect(flowToScreen(v, f)).toEqual({ x: 150, y: 80 });
  });

  it("zooms around a point, keeping it fixed and clamping", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const z = zoomAround(v, 2, { x: 100, y: 100 }, 0.1, 4);
    expect(z.zoom).toBe(2);
    expect(screenToFlow(z, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    expect(zoomAround(v, 100, { x: 0, y: 0 }, 0.1, 4).zoom).toBe(4);
  });

  it("fits bounds into the canvas, centred", () => {
    const v = fitBounds({ x: 0, y: 0, width: 400, height: 200 }, { width: 1000, height: 600 }, { padding: 100, maxZoom: 10 });
    expect(v.zoom).toBe(2);
    expect(flowToScreen(v, { x: 200, y: 100 })).toEqual({ x: 500, y: 300 });
    expect(fitBounds({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 600 }).zoom).toBe(1.5);
  });
});

describe("rects and hit tests", () => {
  it("bounds and intersections", () => {
    expect(boundsOf([])).toBeUndefined();
    expect(boundsOf([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 5, height: 5 }])).toEqual({ x: 0, y: -5, width: 25, height: 15 });
    expect(rectFrom({ x: 10, y: 10 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, width: 10, height: 5 });
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 5, height: 5 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
  });

  it("drops into the innermost container holding the node's centre", () => {
    const outer = { id: "outer", rect: { x: 0, y: 0, width: 500, height: 500 } };
    const inner = { id: "inner", rect: { x: 100, y: 100, width: 200, height: 200 } };
    const node = { x: 150, y: 150, width: 40, height: 20 };
    expect(containerAt(node, [outer, inner])).toBe("inner");
    expect(containerAt(node, [outer, inner], new Set(["inner"]))).toBe("outer");
    expect(containerAt({ ...node, x: 600 }, [outer, inner])).toBeNull();
  });

  it("nearest within a radius", () => {
    const c = [
      { id: "a", point: { x: 0, y: 0 } },
      { id: "b", point: { x: 10, y: 0 } },
    ];
    expect(nearest(c, { x: 8, y: 0 }, 28)?.id).toBe("b");
    expect(nearest(c, { x: 100, y: 0 }, 28)).toBeUndefined();
  });
});
