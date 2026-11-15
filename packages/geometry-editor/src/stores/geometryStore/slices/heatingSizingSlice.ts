// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import type { GeometryState } from '../../geometryStore';
import { NO_TARGET_SIZING_REASON_PREFIX, sizeHeating, type DesignHeatLoss, type HeatingSizing } from '../../../lib/heatingSizing';

type Json = Record<string, unknown>;

/** The model as prepared for its pinned HEM target: what a run of the model takes. */
export interface HeatingSizingRequest {
  targetBundleId: string;
  model: Json;
}

/** `model` is the core input the design loss was computed on (after the target's preprocessing). */
export type HeatingSizingComputation =
  | { status: 'ready'; model: Json; designHeatLoss: DesignHeatLoss }
  | { status: 'unavailable'; reason: string };

/** Host service that computes a prepared model's design heat loss. Throw on failure. */
export interface HeatingSizingProvider {
  compute(request: HeatingSizingRequest, signal: AbortSignal): Promise<HeatingSizingComputation>;
}

export interface HeatingSizingState {
  status: 'idle' | 'computing' | 'ready' | 'unavailable' | 'error';
  /** While computing: the last result, kept so its warnings do not flicker (see heatingSizingWarnings). */
  result?: HeatingSizing;
  reason?: string;
  /** Hash of the request the state belongs to. */
  modelKey?: string;
}

export interface HeatingSizingSlice {
  heatingSizing: HeatingSizingState;
  /**
   * Sizes a prepared model. The host calls it with each freshly prepared model (the live target
   * preflight, after its idle delay), so this action adds no debounce. A newer request aborts the
   * older one; an unchanged model is answered from the cache.
   */
  requestHeatingSizing: (request: HeatingSizingRequest) => void;
  /**
   * No prepared model to size (target not downloaded, preparation failed). Like a provider error,
   * the reason shows only once the current target has sized a model; otherwise it is hidden.
   */
  setHeatingSizingUnavailable: (reason: string) => void;
}

export const selectHeatingSizing = (state: GeometryState): HeatingSizingState => state.heatingSizing;

export const NO_HEATING_SIZING_PROVIDER = 'This app cannot compute the design heat loss.';
const IDLE: HeatingSizingState = { status: 'idle' };
const CACHE_SIZE = 8;

/** cyrb53: a 53-bit string hash. Cache keys only; a collision shows another model's sizing. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const hasSpaceHeating = (model: Json): boolean => {
  const systems = model.SpaceHeatSystem;
  return !!systems && typeof systems === 'object' && Object.keys(systems).length > 0;
};

export const createHeatingSizingSlice = (
  provider: HeatingSizingProvider | undefined,
): StateCreator<GeometryState, [], [], HeatingSizingSlice> => (set, get, api) => {
  const cache = new Map<string, HeatingSizingState>();
  let active: AbortController | undefined;
  /**
   * The bundle that last gave a result. Only a target known to size explains why it did not: on
   * any other (every released target, a7, one not yet downloaded or run) reasons are hidden.
   */
  let sizedBundleId: string | undefined;
  const hideUnlessSized = (bundleId: string | null | undefined, reason: string): HeatingSizingState =>
    (bundleId && bundleId === sizedBundleId) || reason.startsWith(NO_TARGET_SIZING_REASON_PREFIX)
      ? { status: 'unavailable', reason }
      : { status: 'unavailable', reason: `${NO_TARGET_SIZING_REASON_PREFIX} ${reason}` };
  const settle = (state: HeatingSizingState) => {
    active?.abort();
    active = undefined;
    set({ heatingSizing: state });
  };
  // A load, new document or target change clears the target check; the old sizing goes with it.
  api.subscribe((state, prev) => {
    if (state.targetBundleId !== prev.targetBundleId) sizedBundleId = undefined;
    if (prev.targetValidation && !state.targetValidation && state.heatingSizing !== IDLE) settle(IDLE);
  });
  return {
    heatingSizing: IDLE,
    setHeatingSizingUnavailable: (reason) => settle(hideUnlessSized(get().targetBundleId, reason)),
    requestHeatingSizing: (request) => {
      if (!hasSpaceHeating(request.model)) return settle(IDLE);
      if (!provider) return settle(hideUnlessSized(undefined, NO_HEATING_SIZING_PROVIDER));
      const modelKey = hash(`${request.targetBundleId}\n${JSON.stringify(request.model)}`);
      const cached = cache.get(modelKey);
      if (cached) {
        sizedBundleId = request.targetBundleId;
        return settle(cached);
      }
      if (get().heatingSizing.modelKey === modelKey && get().heatingSizing.status === 'computing') return;
      settle({ status: 'computing', modelKey, result: get().heatingSizing.result });
      const controller = new AbortController();
      active = controller;
      void provider.compute(request, controller.signal)
        .then((computed): HeatingSizingState => computed.status === 'ready'
          ? { status: 'ready', modelKey, result: sizeHeating(computed.model, computed.designHeatLoss) }
          : { ...hideUnlessSized(request.targetBundleId, computed.reason), modelKey })
        .then(
          (state) => {
            if (controller.signal.aborted) return;
            // Only results are cached: an unavailable target can become available (downloaded) unchanged.
            if (state.status === 'ready') {
              cache.set(modelKey, state);
              sizedBundleId = request.targetBundleId;
            }
            if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
            settle(state);
          },
          (error: unknown) => {
            if (controller.signal.aborted) return;
            const reason = error instanceof Error ? error.message : String(error);
            settle(request.targetBundleId === sizedBundleId ? { status: 'error', modelKey, reason } : { ...hideUnlessSized(request.targetBundleId, reason), modelKey });
          },
        );
    },
  };
};
