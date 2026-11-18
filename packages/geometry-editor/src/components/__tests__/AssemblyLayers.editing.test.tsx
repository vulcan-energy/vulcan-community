// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/index';
import type { BundledAssemblyLibrary } from '../../lib/assemblyLibrary';
import type { AssemblyExample, MaterialRow } from '../../lib/assemblyTypes';

const assemblyLibraryMocks = vi.hoisted(() => ({ load: vi.fn(), upsert: vi.fn() }));

vi.mock('../../lib/assemblyLibrary', () => ({
  loadBundledAssemblyLibrary: assemblyLibraryMocks.load,
  upsertUserAssembly: assemblyLibraryMocks.upsert,
}));

import { AssemblyLayers } from '../AssemblyLayers';
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

const material = (id: string, name: string, lambda: number): MaterialRow =>
  ({ id, name, shortName: name, lambda_W_mK: lambda, density_kg_m3: 500, specific_heat_J_kg_K: 1500 }) as unknown as MaterialRow;

const SOFTWOOD = 'mat.br443.timber_softwood';
const wall: AssemblyExample = {
  id: 'user:asm:wall', name: 'Insulated wall', elementType: 'wall', sourceType: 'user',
  layers: [{ kind: 'solid', materialId: 'insulation', thickness_m: 0.2 }],
};
const roof: AssemblyExample = {
  id: 'user:asm:roof', name: 'Insulated roof', elementType: 'roof', sourceType: 'user',
  layers: [{ kind: 'solid', materialId: 'insulation', thickness_m: 0.3 }],
};
const ventedRoof: AssemblyExample = {
  id: 'user:asm:vented-roof', name: 'Vented roof', elementType: 'roof', sourceType: 'user',
  layers: [
    { kind: 'solid', materialId: 'insulation', thickness_m: 0.2 },
    { kind: 'cavity', ventilation: 'well_ventilated', gap_thickness_m: 0.05, surface_emissivity: 'high' },
    { kind: 'solid', materialId: 'glass', thickness_m: 0.01 },
  ],
};
const thinWall: AssemblyExample = {
  id: 'user:asm:thin-wall', name: 'Thin wall', elementType: 'wall', sourceType: 'user',
  layers: [{ kind: 'solid', materialId: 'insulation', thickness_m: 0.1 }],
};
const sampleWall: AssemblyExample = {
  id: 'example.wall', name: 'Sample wall', elementType: 'wall',
  layers: [{ kind: 'solid', materialId: 'insulation', thickness_m: 0.15 }],
};
const groundFloor: AssemblyExample = {
  id: 'user:asm:floor', name: 'Insulated floor', elementType: 'ground_floor', sourceType: 'user',
  layers: [{ kind: 'solid', materialId: 'insulation', thickness_m: 0.15 }],
};
const library = {
  materialsById: new Map([
    // Sorts first by name: a new bridge must not take it.
    ['glass', material('glass', '4mm Clear Float Cladding', 1)],
    ['insulation', material('insulation', 'Insulation', 0.04)],
    [SOFTWOOD, material(SOFTWOOD, 'Softwood', 0.13)],
  ]),
  cavityResistanceByType: new Map(),
  cavityRows: [],
  examples: [sampleWall, wall, thinWall, roof, ventedRoof, groundFloor],
  materialCategories: [],
} as BundledAssemblyLibrary;

function renderLayers(props: Partial<React.ComponentProps<typeof AssemblyLayers>> = {}) {
  const onApply = vi.fn();
  render(
    <AssemblyLayers
      elementMode="BuildingElementOpaque"
      elementPitchDeg={90}
      opaqueSubtype="wall"
      onApply={onApply}
      workspaceResourcePort={workspacePort}
      {...props}
    />,
  );
  return onApply;
}

async function pick(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Search assemblies…' }));
  fireEvent.click(screen.getByText(name));
}

describe('AssemblyLayers editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assemblyLibraryMocks.load.mockResolvedValue(library);
    assemblyLibraryMocks.upsert.mockResolvedValue(undefined);
  });

  it('a roof opens as a roof: no Wall/Roof toggle, the roof library, and the save footer files it as a roof', async () => {
    renderLayers({ elementPitchDeg: 35, opaqueSubtype: 'roof' });
    fireEvent.click(await screen.findByRole('button', { name: 'Search assemblies…' }));
    expect(screen.queryByText('Fabric type')).not.toBeInTheDocument();
    expect(screen.queryByText('Insulated wall')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Insulated roof'));
    fireEvent.click(screen.getByRole('button', { name: 'Insulated roof' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save these layers to your library' }));
    await waitFor(() => expect(assemblyLibraryMocks.upsert).toHaveBeenCalled());
    expect(assemblyLibraryMocks.upsert.mock.calls[0]![0]).toMatchObject({ elementType: 'roof' });
  });

  it('a new repeating bridge is softwood', async () => {
    const onApply = renderLayers();
    await pick('Insulated wall');
    fireEvent.click(screen.getByRole('button', { name: 'Insulation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add repeating bridge' }));
    const envelope = onApply.mock.calls.at(-1)![0].vulcan_assembly_v1;
    expect(envelope.assemblySnapshot.layers[0].repeatingBridges[0].bridgeMaterialId).toBe(SOFTWOOD);
  });

  it('each library option shows its U, and the picker keeps the chosen name', async () => {
    renderLayers();
    const u = computePatchFromSavedAssembly(wall, library, 'BuildingElementOpaque', 90)!.preview.u;
    fireEvent.click(await screen.findByRole('button', { name: 'Search assemblies…' }));
    expect(within(screen.getByRole('option', { name: /Insulated wall/ })).getByText(u.toFixed(2))).toBeInTheDocument();
    fireEvent.click(screen.getByText('Insulated wall'));
    expect(screen.getByRole('button', { name: 'Insulated wall' })).toBeInTheDocument();
  });

  it('each option wraps its full name (in its title) and carries its U in its accessible name; the list is labelled Layers', async () => {
    renderLayers();
    const u = computePatchFromSavedAssembly(wall, library, 'BuildingElementOpaque', 90)!.preview.u;
    fireEvent.click(await screen.findByRole('button', { name: 'Search assemblies…' }));
    expect(screen.getByRole('listbox', { name: 'Layers' })).toBeInTheDocument();
    const option = screen.getByRole('option', { name: `Insulated wall, U ${u.toFixed(2)}` });
    const label = within(option).getByText('Insulated wall');
    expect(label).toHaveAttribute('title', 'Insulated wall');
    expect(label).toHaveStyle({ fontWeight: '400', WebkitLineClamp: '2' });
  });

  it('clears "Saved to your library" at the next layer edit', async () => {
    renderLayers();
    await pick('Insulated wall');
    fireEvent.click(screen.getByRole('button', { name: 'Insulated wall' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save these layers to your library' }));
    expect(await screen.findByText('Saved to your library')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Layer 1 thickness (mm)'), { target: { value: '120' } });
    expect(screen.queryByText('Saved to your library')).not.toBeInTheDocument();
  });

  it('groups the picker as your library, then the sample library of this type, with a filter', async () => {
    renderLayers();
    fireEvent.click(await screen.findByRole('button', { name: 'Search assemblies…' }));
    const headings = within(screen.getByRole('listbox')).getAllByRole('group').map((group) => group.getAttribute('aria-label'));
    expect(headings).toEqual(['Your library', 'Sample library · Walls']);
    expect(screen.getByPlaceholderText('Filter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
  });

  it('the save footer saves the layers to the library, closes the menu and hands on the reloaded library', async () => {
    const onLibrarySaved = vi.fn();
    renderLayers({ onLibrarySaved });
    await pick('Insulated wall');
    expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Insulated wall' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save these layers to your library' }));
    await waitFor(() => expect(assemblyLibraryMocks.upsert).toHaveBeenCalledTimes(1));
    expect(assemblyLibraryMocks.upsert.mock.calls[0]![0]).toMatchObject({ elementType: 'wall', layers: wall.layers });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await waitFor(() => expect(onLibrarySaved).toHaveBeenCalledWith(library));
    expect(screen.getByText('Saved to your library')).toBeInTheDocument();
  });

  it('a ground floor option shows the R_f it writes, not a U', async () => {
    renderLayers({ elementMode: 'BuildingElementGround', elementPitchDeg: 180, groundFloorType: 'Slab_no_edge_insulation' });
    const r = computePatchFromSavedAssembly(groundFloor, library, 'BuildingElementGround', 180, {
      groundFloorType: 'Slab_no_edge_insulation',
    })!.preview.r;
    fireEvent.click(await screen.findByRole('button', { name: 'Search assemblies…' }));
    expect(within(screen.getByRole('option', { name: /Insulated floor/ })).getByText(`R_f ${r.toFixed(2)}`)).toBeInTheDocument();
  });

  it('picking a library row clears the fasteners set before, so the applied U is the option U', async () => {
    const onApply = renderLayers();
    await pick('Insulated wall');
    fireEvent.click(screen.getByText('Advanced corrections'));
    fireEvent.click(screen.getByLabelText('Include fastener correction'));
    fireEvent.change(screen.getByLabelText('How many per square metre of face?'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Heat loss per fastener/), { target: { value: '0.05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insulated wall' }));
    fireEvent.click(screen.getByText('Thin wall'));
    expect(screen.getByLabelText('Include fastener correction')).not.toBeChecked();
    const optionU = computePatchFromSavedAssembly(thinWall, library, 'BuildingElementOpaque', 90)!.preview.u;
    expect(onApply.mock.calls.at(-1)![0].u_value).toBe(optionU);
  });

  it('shows no error before any input, then one error line', async () => {
    const onApply = renderLayers();
    await screen.findByRole('button', { name: 'Search assemblies…' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a layer at the outside' }));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies each edit as it is made, with no Update element or Writes to element', async () => {
    const onApply = renderLayers();
    await pick('Insulated wall');
    const picked = computePatchFromSavedAssembly(wall, library, 'BuildingElementOpaque', 90)!;
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toMatchObject({ u_value: picked.patch.u_value, thermal_resistance_construction: picked.patch.thermal_resistance_construction });
    expect(screen.queryByRole('button', { name: 'Update element' })).not.toBeInTheDocument();
    expect(screen.queryByText('Writes to element')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Layer 1 thickness (mm)'), { target: { value: '100' } });
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply.mock.calls[1]![0].u_value).toBe(computePatchFromSavedAssembly(thinWall, library, 'BuildingElementOpaque', 90)!.preview.u);
  });

  it('rows run inside to outside: + layer at the inside puts the new layer first, and an open row removes', async () => {
    const onApply = renderLayers();
    await pick('Insulated wall');
    const rows = () => [...document.querySelectorAll('[data-layer-row]')].map((row) => row.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'Add a layer at the inside' }));
    expect(rows()[0]).toContain('Choose a material');
    expect(rows()[1]).toContain('Insulation');
    fireEvent.click(screen.getByRole('button', { name: 'Remove layer' }));
    expect(rows()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Remove layer' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Insulation' }));
    expect(screen.getByRole('button', { name: 'Remove layer' })).toBeInTheDocument();
    expect(onApply.mock.calls.at(-1)![0].vulcan_assembly_v1.assemblySnapshot.layers).toEqual(wall.layers);
  });

  it('opens on the element\'s layers and applies nothing until they change', async () => {
    const applied = computePatchFromSavedAssembly(wall, library, 'BuildingElementOpaque', 90)!.patch.vulcan_assembly_v1 as never;
    const onApply = renderLayers({ appliedEnvelope: applied });
    expect(await screen.findByRole('button', { name: 'Insulation' })).toBeInTheDocument();
    expect(screen.getByLabelText('Layer 1 thickness (mm)')).toHaveValue('200');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('a roof over a well-ventilated cavity shows R on the rows inside it, and none on the cavity or the rows outside', async () => {
    renderLayers({ elementPitchDeg: 35, opaqueSubtype: 'roof' });
    await pick('Vented roof');
    const r = (n: number) => document.querySelector(`[data-layer-row="Layer ${n}"] [title="R (m²·K/W)"]`)?.textContent;
    await waitFor(() => expect(r(1)).toBe('5.00'));
    expect(r(2)).toBe('');
    expect(r(3)).toBe('');
  });

  it('carries no explanatory copy', async () => {
    renderLayers({ elementMode: 'BuildingElementPartyWall' });
    await screen.findByRole('button', { name: 'Search assemblies…' });
    expect(screen.queryByText(/How it.s calculated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dwelling-side half construction/)).not.toBeInTheDocument();
    const layers = document.querySelector('[data-assembly-layers]') as HTMLElement;
    expect(within(layers).queryByText(/Only use these when/)).not.toBeInTheDocument();
  });
});
