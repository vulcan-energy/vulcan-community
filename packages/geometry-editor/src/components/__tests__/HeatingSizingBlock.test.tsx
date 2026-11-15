// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HeatingSizing, HeatSourceSizing, SystemSizing } from '../../lib/heatingSizing';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import type { HeatingSizingState } from '../../stores/geometryStore/slices/heatingSizingSlice';
import { HeatingSizingBlock } from '../HeatingSizingBlock';

const system = (id: string, name: string, subcategory: string) => ({ id, name, type: 'System', subcategory }) as unknown as Element;
const emitter = (id: string, link: string) => ({ id, name: id, type: 'WetEmitter', subcategory: 'radiator', space_heat_system: link }) as unknown as Element;
const hp = system('e-hp', 'hp', 'HeatSourceWet');
const rads = system('e-rads', 'rads', 'SpaceHeatSystem');
const rad = emitter('e-rad', 'rads');
const elements = [hp, rads, rad];

const source: HeatSourceSizing = {
  name: 'hp', kind: 'HeatPump', systems: ['rads'], status: 'ok', reason: null, designLossKw: 5.6, flowTempC: 45, minKw: 3.5, maxKw: 6.5,
  verdict: 'ok', shortfallKw: null, balancePointC: null, hasBackupHeater: null, otherSystemsInZone: false, testPointC: -7, designBelowTestPointK: null, notes: [],
};
const sized: SystemSizing = {
  name: 'rads', kind: 'WetDistribution', zone: 'z', heatSources: ['hp'], status: 'ok', reason: null, designLossKw: 5.6, designFlowTempC: 45, flowTempAtDesignC: 45,
  outputAtDesignKw: 4.6, curve: Array.from({ length: 41 }, (_, i) => ({ flowC: 30 + i, outputKw: 0.2 * i + 1.6 })), minFlowC: 49, verdict: 'too-small', suggestedFlowC: null, notes: [],
};
const result = (over: Partial<HeatingSizing> = {}): HeatingSizing => ({
  coldestHourC: -6.5, setpointC: 21, weatherName: 'Bedford', zoneCount: 1, systems: [sized], heatSources: [source], notes: [], ...over,
});

function show(element: Element, heatingSizing: HeatingSizingState) {
  const store = createGeometryStore();
  store.setState({ heatingSizing });
  const view = render(
    <GeometryStoreProvider store={store}>
      <HeatingSizingBlock element={element} elements={elements} />
    </GeometryStoreProvider>,
  );
  return { store, ...view };
}

describe('HeatingSizingBlock', () => {
  it('shows nothing when idle, for a target that cannot be sized, and while computing the first result', () => {
    expect(show(hp, { status: 'idle' }).container).toBeEmptyDOMElement();
    expect(show(hp, { status: 'unavailable', reason: 'Heating sizing is not available for this target. This model uses Python FHS.' }).container).toBeEmptyDOMElement();
    expect(show(hp, { status: 'computing' }).container).toBeEmptyDOMElement();
  });

  it('shows one dim line for another unavailable reason (the store keeps these for a target that has sized)', () => {
    const { container } = show(hp, { status: 'unavailable', reason: 'Fix the model errors to size the heating.' });
    expect(container.textContent).toBe('Not sized: Fix the model errors to size the heating.');
  });

  it('draws the bar for a heat source, and the chart for a system', () => {
    const bar = show(hp, { status: 'ready', result: result() });
    expect(bar.getByText('Big enough')).toBeInTheDocument();
    expect(bar.getByText('6.5 kW on the design day · min 3.5 kW')).toBeInTheDocument();
    expect(bar.container.querySelector('svg')).toBeNull();
    const chart = show(rads, { status: 'ready', result: result() });
    expect(chart.getByText('Too small at 45 °C')).toBeInTheDocument();
    expect(chart.container.querySelector('svg')).not.toBeNull();
    expect(chart.container.textContent).not.toContain('You could lower');
  });

  it('shows the lower flow suggestion in place of the sentence', () => {
    const big = { ...sized, designFlowTempC: 55, flowTempAtDesignC: 55, outputAtDesignKw: 6.6, minFlowC: 48.2, verdict: 'ok' as const, suggestedFlowC: 49 };
    const view = show(rads, { status: 'ready', result: result({ systems: [big] }) });
    expect(view.getByText('You could lower the design flow temperature to 49 °C. The radiators still give enough heat, and the heat pump runs more efficiently.')).toBeInTheDocument();
    expect(view.container.textContent).not.toContain('Radiators give enough heat from');
  });

  it('shows only a dim line, never a pill, for an unsupported or unsized entry', () => {
    const unsupported = show(hp, { status: 'ready', result: result({ heatSources: [{ ...source, status: 'unsupported', reason: 'Only outside air heat pumps are sized.', verdict: null }] }) });
    expect(unsupported.container.textContent).toBe('Not sized: Only outside air heat pumps are sized.');
    expect(unsupported.container.querySelector('.status-pill')).toBeNull();
    const noData = show(rads, { status: 'ready', result: result({ systems: [{ ...sized, status: 'no-data', reason: 'The system has no emitters.', verdict: null }] }) });
    expect(noData.container.textContent).toBe('Not sized: The system has no emitters.');
    expect(noData.container.querySelector('svg')).toBeNull();
  });

  it('draws one block per plant, headed by its name, for a System holding several', () => {
    const plant = { ...hp, extra_json: { HeatSourceWet: { boiler: {}, hp: {} } } } as unknown as Element;
    const boiler: HeatSourceSizing = { ...source, name: 'boiler', kind: 'Boiler', verdict: 'too-big', minKw: 7, maxKw: 24 };
    const view = show(plant, { status: 'ready', result: result({ heatSources: [boiler, source] }) });
    expect(view.getAllByRole('heading').map((h) => h.textContent)).toEqual(['boiler', 'hp']);
    expect(view.getByText('Too big')).toBeInTheDocument();
    expect(view.getByText('Big enough')).toBeInTheDocument();
    expect(show(hp, { status: 'ready', result: result() }).container.querySelector('h4')).toBeNull();
  });

  it('keeps the previous result while computing', () => {
    expect(show(hp, { status: 'computing', result: result() }).getByText('Big enough')).toBeInTheDocument();
  });

  it('gives a WetEmitter one line from its system, only when the system was sized', () => {
    const ok = show(rad, { status: 'ready', result: result() });
    expect(ok.container.textContent).toContain('Too small at 45 °C');
    expect(ok.container.textContent).toContain('Its system: radiators give 4.6 kW at 45 °C flow. The house needs 5.6 kW.');
    expect(ok.container.querySelector('svg')).toBeNull();
    expect(show(rad, { status: 'ready', result: result({ systems: [{ ...sized, status: 'unsupported', reason: 'x', verdict: null }] }) }).container).toBeEmptyDOMElement();
    expect(show(rad, { status: 'error', reason: 'boom' }).container).toBeEmptyDOMElement();
  });
});
