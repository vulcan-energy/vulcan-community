// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { NO_TARGET_SIZING_REASON_PREFIX, sizeHeating, type HeatSourceSizing, type SystemSizing } from '../heatingSizing';
import {
  chooseLabel,
  designConditions,
  emitterLineView,
  fmtTemp,
  heatSourceView,
  sizingGate,
  systemView,
  yTickStep,
  type HeatSourceView,
  type SystemView,
  heatSourceGivesSentence,
} from '../heatingSizingView';

/** Non-breaking spaces read as spaces. */
const plain = (text: string | null | undefined): string => (text ?? '').replace(/\u00a0/g, ' ');
const conditions = { coldestHourC: -6.5, setpointC: 21, weatherName: 'Bedford', zoneCount: 1 };
const src = (over: Partial<HeatSourceSizing> = {}): HeatSourceSizing => ({
  name: 'hp', kind: 'HeatPump', systems: ['rads'], status: 'ok', reason: null, designLossKw: 5.6, flowTempC: 45,
  minKw: 3.5, maxKw: 6.5, verdict: 'ok', shortfallKw: null, balancePointC: null, hasBackupHeater: null, otherSystemsInZone: false,
  testPointC: -7, designBelowTestPointK: null, notes: [], ...over,
});
/** Emitter output rising 0.2 kW per K from 1.6 kW at 30 C, 1 K steps from 30 C to `to` C. */
const curve = (to = 70, at: (f: number) => number = (f) => 0.2 * (f - 30) + 1.6) =>
  Array.from({ length: to - 29 }, (_, i) => ({ flowC: 30 + i, outputKw: at(30 + i) }));
const sys = (over: Partial<SystemSizing> = {}): SystemSizing => ({
  name: 'rads', kind: 'WetDistribution', zone: 'zone', heatSources: ['hp'], status: 'ok', reason: null,
  designLossKw: 5.6, designFlowTempC: 45, flowTempAtDesignC: 45, outputAtDesignKw: 4.6, curve: curve(), minFlowC: 49,
  verdict: 'too-small', suggestedFlowC: null, notes: [], ...over,
});
const hsv = (v: unknown) => v as HeatSourceView;
const chartOf = (v: unknown) => (v as SystemView).chart;
const sv = (entry: SystemSizing, zoneCount = 1) => systemView(entry, { zoneCount });

describe('fmtTemp', () => {
  it('uses the typographic minus, one decimal at most and a degree sign', () => {
    expect(fmtTemp(-6.54)).toBe('\u22126.5\u00a0\u00b0C');
    expect(fmtTemp(21)).toBe('21\u00a0\u00b0C');
    expect(fmtTemp(-0.04)).toBe('0\u00a0\u00b0C');
  });
});

describe('sizingGate', () => {
  it('hides on idle, on a target without sizing and while computing the first result', () => {
    expect(sizingGate({ status: 'idle' }).kind).toBe('hidden');
    expect(sizingGate({ status: 'unavailable', reason: `${NO_TARGET_SIZING_REASON_PREFIX} This model uses Python FHS.` }).kind).toBe('hidden');
    expect(sizingGate({ status: 'computing' }).kind).toBe('hidden');
  });
  it('gives one line for another unavailable reason or an error', () => {
    expect(sizingGate({ status: 'unavailable', reason: 'HEM 1.0.0a9 is not downloaded.' })).toEqual({ kind: 'note', text: 'Not sized: HEM 1.0.0a9 is not downloaded.' });
    expect(sizingGate({ status: 'error', reason: 'boom' })).toEqual({ kind: 'note', text: 'Not sized: boom.' });
  });
});

describe('heatSourceView', () => {
  it('ok: green, no sentence, range and need as percent of a track 8% longer than the larger', () => {
    const v = hsv(heatSourceView(src(), conditions));
    expect(v.pill).toEqual({ label: 'Big enough', tone: 'success' });
    expect(v.sentence).toBeNull();
    expect(v.bar.segStartPct).toBeCloseTo((3.5 / (6.5 * 1.08)) * 100, 6);
    expect(v.bar.segEndPct).toBeCloseTo((6.5 / (6.5 * 1.08)) * 100, 6);
    expect(v.bar.markerPct).toBeCloseTo((5.6 / (6.5 * 1.08)) * 100, 6);
    expect(plain(v.bar.markerLabel)).toBe('House needs 5.6 kW');
    expect(plain(v.bar.segLabel)).toBe('6.5 kW on the design day · min 3.5 kW');
    expect(plain(v.basis)).toBe('Coldest hour in the Bedford weather file: \u22126.5 \u00b0C outside, 21 \u00b0C inside.');
  });
  it('too small: the temperature leads, then the backup heater or the cold rooms', () => {
    const small = { verdict: 'too-small' as const, designLossKw: 9.1, maxKw: 6.5, balancePointC: -2.1 };
    expect(plain(hsv(heatSourceView(src({ ...small, hasBackupHeater: true }), conditions)).sentence))
      .toBe('Below \u22122.1 \u00b0C outside, the backup heater covers the gap.');
    const none = hsv(heatSourceView(src({ ...small, hasBackupHeater: false }), conditions));
    expect(plain(none.sentence)).toBe('Below \u22122.1 \u00b0C outside, rooms run below set-point.');
    expect(plain(hsv(heatSourceView(src({ ...small, hasBackupHeater: false, otherSystemsInZone: true }), conditions)).sentence))
      .toBe('Below \u22122.1 \u00b0C outside, another heating system in the zone must cover the gap.');
    expect(plain(hsv(heatSourceView(src({ ...small, hasBackupHeater: true, otherSystemsInZone: true }), conditions)).sentence))
      .toBe('Below \u22122.1 \u00b0C outside, the backup heater covers the gap.');
    expect(none.pill.tone).toBe('error');
    expect(none.bar.markerPct).toBeCloseTo(100 / 1.08, 6);
  });
  it('too big: amber and one sentence', () => {
    const v = hsv(heatSourceView(src({ verdict: 'too-big', designLossKw: 2, minKw: 3 }), conditions));
    expect(v.pill).toEqual({ label: 'Too big', tone: 'warning' });
    expect(v.sentence).toBe('It will switch on and off all year.');
  });
  it('no minimum: the label drops the minimum; the segment starts at zero', () => {
    const v = hsv(heatSourceView(src({ minKw: null }), conditions));
    expect(plain(v.bar.segLabel)).toBe('6.5 kW on the design day');
    expect(v.bar.segStartPct).toBe(0);
  });
  it('gives sentence: design-day size first, then the turn-down', () => {
    expect(heatSourceGivesSentence({ kind: 'HeatPump', minKw: 3.5 }, 8.8)).toBe('Heat pump gives 8.8\u00a0kW on the design day and turns down to 3.5\u00a0kW.');
    expect(heatSourceGivesSentence({ kind: 'Boiler', minKw: null }, 8.8)).toBe('Boiler gives 8.8\u00a0kW on the design day.');
  });
  it('basis adds the test point and the system count', () => {
    const v = hsv(heatSourceView(src({ designBelowTestPointK: 0.5, systems: ['a', 'b'] }), conditions));
    expect(plain(v.basis)).toBe('Coldest hour in the Bedford weather file: \u22126.5 \u00b0C outside, 21 \u00b0C inside. Output declared at \u22127 \u00b0C. Serves 2 systems.');
  });
  it('says zone, not house, when the model has several zones', () => {
    const v = hsv(heatSourceView(src(), { ...conditions, zoneCount: 2 }));
    expect(plain(v.bar.markerLabel)).toBe('Zone needs 5.6 kW');
  });
  it('keeps both labels inside the track at either end', () => {
    const left = hsv(heatSourceView(src({ designLossKw: 0.01, minKw: 0, maxKw: 0.3 }), conditions)).bar;
    expect(left.markerLabelShiftPct).toBeGreaterThanOrEqual(-100);
    expect(left.markerLabelShiftPct).toBeLessThanOrEqual(0);
    const right = hsv(heatSourceView(src({ verdict: 'too-small', designLossKw: 99.9, maxKw: 1, minKw: 0.5, balancePointC: 1 }), conditions)).bar;
    expect(right.markerLabelShiftPct).toBeLessThan(-90);
  });
  it('gives only a dim line when not ok', () => {
    expect(heatSourceView(src({ status: 'unsupported', reason: 'Only outside air heat pumps are sized.' }), conditions))
      .toEqual({ kind: 'note', text: 'Not sized: Only outside air heat pumps are sized.' });
  });
});

describe('designConditions', () => {
  it('names the weather file, and keeps a long name in one sentence', () => {
    expect(plain(designConditions({ ...conditions, weatherName: 'Bedford' }))).toContain('in the Bedford weather file:');
    expect(designConditions({ ...conditions, weatherName: 'Glasgow Renfrewshire Airport TRY 2050 high emissions' }))
      .toContain('in the Glasgow Renfrewshire Airport TRY 2050 high emissions weather file:');
  });
});

describe('yTickStep', () => {
  it.each([
    [0.63, 0.2, 1], [3.2, 1, 0], [6.3, 2, 0], [15.75, 5, 0], [31.5, 10, 0], [105, 50, 0], [4.2, 2, 0],
  ])('%s kW range: step %s, %s decimals', (max, step, decimals) => {
    const t = yTickStep(max);
    expect(t.step).toBeCloseTo(step as number, 9);
    expect(t.decimals).toBe(decimals === 1 ? 1 : 0);
  });
  it('whole numbers whenever the range reaches 4 kW', () => {
    for (let max = 4; max < 400; max += 0.37) {
      const { step, decimals } = yTickStep(max);
      expect(Number.isInteger(step)).toBe(true);
      expect(decimals).toBe(0);
    }
  });
});

describe('chart height', () => {
  it('fits 292 x 148 with the plot 88 high: top and axis-title gaps trimmed, text unchanged', () => {
    const c = chartOf(sv(sys()));
    expect([c.width, c.height]).toEqual([292, 148]);
    expect(c.plot.y1 - c.plot.y0).toBe(88);
    expect(c.plot.radius).toBe(8);
  });
});

describe('systemView', () => {
  it('too small with a crossing: pill at the design flow, sentence, zones split at the crossing', () => {
    const v = sv(sys()) as SystemView;
    expect(plain(v.pill.label)).toBe('Too small at 45 \u00b0C');
    expect(v.pill.tone).toBe('error');
    expect(plain(v.sentence)).toBe('Radiators give enough heat from 49 \u00b0C flow.');
    const c = v.chart;
    expect(c.width).toBe(292);
    expect(c.redZone!.x + c.redZone!.width).toBeCloseTo(c.greenZone!.x, 6);
    expect(c.cross!.x).toBeCloseTo(c.greenZone!.x, 6);
    expect(c.cross!.y).toBe(c.designLineY);
    expect(c.xTicks.map((t) => t.text)).toEqual(['30', '40', '50', '60', '70']);
  });
  it('null: all red up to the search limit, no crossing', () => {
    const v = sv(sys({ minFlowC: null })) as SystemView;
    expect(plain(v.sentence)).toBe('Radiators do not give enough heat at any flow temperature up to 100 \u00b0C.');
    expect(v.chart.greenZone).toBeNull();
    expect(v.chart.cross).toBeNull();
    expect(v.chart.greenLabel).toBeNull();
    expect(v.chart.redLabel).not.toBeNull();
  });
  it('null with a design flow above the search limit names that flow', () => {
    const v = sv(sys({ minFlowC: null, flowTempAtDesignC: 104, curve: curve(104) })) as SystemView;
    expect(plain(v.sentence)).toContain('up to 104 \u00b0C.');
  });
  it('minFlowC at or below the first point: green everywhere, no crossing, real first flow named', () => {
    const v = sv(sys({ minFlowC: 22.4, verdict: 'ok', outputAtDesignKw: 7 })) as SystemView;
    expect(plain(v.sentence)).toBe('Radiators give enough heat at any flow temperature from 30 \u00b0C.');
    expect(v.chart.redZone).toBeNull();
    expect(v.chart.cross).toBeNull();
    expect(v.chart.dot!.tone).toBe('success');
  });
  it('fractional minFlowC keeps its decimal and sits between the whole-degree points', () => {
    const v = sv(sys({ minFlowC: 49.3 })) as SystemView;
    expect(plain(v.sentence)).toBe('Radiators give enough heat from 49.3 \u00b0C flow.');
    const c = v.chart;
    expect(c.cross!.x).toBeGreaterThan(c.plot.x0 + ((49 - 30) / 40) * (c.plot.x1 - c.plot.x0));
    expect(c.cross!.x).toBeLessThan(c.plot.x0 + ((50 - 30) / 40) * (c.plot.x1 - c.plot.x0));
  });
  it('the x domain follows the curve: design flow 80 draws to 80, dot and ticks included', () => {
    const v = sv(sys({ flowTempAtDesignC: 80, curve: curve(80), outputAtDesignKw: 11.6, minFlowC: 49, verdict: 'ok' })) as SystemView;
    expect(v.chart.xTicks.map((t) => t.text)).toEqual(['30', '40', '50', '60', '70', '80']);
    expect(v.chart.dot!.x).toBe(v.chart.plot.x1 - 7);
    expect(v.chart.cross!.x).toBeCloseTo(v.chart.plot.x0 + 7 + ((49 - 30) / 50) * (v.chart.plot.x1 - v.chart.plot.x0 - 14), 6);
  });
  it('minFlowC past the last point: sentence names it, the visible zone is all red, no crossing', () => {
    const v = sv(sys({ minFlowC: 85 })) as SystemView;
    expect(plain(v.sentence)).toBe('Radiators give enough heat from 85 \u00b0C flow.');
    expect(v.chart.greenZone).toBeNull();
    expect(v.chart.cross).toBeNull();
    expect(v.chart.dot!.tone).toBe('error');
  });
  it('drops a zone label whose zone is too narrow', () => {
    const c = chartOf(sv(sys({ minFlowC: 31 })));
    expect(c.redLabel).toBeNull();
    expect(c.greenLabel).not.toBeNull();
  });
  it('puts the design dot on the plot edge at 30 and 70, flipping its label left at the right edge', () => {
    const at30 = chartOf(sv(sys({ flowTempAtDesignC: 30, outputAtDesignKw: 1.6 })));
    expect(at30.dot!.x).toBe(at30.plot.x0 + 7);
    const at70 = chartOf(sv(sys({ flowTempAtDesignC: 70, outputAtDesignKw: 9.6, verdict: 'ok', minFlowC: 49 })));
    expect(at70.dot!.x).toBe(at70.plot.x1 - 7);
    expect(at70.dot!.label.anchor).toBe('end');
  });
  it('whole-number y ticks from zero when the range allows, one decimal below', () => {
    const far = chartOf(sv(sys({ designLossKw: 40, minFlowC: null })));
    expect(far.yTicks.map((t) => t.text).every((t) => /^\d+$/.test(t))).toBe(true);
    const nullCase = chartOf(sv(sys({ minFlowC: null, curve: curve(70, (f) => 0.5 + 0.1 * (f - 30)), outputAtDesignKw: 2, designLossKw: 5.6 })));
    expect(nullCase.yTicks.map((t) => t.text).every((t) => /^\d+$/.test(t))).toBe(true);
    const tiny = chartOf(sv(sys({ designLossKw: 0.1, curve: curve(70, (f) => 0.005 * (f - 30) + 0.05), outputAtDesignKw: 0.1, minFlowC: 30, verdict: 'ok' })));
    expect(tiny.yTicks[0].text).toBe('0.0');
    expect(tiny.yTicks.every((t) => /^\d\.\d$/.test(t.text))).toBe(true);
  });
  it('labels say zone when the model has several zones', () => {
    expect(chartOf(sv(sys(), 2)).needLabel.text).toContain('Zone needs');
  });
  it('pill, dot colour and sentence agree for every design flow against every minimum', () => {
    for (const flow of [30, 45, 49.3, 70, 80]) {
      for (const minFlowC of [null, 20, 30, 49.3, 70, 85, 99.9]) {
        const verdict = minFlowC !== null && flow >= minFlowC ? 'ok' as const : 'too-small' as const;
        const view = sv(sys({ flowTempAtDesignC: flow, curve: curve(Math.max(70, Math.ceil(flow))), minFlowC, verdict, outputAtDesignKw: 5 })) as SystemView;
        const tone = verdict === 'ok' ? 'success' : 'error';
        expect(view.pill.tone).toBe(tone);
        expect(view.chart.dot?.tone ?? tone).toBe(tone);
        // A pill that says big enough never sits under a sentence that says the radiators fall short at the design flow.
        const sentence = plain(view.sentence);
        if (verdict === 'ok') expect(sentence).not.toContain('do not give enough heat');
        if (minFlowC === null) expect(sentence).toContain('do not give enough heat');
      }
    }
  });
  it('gives only a dim line when not ok', () => {
    expect(sv(sys({ status: 'no-data', reason: 'No emitters.', verdict: null }))).toEqual({ kind: 'note', text: 'Not sized: No emitters.' });
  });
});

describe('the suggested lower flow', () => {
  it('replaces the sentence with one sentence and one number', () => {
    const v = sv(sys({ verdict: 'ok', designFlowTempC: 55, flowTempAtDesignC: 55, outputAtDesignKw: 9, minFlowC: 38.2, suggestedFlowC: 39 })) as SystemView;
    expect(plain(v.sentence)).toBe('You could lower the design flow temperature to 39 °C. The radiators still give enough heat, and the heat pump runs more efficiently.');
    expect(plain((sv(sys({ verdict: 'ok', minFlowC: 38.2, outputAtDesignKw: 9 })) as SystemView).sentence)).toBe('Radiators give enough heat from 38.2 °C flow.');
  });
});

describe('emitterLineView', () => {
  it('states its system in one line', () => {
    const line = emitterLineView(sys(), { zoneCount: 1 })!;
    expect(line.pill.tone).toBe('error');
    expect(plain(line.pill.label)).toBe('Too small at 45 \u00b0C');
    expect(plain(line.sentence)).toBe('Its system: radiators give 4.6 kW at 45 \u00b0C flow. The house needs 5.6 kW.');
  });
  it('says zone when the model has several', () => {
    expect(plain(emitterLineView(sys(), { zoneCount: 3 })!.sentence)).toContain('The zone needs 5.6 kW.');
  });
  it('says nothing unless the system was sized', () => {
    expect(emitterLineView(sys({ status: 'unsupported', reason: 'x', verdict: null }), { zoneCount: 1 })).toBeNull();
  });
});

describe('the view reads the real sizing', () => {
  it('a sized model gives a chart whose zones agree with its verdict', () => {
    const model = {
      Zone: { z: {} },
      SpaceHeatSystem: { rads: { type: 'WetDistribution', Zone: 'z', HeatSource: { name: 'b' }, design_flow_temp: 80,
        temp_diff_emit_dsgn: 10, variable_flow: true, min_flow_rate: 3, max_flow_rate: 18,
        emitters: [{ wet_emitter_type: 'radiator', c: 0.05, n: 1.3 }] } },
      HeatSourceWet: { b: { type: 'Boiler', rated_power: 24, modulation_load: 0.3 } },
    };
    const loss = { coldestHourC: -3, setpointC: 21, weatherName: 'Bedford', zones: { z: { htcWPerK: 200, fabricWPerK: 100, thermalBridgesWPerK: 20, ventilationWPerK: 80, designLossKw: 4.8 } } };
    const result = sizeHeating(model, loss);
    const view = systemView(result.systems[0], result) as SystemView;
    expect(view.chart.xTicks.at(-1)!.text).toBe('80');
    expect(view.chart.dot!.tone).toBe(result.systems[0].verdict === 'ok' ? 'success' : 'error');
  });
});

/** The FHS demo radiators (four, variable flow 3 to 18 l/min, 10 K) against 8.96 kW, sized by the engine formula. */
function fhsDemo(designFlowC: number): SystemSizing {
  return sizeHeating({
    SpaceHeatSystem: { r: { type: 'WetDistribution', Zone: 'z', HeatSource: { name: 'hp' }, design_flow_temp: designFlowC, temp_diff_emit_dsgn: 10,
      variable_flow: true, min_flow_rate: 3, max_flow_rate: 18, ecodesign_controller: { ecodesign_control_class: 1 },
      emitters: [0.08, 0.1, 0.08, 0.1].map((c) => ({ wet_emitter_type: 'radiator', c, n: c === 0.08 ? 1.2 : 1.3 })) } },
  }, { coldestHourC: -6.5, setpointC: 21, weatherName: 'Bedford', zones: { z: { htcWPerK: 325.7, fabricWPerK: 0, thermalBridgesWPerK: 0, ventilationWPerK: 0, designLossKw: 8.96 } } }).systems[0];
}

describe('"Your design" label in a plot corner', () => {
  const bx = (c: ReturnType<typeof chartOf>) => c.dot!.label;
  // [name, entry]: the corner and far-from-curve cases the harness flagged.
  const cases: [string, SystemSizing][] = [
    ['minFlowC null', sys({ minFlowC: null, curve: curve(70, (f) => 0.1 * (f - 30) + 0.5), outputAtDesignKw: 1.5 })],
    ['design flow 30', sys({ flowTempAtDesignC: 30, outputAtDesignKw: 1.6 })],
    ['need far above curve', sys({ designLossKw: 28, minFlowC: null, outputAtDesignKw: 4.6 })],
    ['need near zero', sys({ designLossKw: 0.1, minFlowC: 30, verdict: 'ok', outputAtDesignKw: 4.6 })],
    ['design flow 80', sys({ flowTempAtDesignC: 80, curve: curve(80), outputAtDesignKw: 11.9, minFlowC: 49, verdict: 'ok' })],
    ['design flow 80 too small', sys({ flowTempAtDesignC: 80, curve: curve(80), outputAtDesignKw: 11.9, designLossKw: 14, minFlowC: 86.5 })],
    // The FHS demo radiators at 45 C on the engine's curve: the curve leaves no room beside the dot.
    ['FHS demo radiators at 45 C', fhsDemo(45)],
    // The real-app "too small at 55 C" state: the demo curve x 0.38, so it crosses 9.0 kW at 59 C. The
    // left end of the dashed line is under the curve; the only clear spot for "House needs" is below it.
    ['FHS demo curve x 0.38, too small at 55 C', (() => {
      const s = fhsDemo(55);
      const curve = s.curve.map((p) => ({ flowC: p.flowC, outputKw: p.outputKw * 0.38 }));
      return { ...s, curve, outputAtDesignKw: curve[25].outputKw, minFlowC: 59, verdict: 'too-small' as const, suggestedFlowC: null };
    })()],
    // The real-app state with the curve x 0.18: "House needs" fits only below the line on the left,
    // where "Your design" beside its dot would sit on it.
    ['FHS demo curve x 0.18, never enough', (() => {
      const s = fhsDemo(55);
      const curve = s.curve.map((p) => ({ flowC: p.flowC, outputKw: p.outputKw * 0.18 }));
      return { ...s, curve, outputAtDesignKw: curve[25].outputKw, minFlowC: null, verdict: 'too-small' as const, suggestedFlowC: null };
    })()],
  ];
  /** Curve vertices from the path, sampled every px. */
  const curveSamples = (path: string) => {
    const v = [...path.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < v.length; i++) for (let k = 0; k < 8; k++) out.push({ x: v[i].x + ((v[i + 1].x - v[i].x) * k) / 8, y: v[i].y + ((v[i + 1].y - v[i].y) * k) / 8 });
    return out;
  };
  it.each(cases)('%s: both labels stay off the curve, with a leader when not beside the dot', (_n, entry) => {
    const c = chartOf(sv(entry));
    const l = bx(c);
    const w = l.text.length * 12 * 0.55;
    const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
    const samples = curveSamples(c.curvePath);
    const hits = samples.filter((p) => p.x >= x0 && p.x <= x0 + w && p.y >= l.y - 10 && p.y <= l.y + 2);
    expect(hits).toEqual([]);
    const n = c.needLabel;
    const nw = n.text.length * 12 * 0.55;
    expect(samples.filter((p) => p.x >= n.x && p.x <= n.x + nw && p.y >= n.y - 10 && p.y <= n.y + 2)).toEqual([]);
    // The two labels' text boxes (12 px font: 11 px above the baseline, 3 below) do not touch.
    const apart = x0 + w <= n.x || n.x + nw <= x0 || l.y + 3 <= n.y - 11 || n.y + 3 <= l.y - 11;
    expect(apart).toBe(true);
    expect(x0).toBeGreaterThanOrEqual(c.plot.x0);
    expect(x0 + w).toBeLessThanOrEqual(c.plot.x1);
    if (l.leader) {
      expect(l.leader.len).toBeLessThanOrEqual(60);
      expect(l.leader.len).toBeGreaterThan(9);
    }
  });
  it('design flow 80: the free space left of the dot and above the curve wins over any leader', () => {
    const c = chartOf(sv(sys({ flowTempAtDesignC: 80, curve: curve(80), outputAtDesignKw: 11.9, minFlowC: 49, verdict: 'ok' })));
    expect(c.dot!.label.leader).toBeUndefined();
    expect(c.dot!.label.anchor).toBe('end');
    expect(c.dot!.label.x).toBeLessThan(c.dot!.x);
  });
  it('a dot on the domain edge, its curve ends and the first point sit inside the plot', () => {
    for (const flow of [30, 70, 80]) {
      const c = chartOf(sv(sys({ flowTempAtDesignC: flow, curve: curve(Math.max(flow, 70)), outputAtDesignKw: 5, minFlowC: 49 })));
      expect(c.dot!.x - 5).toBeGreaterThanOrEqual(c.plot.x0);
      expect(c.dot!.x + 5).toBeLessThanOrEqual(c.plot.x1);
      expect(c.dot!.y - 5).toBeGreaterThanOrEqual(c.plot.y0);
      expect(c.dot!.y + 5).toBeLessThanOrEqual(c.plot.y1);
    }
  });
  it('a label beside its dot needs no leader', () => {
    expect(bx(chartOf(sv(sys()))).leader).toBeUndefined();
  });
});

describe('chooseLabel', () => {
  const bounds = { x: 0, y: 0, w: 300, h: 100 };
  const at = (x: number, y: number) => ({ text: 'House needs 5.6 kW', x, y, anchor: 'start' as const });
  const none = { rects: [], points: [] };

  it.each([
    ['takes the first candidate when nothing is in the way', [at(10, 20), at(10, 60)], none, 0],
    ['skips one that covers a rect', [at(10, 20), at(10, 60)], { rects: [{ x: 0, y: 10, w: 300, h: 6 }], points: [] }, 1],
    ['skips one that covers the curve', [at(10, 20), at(10, 60)], { rects: [], points: [{ x: 50, y: 15 }] }, 1],
    ['skips one outside the bounds', [at(250, 20), at(10, 20)], none, 1],
    ['takes the lesser of two curve crossings', [at(10, 20), at(10, 60)], { rects: [], points: [{ x: 50, y: 15 }, { x: 60, y: 14 }, { x: 70, y: 52 }] }, 1],
    ['takes the first of equals', [at(10, 60), at(10, 20)], { rects: [], points: [{ x: 50, y: 15 }, { x: 50, y: 55 }] }, 0],
  ])('%s', (_name, candidates, obstacles, expected) => {
    expect(chooseLabel(candidates, 12, bounds, obstacles)).toBe(candidates[expected]);
  });

  it('among spots that cover something, the one covering least wins', () => {
    const candidates = [at(10, 20), at(10, 60)];
    const obstacles = { rects: [{ x: 0, y: 50, w: 300, h: 6 }], points: [{ x: 50, y: 15 }, { x: 60, y: 15 }] };
    expect(chooseLabel(candidates, 12, bounds, obstacles)).toBe(candidates[0]);
  });
});

describe('chooseLabel leaders', () => {
  const bounds = { x: 0, y: 0, w: 300, h: 100 };
  const near = { text: 'Your design: 4.6 kW', x: 20, y: 40, anchor: 'start' as const };
  const led = { ...near, y: 80, leader: { x: 18, y: 76, len: 30 } };
  const curvePoints = Array.from({ length: 40 }, (_, i) => ({ x: 20 + i * 3, y: 36 }));
  it('a leader label beats a heavy curve crossing', () => {
    expect(chooseLabel([near, led], 12, bounds, { rects: [], points: curvePoints })).toBe(led);
  });
  it('but not a clear spot beside the dot', () => {
    expect(chooseLabel([led, near], 12, bounds, { rects: [], points: [] })).toBe(near);
  });
});

describe('chooseLabel tiers', () => {
  const bounds = { x: 0, y: 0, w: 300, h: 100 };
  const label = (y: number, tier: number) => ({ text: 'House needs 5.6 kW', x: 10, y, anchor: 'start' as const, tier });
  it('takes the spot next to the line over a free spot far from it when both are clear', () => {
    expect(chooseLabel([label(80, 1), label(30, 0)], 12, bounds, { rects: [], points: [] })).toEqual(label(30, 0));
  });
  it('never takes a spot on the curve while a clear one exists, however far', () => {
    const adjacent = label(30, 0);
    const far = label(80, 1);
    expect(chooseLabel([adjacent, far], 12, bounds, { rects: [], points: [{ x: 50, y: 25 }, { x: 60, y: 24 }] })).toBe(far);
  });
  it('leaves the line only when every adjacent spot is blocked', () => {
    const above = label(30, 0);
    const below = label(50, 0);
    const far = label(85, 1);
    const blocked = { rects: [{ x: 0, y: 14, w: 300, h: 20 }, { x: 0, y: 34, w: 300, h: 20 }], points: [] };
    expect(chooseLabel([above, below, far], 12, bounds, blocked)).toBe(far);
  });
  it('a name beside its own dot but over the curve loses to a clear spot further away', () => {
    const nearDot = { text: 'Your design: 4.6 kW', x: 20, y: 40, anchor: 'start' as const, tier: 0 };
    const farAway = { ...nearDot, y: 85, tier: 1 };
    const curvePoints = Array.from({ length: 40 }, (_, i) => ({ x: 20 + i * 3, y: 36 }));
    expect(chooseLabel([nearDot, farAway], 12, bounds, { rects: [], points: curvePoints })).toBe(farAway);
  });
});

describe('chooseLabel with another label', () => {
  const bounds = { x: 0, y: 0, w: 300, h: 100 };
  const at = (x: number, y: number) => ({ text: 'House needs 5.6 kW', x, y, anchor: 'start' as const });
  it('accepts a few px of padding overlap with a label rather than crossing the curve', () => {
    const candidates = [at(10, 20), at(10, 60)];
    const other = { x: 0, y: 28, w: 300, h: 20, soft: true }; // overlaps candidate 0's padded rect (y 6..26... +) by <= 8
    const obstacles = { rects: [{ ...other, y: 22 }], points: [{ x: 50, y: 55 }] };
    expect(chooseLabel(candidates, 12, bounds, obstacles)).toBe(candidates[0]);
  });
  it('refuses a real overlap with a label', () => {
    const candidates = [at(10, 20), at(10, 60)];
    const obstacles = { rects: [{ x: 0, y: 8, w: 300, h: 20, soft: true }], points: [{ x: 50, y: 55 }] };
    expect(chooseLabel(candidates, 12, bounds, obstacles)).toBe(candidates[1]);
  });
});
