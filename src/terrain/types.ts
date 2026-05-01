import type { TileIndex } from "../types";
import type { Texture } from "three";

export type TileStatus = "loading" | "ready" | "error";

export type RequestTile = {
  id: string;
  index: TileIndex;
  status: TileStatus;
  imageryTexture?: Texture;
  demTexture?: Texture;
  errorMessage?: string;
  lastUsed: number;
};

/** @deprecated Use RequestTile instead. */
export type TileRecord = RequestTile;

export type UVBounds = {
  uMin: number;
  vMin: number;
  uMax: number;
  vMax: number;
};

export type RenderedTile = {
  id: string;
  renderIndex: { x: number; y: number };
  segments: number;
  source: {
    requestTile: RequestTile;
    uvBounds: UVBounds;
    sourceZoom: number;
  };
};

export type RenderedEdgeRecord = {
  id: string;
  direction: "east" | "south";
  segments: number;
  tileA: RenderedTile;
  tileB: RenderedTile;
};

export type RenderedCornerRecord = {
  id: string;
  segments: number;
  nw: RenderedTile;
  ne: RenderedTile;
  sw: RenderedTile;
  se: RenderedTile;
};

/** @deprecated Use RenderedEdgeRecord instead. */
export type EdgeRecord = {
  id: string;
  direction: "east" | "south";
  tileA: RequestTile;
  tileB: RequestTile;
};

/** @deprecated Use RenderedCornerRecord instead. */
export type CornerPatchRecord = {
  id: string;
  nw: RequestTile;
  ne: RequestTile;
  sw: RequestTile;
  se: RequestTile;
};
