// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/index';
import type {
  ExternalConstructionDetailProfile,
  ExternalDetailCataloguePort,
} from '../../geometry/thermalBridge/externalDetailContracts';

const assemblyLibraryMocks = vi.hoisted(() => ({
  load: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../../lib/assemblyLibrary', () => ({
  loadBundledAssemblyLibrary: assemblyLibraryMocks.load,
  upsertUserAssembly: assemblyLibraryMocks.upsert,
}));

import { AssemblyCalculatorModal } from '../AssemblyCalculatorModal';

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

const profile: ExternalConstructionDetailProfile = {
  id: 'manufacturer:wall:one',
  source: 'manufacturer',
  sourceName: 'Manufacturer details',
  sourceShortName: 'Maker',
  sourceUrl: 'https://example.test/details',
  importedAt: '2026-01-01T00:00:00.000Z',
  category: 'manufacturer',
  elementType: 'wall',
  systemName: 'Cavity wall',
  label: 'Maker cavity wall',
  optionLabel: 'Cavity wall option',
  junctions: [],
};

const externalDetailCataloguePort = {
  listProfiles: vi.fn(() => [profile]),
  getProfile: vi.fn((linkOrId) => {
    const id = typeof linkOrId === 'string' ? linkOrId : linkOrId?.profileId;
    return id === profile.id ? profile : undefined;
  }),
  getDetailsForJunction: vi.fn(() => []),
} satisfies ExternalDetailCataloguePort;

function renderModal(extraProps: Record<string, unknown> = {}) {
  return render(
    <AssemblyCalculatorModal
      isOpen
      onClose={vi.fn()}
      elementMode="BuildingElementOpaque"
      elementPitchDeg={90}
      onApply={vi.fn()}
      workspaceResourcePort={workspacePort}
      {...extraProps}
    />,
  );
}

describe('AssemblyCalculatorModal resource ports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assemblyLibraryMocks.load.mockResolvedValue({
      materialsById: new Map(),
      cavityResistanceByType: new Map(),
      cavityRows: [],
      examples: [],
      materialCategories: [],
    });
    assemblyLibraryMocks.upsert.mockResolvedValue(undefined);
  });

  it('has no direct private catalogue or file-service dependency', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../AssemblyCalculatorModal.tsx'),
      'utf8',
    );
    expect(source).not.toContain("from '../lib/externalDetailLibraries'");
    expect(source).not.toContain("from '../lib/fileService'");
  });

  it('loads the current calculator through the supplied workspace resource port', async () => {
    renderModal();

    expect(screen.getByText('Assembly calculator')).toBeInTheDocument();
    await waitFor(() => expect(assemblyLibraryMocks.load).toHaveBeenCalledWith(workspacePort));
    expect(screen.queryByText('Detail profile')).not.toBeInTheDocument();
  });

  it('shows private detail suggestions only when a catalogue contribution is supplied', async () => {
    renderModal({ externalDetailCataloguePort });

    await waitFor(() => expect(externalDetailCataloguePort.listProfiles).toHaveBeenCalled());
    expect(screen.getByText('Detail profile')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not linked' }));
    fireEvent.click(screen.getByText('Maker · Cavity wall'));
    expect(screen.getByText('Cavity wall option')).toBeInTheDocument();
  });
});
