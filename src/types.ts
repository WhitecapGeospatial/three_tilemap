export type MapViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

export type TileIndex = {
  x: number;
  y: number;
  z: number;
};

export type TileSize = {
  width: number;
  height: number;
};

export type DemDecodeParams = {
  base: number;
  interval: number;
};

export type HeightField = {
  width: number;
  height: number;
  data: Float32Array;
};
