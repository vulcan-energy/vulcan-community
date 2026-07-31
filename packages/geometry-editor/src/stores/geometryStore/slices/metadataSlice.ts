// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import type { GuideOverlay, GuideOverlaySource } from '../../../geometry/guideOverlay';
import {
  resolveGuideOverlayForFloor,
  resolveGuideOverlaySourceForFloor,
  type GuideOverlayByFloor,
  type GuideOverlaySourceByFloor,
} from '../../../geometry/guideOverlayByFloor';
import type { GeometryState } from '../../geometryStore';
import type { BundledAssemblyLibrary } from '../../../lib/assemblyLibrary';
import type { CreationDefaultAssemblyIds } from '../../../lib/multiSelectAssemblyApply';
import { parseJunctionPsiDefaultsCsv } from '../../../lib/junctionPsiDefaultsCsv';
import type { GeometryWorkspaceResourcePort } from '../../../../../geometry-editor-host/src/workspaceResourcePort';

type MetadataSlice = Pick<
  GeometryState,
  | 'defaultsPath'
  | 'setDefaultsPath'
  | 'defaultsJson'
  | 'setDefaultsJson'
  | 'defaultsLoading'
  | 'setDefaultsLoading'
  | 'hostDocumentMetadata'
  | 'setHostDocumentMetadataValue'
  | 'propertyPostcode'
  | 'setPropertyPostcode'
  | 'guideOverlay'
  | 'guideOverlaySource'
  | 'guideOverlayByFloor'
  | 'guideOverlaySourceByFloor'
  | 'setGuideOverlay'
  | 'setGuideOverlaySource'
  | 'updateGuideOverlay'
  | 'clearGuideOverlay'
  | 'resetGuideOverlayForActiveFloor'
  | 'defaultThermalBridging'
  | 'setDefaultThermalBridging'
  | 'junctionPsiDefaultsPath'
  | 'setJunctionPsiDefaultsPath'
  | 'junctionPsiDefaultsMap'
  | 'junctionPsiDefaultsLoading'
  | 'junctionPsiDefaultsError'
  | 'detailedBridgePsiProfile'
  | 'setDetailedBridgePsiProfile'
  | 'creationDefaultAssemblyIds'
  | 'setCreationDefaultAssemblyIds'
  | 'bundledAssemblyLibrary'
  | 'setBundledAssemblyLibrary'
  | 'bundledAssemblyLibraryLoading'
  | 'setBundledAssemblyLibraryLoading'
  | 'bundledAssemblyLibraryError'
  | 'setBundledAssemblyLibraryError'
>;

export type GeometryStoreSlice = StateCreator<GeometryState, [], [], MetadataSlice>;

export type MetadataSliceOptions = Readonly<{
  defaultDefaultsPath: string | undefined;
  workspaceResourcePort: GeometryWorkspaceResourcePort;
}>;

/** Recompute the active-floor denormalized fields from the by-floor maps + currentFloorZ. */
const computeActiveOverlayView = (
  byFloor: GuideOverlayByFloor,
  sourceByFloor: GuideOverlaySourceByFloor,
  floorZ: number,
): { guideOverlay: GuideOverlay | null; guideOverlaySource: GuideOverlaySource | null } => ({
  guideOverlay: resolveGuideOverlayForFloor(byFloor, floorZ).value,
  guideOverlaySource: resolveGuideOverlaySourceForFloor(sourceByFloor, floorZ).value,
});

export const createMetadataSlice = (
  options: MetadataSliceOptions,
): GeometryStoreSlice => (set) => {
  let junctionPsiDefaultsLoadVersion = 0;

  return {
  defaultsPath: options.defaultDefaultsPath,
  defaultsJson: null,
  defaultsLoading: false,
  creationDefaultAssemblyIds: {} as CreationDefaultAssemblyIds,
  bundledAssemblyLibrary: null as BundledAssemblyLibrary | null,
  bundledAssemblyLibraryLoading: false,
  bundledAssemblyLibraryError: null as string | null,
  setBundledAssemblyLibrary: (lib: BundledAssemblyLibrary | null) =>
    set({
      bundledAssemblyLibrary: lib,
      ...(lib != null ? { bundledAssemblyLibraryError: null } : {}),
    }),
  setBundledAssemblyLibraryLoading: (loading: boolean) => set({ bundledAssemblyLibraryLoading: loading }),
  setBundledAssemblyLibraryError: (message: string | null) => set({ bundledAssemblyLibraryError: message }),
  setCreationDefaultAssemblyIds: (patch: Partial<Record<'wall' | 'roof' | 'ground_floor', string | undefined>>) => {
    set((state) => {
      const next: CreationDefaultAssemblyIds = { ...state.creationDefaultAssemblyIds };
      (['wall', 'roof', 'ground_floor'] as const).forEach((key) => {
        if (!(key in patch)) return;
        const v = patch[key];
        if (v === undefined || v === '') {
          delete next[key];
        } else {
          next[key] = v;
        }
      });
      return { creationDefaultAssemblyIds: next };
    });
  },
  setDefaultsLoading: (loading: boolean) => set({ defaultsLoading: loading }),
  hostDocumentMetadata: {},
  propertyPostcode: undefined,
  guideOverlay: null,
  guideOverlaySource: null,
  guideOverlayByFloor: {} as GuideOverlayByFloor,
  guideOverlaySourceByFloor: {} as GuideOverlaySourceByFloor,
  // Global thermal bridging default (W/K)
  defaultThermalBridging: 0.2,
  setDefaultThermalBridging: (value: number) => {
    set({ defaultThermalBridging: value });
  },
  setDefaultsPath: (path) => set({ defaultsPath: path }),
  setDefaultsJson: (json) => set({ defaultsJson: json }),
  setHostDocumentMetadataValue: (key, value) => set((state) => {
    const next = { ...state.hostDocumentMetadata };
    const normalized = value?.trim();
    if (normalized) next[key] = normalized;
    else delete next[key];
    return { hostDocumentMetadata: next };
  }),
  setPropertyPostcode: (postcode) => set({ propertyPostcode: postcode }),
  setGuideOverlay: (overlay: GuideOverlay | null) => {
    set((state) => {
      const floorZ = state.currentFloorZ ?? 0;
      const nextByFloor: GuideOverlayByFloor = { ...state.guideOverlayByFloor };
      if (overlay) {
        nextByFloor[floorZ] = overlay;
      } else {
        delete nextByFloor[floorZ];
      }
      const view = computeActiveOverlayView(nextByFloor, state.guideOverlaySourceByFloor, floorZ);
      return { guideOverlayByFloor: nextByFloor, ...view };
    });
  },
  setGuideOverlaySource: (source: GuideOverlaySource | null) => {
    set((state) => {
      const floorZ = state.currentFloorZ ?? 0;
      const nextByFloor: GuideOverlaySourceByFloor = { ...state.guideOverlaySourceByFloor };
      if (source) {
        nextByFloor[floorZ] = source;
      } else {
        delete nextByFloor[floorZ];
      }
      const view = computeActiveOverlayView(state.guideOverlayByFloor, nextByFloor, floorZ);
      return { guideOverlaySourceByFloor: nextByFloor, ...view };
    });
  },
  updateGuideOverlay: (updates) => {
    set((state) => {
      const floorZ = state.currentFloorZ ?? 0;
      // Materialize from inheritance on first write so partial patches don't quietly mutate
      // the floor-below record.
      const resolved = resolveGuideOverlayForFloor(state.guideOverlayByFloor, floorZ);
      if (!resolved.value) return state;
      const next: GuideOverlay = { ...resolved.value, ...updates } as GuideOverlay;
      const nextByFloor: GuideOverlayByFloor = { ...state.guideOverlayByFloor, [floorZ]: next };
      const view = computeActiveOverlayView(nextByFloor, state.guideOverlaySourceByFloor, floorZ);
      return { guideOverlayByFloor: nextByFloor, ...view };
    });
  },
  clearGuideOverlay: () => {
    set({
      guideOverlay: null,
      guideOverlaySource: null,
      guideOverlayByFloor: {} as GuideOverlayByFloor,
      guideOverlaySourceByFloor: {} as GuideOverlaySourceByFloor,
    });
  },
  resetGuideOverlayForActiveFloor: () => {
    set((state) => {
      const floorZ = state.currentFloorZ ?? 0;
      const ownsOverlay = Object.prototype.hasOwnProperty.call(state.guideOverlayByFloor, floorZ);
      const ownsSource = Object.prototype.hasOwnProperty.call(state.guideOverlaySourceByFloor, floorZ);
      if (!ownsOverlay && !ownsSource) return state;
      const nextOverlayByFloor: GuideOverlayByFloor = { ...state.guideOverlayByFloor };
      const nextSourceByFloor: GuideOverlaySourceByFloor = { ...state.guideOverlaySourceByFloor };
      delete nextOverlayByFloor[floorZ];
      delete nextSourceByFloor[floorZ];
      const view = computeActiveOverlayView(nextOverlayByFloor, nextSourceByFloor, floorZ);
      return {
        guideOverlayByFloor: nextOverlayByFloor,
        guideOverlaySourceByFloor: nextSourceByFloor,
        ...view,
      };
    });
  },

  junctionPsiDefaultsPath: undefined,
  junctionPsiDefaultsMap: {} as Record<string, number>,
  junctionPsiDefaultsLoading: false,
  junctionPsiDefaultsError: null as string | null,
  detailedBridgePsiProfile: null,
  setDetailedBridgePsiProfile: (profile) => {
    if (!profile?.source?.trim() || !profile.profileId?.trim()) {
      set({ detailedBridgePsiProfile: null });
      return;
    }
    set({
      detailedBridgePsiProfile: {
        source: profile.source.trim(),
        profileId: profile.profileId.trim(),
        label: profile.label?.trim() || profile.profileId.trim(),
      },
    });
  },
  setJunctionPsiDefaultsPath: (path: string | undefined) => {
    const loadVersion = ++junctionPsiDefaultsLoadVersion;
    const trimmed = path?.trim();
    if (!trimmed) {
      set({
        junctionPsiDefaultsPath: undefined,
        junctionPsiDefaultsMap: {},
        junctionPsiDefaultsLoading: false,
        junctionPsiDefaultsError: null,
      });
      return;
    }
    set({
      junctionPsiDefaultsPath: trimmed,
      // A retained path may now resolve against a different workspace. Never
      // expose the previous workspace's values while the replacement loads.
      junctionPsiDefaultsMap: {},
      junctionPsiDefaultsLoading: true,
      junctionPsiDefaultsError: null,
    });
    options.workspaceResourcePort
      .readText(trimmed)
      .then((text) => {
        if (loadVersion !== junctionPsiDefaultsLoadVersion) return;
        const map = parseJunctionPsiDefaultsCsv(text);
        set({
          junctionPsiDefaultsMap: map,
          junctionPsiDefaultsLoading: false,
          junctionPsiDefaultsError: null,
        });
      })
      .catch((e: unknown) => {
        if (loadVersion !== junctionPsiDefaultsLoadVersion) return;
        const msg = e instanceof Error ? e.message : String(e);
        set({
          junctionPsiDefaultsMap: {},
          junctionPsiDefaultsLoading: false,
          junctionPsiDefaultsError: msg,
        });
      });
  },
  };
};
