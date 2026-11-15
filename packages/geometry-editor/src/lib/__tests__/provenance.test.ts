// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { provenanceOf } from '../provenance';

it('provenanceOf reads a stated value that differs from its source as the user\'s', () => {
  const at = (source: number | null, current: number | '') => provenanceOf({ kind: 'element', id: 'w' }, 'perimeter', { source, current });
  expect(at(10, 12)).toBe('user');
  expect(at(10, 10.004)).toBe('source');
  expect(at(10, '')).toBe('source');
  expect(at(null, 12)).toBe('source');
});
