// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Section-based CSV parsing for geometry / batch base-model CSVs.
 * Mirrors `hem-batch-core/src/csv_pipeline/parser.rs`: section title row,
 * then a header row, then rectangular data rows.
 */
import {
  findTabularGeometryCsvStart,
  isGeometryCsvSectionHeaderLine,
  isTabularGeometryCsvSectionHeaderLine,
  KNOWN_GEOMETRY_CSV_SECTIONS,
  parseGeometryCsvLine,
} from '../../../../geometry-document/src/geometryCsvSections';

export {
  findTabularGeometryCsvStart,
  KNOWN_GEOMETRY_CSV_SECTIONS,
};

/** Backwards-compatible editor names backed by the shared document primitive. */
export const parseCsvLine = parseGeometryCsvLine;
export const isSectionHeaderLine = isGeometryCsvSectionHeaderLine;
export const isTabularSectionHeaderLine =
  isTabularGeometryCsvSectionHeaderLine;

/** Deprecated CSV section title (not listed in `KNOWN_GEOMETRY_CSV_SECTIONS`). */
export function isLegacyBuildingServicesSectionTitle(fields: string[]): boolean {
  if (fields.length === 0) return false;
  return fields[0].trim() === 'Building Services' && fields.slice(1).every((f) => f.trim() === '');
}

/**
 * Remove deprecated `Building Services,,` blocks (no column-header row in old files).
 * Rows until the next recognised tabular section are dropped.
 */
export function stripLegacyBuildingServicesBlocks(csv: string): string {
  const lines = csv.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = parseCsvLine(line);
    if (!skipping && isLegacyBuildingServicesSectionTitle(f)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (isTabularSectionHeaderLine(f)) {
        skipping = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export interface CsvSection {
  name: string;
  headerLineIndex: number;
  columnHeaders: string[];
  columnHeaderLineIndex: number;
  rows: CsvRow[];
}

export interface CsvRow {
  lineIndex: number;
  fields: string[];
  data: Record<string, string>;
}

export function parseCsvSections(csvText: string): CsvSection[] {
  const lines = csvText.split(/\r?\n/);
  const sections: CsvSection[] = [];
  let currentSection: Omit<CsvSection, 'columnHeaders' | 'columnHeaderLineIndex' | 'rows'> | null = null;
  let columnHeaders: string[] | null = null;
  let columnHeaderLineIndex = -1;
  let rows: CsvRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') continue;

    const fields = parseCsvLine(line);

    if (isSectionHeaderLine(fields)) {
      if (currentSection && columnHeaders) {
        sections.push({
          ...currentSection,
          columnHeaders,
          columnHeaderLineIndex,
          rows,
        });
      }
      currentSection = {
        name: fields[0].trim(),
        headerLineIndex: i,
      };
      columnHeaders = null;
      columnHeaderLineIndex = -1;
      rows = [];
      continue;
    }

    if (currentSection && !columnHeaders) {
      columnHeaders = fields.map((f) => f.trim());
      columnHeaderLineIndex = i;
      continue;
    }

    if (currentSection && columnHeaders) {
      const data: Record<string, string> = {};
      for (let j = 0; j < columnHeaders.length; j++) {
        if (columnHeaders[j]) {
          data[columnHeaders[j]] = (fields[j] ?? '').trim();
        }
      }
      rows.push({ lineIndex: i, fields, data });
    }
  }

  if (currentSection && columnHeaders) {
    sections.push({
      ...currentSection,
      columnHeaders,
      columnHeaderLineIndex,
      rows,
    });
  }

  return sections;
}
