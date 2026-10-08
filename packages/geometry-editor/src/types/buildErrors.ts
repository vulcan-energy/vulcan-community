// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type BuildErrorItem = {
  source: 'schema' | 'part_f_preflight' | 'fhs_preflight' | 'build';
  message: string;
  path?: string;
  code?: string;
  category?: string;
  userMessage?: string;
  technicalMessage?: string;
  schemaPath?: string;
  keyword?: string;
  /** Non-blocking: shown as a warning, never counted against Save or run. */
  severity?: 'warning';
};

/** Validation by the selected HEM target, e.g. `{ hemVersion: '1.0.0a8', items }`. */
export type TargetValidation = { hemVersion: string; items: readonly BuildErrorItem[] };
