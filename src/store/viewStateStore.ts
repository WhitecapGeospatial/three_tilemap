import { create } from "zustand";
import type { MapViewState, FirstPersonViewState, ViewMode } from "../types";

const DEFAULT_MAP_VIEW_STATE: MapViewState = {
  longitude: -122.45,
  latitude: 37.78,
  zoom: 10,
  pitch: 45,
  bearing: 0,
};

const DEFAULT_FP_VIEW_STATE: FirstPersonViewState = {
  longitude: -122.45,
  latitude: 37.78,
  position: [0, 0, 500],
  pitch: 0,
  bearing: 0,
  minPitch: -89,
  maxPitch: 89,
};

type ViewStateStore = {
  mode: ViewMode;
  mapViewState: MapViewState;
  fpViewState: FirstPersonViewState;
  setMode: (mode: ViewMode) => void;
  setMapViewState: (next: Partial<MapViewState>) => void;
  setFpViewState: (next: Partial<FirstPersonViewState>) => void;
};

export const useViewStateStore = create<ViewStateStore>((set) => ({
  mode: "map",
  mapViewState: DEFAULT_MAP_VIEW_STATE,
  fpViewState: DEFAULT_FP_VIEW_STATE,

  setMode: (mode) =>
    set((state) => {
      if (mode === state.mode) return state;
      if (mode === "firstPerson") {
        return {
          mode,
          fpViewState: {
            ...state.fpViewState,
            longitude: state.mapViewState.longitude,
            latitude: state.mapViewState.latitude,
            bearing: state.mapViewState.bearing,
            pitch: 0,
            // Reset horizontal local offsets so first-person mode starts at the
            // same geographic anchor as map mode.
            position: [0, 0, state.fpViewState.position[2]],
          },
        };
      }
      return {
        mode,
        mapViewState: {
          ...state.mapViewState,
          longitude: state.fpViewState.longitude,
          latitude: state.fpViewState.latitude,
          bearing: state.fpViewState.bearing,
        },
      };
    }),

  setMapViewState: (next) =>
    set((state) => ({
      mapViewState: { ...state.mapViewState, ...next },
    })),

  setFpViewState: (next) =>
    set((state) => ({
      fpViewState: { ...state.fpViewState, ...next },
    })),
}));
