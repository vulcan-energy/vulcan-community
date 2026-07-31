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
};
