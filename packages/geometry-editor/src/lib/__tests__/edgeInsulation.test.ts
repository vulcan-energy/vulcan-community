// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  edgeInsulationMethod,
  extraJsonEdgeInsulationToFormValues,
  formValuesToExtraJsonEdgeInsulation,
  switchEdgeInsulationMethod,
} from '../edgeInsulation';

const seg = (edgeThermalResistance = '', widthOrDepth = '', thickness = '', material = '', thermalConductivity = '') =>
  ({ edgeThermalResistance, widthOrDepth, thickness, material, thermalConductivity });

describe('edgeInsulation', () => {
  it('parses horizontal and vertical segments together', () => {
    expect(
      extraJsonEdgeInsulationToFormValues([
        { type: 'horizontal', edge_thermal_resistance: 1.25, width: 0.5 },
        { type: 'vertical', edge_thermal_resistance: 2, depth: 0.3 },
      ]),
    ).toEqual({ horizontal: seg('1.25', '0.5'), vertical: seg('2', '0.3') });
    expect(extraJsonEdgeInsulationToFormValues(null)).toEqual({ horizontal: seg(), vertical: seg() });
  });

  it('serializes null when both are empty, and both segments when both are filled', () => {
    expect(formValuesToExtraJsonEdgeInsulation({ horizontal: seg(), vertical: seg() })).toEqual({ ok: true, value: null });
    expect(
      formValuesToExtraJsonEdgeInsulation({ horizontal: seg('1', '0.5'), vertical: seg('2', '0.25') }),
    ).toEqual({
      ok: true,
      value: [
        { type: 'horizontal', edge_thermal_resistance: 1, width: 0.5 },
        { type: 'vertical', edge_thermal_resistance: 2, depth: 0.25 },
      ],
    });
  });

  it('is incomplete while a segment is half filled', () => {
    expect(
      formValuesToExtraJsonEdgeInsulation({ horizontal: seg('', '1'), vertical: seg() }),
    ).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('takes one of resistance and size on an existing building, where the other defaults', () => {
    const partial = { horizontal: seg('', '0.5'), vertical: seg('1.5', '') };
    expect(formValuesToExtraJsonEdgeInsulation({ horizontal: seg('1', ''), vertical: seg() }, true)).toEqual({ ok: false, reason: 'incomplete' });
    expect(formValuesToExtraJsonEdgeInsulation(partial)).toEqual({ ok: false, reason: 'incomplete' });
    expect(formValuesToExtraJsonEdgeInsulation(partial, true)).toEqual({
      ok: true,
      value: [{ type: 'horizontal', width: 0.5 }, { type: 'vertical', edge_thermal_resistance: 1.5 }],
    });
  });

  it('round-trips thickness, material and conductivity on an existing building', () => {
    const stated = [
      { type: 'horizontal', width: 0.6, thickness: 0.03, material: 'PIR' },
      { type: 'vertical', thickness: 0.05, material: 'XPS', thermal_conductivity: 0.034 },
    ];
    const form = extraJsonEdgeInsulationToFormValues(stated);
    expect(form).toEqual({ horizontal: seg('', '0.6', '0.03', 'PIR'), vertical: seg('', '', '0.05', 'XPS', '0.034') });
    expect(formValuesToExtraJsonEdgeInsulation(form, true)).toEqual({ ok: true, value: stated });
    // A horizontal width has no default.
    expect(formValuesToExtraJsonEdgeInsulation({ horizontal: seg('', '', '0.03'), vertical: seg() }, true)).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('states one method: resistance, else thickness and material; switching clears the other', () => {
    expect(edgeInsulationMethod({ horizontal: seg(), vertical: seg() })).toBeUndefined();
    expect(edgeInsulationMethod({ horizontal: seg('1', '0.5'), vertical: seg() })).toBe('resistance');
    expect(edgeInsulationMethod({ horizontal: seg(), vertical: seg('', '', '', 'EPS') })).toBe('thickness');
    const both = { horizontal: seg('1', '0.5'), vertical: seg('', '0.3', '0.05', 'EPS', '0.03') };
    expect(switchEdgeInsulationMethod(both, 'resistance')).toEqual({ horizontal: seg('1', '0.5'), vertical: seg('', '0.3') });
    expect(switchEdgeInsulationMethod(both, 'thickness')).toEqual({ horizontal: seg('', '0.5'), vertical: seg('', '0.3', '0.05', 'EPS', '0.03') });
  });

  it('states resistance, width or depth and thickness for a new build, never material or conductivity', () => {
    // An existing floor's values, after the building is switched to a new build.
    const form = extraJsonEdgeInsulationToFormValues([
      { type: 'horizontal', edge_thermal_resistance: 1, width: 0.5, thickness: 0.03, material: 'PIR', thermal_conductivity: 0.022 },
      { type: 'vertical', depth: 0.3, thickness: 0.05, material: 'EPS' },
    ]);
    expect(formValuesToExtraJsonEdgeInsulation(form)).toEqual({ ok: false, reason: 'incomplete' });
    form.vertical.edgeThermalResistance = '1.5';
    expect(formValuesToExtraJsonEdgeInsulation(form)).toEqual({
      ok: true,
      // The thickness is the floor calculation's d_n.
      value: [
        { type: 'horizontal', edge_thermal_resistance: 1, width: 0.5, thickness: 0.03 },
        { type: 'vertical', edge_thermal_resistance: 1.5, depth: 0.3, thickness: 0.05 },
      ],
    });
  });
});
