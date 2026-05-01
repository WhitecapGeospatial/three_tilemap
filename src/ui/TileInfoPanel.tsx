import { useMemo } from "react";
import type { RenderedTile, RequestTile, TileStatus } from "../terrain/types";

type TileInfoPanelProps = {
  renderedTiles: RenderedTile[];
  requestTileCache: Map<string, RequestTile>;
  maxRenderZoom: number;
  minRequestZoom: number;
  selectedTileId: string | null;
  onSelectTile: (id: string | null) => void;
};

type ZoomBucket = {
  zoom: number;
  ready: number;
  loading: number;
  error: number;
};

type ContributingTile = {
  id: string;
  zoom: number;
  status: TileStatus;
  isActive: boolean;
};

function useZoomBuckets(cache: Map<string, RequestTile>): ZoomBucket[] {
  return useMemo(() => {
    const buckets = new Map<number, { ready: number; loading: number; error: number }>();
    for (const tile of cache.values()) {
      const z = tile.index.z;
      let b = buckets.get(z);
      if (!b) {
        b = { ready: 0, loading: 0, error: 0 };
        buckets.set(z, b);
      }
      b[tile.status]++;
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([zoom, counts]) => ({ zoom, ...counts }));
  }, [cache]);
}

function useSourceZoomDistribution(tiles: RenderedTile[]): Map<number, number> {
  return useMemo(() => {
    const dist = new Map<number, number>();
    for (const t of tiles) {
      const z = t.source.sourceZoom;
      dist.set(z, (dist.get(z) ?? 0) + 1);
    }
    return dist;
  }, [tiles]);
}

function findContributingTiles(
  rx: number,
  ry: number,
  maxRenderZoom: number,
  minRequestZoom: number,
  cache: Map<string, RequestTile>,
  activeSourceId: string,
): ContributingTile[] {
  const results: ContributingTile[] = [];
  for (let z = maxRenderZoom; z >= minRequestZoom; z--) {
    const scale = 1 << (maxRenderZoom - z);
    const tx = Math.floor(rx / scale);
    const ty = Math.floor(ry / scale);
    const id = `${z}/${tx}/${ty}`;
    const tile = cache.get(id);
    if (tile) {
      results.push({
        id: tile.id,
        zoom: z,
        status: tile.status,
        isActive: tile.id === activeSourceId,
      });
    }
  }
  return results;
}

function statusClass(status: TileStatus): string {
  if (status === "ready") return "tile-info-ready";
  if (status === "loading") return "tile-info-loading";
  return "tile-info-error";
}

function TileListItem({
  tile,
  maxRenderZoom,
  isSelected,
  onSelect,
}: {
  tile: RenderedTile;
  maxRenderZoom: number;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const isFallback = tile.source.sourceZoom < maxRenderZoom;
  return (
    <button
      type="button"
      className={`tile-list-item ${isSelected ? "tile-list-item-active" : ""}`}
      onClick={() => onSelect(isSelected ? null : tile.id)}
    >
      <span className="tile-list-item-id">{tile.id}</span>
      <span className={`tile-list-item-zoom ${isFallback ? "tile-info-loading" : ""}`}>
        z{tile.source.sourceZoom}
      </span>
    </button>
  );
}

export function TileInfoPanel({
  renderedTiles,
  requestTileCache,
  maxRenderZoom,
  minRequestZoom,
  selectedTileId,
  onSelectTile,
}: TileInfoPanelProps) {
  const zoomBuckets = useZoomBuckets(requestTileCache);
  const sourceZoomDist = useSourceZoomDistribution(renderedTiles);

  const selectedTile = useMemo(() => {
    if (!selectedTileId) return null;
    return renderedTiles.find((t) => t.id === selectedTileId) ?? null;
  }, [renderedTiles, selectedTileId]);

  const contributingTiles = useMemo(() => {
    if (!selectedTile) return [];
    return findContributingTiles(
      selectedTile.renderIndex.x,
      selectedTile.renderIndex.y,
      maxRenderZoom,
      minRequestZoom,
      requestTileCache,
      selectedTile.source.requestTile.id,
    );
  }, [selectedTile, maxRenderZoom, minRequestZoom, requestTileCache]);

  const totalReady = useMemo(
    () => zoomBuckets.reduce((s, b) => s + b.ready, 0),
    [zoomBuckets],
  );
  const totalLoading = useMemo(
    () => zoomBuckets.reduce((s, b) => s + b.loading, 0),
    [zoomBuckets],
  );
  const totalError = useMemo(
    () => zoomBuckets.reduce((s, b) => s + b.error, 0),
    [zoomBuckets],
  );

  const segmentRange = useMemo(() => {
    if (renderedTiles.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const t of renderedTiles) {
      if (t.segments < min) min = t.segments;
      if (t.segments > max) max = t.segments;
    }
    return { min, max };
  }, [renderedTiles]);

  const sortedTiles = useMemo(
    () =>
      [...renderedTiles].sort((a, b) => {
        if (a.renderIndex.x !== b.renderIndex.x) return a.renderIndex.x - b.renderIndex.x;
        return a.renderIndex.y - b.renderIndex.y;
      }),
    [renderedTiles],
  );

  return (
    <div className="tile-info-panel">
      <div className="tile-info-section">
        <div className="tile-info-title">Rendered Tiles</div>
        <div className="tile-info-row">
          <span className="tile-info-label">Count</span>
          <span className="tile-info-value">{renderedTiles.length}</span>
        </div>
        {segmentRange && (
          <div className="tile-info-row">
            <span className="tile-info-label">Segments</span>
            <span className="tile-info-value">
              {segmentRange.min === segmentRange.max
                ? segmentRange.min
                : `${segmentRange.min} – ${segmentRange.max}`}
            </span>
          </div>
        )}
        <div className="tile-info-row">
          <span className="tile-info-label">Render zoom</span>
          <span className="tile-info-value">z{maxRenderZoom}</span>
        </div>
        {sourceZoomDist.size > 0 && (
          <div className="tile-info-sub">
            {Array.from(sourceZoomDist.entries())
              .sort(([a], [b]) => b - a)
              .map(([z, count]) => (
                <div key={z} className="tile-info-zoom-row">
                  <span className="tile-info-zoom-label">z{z}</span>
                  <span className="tile-info-zoom-bar">
                    <span
                      className="tile-info-zoom-fill"
                      style={{ width: `${Math.min(100, (count / renderedTiles.length) * 100)}%` }}
                    />
                  </span>
                  <span className="tile-info-zoom-count">{count}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="tile-info-section">
        <div className="tile-info-title">Request Cache</div>
        <div className="tile-info-row">
          <span className="tile-info-label">Total</span>
          <span className="tile-info-value">
            <span className="tile-info-ready">{totalReady}</span>
            {totalLoading > 0 && (
              <> / <span className="tile-info-loading">{totalLoading} loading</span></>
            )}
            {totalError > 0 && (
              <> / <span className="tile-info-error">{totalError} error</span></>
            )}
          </span>
        </div>
        {zoomBuckets.map((b) => (
          <div key={b.zoom} className="tile-info-row tile-info-row-indent">
            <span className="tile-info-label">z{b.zoom}</span>
            <span className="tile-info-value">
              <span className="tile-info-ready">{b.ready}</span>
              {b.loading > 0 && (
                <> / <span className="tile-info-loading">{b.loading}</span></>
              )}
              {b.error > 0 && (
                <> / <span className="tile-info-error">{b.error}</span></>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="tile-info-section">
        <div className="tile-info-title">Tile List</div>
        <div className="tile-list-scroll">
          {sortedTiles.map((tile) => (
            <TileListItem
              key={tile.id}
              tile={tile}
              maxRenderZoom={maxRenderZoom}
              isSelected={tile.id === selectedTileId}
              onSelect={onSelectTile}
            />
          ))}
        </div>
      </div>

      {selectedTile && (
        <div className="tile-info-section tile-info-selected">
          <div className="tile-info-title">Selected Tile</div>
          <div className="tile-info-row">
            <span className="tile-info-label">Render ID</span>
            <span className="tile-info-value tile-info-mono">{selectedTile.id}</span>
          </div>
          <div className="tile-info-row">
            <span className="tile-info-label">Active zoom</span>
            <span className="tile-info-value">
              z{selectedTile.source.sourceZoom}
              {selectedTile.source.sourceZoom < maxRenderZoom && (
                <span className="tile-info-fallback"> (fallback)</span>
              )}
            </span>
          </div>
          <div className="tile-info-row">
            <span className="tile-info-label">Segments</span>
            <span className="tile-info-value">{selectedTile.segments}</span>
          </div>
          <div className="tile-info-row">
            <span className="tile-info-label">UV bounds</span>
            <span className="tile-info-value tile-info-mono">
              [{selectedTile.source.uvBounds.uMin.toFixed(3)}, {selectedTile.source.uvBounds.vMin.toFixed(3)}] &rarr; [{selectedTile.source.uvBounds.uMax.toFixed(3)}, {selectedTile.source.uvBounds.vMax.toFixed(3)}]
            </span>
          </div>
          <div className="tile-info-sources">
            <div className="tile-info-sources-label">Source Tiles</div>
            {contributingTiles.map((ct) => (
              <div
                key={ct.id}
                className={`tile-info-source-row ${ct.isActive ? "tile-info-source-active" : ""}`}
              >
                <span className="tile-info-mono">{ct.id}</span>
                <span className={statusClass(ct.status)}>
                  {ct.status}
                </span>
                {ct.isActive && <span className="tile-info-source-badge">active</span>}
              </div>
            ))}
            {contributingTiles.length === 0 && (
              <div className="tile-info-hint">No request tiles in cache</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
