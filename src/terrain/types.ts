import type { TileIndex } from "../types";
import type { Texture } from "three";

export type TileStatus = "loading" | "ready" | "error";

export type TileRecord = {
  id: string;
  index: TileIndex;
  status: TileStatus;
  imageryTexture?: Texture;
  demTexture?: Texture;
  errorMessage?: string;
  lastUsed: number;
};

export type EdgeRecord = {
  id: string;
  direction: "east" | "south";
  tileA: TileRecord;
  tileB: TileRecord;
};

export type CornerPatchRecord = {
  id: string;
  nw: TileRecord;
  ne: TileRecord;
  sw: TileRecord;
  se: TileRecord;
};
