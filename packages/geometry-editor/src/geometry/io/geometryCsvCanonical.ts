// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  isTabularGeometryCsvSectionHeaderLine,
  parseGeometryCsvLine,
} from '../../../../geometry-document/src/geometryCsvSections';

/**
 * Canonical bytes for a shared model's content hash: the CSV without its `ModelVersion`
 * metadata row, so the base version a push was made from never changes the hash. Only the
 * Metadata block (up to the first blank or section-title row) is searched; every other byte,
 * line endings included, is left as it is.
 */
export const stripModelVersionRow = (csv: string): string => {
  const lines = csv.split('\n');
  if (!lines[0]?.startsWith('Metadata,')) return csv;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!.replace(/\r$/, '');
    if (/^[,\s]*$/.test(line) || isTabularGeometryCsvSectionHeaderLine(parseGeometryCsvLine(line))) return csv;
    if (line.startsWith('ModelVersion,')) {
      lines.splice(index, 1);
      return lines.join('\n');
    }
  }
  return csv;
};
