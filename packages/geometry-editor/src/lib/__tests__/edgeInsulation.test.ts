// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  extraJsonEdgeInsulationToFormValues,
  formValuesToExtraJsonEdgeInsulation,
} from '../edgeInsulation';

const seg = (edgeThermalResistance = '', widthOrDepth = '') => ({ edgeThermalResistance, widthOrDepth });

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
});
