# DeckGL + ThreeJS Terrain Renderer

A 3D terrain viewer that composites a ThreeJS scene on top of a DeckGL map, using DeckGL's WebMercator math to keep both renderers pixel-perfectly aligned. Supports both a standard map view and a free-flying first-person camera.

## Architecture Overview

The two renderers are completely independent canvases, stacked via CSS. They never share a WebGL context or canvas element.

```
┌─────────────────────────────────┐
│  DeckGL canvas (pointer events) │  ← interaction layer, transparent background
├─────────────────────────────────┤
│  ThreeJS canvas (terrain mesh)  │  ← rendering layer
└─────────────────────────────────┘
```

ThreeJS renders the 3D terrain geometry. DeckGL renders nothing visible — its `TileLayer` has `renderSubLayers: () => null` — and exists solely as a **tile scheduler and interaction controller**. The `TileLayer` is locked to a single fixed zoom level to enable seamless tile buffer strips.

## View Modes

The app supports two camera modes, toggled via a button in the HUD:

### Map Mode (default)

Standard DeckGL `MapView` with pan/zoom/tilt. Viewport state is a `MapViewState` (longitude, latitude, zoom, pitch, bearing).

### First-Person Mode

A free-flying `FirstPersonView` from `@deck.gl/core`. Mouse look/zoom are handled by DeckGL's `FirstPersonController`, while keyboard movement is custom-mapped in `src/App.tsx`:

| Input | Action |
|---|---|
| `W` / `S` | Move forward / backward along camera facing direction |
| `A` / `D` | Strafe left / right |
| `R` / `F` | Ascend / descend |
| Arrow keys | Look up/down, turn left/right |
| Mouse drag | Look around |
| Scroll wheel | Zoom (move along facing direction) |

Movement speed is controlled from the HUD (`Move speed`) and is applied only to translation (WASD/R/F), not turning speed. Arrow-key turning speed is fixed. Pitch is clamped to ±89°.

During first-person movement, state is continuously re-anchored so `longitude`/`latitude` stay in sync with the actual camera world position (rather than accumulating large local XY offsets). This keeps tile selection stable in FP mode.

When switching modes, view-state conversion preserves camera position in world space so toggling Map ↔ First Person does not jump to an old center/anchor.

## Source of Truth for Viewport State

The viewport/camera state lives in Zustand and is propagated down to both DeckGL and ThreeJS:

```
User interaction (pan / zoom / tilt / mouse look / keyboard fly)
    → DeckGL controller and app keyboard loop
    → onViewStateChange callback
    → setFpViewState/setMapViewState
    → Zustand viewStateStore
    → props down to TerrainScene + DeckGL
```

The Zustand store (`src/store/viewStateStore.ts`) holds both view states and a mode flag:

```ts
{
  mode: "map" | "firstPerson";
  mapViewState: { longitude, latitude, zoom, pitch, bearing };
  fpViewState:  { longitude, latitude, position: [east, north, up], pitch, bearing };
}
```

ThreeJS **never writes** to this store — it only reads from it for camera sync and tile mesh placement.

## ThreeJS Camera Synchronisation

`DeckSyncedCamera` (`src/terrain/TerrainScene.tsx`) runs inside a `useFrame` hook, which fires every frame before ThreeJS draws. Each frame it:

1. Constructs either a `WebMercatorViewport` (map mode) or `FirstPersonViewport` (first-person mode) from the current view state and pixel dimensions.
2. Reads `projectionMatrix` and `viewMatrix` directly off the viewport object.
3. Copies those matrices onto the Three camera, bypassing Three's own transform system.

```ts
camera.matrixAutoUpdate = false;   // prevent Three from overwriting our matrices
camera.matrix.copy(world);
camera.matrixWorld.copy(world);
camera.matrixWorldInverse.copy(view);
camera.projectionMatrix.copy(projection);
camera.projectionMatrixInverse.copy(projection).invert();
```

`matrixAutoUpdate = false` is critical: without it, Three's internal `updateMatrixWorld()` call would silently overwrite the injected matrices on the next traversal.

Both viewport types produce matrices in the same format, so the injection pattern is identical regardless of mode.

## Coordinate System Bridge

The shared math layer differs slightly by mode:

- **Map mode**: `WebMercatorViewport` is used everywhere — for camera matrices and for tile geometry placement.
- **First-person mode**: `FirstPersonViewport` drives the camera matrices. Tile geometry placement still uses `WebMercatorViewport` (via `tileMath.ts`), since `projectPosition` returns zoom-0 world coordinates independent of viewport type. A synthetic zoom from `getMeterZoom(latitude)` is passed to keep `distanceScales` consistent.

Because both sides ultimately express geometry in DeckGL's WebMercator world-space, tiles align with the camera in either mode.

## Seamless Terrain via Tile Buffer Strips

Tile boundaries are eliminated by splitting each tile into three piece types that share texture data from adjacent tiles. All pieces have identical world-space dimensions.

### Geometry Model

With `tileSize = 256` and `bufferPx = 128` (half the tile), each side of a tile is trimmed by 64px (`bufferPx / 2`). This yields:

- **Core mesh** — the center 128x128 of the 256x256 tile (UV `[0.25, 0.75]` on both axes).
- **Edge strip** — bridges two adjacent tiles. 64px from tile A's near edge + 64px from tile B's near edge = 128px total. Generated for east and south edges only (to avoid duplicates).
- **Corner patch** — bridges four tiles at their shared corner. 64x64px from each tile.

### Fixed Zoom

The `TileLayer` is locked to a single zoom level (`fixedZoom`, currently 7). This eliminates LOD management and guarantees all tiles share the same z, which is required for the adjacency computations.

### Shared Texture Ownership

Because edge strips and corner patches reference textures from multiple tiles, texture disposal is centralized in `useDeckTileTerrain` via a deferred disposal queue. Individual mesh components do not dispose textures — they only dispose their own geometry and material.

### Adjacency Computation

`useDeckTileTerrain` derives `edgeRecords` and `cornerRecords` from the loaded `tileMap`. For each ready tile, it checks whether east (`x+1`), south (`y+1`), and southeast (`x+1, y+1`) neighbors exist. Edge records reference two `TileRecord`s; corner records reference four.

### TSL Shaders

All three mesh types use TSL (Three Shading Language) node materials with the same elevation decode formula (`base + (R*256^2 + G*256 + B) * interval`). Edge strips use `step(0.5, uv)` to select between two tiles' textures. Corner patches use two `step` nodes to select among four quadrants via `mix(mix(SW, SE, tx), mix(NW, NE, tx), ty)`.

## Data Flow Summary

| Concern | Owner |
|---|---|
| User interaction (pan / zoom / tilt / fly) | DeckGL controller (MapView or FirstPersonView) |
| Viewport state | Zustand store (written by Deck callbacks + FP keyboard loop) |
| Camera matrices (view + projection) | Computed from `WebMercatorViewport` or `FirstPersonViewport` each frame |
| Tile scheduling (fixed zoom) | DeckGL `TileLayer` with `minZoom === maxZoom` |
| Tile texture loading (DEM + imagery) | ThreeJS `TextureLoader` (triggered by DeckGL callbacks) |
| Adjacency computation | `useDeckTileTerrain` — derives edge/corner records from loaded tile map |
| Texture disposal | Centralized deferred queue in `useDeckTileTerrain` |
| 3D rendering | ThreeJS / React Three Fiber |

## Key Files

| File | Role |
|---|---|
| `src/App.tsx` | Composes the two canvases; owns the DeckGL `onViewStateChange` handler; sets `FIXED_ZOOM` |
| `src/types.ts` | `MapViewState`, `FirstPersonViewState`, `ViewMode` type definitions |
| `src/store/viewStateStore.ts` | Zustand store holding both view states and the active mode |
| `src/terrain/types.ts` | `TileRecord`, `EdgeRecord`, `CornerPatchRecord` type definitions |
| `src/terrain/TerrainScene.tsx` | `DeckSyncedCamera` — per-frame matrix injection; renders core, edge, and corner meshes |
| `src/terrain/TileTerrainMesh.tsx` | Core mesh per tile; TSL vertex shader for DEM displacement with UV inset |
| `src/terrain/TileEdgeStripMesh.tsx` | Edge strip mesh bridging two adjacent tiles with dual-texture TSL shader |
| `src/terrain/TileCornerPatchMesh.tsx` | Corner patch mesh bridging four tiles with quad-texture TSL shader |
| `src/terrain/useDeckTileTerrain.ts` | Fixed-zoom `TileLayer`; manages tile lifecycle, shared texture disposal, and adjacency records |
| `src/utils/tileMath.ts` | Converts tile indices → WebMercator world-space bounds; accepts `zoomOverride` for first-person mode |
