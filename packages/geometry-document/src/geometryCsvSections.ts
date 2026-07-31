// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Sections accepted by the canonical geometry CSV parser and editor export. */
export const KNOWN_GEOMETRY_CSV_SECTIONS: ReadonlySet<string> = new Set([
  'Metadata',
  'Exposed Elements',
  'Window Elements',
  'Ground Elements',
  'Non-Exposed Elements',
  'Thermal Bridging Elements',
  'Zone',
  'Window Shading',
  'Lighting',
  'Ventilation Systems',
  'Combustion Appliances',
  'Water Pipework',
  'Wet Emitters',
  'Appliances',
  'Hot Water Outlets',
  'Context Shading',
  'On-Site Generation',
  'Systems',
  'Space Labels',
  'Test Section',
]);

/** Parse one CSV line with the same RFC-style quoting rules as the Rust parser. */
export function parseGeometryCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let index = 0;

  while (index < line.length) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (index + 1 < line.length && line[index + 1] === '"') {
          current += '"';
          index += 2;
        } else {
          inQuotes = false;
          index += 1;
        }
      } else {
        current += character;
        index += 1;
      }
    } else if (character === '"') {
      inQuotes = true;
      index += 1;
    } else if (character === ',') {
      fields.push(current);
      current = '';
      index += 1;
    } else {
      current += character;
      index += 1;
    }
  }
  fields.push(current);
  return fields;
}

export function isGeometryCsvSectionHeaderLine(
  fields: readonly string[],
): boolean {
  if (fields.length === 0) return false;
  const first = fields[0]!.trim();
  return first.length > 0
    && KNOWN_GEOMETRY_CSV_SECTIONS.has(first)
    && fields.slice(1).every((field) => field.trim() === '');
}

/** True for a recognised non-Metadata section title row. */
export function isTabularGeometryCsvSectionHeaderLine(
  fields: readonly string[],
): boolean {
  if (!isGeometryCsvSectionHeaderLine(fields)) return false;
  return fields[0]!.trim() !== 'Metadata';
}

/** Lines must be non-empty trimmed rows, matching the geometry CSV pre-pass. */
export function findTabularGeometryCsvStart(lines: readonly string[]): number {
  if (lines.length === 0) return 0;
  const first = parseGeometryCsvLine(lines[0]!);
  if (
    !isGeometryCsvSectionHeaderLine(first)
    || first[0]!.trim() !== 'Metadata'
  ) {
    return 0;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (isTabularGeometryCsvSectionHeaderLine(parseGeometryCsvLine(lines[index]!))) {
      return index;
    }
  }
  return lines.length;
}
