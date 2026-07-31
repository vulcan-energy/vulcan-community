// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { JUNCTION_TYPE_ENUM, getPsiForJunctionType } from './simplifiedFabricMap';

/** Workspace folder for junction ψ CSV files (relative to workspace root). */
export const JUNCTION_PSI_DEFAULTS_DIR = 'input/junction_psi_defaults';

/** Shipped full table (Table 3.7); copy to override per project. */
export const DEFAULT_JUNCTION_PSI_CSV_FILENAME = 'table_3_7_default_psi.csv';

export const DEFAULT_JUNCTION_PSI_CSV_RELATIVE_PATH = `${JUNCTION_PSI_DEFAULTS_DIR}/${DEFAULT_JUNCTION_PSI_CSV_FILENAME}`;

const HEADER = 'junction_type,linear_thermal_transmittance';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parse sparse or full junction ψ CSV. Header: junction_type,linear_thermal_transmittance
 * Duplicate junction_type rows: last wins. Lines starting with # are ignored.
 */
export function parseJunctionPsiDefaultsCsv(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  let headerSeen = false;
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const parts = parseCSVLine(line);
    if (!headerSeen) {
      const h0 = (parts[0] || '').trim().toLowerCase();
      const h1 = (parts[1] || '').trim().toLowerCase();
      if (h0 === 'junction_type' && h1 === 'linear_thermal_transmittance') {
        headerSeen = true;
      }
      continue;
    }
    const jt = (parts[0] || '').trim();
    if (!jt) continue;
    const raw = (parts[1] || '').trim();
    const v = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    out[jt] = v;
  }
  return out;
}

/**
 * ψ (W/m·K) from workspace file: explicit row value if present, else built-in Table 3.7.
 */
export function getEffectiveLinearPsiFromWorkspaceSparseMap(
  junctionType: string | undefined,
  sparseMap: Record<string, number> | null | undefined,
): number | undefined {
  if (!junctionType || !junctionType.trim()) return undefined;
  const jt = junctionType.trim();
  if (sparseMap && Object.prototype.hasOwnProperty.call(sparseMap, jt)) {
    const v = sparseMap[jt];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return getPsiForJunctionType(jt);
}

/** Build CSV text from the built-in Table 3.7 map (for tooling / reference). */
export function buildReferenceCsvFromTable(table: Record<string, number>): string {
  const lines = [HEADER];
  for (const code of JUNCTION_TYPE_ENUM) {
    const v = table[code];
    if (v !== undefined && Number.isFinite(v)) {
      lines.push(`${code},${v}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
