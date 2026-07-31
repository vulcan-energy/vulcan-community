// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared CSV preset utilities.
 * Extracted from geometryWorker so they can be unit-tested outside the worker context.
 */

/**
 * Keys removed from extra_json before WASM → HEM JSON merge.
 * - UI-only: presets, psi picker state, canvas PV footprint flags (`_pv_*`).
 * - Audit-only: large assembly payloads — HEM does not read them; the saved geometry CSV
 *   (written before strip) retains the full extra_json for evidence / review.
 *
 * Do **not** add `junction_preset_id` / `junction_preset_name` here — they must survive strip
 * for lodged evidence and model reload (same CSV column; `ioSlice` exports full `extra_json`).
 */
export const EXTRA_JSON_UI_KEYS = [
  '_element_preset',
  '_system_source',
  '_ground_line_height_m',
  'psi_source',
  'vulcan_assembly_v1',
  /** ISO 6946 R_u calculator fields (incl. optional exposed-wall assembly id for split mode) */
  'ru_calculator_state_v1',
  /** Window treatment simplified UI snapshot (paired with `treatment` in extra_json) */
  '_treatment_ui',
  /** Adjacent conditioned “Party floor” UI toggle; not a HEM input field. */
  '_vulcan_ui_party_element',
  /** P1–P3: id of the adjacent / party line for ψ apportion; not a HEM input field. */
  '_vulcan_ui_tb_adjacent_element_id',
  /** Legacy UI hint key (removed from product); strip so it never reaches HEM merge. */
  '_vulcan_ui_tb_suggest_junction',
];

/** Minimal CSV line parser that handles quoted fields. */
/**
 * When `FALSE`, the model’s base JSON is hidden from the Scenarios tab base-model picker
 * (set automatically after merge from strict FHS/ECaaS validation outcome).
 */
export const SCENARIOS_BASE_MODEL_ENABLED_KEY = 'ScenariosBaseModelEnabled';

/** Trailing empty columns match `ioSlice` metadata row shape. */
export function scenariosBaseModelEnabledCsvLine(enabled: boolean): string {
  return `${SCENARIOS_BASE_MODEL_ENABLED_KEY},${enabled ? 'TRUE' : 'FALSE'},,,,,,,,,,,,,`;
}

/**
 * Insert or replace a `ScenariosBaseModelEnabled,…` row in a geometry CSV string.
 * Prefers placement immediately after `ComplianceValidationEnabled,`, else after `Metadata,`.
 */
export function upsertScenariosBaseModelEnabledLine(csv: string, enabled: boolean): string {
  const newLine = scenariosBaseModelEnabledCsvLine(enabled);
  const lines = csv.split(/\r?\n/);
  const keyPrefix = `${SCENARIOS_BASE_MODEL_ENABLED_KEY},`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trimStart().startsWith(keyPrefix)) {
      lines[i] = newLine;
      return lines.join('\n');
    }
  }
  let insertAt = -1;
  for (let j = 0; j < lines.length; j++) {
    if (lines[j]!.trimStart().startsWith('ComplianceValidationEnabled,')) {
      insertAt = j + 1;
      break;
    }
  }
  if (insertAt < 0) {
    for (let j = 0; j < lines.length; j++) {
      if (lines[j]!.trimStart().startsWith('Metadata,')) {
        insertAt = j + 1;
        break;
      }
    }
  }
  if (insertAt < 0) insertAt = 0;
  lines.splice(insertAt, 0, newLine);
  return lines.join('\n');
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

/**
 * Strip UI-only keys from all extra_json cells in a geometry CSV string.
 * Works by detecting header rows that contain an "extra_json" column, then
 * parsing and cleaning the JSON in that column for every subsequent data row
 * until the next section header (or end of file).
 */
export function stripUiKeysFromCsv(csv: string): string {
  const lines = csv.split('\n');
  let extraJsonColIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip empty lines
    if (!line.trim()) continue;

    // Detect header rows: they contain "extra_json" as a column name
    const cols = parseCSVLine(line);
    if (cols.includes('extra_json')) {
      extraJsonColIdx = cols.indexOf('extra_json');
      continue;
    }

    // Section headers (e.g. "Exposed Elements,,,,") reset the column index
    // These are lines where the first cell has content and most others are empty
    if (extraJsonColIdx >= 0 && cols.length > 2) {
      const nonEmpty = cols.filter(c => c.trim() !== '');
      if (nonEmpty.length <= 1 && cols[0].trim() !== '') {
        extraJsonColIdx = -1;
        continue;
      }
    }

    // If we have a known extra_json column, clean it
    if (extraJsonColIdx >= 0 && extraJsonColIdx < cols.length) {
      const cell = cols[extraJsonColIdx].trim();
      if (cell) {
        try {
          const parsed = JSON.parse(cell);
          if (parsed && typeof parsed === 'object') {
            let changed = false;
            for (const key of EXTRA_JSON_UI_KEYS) {
              if (key in parsed) {
                delete parsed[key];
                changed = true;
              }
            }
            for (const key of Object.keys(parsed)) {
              if (key.startsWith('_pv_')) {
                delete (parsed as Record<string, unknown>)[key];
                changed = true;
              }
            }
            if (changed) {
              const cleaned = Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : '';
              cols[extraJsonColIdx] = cleaned;
              lines[i] = cols.map(c => {
                // Re-escape cells that contain commas, quotes, or newlines
                if (c.includes(',') || c.includes('"') || c.includes('\n')) {
                  return `"${c.replace(/"/g, '""')}"`;
                }
                return c;
              }).join(',');
            }
          }
        } catch {
          // Not valid JSON — leave as-is
        }
      }
    }
  }

  return lines.join('\n');
}
