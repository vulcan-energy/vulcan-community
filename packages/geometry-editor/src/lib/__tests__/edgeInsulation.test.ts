// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  extraJsonEdgeInsulationToFormValues,
  formValuesToExtraJsonEdgeInsulation,
} from '../edgeInsulation';

describe('edgeInsulation', () => {
  describe('extraJsonEdgeInsulationToFormValues', () => {
    it('returns empty form for null / undefined / non-array', () => {
      expect(extraJsonEdgeInsulationToFormValues(null)).toEqual({
        orientation: '',
        edgeThermalResistance: '',
        widthOrDepth: '',
      });
      expect(extraJsonEdgeInsulationToFormValues(undefined)).toEqual({
        orientation: '',
        edgeThermalResistance: '',
        widthOrDepth: '',
      });
      expect(extraJsonEdgeInsulationToFormValues([])).toEqual({
        orientation: '',
        edgeThermalResistance: '',
        widthOrDepth: '',
      });
    });

    it('maps first horizontal segment', () => {
      expect(
        extraJsonEdgeInsulationToFormValues([
          { type: 'horizontal', edge_thermal_resistance: 1.25, width: 0.5 },
        ]),
      ).toEqual({
        orientation: 'horizontal',
        edgeThermalResistance: '1.25',
        widthOrDepth: '0.5',
      });
    });

    it('maps first vertical segment', () => {
      expect(
        extraJsonEdgeInsulationToFormValues([
          { type: 'vertical', edge_thermal_resistance: 2, depth: 0.3 },
        ]),
      ).toEqual({
        orientation: 'vertical',
        edgeThermalResistance: '2',
        widthOrDepth: '0.3',
      });
    });

    it('ignores extra array entries (first wins)', () => {
      expect(
        extraJsonEdgeInsulationToFormValues([
          { type: 'horizontal', edge_thermal_resistance: 1, width: 1 },
          { type: 'vertical', edge_thermal_resistance: 9, depth: 9 },
        ]),
      ).toEqual({
        orientation: 'horizontal',
        edgeThermalResistance: '1',
        widthOrDepth: '1',
      });
    });
  });

  describe('formValuesToExtraJsonEdgeInsulation', () => {
    it('serializes null when orientation is empty', () => {
      expect(
        formValuesToExtraJsonEdgeInsulation({
          orientation: '',
          edgeThermalResistance: '1',
          widthOrDepth: '1',
        }),
      ).toEqual({ ok: true, value: null });
    });

    it('returns incomplete when orientation set but numbers invalid', () => {
      expect(
        formValuesToExtraJsonEdgeInsulation({
          orientation: 'horizontal',
          edgeThermalResistance: '',
          widthOrDepth: '1',
        }),
      ).toEqual({ ok: false, reason: 'incomplete' });
    });

    it('serializes horizontal array', () => {
      expect(
        formValuesToExtraJsonEdgeInsulation({
          orientation: 'horizontal',
          edgeThermalResistance: '1',
          widthOrDepth: '0.5',
        }),
      ).toEqual({
        ok: true,
        value: [{ type: 'horizontal', edge_thermal_resistance: 1, width: 0.5 }],
      });
    });

    it('serializes vertical array', () => {
      expect(
        formValuesToExtraJsonEdgeInsulation({
          orientation: 'vertical',
          edgeThermalResistance: '2',
          widthOrDepth: '0.25',
        }),
      ).toEqual({
        ok: true,
        value: [{ type: 'vertical', edge_thermal_resistance: 2, depth: 0.25 }],
      });
    });
  });
});
