// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  junctionCodesGroupedBySeries,
  junctionCodesInFacadeAutoModal,
  junctionCodesNotAutoSuggestedByFacadeTool,
} from './facadeAutoTbScope';

describe('facadeAutoTbScope', () => {
  it('lists modal codes including E, R1–R3, P1–P3', () => {
    expect(junctionCodesInFacadeAutoModal()).toEqual([
      'E1',
      'E2',
      'E3',
      'E4',
      'E5',
      'E6',
      'E7',
      'E10',
      'E11',
      'E12',
      'E13',
      'E14',
      'E15',
      'E16',
      'E17',
      'E18',
      'E19',
      'E20',
      'E21',
      'E22',
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
      'P8',
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      'R8',
      'R9',
      'R10',
      'R11',
    ]);
  });

  it('excludes modal codes from not-auto list', () => {
    const manual = junctionCodesNotAutoSuggestedByFacadeTool();
    expect(manual).not.toContain('E1');
    expect(manual).not.toContain('E16');
    expect(manual).not.toContain('E6');
    expect(manual).not.toContain('E7');
    expect(manual).not.toContain('E10');
    expect(manual).not.toContain('E18');
    expect(manual).not.toContain('E20');
    expect(manual).not.toContain('E21');
    expect(manual).not.toContain('E14');
    expect(manual).not.toContain('E15');
    expect(manual).not.toContain('P1');
    expect(manual).not.toContain('P2');
    expect(manual).not.toContain('P3');
    expect(manual).not.toContain('P4');
    expect(manual).not.toContain('R1');
    expect(manual).not.toContain('R2');
    expect(manual).not.toContain('R3');
    expect(manual).not.toContain('R4');
    expect(manual).not.toContain('R10');
  });

  it('groups by series', () => {
    const g = junctionCodesGroupedBySeries(['P2', 'P1', 'E10', 'E7']);
    expect(g).toEqual([
      { series: 'E', codes: ['E7', 'E10'] },
      { series: 'P', codes: ['P1', 'P2'] },
    ]);
  });
});
