// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import type { DevelopmentContextModel } from './developmentContext';
import type { DevelopmentContextVerticalRelation } from './developmentContextShading';

export type DevelopmentContextValidationState = 'valid' | 'warning' | 'error' | 'unknown';

export type DevelopmentContextValidationCacheEntry = {
  warnings?: unknown[];
  criticalIssues?: unknown[];
  validatedAt?: string;
  wasmValidation?: {
    is_valid?: boolean;
    errors?: unknown[];
  };
  comparisonWarnings?: unknown[];
};

export type DevelopmentContextValidationCache = Record<string, DevelopmentContextValidationCacheEntry | undefined>;

export type DevelopmentContextModelLabelBounds = {
  stem: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  verticalRelation: DevelopmentContextVerticalRelation;
};

export type DevelopmentContextModelLabelItem = {
  stem: string;
  verticalRelation: DevelopmentContextVerticalRelation;
  floorLabel: string;
  floorSort: number | null;
  floorTitle: string;
  validationState: DevelopmentContextValidationState;
  validationText: string;
  validationTitle: string;
};

export type DevelopmentContextModelLabel = {
  id: string;
  stems: string[];
  models: DevelopmentContextModelLabelItem[];
  primaryText: string;
  floorText: string;
  statusText: string;
  statusState: DevelopmentContextValidationState | 'mixed';
  verticalRelation: DevelopmentContextVerticalRelation;
  isStack: boolean;
  x: number;
  y: number;
  width: number;
  title: string;
};

const STACKED_LABEL_CLUSTER_PX = 36;

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatFloorNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, '');
}

function getLowestCoordinateZ(elements: Element[]): number | null {
  let lowest: number | null = null;
  for (const element of elements) {
    for (const coord of element.coordinates ?? []) {
      if (!Number.isFinite(coord.z)) continue;
      lowest = lowest === null ? coord.z : Math.min(lowest, coord.z);
    }
  }
  return lowest;
}

export function getDevelopmentContextFloorInfo(model: DevelopmentContextModel | undefined): {
  label: string;
  sort: number | null;
  title: string;
} {
  const storey = parseFiniteNumber(model?.metadata?.complianceSettings?.storey_of_dwelling);
  if (storey !== null) {
    return {
      label: `F${formatFloorNumber(storey)}`,
      sort: storey,
      title: `Storey of dwelling ${formatFloorNumber(storey)}`,
    };
  }

  const lowestCoordinateZ = model ? getLowestCoordinateZ(model.elements) : null;
  if (lowestCoordinateZ !== null) {
    const inferredFloor = Math.floor(lowestCoordinateZ) + 1;
    return {
      label: `F${inferredFloor}`,
      sort: inferredFloor,
      title: `Floor inferred from geometry`,
    };
  }

  return {
    label: 'F?',
    sort: null,
    title: 'Floor not recorded',
  };
}

export function getDevelopmentContextValidationInfo(
  stem: string,
  cache: DevelopmentContextValidationCache,
): {
  state: DevelopmentContextValidationState;
  text: string;
  title: string;
} {
  const cached = cache[stem] ?? cache[`${stem}.csv`];
  if (!cached) {
    return { state: 'unknown', text: '?', title: 'Validation not run this session' };
  }

  const criticalCount = cached.criticalIssues?.length ?? 0;
  const wasmErrorCount = cached.wasmValidation?.is_valid === false
    ? Math.max(1, cached.wasmValidation.errors?.length ?? 0)
    : 0;
  const errorCount = criticalCount + wasmErrorCount;
  if (errorCount > 0) {
    return {
      state: 'error',
      text: 'X',
      title: `${errorCount} validation error${errorCount === 1 ? '' : 's'}`,
    };
  }

  const warningCount = (cached.warnings?.length ?? 0) + (cached.comparisonWarnings?.length ?? 0);
  if (warningCount > 0) {
    return {
      state: 'warning',
      text: '!',
      title: `${warningCount} validation warning${warningCount === 1 ? '' : 's'}`,
    };
  }

  return { state: 'valid', text: 'OK', title: 'Validation OK' };
}

function clampLabelPosition(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function summarizeFloors(items: DevelopmentContextModelLabelItem[]): string {
  const knownFloors = Array.from(
    new Set(
      items
        .map((item) => item.floorSort)
        .filter((value): value is number => value !== null && Number.isFinite(value))
        .map((value) => Math.round(value * 10) / 10),
    ),
  ).sort((a, b) => a - b);
  const hasUnknown = items.some((item) => item.floorSort === null);
  if (knownFloors.length === 0) return 'F?';
  if (knownFloors.length === 1) {
    return hasUnknown ? `F${formatFloorNumber(knownFloors[0])}+?` : `F${formatFloorNumber(knownFloors[0])}`;
  }
  const allIntegers = knownFloors.every(Number.isInteger);
  const contiguous = allIntegers && knownFloors.every((floor, index) => index === 0 || floor === knownFloors[index - 1] + 1);
  const base = contiguous
    ? `F${formatFloorNumber(knownFloors[0])}-F${formatFloorNumber(knownFloors[knownFloors.length - 1])}`
    : knownFloors.slice(0, 3).map((floor) => `F${formatFloorNumber(floor)}`).join(',');
  const truncated = !contiguous && knownFloors.length > 3 ? `${base}+` : base;
  return hasUnknown ? `${truncated}+?` : truncated;
}

function summarizeStatus(items: DevelopmentContextModelLabelItem[]): {
  text: string;
  state: DevelopmentContextValidationState | 'mixed';
} {
  if (items.length === 1) {
    return { text: items[0].validationText, state: items[0].validationState };
  }

  const counts: Record<DevelopmentContextValidationState, number> = {
    error: 0,
    warning: 0,
    unknown: 0,
    valid: 0,
  };
  for (const item of items) counts[item.validationState] += 1;
  const parts = [
    counts.error ? `${counts.error}X` : '',
    counts.warning ? `${counts.warning}!` : '',
    counts.unknown ? `${counts.unknown}?` : '',
    counts.valid ? `${counts.valid}OK` : '',
  ].filter(Boolean);
  const states = new Set(items.map((item) => item.validationState));
  return {
    text: parts.join(' '),
    state: states.size === 1 ? items[0].validationState : 'mixed',
  };
}

function summarizeRelation(items: DevelopmentContextModelLabelItem[]): DevelopmentContextVerticalRelation {
  const first = items[0]?.verticalRelation ?? 'same';
  return items.every((item) => item.verticalRelation === first) ? first : 'same';
}

function buildLabelTitle(args: {
  primaryText: string;
  floorText: string;
  statusText: string;
  models: DevelopmentContextModelLabelItem[];
}): string {
  if (args.models.length === 1) {
    const model = args.models[0];
    return `${model.stem} - ${model.floorTitle} - ${model.validationTitle}`;
  }
  return `${args.primaryText} - ${args.floorText} - ${args.statusText}`;
}

function estimateLabelWidth(args: {
  primaryText: string;
  floorText: string;
  statusText: string;
  isStack: boolean;
}): number {
  const estimated = args.primaryText.length * 7 + args.floorText.length * 6 + args.statusText.length * 6 + 44;
  return Math.min(260, Math.max(args.isStack ? 142 : 112, estimated));
}

export function buildDevelopmentContextModelLabels(args: {
  bounds: DevelopmentContextModelLabelBounds[];
  contextModels: DevelopmentContextModel[];
  csvValidationCache: DevelopmentContextValidationCache;
  stageWidth: number;
  stageHeight: number;
}): DevelopmentContextModelLabel[] {
  const modelByStem = new Map(args.contextModels.map((model) => [model.stem, model]));
  const candidates = args.bounds
    .filter((bounds) => (
      Number.isFinite(bounds.minX) &&
      Number.isFinite(bounds.minY) &&
      Number.isFinite(bounds.maxX) &&
      Number.isFinite(bounds.maxY)
    ))
    .map((bounds) => {
      const floor = getDevelopmentContextFloorInfo(modelByStem.get(bounds.stem));
      const validation = getDevelopmentContextValidationInfo(bounds.stem, args.csvValidationCache);
      return {
        bounds,
        centerX: (bounds.minX + bounds.maxX) / 2,
        centerY: (bounds.minY + bounds.maxY) / 2,
        item: {
          stem: bounds.stem,
          verticalRelation: bounds.verticalRelation,
          floorLabel: floor.label,
          floorSort: floor.sort,
          floorTitle: floor.title,
          validationState: validation.state,
          validationText: validation.text,
          validationTitle: validation.title,
        },
      };
    })
    .sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX || a.item.stem.localeCompare(b.item.stem));

  const groups: typeof candidates[] = [];
  for (const candidate of candidates) {
    const group = groups.find((existing) => {
      const anchor = existing[0];
      return (
        Math.abs(candidate.centerX - anchor.centerX) <= STACKED_LABEL_CLUSTER_PX &&
        Math.abs(candidate.centerY - anchor.centerY) <= STACKED_LABEL_CLUSTER_PX
      );
    });
    if (group) {
      group.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }

  return groups.map((group) => {
    const models = group
      .map((candidate) => candidate.item)
      .sort((a, b) => {
        if (a.floorSort !== null && b.floorSort !== null && a.floorSort !== b.floorSort) return a.floorSort - b.floorSort;
        if (a.floorSort !== null) return -1;
        if (b.floorSort !== null) return 1;
        return a.stem.localeCompare(b.stem);
      });
    const isStack = models.length > 1;
    const primaryText = isStack ? `${models.length} stacked` : models[0].stem;
    const floorText = isStack ? summarizeFloors(models) : models[0].floorLabel;
    const status = summarizeStatus(models);
    const verticalRelation = summarizeRelation(models);
    const width = estimateLabelWidth({
      primaryText,
      floorText,
      statusText: status.text,
      isStack,
    });
    const halfWidth = width / 2;
    const centerX = group.reduce((sum, candidate) => sum + candidate.centerX, 0) / group.length;
    const centerY = group.reduce((sum, candidate) => sum + candidate.centerY, 0) / group.length;
    const x = clampLabelPosition(centerX, halfWidth + 8, Math.max(halfWidth + 8, args.stageWidth - halfWidth - 8));
    const y = clampLabelPosition(centerY, 22, Math.max(22, args.stageHeight - 22));
    const stems = models.map((model) => model.stem);
    const title = buildLabelTitle({
      primaryText,
      floorText,
      statusText: status.text,
      models,
    });
    return {
      id: isStack ? `stack:${stems.join('|')}` : `model:${stems[0]}`,
      stems,
      models,
      primaryText,
      floorText,
      statusText: status.text,
      statusState: status.state,
      verticalRelation,
      isStack,
      x,
      y,
      width,
      title,
    };
  });
}
