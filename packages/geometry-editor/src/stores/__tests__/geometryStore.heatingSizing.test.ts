// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';

import { createGeometryStore } from '../geometryStore';
import { NO_TARGET_SIZING_REASON_PREFIX } from '../../lib/heatingSizing';
import {
  NO_HEATING_SIZING_PROVIDER,
  selectHeatingSizing,
  type HeatingSizingComputation,
  type HeatingSizingProvider,
} from '../geometryStore/slices/heatingSizingSlice';

const loss = {
  coldestHourC: -3,
  setpointC: 21,
  zones: { zone: { htcWPerK: 100, fabricWPerK: 60, thermalBridgesWPerK: 10, ventilationWPerK: 30, designLossKw: 2.4 } },
};
const heated = (boilerKw: number) => ({
  Zone: { zone: {} },
  SpaceHeatSystem: { rads: { type: 'WetDistribution', Zone: 'zone', HeatSource: { name: 'boiler' }, design_flow_temp: 55,
    emitters: [{ wet_emitter_type: 'radiator', c: 0.05, n: 1.3 }] } },
  HeatSourceWet: { boiler: { type: 'Boiler', rated_power: boilerKw, modulation_load: 0.3 } },
});
const request = (model: Record<string, unknown>) => ({ targetBundleId: 'rust-fhs-a9', model });

function deferredProvider() {
  const calls: Array<{ resolve: (value: HeatingSizingComputation) => void; reject: (error: Error) => void; signal: AbortSignal }> = [];
  const provider: HeatingSizingProvider = {
    compute: vi.fn((_request, signal) => new Promise<HeatingSizingComputation>((resolve, reject) => calls.push({ resolve, reject, signal }))),
  };
  return { provider, calls };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('heating sizing slice', () => {
  it('sizes a prepared model with the provider and caches an unchanged model', async () => {
    const { provider, calls } = deferredProvider();
    const store = createGeometryStore({ heatingSizingProvider: provider });
    store.getState().requestHeatingSizing(request(heated(24)));
    expect(selectHeatingSizing(store.getState()).status).toBe('computing');
    calls[0].resolve({ status: 'ready', model: heated(24), designHeatLoss: loss });
    await flush();
    const ready = selectHeatingSizing(store.getState());
    expect(ready.status).toBe('ready');
    expect(ready.result?.heatSources[0]).toMatchObject({ name: 'boiler', verdict: 'too-big', designLossKw: 2.4 });

    store.getState().requestHeatingSizing(request(heated(24)));
    expect(provider.compute).toHaveBeenCalledTimes(1);
    expect(selectHeatingSizing(store.getState())).toBe(ready);
  });

  it('aborts and ignores the older computation when a newer model arrives', async () => {
    const { provider, calls } = deferredProvider();
    const store = createGeometryStore({ heatingSizingProvider: provider });
    store.getState().requestHeatingSizing(request(heated(24)));
    store.getState().requestHeatingSizing(request(heated(2)));
    expect(calls[0].signal.aborted).toBe(true);
    calls[1].resolve({ status: 'ready', model: heated(2), designHeatLoss: loss });
    calls[0].resolve({ status: 'ready', model: heated(24), designHeatLoss: loss });
    await flush();
    expect(selectHeatingSizing(store.getState()).result?.heatSources[0].verdict).toBe('too-small');
  });

  it('does not restart a computation for the model already computing', () => {
    const { provider } = deferredProvider();
    const store = createGeometryStore({ heatingSizingProvider: provider });
    store.getState().requestHeatingSizing(request(heated(24)));
    store.getState().requestHeatingSizing(request(heated(24)));
    expect(provider.compute).toHaveBeenCalledTimes(1);
  });

  it('is idle when the model has no space heating system', () => {
    const { provider } = deferredProvider();
    const store = createGeometryStore({ heatingSizingProvider: provider });
    store.getState().requestHeatingSizing(request({ Zone: { zone: {} }, SpaceHeatSystem: {} }));
    expect(selectHeatingSizing(store.getState())).toEqual({ status: 'idle' });
    expect(provider.compute).not.toHaveBeenCalled();
  });

  it('gives the reason when sizing is unavailable', async () => {
    // As the host's reason for a target build without the export (hem-target-runtime designHeatLoss.ts).
    const NO_EXPORT = `${NO_TARGET_SIZING_REASON_PREFIX} This HEM target build cannot compute the design heat loss. Released targets do not have it yet.`;
    const store = createGeometryStore();
    store.getState().requestHeatingSizing(request(heated(24)));
    expect(selectHeatingSizing(store.getState())).toEqual({ status: 'unavailable', reason: NO_HEATING_SIZING_PROVIDER });

    const { provider, calls } = deferredProvider();
    const hosted = createGeometryStore({ heatingSizingProvider: provider });
    hosted.getState().requestHeatingSizing(request(heated(24)));
    calls[0].resolve({ status: 'unavailable', reason: NO_EXPORT });
    await flush();
    expect(selectHeatingSizing(hosted.getState())).toMatchObject({ status: 'unavailable', reason: NO_EXPORT });

    hosted.getState().setHeatingSizingUnavailable('HEM 1.0.0a9 is not downloaded.');
    expect(selectHeatingSizing(hosted.getState())).toEqual({ status: 'unavailable', reason: 'HEM 1.0.0a9 is not downloaded.' });
  });

  it('shows a provider error and computes again on the next request', async () => {
    const { provider, calls } = deferredProvider();
    const store = createGeometryStore({ heatingSizingProvider: provider });
    store.getState().requestHeatingSizing(request(heated(24)));
    calls[0].reject(new Error('Static heat loss failed: no zones'));
    await flush();
    expect(selectHeatingSizing(store.getState())).toMatchObject({ status: 'error', reason: 'Static heat loss failed: no zones' });
    store.getState().requestHeatingSizing(request(heated(24)));
    expect(provider.compute).toHaveBeenCalledTimes(2);
  });

  it('keeps the last result while the next model computes, and the element warnings with it', async () => {
    const { provider, calls } = deferredProvider();
    const store = createGeometryStore({ heatingSizingProvider: provider });
    const boiler = { id: 'b', name: 'boiler', type: 'System', subcategory: 'HeatSourceWet' } as const;
    store.setState({ elementsById: { b: boiler }, elementIds: ['b'] });
    const sizingWarnings = () => store.getState().validateElement(boiler).warnings.filter((w) => w.source === 'sizing');
    store.getState().requestHeatingSizing(request(heated(2)));
    expect(sizingWarnings()).toEqual([]);
    calls[0].resolve({ status: 'ready', model: heated(2), designHeatLoss: loss });
    await flush();
    expect(sizingWarnings().map((w) => w.message.replace(/\u00a0/g, ' '))).toEqual([
      'boiler (System): The boiler is too small for the house on the design day.',
    ]);
    const { result } = selectHeatingSizing(store.getState());
    store.getState().requestHeatingSizing(request(heated(3)));
    expect(selectHeatingSizing(store.getState())).toMatchObject({ status: 'computing', result });
    expect(sizingWarnings()).toHaveLength(1);
    expect(store.getState().validateElement(boiler).hasIssues).toBe(false);
    calls[1].reject(new Error('failed'));
    await flush();
    expect(sizingWarnings()).toEqual([]);
  });

  it('clears to idle when a load clears the target check', async () => {
    const { provider, calls } = deferredProvider();
    const store = createGeometryStore({ heatingSizingProvider: provider });
    store.getState().setTargetValidation({ hemVersion: '1.0.0a9', items: [] });
    store.getState().requestHeatingSizing(request(heated(24)));
    calls[0].resolve({ status: 'ready', model: heated(24), designHeatLoss: loss });
    await flush();
    store.getState().setTargetValidation(null);
    expect(selectHeatingSizing(store.getState())).toEqual({ status: 'idle' });
  });
});
