// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { readExplicitTbLineMode, readTbLineMode, writeTbLineMode } from '../thermalBridgeLineMode';

describe('thermal bridge line mode helpers', () => {
  it('defaults to plan mode when metadata is missing', () => {
    expect(readTbLineMode(undefined)).toBe('plan');
    expect(readExplicitTbLineMode({})).toBeUndefined();
  });

  it('writes and reads explicit TB line mode metadata', () => {
    const next = writeTbLineMode({ junction_type: 'E16' }, 'vertical');
    expect(next).toMatchObject({
      junction_type: 'E16',
      _tb_line_mode: 'vertical',
    });
    expect(readTbLineMode(next)).toBe('vertical');
    expect(readExplicitTbLineMode(next)).toBe('vertical');
  });
});
