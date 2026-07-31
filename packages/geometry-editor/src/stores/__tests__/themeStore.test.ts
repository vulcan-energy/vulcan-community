// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_VULCAN_THEME_OPTIONS,
  BUILT_IN_CUSTOM_THEME_BASES,
  BUILT_IN_VULCAN_THEME_OPTIONS,
  CUSTOM_VULCAN_THEME_ID,
  DEFAULT_CUSTOM_THEME,
  VULCAN_THEME_EDITABLE_TOKENS,
  VULCAN_THEME_OPTIONS,
  VULCAN_THEME_STORAGE_KEY,
  applyVulcanTheme,
  useThemeStore,
} from '../themeStore';

function relativeLuminance(hexColor: string): number {
  const channelHex = hexColor.slice(1).match(/.{2}/g);
  if (!channelHex || channelHex.length !== 3) throw new Error(`Expected hex colour, got ${hexColor}`);
  const [red, green, blue] = channelHex.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(firstHexColor: string, secondHexColor: string): number {
  const first = relativeLuminance(firstHexColor);
  const second = relativeLuminance(secondHexColor);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('themeStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({
      themeId: 'vulcan-dark',
      customBaseThemeId: 'vulcan-dark',
      customTheme: { ...DEFAULT_CUSTOM_THEME },
    });
    applyVulcanTheme('vulcan-dark', DEFAULT_CUSTOM_THEME);
  });

  it('persists selected built-in themes and applies the document theme attribute', () => {
    useThemeStore.getState().setThemeId('high-contrast-dark');

    expect(document.documentElement.getAttribute('data-vulcan-theme')).toBe('high-contrast-dark');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#061315');
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#FFF45C');
    expect(JSON.parse(window.localStorage.getItem(VULCAN_THEME_STORAGE_KEY) ?? '{}')).toMatchObject({
      themeId: 'high-contrast-dark',
    });
  });

  it('exposes visible presets in the intended menu order while keeping legacy presets valid', () => {
    expect(VULCAN_THEME_OPTIONS.map((option) => option.label)).toEqual([
      'Vulcan Dark',
      'Green Roof',
      'Daylight',
      'Airflow',
      'Solar Gain',
      'Thermal Mass',
      'Infrared',
      'Low Glare',
      'High Contrast Dark',
      'High Contrast Light',
      'Custom',
    ]);
    expect(VULCAN_THEME_OPTIONS.map((option) => option.id)).not.toContain('studio-indigo-light');
    expect(VULCAN_THEME_OPTIONS.map((option) => option.id)).not.toContain('studio-mauve-light');
    expect(ALL_VULCAN_THEME_OPTIONS.map((option) => option.id)).toEqual(
      expect.arrayContaining(['studio-indigo-light', 'studio-mauve-light']),
    );
    expect(BUILT_IN_VULCAN_THEME_OPTIONS.map((option) => option.id)).toEqual(
      expect.arrayContaining(['studio-indigo-light', 'studio-mauve-light']),
    );
  });

  it('persists custom theme values and applies them as root variables', () => {
    useThemeStore.getState().setCustomThemeValue('--bg-primary', '#123456');

    expect(useThemeStore.getState().themeId).toBe(CUSTOM_VULCAN_THEME_ID);
    expect(document.documentElement.getAttribute('data-vulcan-theme')).toBeNull();
    expect(document.documentElement.getAttribute('data-vulcan-custom-theme')).toBe('true');
    expect(document.documentElement.getAttribute('data-vulcan-custom-base')).toBe('vulcan-dark');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#123456');
    expect(document.documentElement.style.getPropertyValue('--surface-overlay-solid')).toBe('#121F22');
    expect(JSON.parse(window.localStorage.getItem(VULCAN_THEME_STORAGE_KEY) ?? '{}')).toMatchObject({
      themeId: CUSTOM_VULCAN_THEME_ID,
      customBaseThemeId: 'vulcan-dark',
      customTheme: {
        '--bg-primary': '#123456',
      },
    });
  });

  it('ignores invalid custom colour values', () => {
    useThemeStore.getState().setCustomThemeValue('--bg-primary', 'not-a-colour');

    expect(useThemeStore.getState().themeId).toBe('vulcan-dark');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#19383A');
    expect(window.localStorage.getItem(VULCAN_THEME_STORAGE_KEY)).toBeNull();
  });

  it('applies specialist theme tokens through the same path', () => {
    useThemeStore.getState().setThemeId('graphite-copper-dark');

    expect(document.documentElement.style.getPropertyValue('--success-text')).toBe('#4ADE80');
    expect(document.documentElement.style.getPropertyValue('--canvas-element-external-wall-stroke')).toBe('#CBD5E1');
    expect(document.documentElement.style.getPropertyValue('--canvas-element-internal-wall-stroke')).toBe('#60A5FA');
    expect(document.documentElement.style.getPropertyValue('--canvas-element-party-wall-stroke')).toBe('#A78BFA');
    expect(document.documentElement.style.getPropertyValue('--canvas-element-adjacent-unconditioned-stroke')).toBe('#FCD34D');
    expect(document.documentElement.style.getPropertyValue('--canvas-3d-bg')).toBe('#111315');
    expect(document.documentElement.style.getPropertyValue('--canvas-3d-window-edge')).toBe('#60A5FA');

    useThemeStore.getState().setCustomThemeValue('--canvas-element-party-wall-stroke', '#123456');

    expect(useThemeStore.getState().themeId).toBe(CUSTOM_VULCAN_THEME_ID);
    expect(document.documentElement.style.getPropertyValue('--canvas-element-party-wall-stroke')).toBe('#123456');
  });

  it('keeps Vulcan Dark chrome borders visible against the app background', () => {
    expect(
      contrastRatio(DEFAULT_CUSTOM_THEME['--border-strong'], DEFAULT_CUSTOM_THEME['--bg-primary']),
    ).toBeGreaterThanOrEqual(3);
  });

  it('keeps stable semantic and derived colours out of editable presets', () => {
    expect(VULCAN_THEME_EDITABLE_TOKENS.map((token) => token.varName)).not.toEqual(
      expect.arrayContaining([
        '--validation-warning',
        '--validation-info',
        '--validation-warning-text',
        '--validation-warning-badge-bg',
        '--semantic-snap',
        '--semantic-explain',
        '--semantic-human',
        '--canvas-element-wall-stroke',
        '--canvas-element-adjacent-stroke',
      ]),
    );

    for (const theme of Object.values(BUILT_IN_CUSTOM_THEME_BASES)) {
      expect(theme).not.toHaveProperty('--validation-warning');
      expect(theme).not.toHaveProperty('--validation-info');
      expect(theme).not.toHaveProperty('--validation-warning-text');
      expect(theme).not.toHaveProperty('--validation-warning-badge-bg');
      expect(theme).not.toHaveProperty('--semantic-snap');
      expect(theme).not.toHaveProperty('--semantic-explain');
      expect(theme).not.toHaveProperty('--semantic-human');
      expect(theme).not.toHaveProperty('--brand-logo-filter');
    }
  });

  it('keeps light-theme external wall tokens bright enough for shaded 3D views', () => {
    const light3dThemes = Object.entries(BUILT_IN_CUSTOM_THEME_BASES).filter(
      ([, theme]) => relativeLuminance(theme['--canvas-3d-bg']) > 0.75,
    );

    expect(light3dThemes.length).toBeGreaterThan(0);

    for (const [themeId, theme] of light3dThemes) {
      expect(relativeLuminance(theme['--canvas-element-external-wall-stroke']), themeId).toBeGreaterThan(0.18);
    }
  });

  it('derives the logo contrast filter from the active theme background', () => {
    useThemeStore.getState().setThemeId('light');

    expect(document.documentElement.style.getPropertyValue('--brand-logo-filter')).toBe('brightness(0) saturate(100%)');
    expect(document.documentElement.style.getPropertyValue('--validation-warning-text')).toBe('#92400E');

    useThemeStore.getState().setThemeId('vulcan-dark');

    expect(document.documentElement.style.getPropertyValue('--brand-logo-filter')).toBe('none');
    expect(document.documentElement.style.getPropertyValue('--validation-warning-text')).toBe('#FCD34D');

    useThemeStore.getState().setCustomThemeValue('--bg-primary', '#FFFFFF');

    expect(document.documentElement.style.getPropertyValue('--brand-logo-filter')).toBe('brightness(0) saturate(100%)');
  });

  it('starts custom edits from the selected built-in preset base', () => {
    useThemeStore.getState().setThemeId('light');
    useThemeStore.getState().setCustomThemeValue('--accent-primary', '#123456');

    expect(useThemeStore.getState().themeId).toBe(CUSTOM_VULCAN_THEME_ID);
    expect(useThemeStore.getState().customBaseThemeId).toBe('light');
    expect(useThemeStore.getState().customTheme['--bg-primary']).toBe('#F4FAF7');
    expect(useThemeStore.getState().customTheme['--accent-primary']).toBe('#123456');
    expect(document.documentElement.getAttribute('data-vulcan-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-vulcan-custom-theme')).toBe('true');
    expect(document.documentElement.getAttribute('data-vulcan-custom-base')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#F4FAF7');
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#123456');
    expect(JSON.parse(window.localStorage.getItem(VULCAN_THEME_STORAGE_KEY) ?? '{}')).toMatchObject({
      themeId: CUSTOM_VULCAN_THEME_ID,
      customBaseThemeId: 'light',
      customTheme: {
        '--bg-primary': '#F4FAF7',
        '--accent-primary': '#123456',
      },
    });
  });
});
