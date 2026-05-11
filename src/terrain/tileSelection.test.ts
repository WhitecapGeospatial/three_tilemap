import { describe, it, expect } from "vitest";
import {
  selectVisibleTiles,
  tileOverlapsRange,
  type VisibleRange,
} from "./tileSelection";
import type { RequestTile } from "./types";

function makeTile(z: number, x: number, y: number): RequestTile {
  return {
    id: `${z}/${x}/${y}`,
    index: { z, x, y },
    status: "ready",
    demTexture: {} as never,
    imageryTexture: {} as never,
    lastUsed: 0,
  };
}

function ids(tiles: RequestTile[]): string[] {
  return tiles.map((t) => t.id).sort();
}

describe("tileOverlapsRange", () => {
  const range: VisibleRange = { xMin: 10, xMax: 12, yMin: 10, yMax: 12, zoom: 5 };

  it("returns true for tile at range zoom inside range", () => {
    expect(tileOverlapsRange({ z: 5, x: 11, y: 11 }, range)).toBe(true);
  });

  it("returns false for tile at range zoom outside range", () => {
    expect(tileOverlapsRange({ z: 5, x: 50, y: 50 }, range)).toBe(false);
  });

  it("returns true for coarser tile whose descendants overlap", () => {
    // z4 tile (5,5) covers z5 tiles 10-11 in both axes
    expect(tileOverlapsRange({ z: 4, x: 5, y: 5 }, range)).toBe(true);
  });

  it("returns false for coarser tile whose descendants don't overlap", () => {
    expect(tileOverlapsRange({ z: 4, x: 0, y: 0 }, range)).toBe(false);
  });

  it("returns true for finer tile whose ancestor overlaps", () => {
    // z6 tile (22,22) → ancestor at z5 is (11,11) which is in range
    expect(tileOverlapsRange({ z: 6, x: 22, y: 22 }, range)).toBe(true);
  });

  it("returns false for finer tile whose ancestor doesn't overlap", () => {
    // z6 tile (0,0) → ancestor at z5 is (0,0) which is outside range
    expect(tileOverlapsRange({ z: 6, x: 0, y: 0 }, range)).toBe(false);
  });
});

describe("selectVisibleTiles", () => {
  it("excludes off-viewport tiles at the target zoom", () => {
    const range: VisibleRange = { xMin: 10, xMax: 12, yMin: 10, yMax: 12, zoom: 5 };
    const tileMap: Record<string, RequestTile> = {
      "5/10/10": makeTile(5, 10, 10),
      "5/11/11": makeTile(5, 11, 11),
      "5/50/50": makeTile(5, 50, 50),
    };

    const result = ids(selectVisibleTiles(tileMap, 5, range));

    expect(result).toContain("5/10/10");
    expect(result).toContain("5/11/11");
    expect(result).not.toContain("5/50/50");
  });

  it("hides parent tile when all four children are ready (zoom in)", () => {
    const range: VisibleRange = { xMin: 20, xMax: 23, yMin: 20, yMax: 23, zoom: 5 };
    const tileMap: Record<string, RequestTile> = {
      "4/10/10": makeTile(4, 10, 10),
      "5/20/20": makeTile(5, 20, 20),
      "5/21/20": makeTile(5, 21, 20),
      "5/20/21": makeTile(5, 20, 21),
      "5/21/21": makeTile(5, 21, 21),
    };

    const result = ids(selectVisibleTiles(tileMap, 5, range));

    expect(result).not.toContain("4/10/10");
    expect(result).toContain("5/20/20");
    expect(result).toContain("5/21/20");
    expect(result).toContain("5/20/21");
    expect(result).toContain("5/21/21");
  });

  it("shows parent tile when some children are missing (partial zoom in)", () => {
    const range: VisibleRange = { xMin: 20, xMax: 23, yMin: 20, yMax: 23, zoom: 5 };
    const tileMap: Record<string, RequestTile> = {
      "4/10/10": makeTile(4, 10, 10),
      "5/20/20": makeTile(5, 20, 20),
      "5/21/20": makeTile(5, 21, 20),
    };

    const result = ids(selectVisibleTiles(tileMap, 5, range));

    expect(result).toContain("4/10/10");
    expect(result).toContain("5/20/20");
    expect(result).toContain("5/21/20");
  });

  it("hides child tiles when ancestor at target zoom is ready (zoom out)", () => {
    const range: VisibleRange = { xMin: 5, xMax: 7, yMin: 5, yMax: 7, zoom: 4 };
    const tileMap: Record<string, RequestTile> = {
      "4/5/5": makeTile(4, 5, 5),
      "5/10/10": makeTile(5, 10, 10),
      "5/11/10": makeTile(5, 11, 10),
      "5/10/11": makeTile(5, 10, 11),
      "5/11/11": makeTile(5, 11, 11),
    };

    const result = ids(selectVisibleTiles(tileMap, 4, range));

    expect(result).toContain("4/5/5");
    expect(result).not.toContain("5/10/10");
    expect(result).not.toContain("5/11/10");
    expect(result).not.toContain("5/10/11");
    expect(result).not.toContain("5/11/11");
  });

  it("shows child tiles as fallback when ancestor at target zoom is missing (zoom out)", () => {
    const range: VisibleRange = { xMin: 5, xMax: 7, yMin: 5, yMax: 7, zoom: 4 };
    const tileMap: Record<string, RequestTile> = {
      "5/10/10": makeTile(5, 10, 10),
      "5/11/10": makeTile(5, 11, 10),
    };

    const result = ids(selectVisibleTiles(tileMap, 4, range));

    expect(result).toContain("5/10/10");
    expect(result).toContain("5/11/10");
  });

  it("excludes error and loading tiles from rendered output", () => {
    const range: VisibleRange = { xMin: 10, xMax: 12, yMin: 10, yMax: 12, zoom: 5 };
    const tileMap: Record<string, RequestTile> = {
      "5/10/10": makeTile(5, 10, 10),
      "5/11/11": {
        id: "5/11/11",
        index: { z: 5, x: 11, y: 11 },
        status: "loading",
        lastUsed: 0,
      },
      "5/12/12": {
        id: "5/12/12",
        index: { z: 5, x: 12, y: 12 },
        status: "error",
        errorMessage: "fail",
        lastUsed: 0,
      },
    };

    const result = ids(selectVisibleTiles(tileMap, 5, range));

    expect(result).toContain("5/10/10");
    expect(result).not.toContain("5/11/11");
    expect(result).not.toContain("5/12/12");
  });

  it("off-viewport children of in-viewport parents do not prevent parent hiding", () => {
    // All 4 children exist but one is off-viewport. The LOD check uses all
    // cached readyIds (not viewport-filtered), so the parent should still hide.
    const range: VisibleRange = { xMin: 20, xMax: 22, yMin: 20, yMax: 22, zoom: 5 };
    const tileMap: Record<string, RequestTile> = {
      "4/10/10": makeTile(4, 10, 10),
      "5/20/20": makeTile(5, 20, 20),
      "5/21/20": makeTile(5, 21, 20),
      "5/20/21": makeTile(5, 20, 21),
      "5/21/21": makeTile(5, 21, 21),
    };

    const result = ids(selectVisibleTiles(tileMap, 5, range));

    expect(result).not.toContain("4/10/10");
  });

  it("multi-level zoom out: deeply nested children hidden by intermediate ancestor", () => {
    // targetZoom=3, cache has z3 and z6 tiles. z6 should be hidden.
    const range: VisibleRange = { xMin: 2, xMax: 4, yMin: 2, yMax: 4, zoom: 3 };
    const tileMap: Record<string, RequestTile> = {
      "3/2/2": makeTile(3, 2, 2),
      "6/16/16": makeTile(6, 16, 16), // ancestor at z3 is 2/2
    };

    const result = ids(selectVisibleTiles(tileMap, 3, range));

    expect(result).toContain("3/2/2");
    expect(result).not.toContain("6/16/16");
  });

  it("multi-level zoom in: parent hides when targetZoom descendants are ready, even without intermediate levels", () => {
    // z8 parent, targetZoom=10. z9 tiles were never loaded. z10 tiles are ready.
    // The z8 tile (5,5) covers z10 tiles (20..23, 20..23).
    const range: VisibleRange = { xMin: 20, xMax: 23, yMin: 20, yMax: 23, zoom: 10 };
    const tileMap: Record<string, RequestTile> = {
      "8/5/5": makeTile(8, 5, 5),
    };
    // Add all 16 z10 descendants in the viewport
    for (let x = 20; x <= 23; x++) {
      for (let y = 20; y <= 23; y++) {
        tileMap[`10/${x}/${y}`] = makeTile(10, x, y);
      }
    }

    const result = ids(selectVisibleTiles(tileMap, 10, range));

    expect(result).not.toContain("8/5/5");
    expect(result).toContain("10/20/20");
    expect(result).toContain("10/23/23");
  });

  it("multi-level zoom in: parent stays when some targetZoom descendants are missing", () => {
    // z8 parent, targetZoom=10. Only some z10 tiles loaded.
    const range: VisibleRange = { xMin: 20, xMax: 23, yMin: 20, yMax: 23, zoom: 10 };
    const tileMap: Record<string, RequestTile> = {
      "8/5/5": makeTile(8, 5, 5),
      "10/20/20": makeTile(10, 20, 20),
      "10/21/20": makeTile(10, 21, 20),
    };

    const result = ids(selectVisibleTiles(tileMap, 10, range));

    expect(result).toContain("8/5/5");
    expect(result).toContain("10/20/20");
    expect(result).toContain("10/21/20");
  });

  it("parent hides when only viewport-visible descendants at targetZoom are ready", () => {
    // z8 tile covers z10 tiles (20..23, 20..23) but viewport only shows (20..21, 20..21).
    // If those 4 viewport tiles are ready, parent should hide even though off-viewport
    // descendants are missing.
    const range: VisibleRange = { xMin: 20, xMax: 21, yMin: 20, yMax: 21, zoom: 10 };
    const tileMap: Record<string, RequestTile> = {
      "8/5/5": makeTile(8, 5, 5),
      "10/20/20": makeTile(10, 20, 20),
      "10/21/20": makeTile(10, 21, 20),
      "10/20/21": makeTile(10, 20, 21),
      "10/21/21": makeTile(10, 21, 21),
    };

    const result = ids(selectVisibleTiles(tileMap, 10, range));

    expect(result).not.toContain("8/5/5");
  });
});
