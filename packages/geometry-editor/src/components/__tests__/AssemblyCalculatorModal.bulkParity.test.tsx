// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/index';
import type { BundledAssemblyLibrary } from '../../lib/assemblyLibrary';
import type { AssemblyElementMode, AssemblyExample, MaterialRow } from '../../lib/assemblyTypes';

const assemblyLibraryMocks = vi.hoisted(() => ({ load: vi.fn(), upsert: vi.fn() }));

vi.mock('../../lib/assemblyLibrary', () => ({
  loadBundledAssemblyLibrary: assemblyLibraryMocks.load,
  upsertUserAssembly: assemblyLibraryMocks.upsert,
}));

import { AssemblyCalculatorModal } from '../AssemblyCalculatorModal';
import { computePatchFromSavedAssembly } from '../../lib/multiSelectAssemblyApply';

const workspacePort = {
  availability: 'available',
  readText: vi.fn(),
  readFile: vi.fn(),
  writeText: vi.fn(),
  writeBytes: vi.fn(),
  removeFile: vi.fn(),
  ensureDirectory: vi.fn(),
  exists: vi.fn(),
  list: vi.fn(),
} satisfies GeometryWorkspaceResourcePort;

// Low-e cavity (R 0.44) flagged as Annex F level 2. The insulation thickness puts the corrected R
// across a 2-d.p. boundary, so a missing ΔU shows up in the written R.
const assembly: AssemblyExample = {
  id: 'user:asm:air-void-wall',
  name: 'Air-void wall',
  elementType: 'wall',
  sourceType: 'user',
  layers: [
    { kind: 'solid', materialId: 'insulation', thickness_m: 0.0999 },
    {
      kind: 'cavity',
      ventilation: 'unventilated',
      gap_thickness_m: 0.05,
      surface_emissivity: 'low',
      annexFAirVoidLevelOverride: 2,
    },
    { kind: 'solid', materialId: 'board', thickness_m: 0.01 },
  ],
};

const library = {
  materialsById: new Map([
    ['insulation', { id: 'insulation', name: 'Insulation', shortName: 'Insulation', lambda_W_mK: 0.04, density_kg_m3: 30, specific_heat_J_kg_K: 1400 } as unknown as MaterialRow],
    ['board', { id: 'board', name: 'Board', shortName: 'Board', lambda_W_mK: 1.0, density_kg_m3: 1000, specific_heat_J_kg_K: 1000 } as unknown as MaterialRow],
  ]),
  cavityResistanceByType: new Map(),
  cavityRows: [],
  examples: [assembly],
  materialCategories: [],
} as BundledAssemblyLibrary;

describe('saved assembly: calculator apply versus bulk apply', () => {
  // Party wall: Annex F on the full wall, then half its corrected R (the halved R_tot gave 1.46).
  it.each<[AssemblyElementMode, number]>([
    ['BuildingElementOpaque', 2.94],
    ['BuildingElementPartyWall', 1.47],
  ])(
    'writes the same U and R for %s',
    async (elementMode, expectedR) => {
      assemblyLibraryMocks.load.mockResolvedValue(library);
      const onApply = vi.fn();
      render(
        <AssemblyCalculatorModal
          isOpen
          onClose={vi.fn()}
          elementMode={elementMode}
          elementPitchDeg={90}
          onApply={onApply}
          workspaceResourcePort={workspacePort}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Search assemblies…' }));
      fireEvent.click(screen.getByText('Air-void wall'));
      fireEvent.click(screen.getByRole('button', { name: 'Update element' }));
      const modalPatch = onApply.mock.calls[0]![0] as Record<string, unknown>;
      expect(modalPatch.thermal_resistance_construction).toBe(expectedR);

      const bulk = computePatchFromSavedAssembly(assembly, library, elementMode, 90);
      expect(bulk!.errors).toEqual([]);
      expect(bulk!.patch.thermal_resistance_construction).toBe(modalPatch.thermal_resistance_construction);
      expect(bulk!.patch.u_value).toBe(modalPatch.u_value);
      expect((bulk!.patch.vulcan_assembly_v1 as { annexF_v1?: unknown }).annexF_v1).toEqual(
        (modalPatch.vulcan_assembly_v1 as { annexF_v1?: unknown }).annexF_v1,
      );
    },
  );
});
