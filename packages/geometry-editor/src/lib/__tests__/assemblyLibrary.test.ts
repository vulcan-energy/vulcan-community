// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import type { GeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/index';
import {
  loadBundledAssemblyLibrary,
  mergeAssemblyExamples,
  mergeMaterialsById,
  upsertUserAssembly,
  upsertUserMaterial,
} from '../assemblyLibrary';
import type { AssemblyExample, MaterialRow } from '../assemblyTypes';

function workspaceResourcePort(files: Record<string, string>) {
  const writes = new Map<string, string>();
  const port: GeometryWorkspaceResourcePort = {
    availability: 'available',
    readText: vi.fn(async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`Missing fixture: ${path}`);
      return content;
    }),
    readFile: vi.fn(async () => {
      throw new Error('readFile is not expected');
    }),
    writeText: vi.fn(async (path, content) => {
      writes.set(path, content);
    }),
    writeBytes: vi.fn(async () => undefined),
    removeFile: vi.fn(async () => undefined),
    ensureDirectory: vi.fn(async () => undefined),
    exists: vi.fn(async (path) => path in files),
    list: vi.fn(async () => []),
  };
  return { port, writes };
}

describe('mergeMaterialsById', () => {
  it('preserves bundled then overrides by user id', () => {
    const bundled = new Map<string, MaterialRow>([
      ['a', { id: 'a', name: 'A', shortName: 'A', lambda_W_mK: 1, sourceType: 'published_guidance' }],
      ['b', { id: 'b', name: 'B', shortName: 'B', lambda_W_mK: 2, sourceType: 'published_guidance' }],
    ]);
    const user: MaterialRow[] = [
      { id: 'b', name: 'B override', shortName: 'B', lambda_W_mK: 3, sourceType: 'user' },
      { id: 'c', name: 'C', shortName: 'C', lambda_W_mK: 4, sourceType: 'user' },
    ];
    const m = mergeMaterialsById(bundled, user);
    expect(m.get('a')?.lambda_W_mK).toBe(1);
    expect(m.get('b')?.lambda_W_mK).toBe(3);
    expect(m.get('c')?.name).toBe('C');
  });
});

describe('mergeAssemblyExamples', () => {
  it('user overrides bundled id', () => {
    const bundled: AssemblyExample[] = [
      { id: 'x', name: 'Old', elementType: 'wall', layers: [] },
    ];
    const user: AssemblyExample[] = [{ id: 'x', name: 'New', elementType: 'wall', layers: [] }];
    const out = mergeAssemblyExamples(bundled, user);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('New');
  });
});

describe('assembly library workspace resource seam', () => {
  it('loads all three assembly resources through the supplied workspace port', async () => {
    const { port } = workspaceResourcePort({
      'input/assembly_library/materials.json': JSON.stringify({
        materials: [{ id: 'brick', name: 'Brick', lambda_W_mK: 0.77 }],
        materialCategories: [{ id: 'masonry', label: 'Masonry' }],
        sourceEdition: 'test-edition',
      }),
      'input/assembly_library/cavity_resistances.json': JSON.stringify({
        cavities: [{ cavityType: 'wall_cavity', fixedResistance_m2K_W: 0.18 }],
      }),
      'input/assembly_library/assemblies.json': JSON.stringify({
        assemblies: [
          {
            id: 'wall.basic',
            name: 'stale name',
            elementType: 'wall',
            layers: [{ kind: 'solid', materialId: 'brick', thickness_m: 0.1 }],
          },
        ],
      }),
    });

    const library = await loadBundledAssemblyLibrary(port);

    expect(port.readText).toHaveBeenCalledTimes(3);
    expect(port.readText).toHaveBeenCalledWith('input/assembly_library/materials.json');
    expect(port.readText).toHaveBeenCalledWith('input/assembly_library/cavity_resistances.json');
    expect(port.readText).toHaveBeenCalledWith('input/assembly_library/assemblies.json');
    expect(library.materialsById.get('brick')?.name).toBe('Brick');
    expect(library.cavityResistanceByType.get('wall_cavity')).toBe(0.18);
    expect(library.examples[0]?.name).toContain('Brick');
    expect(library.sourceEdition).toBe('test-edition');
  });

  it('upserts materials and assemblies through the same supplied workspace port', async () => {
    const { port, writes } = workspaceResourcePort({
      'input/assembly_library/materials.json': JSON.stringify({
        sourceEdition: 'preserved',
        materials: [{ id: 'brick', name: 'Old brick', lambda_W_mK: 0.7 }],
      }),
      'input/assembly_library/assemblies.json': JSON.stringify({
        sourceEdition: 'preserved',
        assemblies: [{ id: 'wall.basic', name: 'Old wall', elementType: 'wall', layers: [] }],
      }),
    });
    const material: MaterialRow = {
      id: 'brick',
      name: 'New brick',
      lambda_W_mK: 0.77,
    };
    const assembly: AssemblyExample = {
      id: 'wall.basic',
      name: 'New wall',
      elementType: 'wall',
      layers: [],
    };

    await upsertUserMaterial(material, port);
    await upsertUserAssembly(assembly, port);

    const materialDoc = JSON.parse(writes.get('input/assembly_library/materials.json')!);
    const assemblyDoc = JSON.parse(writes.get('input/assembly_library/assemblies.json')!);
    expect(materialDoc).toMatchObject({ sourceEdition: 'preserved', materials: [material] });
    expect(assemblyDoc).toMatchObject({ sourceEdition: 'preserved', assemblies: [assembly] });
    expect(writes.get('input/assembly_library/materials.json')).toMatch(/\n$/);
    expect(writes.get('input/assembly_library/assemblies.json')).toMatch(/\n$/);
  });
});
