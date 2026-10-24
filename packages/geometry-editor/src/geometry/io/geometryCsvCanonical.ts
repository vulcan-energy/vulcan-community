// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Canonical bytes for a shared model's content hash: the CSV without its `ModelVersion`
 * metadata row, so the base version a push was made from never changes the hash. Every
 * other byte, line endings included, is left as it is.
 */
export const stripModelVersionRow = (csv: string): string =>
  // ponytail: first `ModelVersion,` line wins; metadata precedes every tabular section.
  csv.replace(/^ModelVersion,[^\r\n]*(?:\r?\n|$)/m, '');
