import { useMemo } from "react";
import type { RequestTile } from "../terrain/types";

type TileInfoPanelProps = {
  tiles: RequestTile[];
  selectedTileId: string | null;
  onSelectTile: (id: string | null) => void;
};

type ZoomBucket = {
  zoom: number;
  count: number;
};

function useZoomBuckets(tiles: RequestTile[]): ZoomBucket[] {
  return useMemo(() => {
    const buckets = new Map<number, number>();
    for (const tile of tiles) {
      const z = tile.index.z;
      buckets.set(z, (buckets.get(z) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([zoom, count]) => ({ zoom, count }));
  }, [tiles]);
}

function TileListItem({
  tile,
  isSelected,
  onSelect,
}: {
  tile: RequestTile;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
}) {
  return (
    <button
      type="button"
      className={`tile-list-item ${isSelected ? "tile-list-item-active" : ""}`}
      onClick={() => onSelect(isSelected ? null : tile.id)}
    >
      <span className="tile-list-item-id">{tile.id}</span>
      <span className="tile-list-item-zoom">z{tile.index.z}</span>
    </button>
  );
}

export function TileInfoPanel({
  tiles,
  selectedTileId,
  onSelectTile,
}: TileInfoPanelProps) {
  const zoomBuckets = useZoomBuckets(tiles);

  const selectedTile = useMemo(() => {
    if (!selectedTileId) return null;
    return tiles.find((t) => t.id === selectedTileId) ?? null;
  }, [tiles, selectedTileId]);

  const sortedTiles = useMemo(
    () =>
      [...tiles].sort((a, b) => {
        if (a.index.z !== b.index.z) return a.index.z - b.index.z;
        if (a.index.x !== b.index.x) return a.index.x - b.index.x;
        return a.index.y - b.index.y;
      }),
    [tiles],
  );

  return (
    <div className="tile-info-panel">
      <div className="tile-info-section">
        <div className="tile-info-title">Tiles</div>
        <div className="tile-info-row">
          <span className="tile-info-label">Count</span>
          <span className="tile-info-value">{tiles.length}</span>
        </div>
        {zoomBuckets.map((b) => (
          <div key={b.zoom} className="tile-info-row tile-info-row-indent">
            <span className="tile-info-label">z{b.zoom}</span>
            <span className="tile-info-value">{b.count}</span>
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
            <span className="tile-info-label">ID</span>
            <span className="tile-info-value tile-info-mono">{selectedTile.id}</span>
          </div>
          <div className="tile-info-row">
            <span className="tile-info-label">Zoom</span>
            <span className="tile-info-value">z{selectedTile.index.z}</span>
          </div>
          <div className="tile-info-row">
            <span className="tile-info-label">Index</span>
            <span className="tile-info-value tile-info-mono">
              ({selectedTile.index.x}, {selectedTile.index.y})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
