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
