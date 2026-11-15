// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { readExtraJsonRecord } from './groundSuspendedFabricSync';
import { normalizeMechanicalVentilationVentType } from './mechanicalVentilationBranches';

/** The only energy supply an MVHR takes on a target without product references; the editor shows it read-only. */
export const MVHR_FIXED_ENERGY_SUPPLY = 'mains elec';

/**
 * Values the document's target or drawing fixes, computed when the model is exported instead of
 * written into the store by the editor. Opening an element never writes them; an unchanged model
 * that already holds them exports the same bytes. `hemDatabaseProducts` is the document's own
 * target's rule; undefined (a pin the host does not know) derives nothing. Returns `elementsById`
 * itself when nothing changes.
 */
export function deriveForExport(
  elementsById: Record<string, Element>,
  hemDatabaseProducts: boolean | undefined,
): Record<string, Element> {
  if (hemDatabaseProducts !== false) return elementsById;
  let derived = elementsById;
  for (const [id, element] of Object.entries(elementsById)) {
    if (element.type !== 'MechanicalVentilation') continue;
    const extra = readExtraJsonRecord(element.extra_json);
    const ventType = normalizeMechanicalVentilationVentType(element.vent_type)
      ?? normalizeMechanicalVentilationVentType(extra.vent_type);
    if (ventType !== 'MVHR' || extra.EnergySupply === MVHR_FIXED_ENERGY_SUPPLY) continue;
    if (derived === elementsById) derived = { ...elementsById };
    derived[id] = { ...element, extra_json: { ...extra, EnergySupply: MVHR_FIXED_ENERGY_SUPPLY } } as Element;
  }
  return derived;
}
