// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { parseSemiDetachedSample } from '../__fixtures__/semiDetachedWithDormer';
import { editorFloorsAndElementsForParsedCsv } from '../../lib/floorDerivation';
import { proposeAutoThermalBridges } from './autoThermalBridgePipeline';

// The sample's cold roof (insulation at ceiling level) has two eaves, an external gable and a
// party gable. BR 497 gives each edge one junction: E10 eaves (§4.1.1), E12 gable (§4.1.2) and P4
// roof/party wall (§4.1.3). R9 is a room-in-roof junction (§4.2) and the sample has no room in roof.
describe('auto thermal bridges on the shipped sample roof', () => {
  it('proposes one junction per roof edge', () => {
    const { elements, floors } = editorFloorsAndElementsForParsedCsv(parseSemiDetachedSample());
    const roofCodes = proposeAutoThermalBridges(elements, floors)
      .filter((p) => p.parentElementForTb?.startsWith('Pitched Roof'))
      .map((p) => p.junctionCode)
      .sort();

    expect(roofCodes).toEqual(['E10', 'E10', 'E12', 'E12', 'P4', 'P4']);
  });
});
