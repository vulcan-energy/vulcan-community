// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryProjectContextProject,
  GeometryProjectContextSnapshot,
} from '../../../geometry-editor-host/src';
import type { Element, Floor, SpaceLabel, Zone } from '../geometry/types';
import { parseCsvToGeometry, type ParsedCsvMetadata } from '../geometry/io/parseCsvToGeometry';
import {
  applyFloorBaseHeightOverrides,
  applyFloorHeightOverrides,
  deriveFloorsFromElements,
} from './floorDerivation';

export type DevelopmentContextProject = GeometryProjectContextProject;
type GeometryListFilter = Extract<
  GeometryProjectContextSnapshot,
  { status: 'ready' }
>['geometryListFilter'];

export interface DevelopmentContextModel {
  stem: string;
  elements: Element[];
  zones: Zone[];
  floors: Floor[];
  spaceLabels: SpaceLabel[];
  metadata: ParsedCsvMetadata;
}

export function normalizeBaseModelStem(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const parts = withoutQuery.split(/[\\/]/);
  const filename = parts[parts.length - 1] ?? withoutQuery;
  return filename.endsWith('.csv') ? filename.slice(0, -4) : filename;
}

export function resolveDevelopmentContextProject(args: {
  projects: readonly DevelopmentContextProject[];
  selectedProjectId: string | null;
  geometryListFilter: GeometryListFilter;
  currentStem: string;
  draftProjectContextId?: string | null;
}): DevelopmentContextProject | null {
  const draftProject = args.draftProjectContextId
    ? args.projects.find((project) => project.id === args.draftProjectContextId)
    : undefined;
  if (draftProject?.kind === 'development') return draftProject;

  const currentStem = normalizeBaseModelStem(args.currentStem);
  if (!currentStem || currentStem === 'draft_model') return null;

  const isDevelopmentProjectForCurrentStem = (project: DevelopmentContextProject | undefined): project is DevelopmentContextProject =>
    Boolean(
      project &&
      project.kind === 'development' &&
      project.baseModelStems.some((stem) => normalizeBaseModelStem(stem) === currentStem)
    );

  const selected = args.selectedProjectId
    ? args.projects.find((project) => project.id === args.selectedProjectId)
    : undefined;
  if (isDevelopmentProjectForCurrentStem(selected)) return selected;

  const geometryFilterProject =
    args.geometryListFilter !== 'all' && args.geometryListFilter !== 'unassigned'
      ? args.projects.find((project) => project.id === args.geometryListFilter)
      : undefined;
  if (isDevelopmentProjectForCurrentStem(geometryFilterProject)) return geometryFilterProject;

  const matchingDevelopmentProjects = args.projects.filter(isDevelopmentProjectForCurrentStem);
  return matchingDevelopmentProjects.length === 1 ? matchingDevelopmentProjects[0] : null;
}

export function resolveNewModelDevelopmentContextProjectId(args: {
  projects: readonly DevelopmentContextProject[];
  selectedProjectId: string | null;
  geometryListFilter: GeometryListFilter;
  currentStem: string;
  draftProjectContextId?: string | null;
}): string | null {
  return resolveDevelopmentContextProject(args)?.id ?? null;
}

export function getDevelopmentContextStems(
  project: DevelopmentContextProject,
  currentStem: string,
): string[] {
  const normalizedCurrent = normalizeBaseModelStem(currentStem);
  const seen = new Set<string>();
  const stems: string[] = [];
  for (const rawStem of project.baseModelStems) {
    const stem = normalizeBaseModelStem(rawStem);
    if (!stem || stem === normalizedCurrent || seen.has(stem)) continue;
    seen.add(stem);
    stems.push(stem);
  }
  return stems;
}

export function parseDevelopmentContextModel(stem: string, csvContent: string): DevelopmentContextModel {
  const parsed = parseCsvToGeometry(csvContent);
  // Neighbour models are read-only snapshots (no store, no `loadFromCSV`), so — unlike the primary
  // editor model — nothing else applies `FloorHeightOverride` metadata rows onto the derived
  // floors. Without this, a neighbour dwelling's typed storey height was silently dropped and
  // context shading fell back to the wall-derived height instead.
  const floors = applyFloorHeightOverrides(
    deriveFloorsFromElements(parsed.elements),
    parsed.metadata.floorHeightOverrides,
  );
  const floorsWithBaseOverrides = applyFloorBaseHeightOverrides(
    floors,
    parsed.metadata.floorBaseHeightOverrides,
  );
  return {
    stem: normalizeBaseModelStem(stem),
    elements: parsed.elements,
    zones: parsed.zones,
    floors: floorsWithBaseOverrides,
    spaceLabels: parsed.spaceLabels,
    metadata: parsed.metadata,
  };
}
