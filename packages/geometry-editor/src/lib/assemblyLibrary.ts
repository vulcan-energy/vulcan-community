// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src';
import { buildAssemblyDisplayNameForExample } from './assemblyNaming';
import type { AssemblyExample, CavityRow, MaterialRow } from './assemblyTypes';

export interface MaterialCategoryRow {
  id: string;
  label: string;
}

export interface BundledAssemblyLibrary {
  materialsById: Map<string, MaterialRow>;
  cavityResistanceByType: Map<string, number>;
  cavityRows: CavityRow[];
  examples: AssemblyExample[];
  /** Display order and labels for material picker sections */
  materialCategories: MaterialCategoryRow[];
  sourceEdition?: string;
  sourceUrl?: string;
}

/** Workspace path: not under `batch_parameters` (excluded from scenario editor). Bundled via `sample_project/input/assembly_library/`. */
export const ASSEMBLY_LIBRARY_DIR = 'input/assembly_library';

const MATERIALS_JSON = `${ASSEMBLY_LIBRARY_DIR}/materials.json`;
const CAVITIES_JSON = `${ASSEMBLY_LIBRARY_DIR}/cavity_resistances.json`;
const ASSEMBLIES_JSON = `${ASSEMBLY_LIBRARY_DIR}/assemblies.json`;

/** Merged materials: bundled first, then user rows override by `id`. Exported for unit tests. */
export function mergeMaterialsById(
  bundled: Map<string, MaterialRow>,
  userMaterials: MaterialRow[],
): Map<string, MaterialRow> {
  const out = new Map(bundled);
  for (const m of userMaterials) {
    if (m?.id) out.set(m.id, m);
  }
  return out;
}

/** Bundled examples first; user assemblies override entries with the same `id`. */
export function mergeAssemblyExamples(
  bundled: AssemblyExample[],
  userExamples: AssemblyExample[],
): AssemblyExample[] {
  const byId = new Map<string, AssemblyExample>();
  for (const a of bundled) {
    if (a?.id) byId.set(a.id, a);
  }
  for (const a of userExamples) {
    if (a?.id) byId.set(a.id, a);
  }
  return [...byId.values()];
}

function refreshAssemblyExampleNames(
  examples: AssemblyExample[],
  materialsById: Map<string, MaterialRow>,
  cavityRows: CavityRow[],
): void {
  for (const ex of examples) {
    ex.name = buildAssemblyDisplayNameForExample(ex, materialsById, cavityRows);
  }
}

/**
 * Load assembly reference data from the workspace (`input/assembly_library/`),
 * same tree as the bundled sample project. Custom materials and assemblies live in the same
 * `materials.json` and `assemblies.json` as bundled rows (unique `id` per entry).
 */
export async function loadBundledAssemblyLibrary(
  workspaceResourcePort: GeometryWorkspaceResourcePort,
): Promise<BundledAssemblyLibrary> {
  const [materialsText, cavitiesText, assembliesText] = await Promise.all([
    workspaceResourcePort.readText(MATERIALS_JSON),
    workspaceResourcePort.readText(CAVITIES_JSON),
    workspaceResourcePort.readText(ASSEMBLIES_JSON),
  ]);

  const materialsDoc = JSON.parse(materialsText) as {
    materials: MaterialRow[];
    materialCategories?: MaterialCategoryRow[];
    sourceEdition?: string;
    sourceUrl?: string;
  };
  const cavitiesDoc = JSON.parse(cavitiesText) as {
    cavities: Array<CavityRow & { fixedResistance_m2K_W: number }>;
  };
  const assembliesDoc = JSON.parse(assembliesText) as { assemblies: AssemblyExample[] };

  const materialsById = new Map<string, MaterialRow>();
  for (const m of materialsDoc.materials || []) {
    materialsById.set(m.id, m);
  }

  const cavityResistanceByType = new Map<string, number>();
  const cavityRows: CavityRow[] = [];
  for (const c of cavitiesDoc.cavities || []) {
    cavityResistanceByType.set(c.cavityType, c.fixedResistance_m2K_W);
    const shortLabel =
      typeof (c as CavityRow).shortLabel === 'string' && (c as CavityRow).shortLabel.trim()
        ? (c as CavityRow).shortLabel.trim()
        : c.cavityType.replace(/_/g, ' ');
    cavityRows.push({ ...c, shortLabel });
  }

  const examples = assembliesDoc.assemblies || [];
  refreshAssemblyExampleNames(examples, materialsById, cavityRows);

  return {
    materialsById,
    cavityResistanceByType,
    cavityRows,
    examples,
    materialCategories: materialsDoc.materialCategories ?? [],
    sourceEdition: materialsDoc.sourceEdition,
    sourceUrl: materialsDoc.sourceUrl,
  };
}

/** Merge or replace a material row by `id` in `materials.json` (bundled + custom in one file). */
export async function upsertUserMaterial(
  material: MaterialRow,
  workspaceResourcePort: GeometryWorkspaceResourcePort,
): Promise<void> {
  const text = await workspaceResourcePort.readText(MATERIALS_JSON);
  const doc = JSON.parse(text) as Record<string, unknown> & { materials?: MaterialRow[] };
  const materials = [...(doc.materials || [])];
  const i = materials.findIndex((m) => m.id === material.id);
  if (i >= 0) materials[i] = material;
  else materials.push(material);
  const out = { ...doc, materials };
  await workspaceResourcePort.writeText(MATERIALS_JSON, `${JSON.stringify(out, null, 2)}\n`);
}

/** Merge or replace an assembly by `id` in `assemblies.json` (bundled + custom in one file). */
export async function upsertUserAssembly(
  assembly: AssemblyExample,
  workspaceResourcePort: GeometryWorkspaceResourcePort,
): Promise<void> {
  const text = await workspaceResourcePort.readText(ASSEMBLIES_JSON);
  const doc = JSON.parse(text) as Record<string, unknown> & { assemblies?: AssemblyExample[] };
  const assemblies = [...(doc.assemblies || [])];
  const i = assemblies.findIndex((a) => a.id === assembly.id);
  if (i >= 0) assemblies[i] = assembly;
  else assemblies.push(assembly);
  const out = { ...doc, assemblies };
  await workspaceResourcePort.writeText(ASSEMBLIES_JSON, `${JSON.stringify(out, null, 2)}\n`);
}
