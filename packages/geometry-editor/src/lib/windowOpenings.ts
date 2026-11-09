// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometrySchemaMode,
  GeometrySchemaPort,
} from '../../../geometry-editor-host/src/schemaPort';
import { unwrapNullableSchema } from './schemaShape';
import { dereferenceSchemaNodeInRoot } from './subschemaCache';

export type WindowOpeningField = 'free_area_height' | 'mid_height' | 'max_window_open_area';
export type WindowOpeningRow = Partial<Record<WindowOpeningField, number>>;

/**
 * What the a8/a9 converter (`map_window` in `vulcan-model-transform`) will do with a window.
 * `needs_input` and `repair` both stop the run; `repair` means the list itself is the problem.
 */
export type WindowOpenings =
  | { kind: 'rows'; source: 'columns' | 'legacy' | 'parts'; rows: WindowOpeningRow[] }
  | { kind: 'closed' }
  | { kind: 'needs_input'; missing: WindowOpeningField[]; row: WindowOpeningRow }
  | {
      kind: 'repair';
      reason: 'incomplete_parts' | 'conflicting_heights' | 'unsupported_list';
      partIssues: string[];
    };

export type WindowOpeningSource = Readonly<Record<string, unknown>>;
export type WindowOpeningPatch = Partial<Record<WindowOpeningField, number | ''>> & {
  extra_json?: Record<string, unknown>;
};

const OPENING_FIELDS: readonly WindowOpeningField[] = ['free_area_height', 'mid_height', 'max_window_open_area'];
const LEGACY_KEY = 'mid_height_air_flow_path';
const PART_FIELD_LABELS: Record<WindowOpeningField, string> = {
  free_area_height: 'free height',
  mid_height: 'mid height',
  max_window_open_area: 'max open area',
};

const REPAIR_MESSAGES = {
  conflicting_heights:
    'The window parts have different heights. This HEM version needs one opening, or parts with their own free height and max open area.',
  unsupported_list: 'The window part list has entries this HEM version cannot use.',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** The converter's `field()`: a non-blank column first, then `extra_json`. */
function sourceField(row: WindowOpeningSource, key: string): unknown {
  const direct = row[key];
  if (direct !== undefined && direct !== null && direct !== '') return direct;
  return isRecord(row.extra_json) ? row.extra_json[key] : undefined;
}

const columnNumber = (row: WindowOpeningSource, key: WindowOpeningField): number | undefined =>
  finite(sourceField(row, key));

const legacyHeight = (entry: unknown): number | undefined =>
  isRecord(entry) && Object.keys(entry).length === 1 ? finite(entry[LEGACY_KEY]) : undefined;

/** A list entry that carries a physical-opening field, even when it also holds other keys. */
export const isPhysicalPart = (entry: unknown): boolean =>
  isRecord(entry) && OPENING_FIELDS.some((key) => key in entry);

const hasOnlyPartFields = (entry: unknown): entry is Record<string, unknown> =>
  isRecord(entry) && Object.keys(entry).every((key) => OPENING_FIELDS.includes(key as WindowOpeningField));

function isConsistentLegacy(parts: unknown): parts is unknown[] {
  if (!Array.isArray(parts) || parts.length === 0) return false;
  const first = legacyHeight(parts[0]);
  if (first === undefined) return false;
  return parts.every((part) => {
    const height = legacyHeight(part);
    return height !== undefined && Math.abs(height - first) < 1e-9;
  });
}

const isLegacyDivisions = (parts: unknown): boolean =>
  Array.isArray(parts) && parts.length > 0 && parts.every((part) => legacyHeight(part) !== undefined);

/** Ordered list of the opening fields a value does not usably supply. HEM requires mid height > 0. */
function missingFields(row: WindowOpeningRow): WindowOpeningField[] {
  return OPENING_FIELDS.filter((key) => {
    const value = row[key];
    return value === undefined || (key === 'mid_height' && value <= 0);
  });
}

function partRow(part: Record<string, unknown>): WindowOpeningRow {
  const row: WindowOpeningRow = {};
  for (const key of OPENING_FIELDS) {
    const value = finite(part[key]);
    if (value !== undefined) row[key] = value;
  }
  return row;
}

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function classifyColumns(
  row: WindowOpeningSource,
  midpoint: number | undefined,
  source: 'columns' | 'legacy',
): WindowOpenings {
  const opening: WindowOpeningRow = {
    ...partRow({
      free_area_height: columnNumber(row, 'free_area_height'),
      max_window_open_area: columnNumber(row, 'max_window_open_area'),
    }),
    ...(midpoint === undefined ? {} : { mid_height: midpoint }),
  };
  // The converter closes any window with area 0. Older saves wrote 0 automatically while the
  // free height was still blank, so that pair asks for input instead of reading as fixed glazing.
  if (opening.max_window_open_area === 0 && opening.free_area_height !== undefined) return { kind: 'closed' };
  const missing = missingFields(opening);
  return missing.length > 0
    ? { kind: 'needs_input', missing, row: opening }
    : { kind: 'rows', source, rows: [opening] };
}

export function classifyWindowOpenings(row: WindowOpeningSource): WindowOpenings {
  const parts = sourceField(row, 'window_part_list');
  if (parts === undefined) return classifyColumns(row, columnNumber(row, 'mid_height'), 'columns');
  if (!Array.isArray(parts)) return { kind: 'repair', reason: 'unsupported_list', partIssues: [] };
  if (parts.length === 0) return { kind: 'closed' };

  const hasEveryPartField = (part: unknown) => isRecord(part) && missingFields(partRow(part)).length === 0;
  if (parts.every(hasEveryPartField)) {
    return { kind: 'rows', source: 'parts', rows: parts.map((part) => partRow(part as Record<string, unknown>)) };
  }
  if (isConsistentLegacy(parts)) return classifyColumns(row, legacyHeight(parts[0]), 'legacy');
  if (isLegacyDivisions(parts)) return { kind: 'repair', reason: 'conflicting_heights', partIssues: [] };
  if (parts.every(hasOnlyPartFields)) {
    const partIssues = parts.flatMap((part, index) => {
      const missing = missingFields(partRow(part));
      return missing.length === 0
        ? []
        : [`Part ${index + 1} needs ${joinLabels(missing.map((key) => PART_FIELD_LABELS[key]))}`];
    });
    return { kind: 'repair', reason: 'incomplete_parts', partIssues };
  }
  return { kind: 'repair', reason: 'unsupported_list', partIssues: [] };
}

/** One sentence per problem, for a form message or a validation issue. */
export function windowOpeningRepairMessages(openings: Extract<WindowOpenings, { kind: 'repair' }>): string[] {
  return openings.reason === 'incomplete_parts' ? openings.partIssues : [REPAIR_MESSAGES[openings.reason]];
}

/**
 * `true` when the active schema's parts are physical openings (a8/a9), `false` for numerical
 * airflow divisions (a7, Core), and `null` when no schema can say.
 */
export function windowPartsArePhysical(
  schemaPort: GeometrySchemaPort,
  mode: GeometrySchemaMode,
): boolean | null {
  if (schemaPort.availability !== 'available') return null;
  const subschema = schemaPort.getElementSubschema(mode, 'BuildingElementTransparent');
  const list = isRecord(subschema?.properties) ? subschema.properties.window_part_list : undefined;
  if (!isRecord(list)) return null;
  const resolved = dereferenceSchemaNodeInRoot(list, schemaPort.getRootSchema(mode) ?? subschema);
  const items = isRecord(resolved) ? unwrapNullableSchema(resolved).items : undefined;
  return isRecord(items) && isRecord(items.properties) ? !(LEGACY_KEY in items.properties) : null;
}

/** True when part-level rows, not the three main-form inputs, are the place to edit the openings. */
export function windowOpeningsUseTable(row: WindowOpeningSource): boolean {
  const parts = sourceField(row, 'window_part_list');
  return Array.isArray(parts) && parts.length >= 2 && parts.every(hasOnlyPartFields);
}

function extraJsonWithHeight(row: WindowOpeningSource, height: number | undefined): Record<string, unknown> {
  const extra = isRecord(row.extra_json) ? { ...row.extra_json } : {};
  if (height === undefined) delete extra.window_part_list;
  else extra.window_part_list = [{ [LEGACY_KEY]: height }];
  return extra;
}

/** The one-opening normal form: the given values in the columns, one legacy entry in the list. */
export function buildSingleOpeningPatch(
  row: WindowOpeningSource,
  opening: WindowOpeningRow,
): WindowOpeningPatch {
  const patch: WindowOpeningPatch = {};
  for (const key of OPENING_FIELDS) {
    if (opening[key] !== undefined) patch[key] = opening[key];
  }
  patch.extra_json = extraJsonWithHeight(row, opening.mid_height ?? columnNumber(row, 'mid_height'));
  return patch;
}

/** Keep part 1 for physical parts; for legacy divisions keep the window's mid height. */
export function buildConvertToSingleOpeningPatch(row: WindowOpeningSource): WindowOpeningPatch {
  const parts = sourceField(row, 'window_part_list');
  const first = Array.isArray(parts) ? parts.find(isPhysicalPart) : undefined;
  if (isRecord(first)) return buildSingleOpeningPatch(row, partRow(first));
  const height = columnNumber(row, 'mid_height') ?? (Array.isArray(parts) ? legacyHeight(parts[0]) : undefined);
  return buildSingleOpeningPatch(row, height === undefined ? {} : { mid_height: height });
}

/** a8/a9 write for one main-form input. Only the edited column moves unless the list must be rewritten. */
export function buildWindowOpeningFieldPatch(
  row: WindowOpeningSource,
  field: WindowOpeningField,
  value: number | '',
): WindowOpeningPatch {
  const edited = finite(value);
  const parts = sourceField(row, 'window_part_list');
  const patch: WindowOpeningPatch = { [field]: value };

  if (Array.isArray(parts) && parts.length === 1 && isPhysicalPart(parts[0]) && hasOnlyPartFields(parts[0])) {
    return {
      ...buildSingleOpeningPatch(row, { ...partRow(parts[0]), [field]: edited }),
      ...patch,
    };
  }
  if (isConsistentLegacy(parts)) {
    if (field !== 'mid_height') return patch;
    if (edited === undefined) return { ...patch, extra_json: extraJsonWithHeight(row, undefined) };
    return {
      ...patch,
      extra_json: {
        ...(row.extra_json as Record<string, unknown>),
        window_part_list: parts.map(() => ({ [LEGACY_KEY]: edited })),
      },
    };
  }
  if (isLegacyDivisions(parts) && field !== 'mid_height') return patch;

  const height = field === 'mid_height' ? edited : columnNumber(row, 'mid_height');
  if (parts === undefined && height === undefined) return patch;
  return { ...patch, extra_json: extraJsonWithHeight(row, height) };
}

/** Adds a second opening. A closed window becomes one opening that the main form can complete. */
export function buildAddWindowOpeningPatch(row: WindowOpeningSource): WindowOpeningPatch {
  const openings = classifyWindowOpenings(row);
  if (openings.kind === 'closed') {
    return {
      ...(columnNumber(row, 'max_window_open_area') === 0 ? { max_window_open_area: '' as const } : {}),
      ...buildSingleOpeningPatch(row, {}),
    };
  }
  const first = openings.kind === 'rows' ? openings.rows[0] : openings.kind === 'needs_input' ? openings.row : {};
  return {
    extra_json: {
      ...(isRecord(row.extra_json) ? row.extra_json : {}),
      window_part_list: [first, {}],
    },
  };
}

/** A list that still follows the window's mid height keeps following it. */
export function syncWindowPartListToMidHeight(
  row: WindowOpeningSource,
  previousMidHeight: number,
  nextMidHeight: number,
): Record<string, unknown> | null {
  const parts = sourceField(row, 'window_part_list');
  if (!isConsistentLegacy(parts) || Math.abs(legacyHeight(parts[0])! - previousMidHeight) > 0.005) return null;
  return {
    ...(row.extra_json as Record<string, unknown>),
    window_part_list: parts.map(() => ({ [LEGACY_KEY]: nextMidHeight })),
  };
}

/**
 * Shift a list entry's new-style height. Sub-nanometre rounding only removes floating-point
 * noise: the frame conversion must round-trip authored values such as 1.234 unchanged.
 */
export function shiftPhysicalPartHeight<T extends Record<string, unknown>>(part: T, delta: number): T {
  const midHeight = finite(part.mid_height);
  if (midHeight === undefined) return part;
  return { ...part, mid_height: Math.round((midHeight + delta) * 1e9) / 1e9 };
}
