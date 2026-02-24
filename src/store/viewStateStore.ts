import { create } from "zustand";
import type { MapViewState } from "../types";

const DEFAULT_VIEW_STATE: MapViewState = {
  longitude: -122.45,
  latitude: 37.78,
  zoom: 10,
  pitch: 45,
  bearing: 0,
};

type ViewStateStore = {
  viewState: MapViewState;
  setViewState: (next: Partial<MapViewState>) => void;
};

export const useViewStateStore = create<ViewStateStore>((set) => ({
  viewState: DEFAULT_VIEW_STATE,
  setViewState: (next) =>
    set((state) => ({
      viewState: {
        ...state.viewState,
        ...next,
      },
    })),
}));
