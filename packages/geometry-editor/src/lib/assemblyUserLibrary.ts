// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers for user-saved materials/assemblies (Phase 1b).
 * Workspace I/O lives in `assemblyLibrary.ts`.
 */

import type {
  AssemblyElementMode,
  AssemblyExample,
  AssemblyLayer,
  CavityRow,
  ExternalDetailProfileLink,
  MaterialRow,
} from './assemblyTypes';
import { buildAssemblyDisplayName } from './assemblyNaming';

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Stable JSON for hashing and dedupe: layer stack + mode + wall/roof/ground classification. */
export function canonicalUserAssemblyJson(
  layers: AssemblyLayer[],
  elementMode: AssemblyElementMode,
  libraryElementType: 'wall' | 'roof' | 'ground_floor',
  externalDetailProfile?: ExternalDetailProfileLink | null,
): string {
  const layerPayload = layers.map((l) => {
    if (l.kind === 'solid') {
      const base: Record<string, unknown> = {
        kind: 'solid' as const,
        materialId: l.materialId,
        thickness_m: round6(l.thickness_m),
      };
      if (l.repeatingBridges && l.repeatingBridges.length > 0) {
        base.repeatingBridges = l.repeatingBridges.map((b) => ({
          id: b.id,
          bridgeMaterialId: b.bridgeMaterialId,
          definition: b.definition,
        }));
      }
      return base;
    }
    return {
      kind: 'cavity' as const,
      cavityType: l.cavityType,
      ...(typeof l.fixedResistance_m2K_W === 'number' ? { fixedResistance_m2K_W: round6(l.fixedResistance_m2K_W) } : {}),
      ...(l.ventilation ? { ventilation: l.ventilation } : {}),
      ...(typeof l.gap_thickness_m === 'number' ? { gap_thickness_m: round6(l.gap_thickness_m) } : {}),
      ...(l.surface_emissivity ? { surface_emissivity: l.surface_emissivity } : {}),
      ...(l.annexFAirVoidLevelOverride !== undefined
        ? { annexFAirVoidLevelOverride: l.annexFAirVoidLevelOverride }
        : {}),
    };
  });
  return JSON.stringify({
    elementMode,
    libraryElementType,
    ...(externalDetailProfile?.source && externalDetailProfile.profileId
      ? {
          externalDetailProfile: {
            source: externalDetailProfile.source,
            profileId: externalDetailProfile.profileId,
          },
        }
      : {}),
    layers: layerPayload,
  });
}

/** 16 hex chars from two 32-bit hashes — stable, sync, good enough for workspace ids. */
export function fnv1aHex16(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = h >>> 0;
  let h2 = 5381;
  for (let i = 0; i < input.length; i++) {
    h2 = (h2 * 33) ^ input.charCodeAt(i);
  }
  const b = h2 >>> 0;
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function userAssemblyIdFromCanonical(canonicalJson: string): string {
  return `user:asm:${fnv1aHex16(canonicalJson)}`;
}

export function userMaterialIdFromNameLambda(name: string, lambda_W_mK: number): string {
  const key = `${name.trim().toLowerCase()}\0${lambda_W_mK}`;
  return `user:mat:${fnv1aHex16(key)}`;
}

/** @deprecated Use `buildAssemblyDisplayName` from `assemblyNaming.ts`. */
export function assemblyDisplayName(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
  cavityRows: CavityRow[],
): string {
  return buildAssemblyDisplayName(layers, materialsById, cavityRows);
}

export function libraryElementTypeForMode(
  mode: AssemblyElementMode,
  opaqueSubtype: 'wall' | 'roof',
): 'wall' | 'roof' | 'ground_floor' {
  if (mode === 'BuildingElementGround') return 'ground_floor';
  if (mode === 'BuildingElementOpaque') return opaqueSubtype;
  if (mode === 'BuildingElementAdjacentConditionedSpace') return opaqueSubtype;
  if (mode === 'BuildingElementPartyWall') return 'wall';
  return 'wall';
}

export function buildUserAssemblyExample(
  layers: AssemblyLayer[],
  elementMode: AssemblyElementMode,
  libraryElementType: 'wall' | 'roof' | 'ground_floor',
  materialsById: Map<string, MaterialRow>,
  cavityRows: CavityRow[],
  externalDetailProfile?: ExternalDetailProfileLink | null,
): AssemblyExample {
  const canonical = canonicalUserAssemblyJson(layers, elementMode, libraryElementType, externalDetailProfile);
  const id = userAssemblyIdFromCanonical(canonical);
  const name = buildAssemblyDisplayName(layers, materialsById, cavityRows);
  const layerJson = layers.map((L) => {
    if (L.kind === 'solid') {
      const row: Record<string, unknown> = {
        kind: 'solid' as const,
        materialId: L.materialId,
        thickness_m: round6(L.thickness_m),
      };
      if (L.repeatingBridges && L.repeatingBridges.length > 0) {
        row.repeatingBridges = L.repeatingBridges.map((b) => ({
          id: b.id,
          bridgeMaterialId: b.bridgeMaterialId,
          definition: b.definition,
        }));
      }
      return row as AssemblyExample['layers'][number];
    }
    return {
      kind: 'cavity' as const,
      cavityType: L.cavityType,
      ...(typeof L.fixedResistance_m2K_W === 'number' ? { fixedResistance_m2K_W: round6(L.fixedResistance_m2K_W) } : {}),
      ...(L.ventilation ? { ventilation: L.ventilation } : {}),
      ...(typeof L.gap_thickness_m === 'number' ? { gap_thickness_m: round6(L.gap_thickness_m) } : {}),
      ...(L.surface_emissivity ? { surface_emissivity: L.surface_emissivity } : {}),
      ...(L.annexFAirVoidLevelOverride !== undefined
        ? { annexFAirVoidLevelOverride: L.annexFAirVoidLevelOverride }
        : {}),
    };
  });
  return {
    id,
    name,
    elementType: libraryElementType,
    layers: layerJson,
    sourceType: 'user',
    ...(externalDetailProfile ? { externalDetailProfile } : {}),
  };
}
