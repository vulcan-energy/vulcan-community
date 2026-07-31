// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export const TB_LINE_MODE_KEY = '_tb_line_mode';

export type TbLineMode = 'plan' | 'vertical' | 'slope';

function readExtra(extraJson: unknown): Record<string, unknown> {
  if (extraJson && typeof extraJson === 'object' && !Array.isArray(extraJson)) {
    return extraJson as Record<string, unknown>;
  }
  if (typeof extraJson === 'string' && extraJson.trim() !== '') {
    try {
      const parsed = JSON.parse(extraJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function readTbLineMode(extraJson: unknown): TbLineMode {
  return readExplicitTbLineMode(extraJson) ?? 'plan';
}

export function readExplicitTbLineMode(extraJson: unknown): TbLineMode | undefined {
  const extra = readExtra(extraJson);
  const mode = extra[TB_LINE_MODE_KEY];
  if (mode === 'vertical' || mode === 'slope') return mode;
  if (mode === 'plan') return mode;
  return undefined;
}

export function writeTbLineMode(extraJson: unknown, mode: TbLineMode): Record<string, unknown> {
  return { ...readExtra(extraJson), [TB_LINE_MODE_KEY]: mode };
}
