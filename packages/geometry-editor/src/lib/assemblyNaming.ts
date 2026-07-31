// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Human-readable assembly `name` strings and search haystacks.
 * Uses material `shortName` + thickness; cavities use `shortLabel` from cavity library rows.
 *
 * Repeating bridges (parallel paths in a solid layer):
 * - framing_fraction → ` +{pct}% {bridge shortName}` (e.g. +25% Timber stud)
 * - spacing_width → ` +{spacing}×{width}mm {bridge shortName}` (centre spacing × member width)
 */

import type {
  AssemblyExample,
  AssemblyLayer,
  CavityRow,
  MaterialRow,
  RepeatingBridgeRow,
} from './assemblyTypes';
import {
  cavitySurfaceEmissivityLabel,
  cavityVentilationLabel,
  isExplicitCavity,
} from './assemblyCavityModel';

/** Keeps stack lines readable in pickers; search uses full names via {@link assemblySearchHaystack}. */
const MAX_ASSEMBLY_MATERIAL_LABEL_CHARS = 28;

/**
 * Shortens a material fragment for the assembly `name` only (word-aware when possible).
 */
export function truncatedAssemblyMaterialLabel(text: string, maxChars = MAX_ASSEMBLY_MATERIAL_LABEL_CHARS): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const budget = maxChars - 1;
  let slice = t.slice(0, budget);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace >= 10) slice = slice.slice(0, lastSpace).trimEnd();
  return `${slice}…`;
}

function formatRValue(r: number): string {
  const t = r.toFixed(2).replace(/\.?0+$/, '');
  return t === '' ? '0' : t;
}

function cavityDisplaySegment(
  cavityType: string | undefined,
  fixedResistance_m2K_W: number | undefined,
  cavityRows: CavityRow[],
): string {
  const row = cavityType ? cavityRows.find((c) => c.cavityType === cavityType) : undefined;
  const label =
    row?.shortLabel?.trim() ||
    (cavityType
      ? cavityType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Cavity');
  return `${label} R${formatRValue(fixedResistance_m2K_W ?? 0)}`;
}

function explicitCavityDisplaySegment(layer: Extract<AssemblyLayer, { kind: 'cavity' }>): string {
  const mm = Math.round((layer.gap_thickness_m ?? 0) * 1000);
  const emissivity = cavitySurfaceEmissivityLabel(layer.surface_emissivity);
  const ventilation = cavityVentilationLabel(layer.ventilation);
  return `${mm}mm ${ventilation} cavity (${emissivity})`;
}

function bridgeMaterialShortName(
  bridgeMaterialId: string,
  materialsById: Map<string, MaterialRow>,
): string {
  const m = materialsById.get(bridgeMaterialId);
  const raw = (m?.shortName ?? m?.name ?? 'Bridge').trim();
  return truncatedAssemblyMaterialLabel(raw);
}

/** Suffix appended to a solid layer segment for each repeating bridge (in array order). */
export function repeatingBridgeSuffixes(
  bridges: RepeatingBridgeRow[] | undefined,
  materialsById: Map<string, MaterialRow>,
): string {
  if (!bridges?.length) return '';
  let out = '';
  for (const b of bridges) {
    const bsn = bridgeMaterialShortName(b.bridgeMaterialId, materialsById);
    if (b.definition.mode === 'framing_fraction') {
      const pct = Math.round(b.definition.framingFraction * 100);
      out += ` +${pct}% ${bsn}`;
    } else {
      const spMm = Math.round(b.definition.spacing_m * 1000);
      const wMm = Math.round(b.definition.width_m * 1000);
      out += ` +${spMm}×${wMm}mm ${bsn}`;
    }
  }
  return out;
}

function solidLayerSegment(
  layer: Extract<AssemblyLayer, { kind: 'solid' }>,
  materialsById: Map<string, MaterialRow>,
): string {
  const mm = Math.round(layer.thickness_m * 1000);
  const m = layer.materialId ? materialsById.get(layer.materialId) : undefined;
  const short = truncatedAssemblyMaterialLabel((m?.shortName ?? m?.name ?? 'layer').trim());
  const bridges = repeatingBridgeSuffixes(layer.repeatingBridges, materialsById);
  return `${mm}mm ${short}${bridges}`;
}

export function buildAssemblyDisplayName(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
  cavityRows: CavityRow[],
): string {
  const parts: string[] = [];
  for (const L of layers) {
    if (L.kind === 'solid') {
      parts.push(solidLayerSegment(L, materialsById));
    } else {
      parts.push(
        isExplicitCavity(L)
          ? explicitCavityDisplaySegment(L)
          : cavityDisplaySegment(L.cavityType, L.fixedResistance_m2K_W, cavityRows),
      );
    }
  }
  return parts.join(' · ');
}

/** Coerce persisted example layers to `AssemblyLayer[]` for naming. */
export function exampleLayersToAssemblyLayers(
  layers: AssemblyExample['layers'],
): AssemblyLayer[] {
  return layers.map((L) => {
    if (L.kind === 'cavity') {
      return {
        kind: 'cavity',
        cavityType: L.cavityType,
        fixedResistance_m2K_W: L.fixedResistance_m2K_W,
        ventilation: L.ventilation,
        gap_thickness_m: L.gap_thickness_m,
        surface_emissivity: L.surface_emissivity,
        annexFAirVoidLevelOverride: L.annexFAirVoidLevelOverride,
      };
    }
    return {
      kind: 'solid',
      materialId: L.materialId!,
      thickness_m: L.thickness_m!,
      repeatingBridges: L.repeatingBridges,
    };
  });
}

export function buildAssemblyDisplayNameForExample(
  ex: AssemblyExample,
  materialsById: Map<string, MaterialRow>,
  cavityRows: CavityRow[],
): string {
  return buildAssemblyDisplayName(exampleLayersToAssemblyLayers(ex.layers), materialsById, cavityRows);
}

/** Lowercase haystack for assembly search (full material names, cavity ids, display name). */
export function assemblySearchHaystack(
  ex: AssemblyExample,
  materialsById: Map<string, MaterialRow>,
): string {
  const chunks: string[] = [ex.id, ex.name];
  for (const L of ex.layers) {
    if (L.kind === 'solid') {
      if (L.materialId) {
        const m = materialsById.get(L.materialId);
        if (m?.name) chunks.push(m.name);
        if (m?.shortName) chunks.push(m.shortName);
      }
      for (const b of L.repeatingBridges ?? []) {
        const bm = materialsById.get(b.bridgeMaterialId);
        if (bm?.name) chunks.push(bm.name);
        if (bm?.shortName) chunks.push(bm.shortName);
      }
    } else {
      chunks.push(L.cavityType ?? '');
      if (L.gap_thickness_m != null) chunks.push(`${Math.round(L.gap_thickness_m * 1000)}mm`);
      if (L.surface_emissivity) chunks.push(L.surface_emissivity);
      if (L.ventilation) chunks.push(L.ventilation);
    }
  }
  return chunks.join(' ').toLowerCase();
}

export function libraryElementTypeLabel(elementType: string): string {
  switch (elementType) {
    case 'wall':
      return 'Wall';
    case 'roof':
      return 'Roof';
    case 'ground_floor':
      return 'Ground floor';
    default:
      return elementType;
  }
}

export function assemblyProvenanceLabel(ex: AssemblyExample): 'Sample library' | 'User created' {
  if (ex.sourceType === 'user' || ex.id.startsWith('user:asm:')) return 'User created';
  return 'Sample library';
}

export function assemblyPickerDescription(ex: AssemblyExample): string {
  return `${assemblyProvenanceLabel(ex)} · ${libraryElementTypeLabel(ex.elementType)}`;
}
