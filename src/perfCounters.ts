/** Dev-only counters for diagnosing texture and resource lifecycle. */

export const perfCounters = {
  texturesLoaded: 0,
  texturesDisposed: 0,
  texturesLive: 0,

  geometriesCreated: 0,
  geometriesDisposed: 0,

  materialsCreated: 0,
  materialsDisposed: 0,

  tileFetchesStarted: 0,
  tileFetchesCompleted: 0,
  tileFetchesFailed: 0,

  pruneCallCount: 0,
  pruneTexturesDisposed: 0,

  /** Monotonic snapshot id for console grouping. */
  snapshotId: 0,
};

export function resetPerfCounters() {
  perfCounters.texturesLoaded = 0;
  perfCounters.texturesDisposed = 0;
  perfCounters.texturesLive = 0;
  perfCounters.geometriesCreated = 0;
  perfCounters.geometriesDisposed = 0;
  perfCounters.materialsCreated = 0;
  perfCounters.materialsDisposed = 0;
  perfCounters.tileFetchesStarted = 0;
  perfCounters.tileFetchesCompleted = 0;
  perfCounters.tileFetchesFailed = 0;
  perfCounters.pruneCallCount = 0;
  perfCounters.pruneTexturesDisposed = 0;
  perfCounters.snapshotId = 0;
}

(globalThis as Record<string, unknown>).__perfCounters = perfCounters;
(globalThis as Record<string, unknown>).__resetPerfCounters = resetPerfCounters;
