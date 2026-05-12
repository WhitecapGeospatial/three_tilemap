# DeckGL + ThreeJS Terrain Renderer

A 3D terrain viewer that composites a ThreeJS scene on top of a DeckGL map, using DeckGL's WebMercator math to keep both renderers pixel-perfectly aligned. Supports both a standard map view and a free-flying first-person camera.

Available as an NPM package via [GitHub Packages](#installation).

## Installation

```bash
# Add the GitHub Packages registry for the @anthropic scope (one-time, project or user level)
echo "@anthropic:registry=https://npm.pkg.github.com" >> .npmrc

# Install (no token needed -- the package is public)
pnpm add @anthropic/deckgl-three-terrain
```

### Peer dependencies

This package expects the following to be installed in your project:

- `react` (^18 or ^19) and `react-dom`
- `three` (>=0.170.0)
- `@react-three/fiber` (^9) and `@react-three/drei` (^10)
- `@deck.gl/core`, `@deck.gl/react`, `@deck.gl/geo-layers` (^9.2)
- `@math.gl/web-mercator` (^4.1)
- `zustand` (^5)

## Usage

```tsx
import {
  useDeckTileTerrain,
  TerrainScene,
  useViewStateStore,
} from "@anthropic/deckgl-three-terrain";
import type { TileEndpoints } from "@anthropic/deckgl-three-terrain";

const endpoints: TileEndpoints = {
  demEndpoint: "https://your-dem-server.com/tiles/{z}/{x}/{y}.png",
  imageryEndpoint: "https://your-imagery-server.com/tiles/{z}/{y}/{x}",
};

function MyTerrain() {
  const { mapViewState } = useViewStateStore();
  const { layer, readyTiles, decodeParams } = useDeckTileTerrain(
    endpoints,
    { base: -10000, interval: 0.1 },
    3,  // minRequestZoom
    11, // maxRequestZoom
    mapViewState,
    { width: window.innerWidth, height: window.innerHeight },
  );

  // Use `layer` with DeckGL and `readyTiles` + `decodeParams` with TerrainScene
}
```

## Development

```bash
pnpm install
pnpm dev        # Run the demo app
pnpm test       # Run tests
pnpm build:lib  # Build the library to dist/
```

## Publishing

### Automated (CI)

Push a version tag and the GitHub Actions workflow handles the rest:

```bash
pnpm version patch   # or minor / major
git push --follow-tags
```

### Manual

```bash
# 1. Authenticate (one-time) -- create a PAT at https://github.com/settings/tokens
#    with write:packages scope
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# 2. Build + publish
pnpm build:lib
pnpm version patch
pnpm publish
git push --follow-tags
```

## Terminology

This project uses three distinct zoom concepts. Each has a single canonical name used consistently across code and documentation.

| Term | Code variable | Meaning |
|---|---|---|
| **Tile zoom** | `tileZoom` / `TILE_ZOOM` | The fixed z-level at which all tile requests are made (currently **9**). Set once in `App.tsx` and passed to the `TileLayer` via `minZoom === maxZoom`. All tiles share this z, which is required for adjacency stitching. |
| **Viewport zoom** | `mapViewState.zoom` | The interactive map-view zoom the user changes by scrolling. Controls visual framing in map mode. Does **not** affect which tiles are fetched. |
| **Meter zoom** | `meterZoom` | A latitude-derived zoom computed via `getMeterZoom(latitude)` from `@math.gl/web-mercator`. Used only in first-person mode to construct a `WebMercatorViewport` for tile world-space placement, keeping `distanceScales` consistent even though the camera is driven by `FirstPersonViewport`. |

Other key terms:

- **`uvInset`** — fraction of each tile texture reserved as overlap margin on each side (currently **0.25**). This is the single parameter that controls the stitching geometry. With `uvInset = 0.25`, the center 50% of the texture is the core and each edge has a 25% buffer.
- **Core mesh** — the center `(1 - 2 * uvInset)²` of a tile's texture, rendered as a displaced `PlaneGeometry`. One per loaded tile.
- **Edge strip** — bridge geometry spanning two adjacent cores, sampling from both tiles' buffer margins. Generated for east and south edges only (to avoid duplicates).
- **Corner patch** — bridge geometry at the junction of four tiles, sampling from all four tiles' corner margins.
- **`TileRecord`** — one fetched tile: a pair of DEM + imagery textures loaded at `tileZoom`.
- **`EdgeRecord`** / **`CornerPatchRecord`** — adjacency records derived from loaded tiles, referencing two or four `TileRecord`s respectively.
- **`coreSpan`** — the non-buffer fraction of a tile: `1 - 2 * uvInset`. Used in geometry sizing and UV mapping.

## Architecture Overview

The two renderers are completely independent canvases, stacked via CSS. They never share a WebGL context or canvas element.

```
┌─────────────────────────────────┐
│  DeckGL canvas (pointer events) │  ← interaction layer, transparent background
├─────────────────────────────────┤
│  ThreeJS canvas (terrain mesh)  │  ← rendering layer
└─────────────────────────────────┘
```

ThreeJS renders the 3D terrain geometry. DeckGL renders nothing visible — its `TileLayer` has `renderSubLayers: () => null` — and exists solely as a **tile scheduler and interaction controller**. The `TileLayer` is locked to a single `tileZoom` level to enable seamless tile stitching.

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
- **First-person mode**: `FirstPersonViewport` drives the camera matrices. Tile geometry placement still uses `WebMercatorViewport` (via `tileMath.ts`), since `projectPosition` returns zoom-0 world coordinates independent of viewport type. `meterZoom` (from `getMeterZoom(latitude)`) is passed to keep `distanceScales` consistent.

Because both sides ultimately express geometry in DeckGL's WebMercator world-space, tiles align with the camera in either mode.

## Seamless Terrain via Tile Stitching

Tile boundaries are eliminated by splitting each tile into three geometry types that share texture data from adjacent tiles. Stitching is a purely client-side geometry concern — it re-samples textures that were already fetched for the core tiles and triggers **zero additional network requests**.

### Requests vs Geometry

Each tile request at `tileZoom` fetches a 256×256 DEM image and a 256×256 imagery image. These two textures become a single `TileRecord`. The stitching system then slices each `TileRecord`'s textures into geometry pieces using `uvInset`:

```
One tile request (z/x/y) at tileZoom
         │
         ▼
   256×256 DEM + 256×256 imagery  →  TileRecord
         │
         ├── Core mesh:    samples UV [uvInset, 1-uvInset] on both axes
         │                 (the center 50% of the texture)
         │
         └── Buffer zones: the outer uvInset (25%) on each side
                           shared with neighbors to build:
                           • Edge strips  (2 tiles' buffers)
                           • Corner patches (4 tiles' buffers)
```

When four tiles meet at a corner, the geometry fits together like this:

```
     tile NW          tile NE
  ┌──────────┬──┬──┬──────────┐
  │          │EW│EW│          │
  │   core   │A │B │   core   │
  │          │  │  │          │
  ├──────────┼──┼──┼──────────┤
  │  edge-S  │NW│NE│  edge-S  │
  │  (A top) │  │  │  (A top) │
  ├──────────┼──┼──┼──────────┤
  │  edge-S  │SW│SE│  edge-S  │
  │  (B bot) │  │  │  (B bot) │
  ├──────────┼──┼──┼──────────┤
  │          │EW│EW│          │
  │   core   │A │B │   core   │
  │          │  │  │          │
  └──────────┴──┴──┴──────────┘
     tile SW          tile SE

  EW = east-west edge strip
  NW/NE/SW/SE = corner patch quadrants
```

The core, edge, and corner meshes tile the plane with no gaps and no overlaps. Every pixel of the original texture is rendered exactly once.

### Geometry Model

With `uvInset = 0.25`, each tile's texture is split into a core and buffer margins. The core occupies UV `[uvInset, 1 - uvInset]` on both axes (the center 50% of the texture). The outer 25% on each side is the buffer zone shared with neighboring tiles. This yields three geometry types:

- **Core mesh** — the center `(1 - 2 * uvInset)²` of the tile, sampling UV `[0.25, 0.75]` on both axes. One per loaded tile.
- **Edge strip** — bridges two adjacent tiles across their shared buffer zones. `uvInset` fraction from tile A's near edge + `uvInset` fraction from tile B's near edge. Generated for east and south edges only (to avoid duplicates).
- **Corner patch** — bridges four tiles at their shared corner, sampling the `uvInset × uvInset` corner region of each tile.

### Tile Zoom

The `TileLayer` is locked to a single zoom level (`tileZoom`, currently 9). This eliminates LOD management and guarantees all tiles share the same z, which is required for the adjacency computations.

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
| Tile scheduling (`tileZoom`) | DeckGL `TileLayer` with `minZoom === maxZoom === tileZoom` |
| Tile texture loading (DEM + imagery) | ThreeJS `TextureLoader` (triggered by DeckGL callbacks) |
| Adjacency computation | `useDeckTileTerrain` — derives edge/corner records from loaded tile map |
| Texture disposal | Centralized deferred queue in `useDeckTileTerrain` |
| 3D rendering | ThreeJS / React Three Fiber |

## Key Files

| File | Role |
|---|---|
| `src/App.tsx` | Composes the two canvases; owns the DeckGL `onViewStateChange` handler; sets `TILE_ZOOM` |
| `src/types.ts` | `MapViewState`, `FirstPersonViewState`, `ViewMode` type definitions |
| `src/store/viewStateStore.ts` | Zustand store holding both view states and the active mode |
| `src/terrain/types.ts` | `TileRecord`, `EdgeRecord`, `CornerPatchRecord` type definitions |
| `src/terrain/TerrainScene.tsx` | `DeckSyncedCamera` — per-frame matrix injection; renders core, edge, and corner meshes |
| `src/terrain/TileTerrainMesh.tsx` | Core mesh per tile; TSL vertex shader for DEM displacement with UV inset |
| `src/terrain/TileEdgeStripMesh.tsx` | Edge strip mesh bridging two adjacent tiles with dual-texture TSL shader |
| `src/terrain/TileCornerPatchMesh.tsx` | Corner patch mesh bridging four tiles with quad-texture TSL shader |
| `src/terrain/useDeckTileTerrain.ts` | `tileZoom`-locked `TileLayer`; manages tile lifecycle, shared texture disposal, and adjacency records |
| `src/utils/tileMath.ts` | Converts tile indices → WebMercator world-space bounds; accepts `meterZoom` for first-person mode |
