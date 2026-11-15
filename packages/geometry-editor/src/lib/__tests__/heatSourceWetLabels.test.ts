// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { collectHeatSourceWetNameLabelsFromProject } from '../heatSourceWetNamesFromProject';
import type { Element } from '../../geometry/types';

const system = (name: string, keys: string[]) => ({
  id: name, type: 'System', name, isPlaceholder: false,
  extra_json: { HeatSourceWet: Object.fromEntries(keys.map((key) => [key, {}])) },
}) as unknown as Element;

describe('heat source labels', () => {
  it('uses the element name alone for one heat source, and name (key) for several', () => {
    const labels = collectHeatSourceWetNameLabelsFromProject({
      a: system('Heat Pump', ['hp']),
      b: system('Boilers', ['boiler 1', 'boiler 2']),
    });
    expect(labels).toEqual({ hp: 'Heat Pump', 'boiler 1': 'Boilers (boiler 1)', 'boiler 2': 'Boilers (boiler 2)' });
  });
});
