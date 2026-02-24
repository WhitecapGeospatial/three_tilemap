export const DEBUG_VIS = true;

export type DebugVisState = {
  hideDeckOverlay: boolean;
  wireframe: boolean;
  showTileCorners: boolean;
  showCameraMarker: boolean;
  /** Multiplier for terrain displacement (1 = normal, 2 = 2× height, etc.) */
  displacementScale: number;
  flattenTerrain: boolean;
  singleTileOnly: boolean;
  singleTileId: string;
  logCamera: boolean;
  logTileBounds: boolean;
  /** Render a bright red sphere at world [0,0,0] to confirm Three is rendering at all */
  sanityMesh: boolean;
  /** Override Deck-synced camera with a simple lookAt aimed down at tile center */
  bypassDeckCamera: boolean;
};

export const DEFAULT_DEBUG_VIS_STATE: DebugVisState = {
  hideDeckOverlay: false,
  wireframe: false,
  showTileCorners: false,
  showCameraMarker: true,
  displacementScale: 1,
  flattenTerrain: false,
  singleTileOnly: false,
  singleTileId: "11/324/788",
  logCamera: false,
  logTileBounds: false,
  sanityMesh: false,
  bypassDeckCamera: false,
};
