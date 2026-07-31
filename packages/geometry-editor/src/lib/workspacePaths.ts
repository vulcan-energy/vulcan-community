// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Canonical merge-defaults template path relative to workspace root (Phase 0). */
export const DEFAULT_DEFAULTS_PATH = 'input/defaults/defaults_template.json';

/** Pre–Phase-0 path; still accepted for reads (canonical location is tried first). */
export const LEGACY_DEFAULT_DEFAULTS_PATH =
  'input/batch_parameters/base_json/defaults_template.json';

export function isLegacyDefaultsTemplatePath(p: string): boolean {
  const n = p.trim().replace(/\\/g, '/');
  return (
    n === LEGACY_DEFAULT_DEFAULTS_PATH ||
    n.endsWith('/batch_parameters/base_json/defaults_template.json')
  );
}

const LEGACY_SUFFIX = 'batch_parameters/base_json/defaults_template.json';
const CANONICAL_SUFFIX = 'defaults/defaults_template.json';

/** Same folder depth as the legacy path but under `input/defaults/` (supports `../input/...` and absolute paths). */
export function siblingCanonicalDefaultsPathForRead(legacyPath: string): string {
  const n = legacyPath.trim().replace(/\\/g, '/');
  const idx = n.lastIndexOf(LEGACY_SUFFIX);
  if (idx >= 0) {
    return `${n.slice(0, idx)}${CANONICAL_SUFFIX}`;
  }
  return DEFAULT_DEFAULTS_PATH;
}

/** Workspace-relative paths to try when loading defaults from disk (new first, then legacy template). */
export function defaultsReadPathAttempts(workspaceRelativePath: string): string[] {
  const t = workspaceRelativePath.trim();
  if (!t) return [];
  if (isLegacyDefaultsTemplatePath(t)) {
    return [siblingCanonicalDefaultsPathForRead(t), t];
  }
  return [t];
}

/** Rewrite known legacy canonical defaults path for CSV metadata / store (export-time normalisation). */
export function normalizeDefaultsPathForMetadata(path: string): string {
  const t = path.trim();
  if (isLegacyDefaultsTemplatePath(t)) return DEFAULT_DEFAULTS_PATH;
  return t;
}
