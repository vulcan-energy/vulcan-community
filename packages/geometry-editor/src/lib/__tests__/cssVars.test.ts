// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'vitest';
import { readRootCssVar } from '../cssVars';

// The four call sites this replaced (GeometryCanvas.tsx, GeometryCanvas3D.tsx,
// geometry3dMapper.ts, elementRendererPalette.ts) had drifted on cycle-guard strategy —
// this locks in the unified (strict, Set-based) behaviour.
describe('readRootCssVar', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('reads a literal custom property', () => {
    document.documentElement.style.setProperty('--test-color', '#123456');
    expect(readRootCssVar('--test-color', '#fallback')).toBe('#123456');
  });

  it('falls back when the property is unset', () => {
    expect(readRootCssVar('--test-color-unset', '#fallback')).toBe('#fallback');
  });

  it('follows a var() indirection chain', () => {
    document.documentElement.style.setProperty('--test-a', 'var(--test-b)');
    document.documentElement.style.setProperty('--test-b', '#abcdef');
    expect(readRootCssVar('--test-a', '#fallback')).toBe('#abcdef');
  });

  it('follows chains deeper than one level (no depth cap)', () => {
    // The retired GeometryCanvas3D variant capped recursion at depth 4 and could
    // return the literal var() string; this locks the unbounded-but-cycle-safe choice.
    document.documentElement.style.setProperty('--test-d1', 'var(--test-d2)');
    document.documentElement.style.setProperty('--test-d2', 'var(--test-d3)');
    document.documentElement.style.setProperty('--test-d3', 'var(--test-d4)');
    document.documentElement.style.setProperty('--test-d4', 'var(--test-d5)');
    document.documentElement.style.setProperty('--test-d5', 'var(--test-d6)');
    document.documentElement.style.setProperty('--test-d6', '#0f0f0f');
    expect(readRootCssVar('--test-d1', '#fallback')).toBe('#0f0f0f');
  });

  it('honours the inline var() fallback over the JS fallback argument', () => {
    // The retired variant's non-capturing regex group discarded the inline fallback.
    document.documentElement.style.setProperty('--test-inline', 'var(--test-inline-missing, #aa11bb)');
    expect(readRootCssVar('--test-inline', '#fallback')).toBe('#aa11bb');
  });

  it('falls back on a genuine cycle instead of hanging', () => {
    document.documentElement.style.setProperty('--test-cycle-a', 'var(--test-cycle-b)');
    document.documentElement.style.setProperty('--test-cycle-b', 'var(--test-cycle-a)');
    expect(readRootCssVar('--test-cycle-a', '#fallback')).toBe('#fallback');
  });

  it('falls back on a color-mix() value canvas/3D consumers cannot use directly', () => {
    document.documentElement.style.setProperty(
      '--test-mix',
      'color-mix(in srgb, red 50%, blue)',
    );
    expect(readRootCssVar('--test-mix', '#fallback')).toBe('#fallback');
  });
});
