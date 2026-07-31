// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from 'zustand';

export const VULCAN_THEME_STORAGE_KEY = 'vulcan.theme.v2';
const LEGACY_THEME_STORAGE_KEY = 'vulcan.theme.v1';

export const VULCAN_THEME_EDITABLE_TOKENS = [
  { varName: '--bg-primary', label: 'App background', group: 'Surfaces' },
  { varName: '--bg-secondary', label: 'Panel background', group: 'Surfaces' },
  { varName: '--bg-hover', label: 'Control hover', group: 'Surfaces' },
  { varName: '--surface-overlay-solid', label: 'Canvas panel surface', group: 'Surfaces' },
  { varName: '--accent-primary', label: 'Primary accent', group: 'Accent' },
  { varName: '--accent-hover', label: 'Accent hover', group: 'Accent' },
  { varName: '--text-primary', label: 'Primary text', group: 'Text' },
  { varName: '--text-secondary', label: 'Secondary text', group: 'Text' },
  { varName: '--text-muted', label: 'Muted text', group: 'Text' },
  { varName: '--text-on-accent', label: 'Text on accent', group: 'Text' },
  { varName: '--border-strong', label: 'Strong border', group: 'Borders' },
  { varName: '--success-text', label: 'Success', group: 'Status' },
  { varName: '--error-text', label: 'Error', group: 'Status' },
  { varName: '--chart-series-1', label: 'Series 1', group: 'Charts' },
  { varName: '--chart-series-2', label: 'Series 2', group: 'Charts' },
  { varName: '--chart-series-3', label: 'Series 3', group: 'Charts' },
  { varName: '--chart-series-4', label: 'Series 4', group: 'Charts' },
  { varName: '--chart-series-5', label: 'Series 5', group: 'Charts' },
  { varName: '--chart-series-6', label: 'Series 6', group: 'Charts' },
  { varName: '--chart-series-7', label: 'Series 7', group: 'Charts' },
  { varName: '--chart-series-8', label: 'Series 8', group: 'Charts' },
  { varName: '--canvas-element-selected', label: 'Selected element', group: 'Canvas 2D' },
  { varName: '--canvas-element-external-wall-stroke', label: 'External wall', group: 'Canvas 2D' },
  { varName: '--canvas-element-internal-wall-stroke', label: 'Internal wall', group: 'Canvas 2D' },
  { varName: '--canvas-element-party-wall-stroke', label: 'Party wall', group: 'Canvas 2D' },
  { varName: '--canvas-element-adjacent-unconditioned-stroke', label: 'Adjacent unheated', group: 'Canvas 2D' },
  { varName: '--canvas-element-door-stroke', label: 'Door', group: 'Canvas 2D' },
  { varName: '--canvas-element-window-stroke', label: 'Window', group: 'Canvas 2D' },
  { varName: '--canvas-element-ground-stroke', label: 'Ground', group: 'Canvas 2D' },
  { varName: '--canvas-element-context-stroke', label: 'Context', group: 'Canvas 2D' },
  { varName: '--canvas-element-thermal-bridge-stroke', label: 'Thermal bridge', group: 'Canvas 2D' },
  { varName: '--canvas-element-thermal-bridge-selected-stroke', label: 'Selected thermal bridge', group: 'Canvas 2D' },
  { varName: '--canvas-element-shading-stroke', label: 'Shading', group: 'Canvas 2D' },
  { varName: '--canvas-element-lighting-stroke', label: 'Lighting', group: 'Canvas 2D' },
  { varName: '--canvas-element-ductwork-stroke', label: 'Ductwork', group: 'Canvas 2D' },
  { varName: '--canvas-element-pipework-stroke', label: 'Pipework', group: 'Canvas 2D' },
  { varName: '--canvas-element-emitter-stroke', label: 'Heat emitter', group: 'Canvas 2D' },
  { varName: '--canvas-element-appliance-stroke', label: 'Appliance', group: 'Canvas 2D' },
  { varName: '--canvas-element-hot-water-stroke', label: 'Hot water', group: 'Canvas 2D' },
  { varName: '--canvas-element-vent-stroke', label: 'Vent', group: 'Canvas 2D' },
  { varName: '--canvas-element-mechanical-ventilation-stroke', label: 'Mechanical ventilation', group: 'Canvas 2D' },
  { varName: '--canvas-element-combustion-stroke', label: 'Combustion appliance', group: 'Canvas 2D' },
  { varName: '--canvas-element-onsite-generation-stroke', label: 'Onsite generation', group: 'Canvas 2D' },
  { varName: '--canvas-element-battery-stroke', label: 'Battery', group: 'Canvas 2D' },
  { varName: '--canvas-element-system-stroke', label: 'System', group: 'Canvas 2D' },
  { varName: '--canvas-drawing-guide', label: 'Drawing guide', group: 'Canvas 2D' },
  { varName: '--canvas-drawing-handle-fill', label: 'Drawing handle', group: 'Canvas 2D' },
  { varName: '--canvas-3d-bg', label: '3D background', group: 'Canvas 3D' },
  { varName: '--canvas-3d-grid-cell', label: '3D grid cell', group: 'Canvas 3D' },
  { varName: '--canvas-3d-grid-section', label: '3D grid section', group: 'Canvas 3D' },
  { varName: '--canvas-3d-selection-overlay', label: 'Selection overlay', group: 'Canvas 3D' },
  { varName: '--canvas-3d-dormer-cutout', label: 'Dormer cutout', group: 'Canvas 3D' },
  { varName: '--canvas-3d-fallback-edge', label: 'Fallback edge', group: 'Canvas 3D' },
  { varName: '--canvas-3d-thermal-bridge-emissive', label: 'Thermal bridge glow', group: 'Canvas 3D' },
  { varName: '--canvas-3d-window-edge', label: 'Window edge', group: 'Canvas 3D' },
  { varName: '--canvas-3d-door-edge', label: 'Door edge', group: 'Canvas 3D' },
  { varName: '--canvas-3d-window-emissive', label: 'Window glow', group: 'Canvas 3D' },
  { varName: '--canvas-3d-door-emissive', label: 'Door glow', group: 'Canvas 3D' },
  { varName: '--canvas-3d-vent-free-area', label: 'Vent free area', group: 'Canvas 3D' },
  { varName: '--canvas-3d-vent-max-open', label: 'Vent max open', group: 'Canvas 3D' },
  { varName: '--canvas-3d-vent-frame', label: 'Vent frame', group: 'Canvas 3D' },
  { varName: '--canvas-3d-icon-stroke', label: '3D icon stroke', group: 'Canvas 3D' },
] as const;

export type VulcanEditableThemeVar = (typeof VULCAN_THEME_EDITABLE_TOKENS)[number]['varName'];
export type VulcanCustomTheme = Record<VulcanEditableThemeVar, string>;

const LEGACY_THEME_TOKENS = [
  '--canvas-element-wall-stroke',
  '--canvas-element-adjacent-stroke',
] as const;

const THEME_TOKEN_LEGACY_FALLBACKS: Partial<Record<VulcanEditableThemeVar, readonly string[]>> = {
  '--canvas-element-external-wall-stroke': ['--canvas-element-wall-stroke'],
  '--canvas-element-internal-wall-stroke': ['--canvas-element-adjacent-stroke'],
  '--canvas-element-party-wall-stroke': ['--canvas-element-adjacent-stroke'],
  '--canvas-element-adjacent-unconditioned-stroke': ['--canvas-element-adjacent-stroke'],
};

const NON_EDITABLE_THEME_TOKENS = [
  '--validation-warning',
  '--validation-info',
  '--validation-error-text',
  '--validation-warning-text',
  '--validation-info-text',
  '--validation-error-badge-bg',
  '--validation-warning-badge-bg',
  '--validation-info-badge-bg',
  '--validation-error-badge-border',
  '--validation-warning-badge-border',
  '--validation-info-badge-border',
  '--semantic-snap',
  '--semantic-explain',
  '--semantic-human',
  '--brand-logo-filter',
  ...LEGACY_THEME_TOKENS,
] as const;

const BRAND_LOGO_FILTER_FOR_LIGHT_BACKGROUND = 'brightness(0) saturate(100%)';
const BRAND_LOGO_FILTER_FOR_DARK_BACKGROUND = 'none';

const VALIDATION_PRESENTATION_FOR_LIGHT_BACKGROUND = {
  '--validation-error-text': '#B91C1C',
  '--validation-error-badge-bg': 'rgba(220, 38, 38, 0.08)',
  '--validation-error-badge-border': 'rgba(220, 38, 38, 0.48)',
  '--validation-warning-text': '#92400E',
  '--validation-warning-badge-bg': 'rgba(245, 158, 11, 0.11)',
  '--validation-warning-badge-border': 'rgba(217, 119, 6, 0.56)',
  '--validation-info-text': '#1D4ED8',
  '--validation-info-badge-bg': 'rgba(59, 130, 246, 0.10)',
  '--validation-info-badge-border': 'rgba(37, 99, 235, 0.44)',
} as const;

const VALIDATION_PRESENTATION_FOR_DARK_BACKGROUND = {
  '--validation-error-text': '#FCA5A5',
  '--validation-error-badge-bg': 'rgba(220, 38, 38, 0.15)',
  '--validation-error-badge-border': 'rgba(248, 113, 113, 0.45)',
  '--validation-warning-text': '#FCD34D',
  '--validation-warning-badge-bg': 'rgba(245, 158, 11, 0.16)',
  '--validation-warning-badge-border': 'rgba(251, 191, 36, 0.45)',
  '--validation-info-text': '#93C5FD',
  '--validation-info-badge-bg': 'rgba(59, 130, 246, 0.15)',
  '--validation-info-badge-border': 'rgba(96, 165, 250, 0.40)',
} as const;

export const DEFAULT_CUSTOM_THEME: VulcanCustomTheme = {
  '--bg-primary': '#19383A',
  '--bg-secondary': '#29494C',
  '--bg-hover': '#355A62',
  '--surface-overlay-solid': '#121F22',
  '--accent-primary': '#DDEE63',
  '--accent-hover': '#C9DD55',
  '--text-primary': '#FFFFFF',
  '--text-secondary': '#B7CEC4',
  '--text-muted': '#9BB3AC',
  '--text-on-accent': '#19383A',
  '--border-strong': '#6A8A8D',
  '--success-text': '#22C55E',
  '--error-text': '#FF6B6B',
  '--chart-series-1': '#FFFFFF',
  '--chart-series-2': '#DDEE63',
  '--chart-series-3': '#87CEEB',
  '--chart-series-4': '#FFA07A',
  '--chart-series-5': '#98FB98',
  '--chart-series-6': '#DDA0DD',
  '--chart-series-7': '#F0E68C',
  '--chart-series-8': '#FFB6C1',
  '--canvas-element-selected': '#FF6B6B',
  '--canvas-element-external-wall-stroke': '#D7E7E1',
  '--canvas-element-internal-wall-stroke': '#8BD3FF',
  '--canvas-element-party-wall-stroke': '#C084FC',
  '--canvas-element-adjacent-unconditioned-stroke': '#FBBF24',
  '--canvas-element-door-stroke': '#FF9F2F',
  '--canvas-element-window-stroke': '#87CEEB',
  '--canvas-element-ground-stroke': '#6DBB6D',
  '--canvas-element-context-stroke': '#9CA3AF',
  '--canvas-element-thermal-bridge-stroke': '#FF6B35',
  '--canvas-element-thermal-bridge-selected-stroke': '#FF7A3D',
  '--canvas-element-shading-stroke': '#F4C430',
  '--canvas-element-lighting-stroke': '#FFB347',
  '--canvas-element-ductwork-stroke': '#4ADE80',
  '--canvas-element-pipework-stroke': '#38BDF8',
  '--canvas-element-emitter-stroke': '#60A5FA',
  '--canvas-element-appliance-stroke': '#CBD5E1',
  '--canvas-element-hot-water-stroke': '#FB7185',
  '--canvas-element-vent-stroke': '#22D3EE',
  '--canvas-element-mechanical-ventilation-stroke': '#2DD4BF',
  '--canvas-element-combustion-stroke': '#FF7A3D',
  '--canvas-element-onsite-generation-stroke': '#FACC15',
  '--canvas-element-battery-stroke': '#A78BFA',
  '--canvas-element-system-stroke': '#FB923C',
  '--canvas-drawing-guide': '#DDEE63',
  '--canvas-drawing-handle-fill': '#DDEE63',
  '--canvas-3d-bg': '#0D1417',
  '--canvas-3d-grid-cell': '#27383D',
  '--canvas-3d-grid-section': '#4B6269',
  '--canvas-3d-selection-overlay': '#FFF176',
  '--canvas-3d-dormer-cutout': '#F6DF5A',
  '--canvas-3d-fallback-edge': '#64748B',
  '--canvas-3d-thermal-bridge-emissive': '#6B5A12',
  '--canvas-3d-window-edge': '#7EC8FF',
  '--canvas-3d-door-edge': '#FFB366',
  '--canvas-3d-window-emissive': '#153A5C',
  '--canvas-3d-door-emissive': '#5C3010',
  '--canvas-3d-vent-free-area': '#22D3EE',
  '--canvas-3d-vent-max-open': '#FBBF24',
  '--canvas-3d-vent-frame': '#F5F0D6',
  '--canvas-3d-icon-stroke': '#FFFFFF',
};

function makeTheme(values: Partial<VulcanCustomTheme>): VulcanCustomTheme {
  return { ...DEFAULT_CUSTOM_THEME, ...values };
}

export const BUILT_IN_VULCAN_THEMES = [
  { id: 'vulcan-dark', label: 'Vulcan Dark', theme: DEFAULT_CUSTOM_THEME },
  {
    id: 'high-contrast-dark',
    label: 'High Contrast Dark',
    theme: makeTheme({
      '--bg-primary': '#061315',
      '--bg-secondary': '#102427',
      '--bg-hover': '#1A3438',
      '--surface-overlay-solid': '#061315',
      '--accent-primary': '#FFF45C',
      '--accent-hover': '#FFE83D',
      '--text-primary': '#FFFFFF',
      '--text-secondary': '#E3F4EF',
      '--text-muted': '#C7D8D2',
      '--text-on-accent': '#061315',
      '--border-strong': '#E3F4EF',
      '--chart-series-2': '#FFF45C',
      '--canvas-drawing-guide': '#FFF45C',
      '--canvas-drawing-handle-fill': '#FFF45C',
    }),
  },
  {
    id: 'low-glare-dark',
    label: 'Low Glare',
    theme: makeTheme({
      '--bg-primary': '#182827',
      '--bg-secondary': '#253836',
      '--bg-hover': '#314744',
      '--surface-overlay-solid': '#162221',
      '--accent-primary': '#D9E76E',
      '--accent-hover': '#CDDC5E',
      '--text-primary': '#F4F1E8',
      '--text-secondary': '#C8D6CC',
      '--text-muted': '#AEBDB4',
      '--text-on-accent': '#182827',
      '--border-strong': '#4A625E',
      '--chart-series-1': '#F4F1E8',
      '--chart-series-2': '#D9E76E',
      '--canvas-drawing-guide': '#D9E76E',
      '--canvas-drawing-handle-fill': '#D9E76E',
    }),
  },
  {
    id: 'light',
    label: 'Green Roof',
    theme: makeTheme({
      '--bg-primary': '#F4FAF7',
      '--bg-secondary': '#FFFFFF',
      '--bg-hover': '#DDECE7',
      '--surface-overlay-solid': '#FFFFFF',
      '--accent-primary': '#A3B91F',
      '--accent-hover': '#849917',
      '--text-primary': '#19383A',
      '--text-secondary': '#355A62',
      '--text-muted': '#5F7774',
      '--text-on-accent': '#19383A',
      '--border-strong': '#9FB7B1',
      '--success-text': '#15803D',
      '--error-text': '#DC2626',
      '--chart-series-1': '#19383A',
      '--chart-series-2': '#A3B91F',
      '--chart-series-3': '#0F766E',
      '--chart-series-4': '#C2410C',
      '--chart-series-5': '#15803D',
      '--chart-series-6': '#7C3AED',
      '--chart-series-7': '#BE123C',
      '--chart-series-8': '#5F7774',
      '--canvas-element-selected': '#19383A',
      '--canvas-element-external-wall-stroke': '#789096',
      '--canvas-element-internal-wall-stroke': '#0B86B6',
      '--canvas-element-party-wall-stroke': '#8B5CF6',
      '--canvas-element-adjacent-unconditioned-stroke': '#B7791F',
      '--canvas-element-door-stroke': '#A34F00',
      '--canvas-element-window-stroke': '#0F766E',
      '--canvas-element-ground-stroke': '#2F6F45',
      '--canvas-element-context-stroke': '#697479',
      '--canvas-element-thermal-bridge-stroke': '#B93800',
      '--canvas-element-thermal-bridge-selected-stroke': '#D94A1F',
      '--canvas-element-shading-stroke': '#7A4A00',
      '--canvas-element-lighting-stroke': '#A34F00',
      '--canvas-element-ductwork-stroke': '#1F6B38',
      '--canvas-element-pipework-stroke': '#005B7C',
      '--canvas-element-emitter-stroke': '#1D4ED8',
      '--canvas-element-appliance-stroke': '#4B5563',
      '--canvas-element-hot-water-stroke': '#B91C1C',
      '--canvas-element-vent-stroke': '#007C89',
      '--canvas-element-mechanical-ventilation-stroke': '#0F766E',
      '--canvas-element-combustion-stroke': '#B93800',
      '--canvas-element-onsite-generation-stroke': '#8A6A00',
      '--canvas-element-battery-stroke': '#6D28D9',
      '--canvas-element-system-stroke': '#9A3412',
      '--canvas-drawing-guide': '#A3B91F',
      '--canvas-drawing-handle-fill': '#A3B91F',
      '--canvas-3d-bg': '#F4FAF7',
      '--canvas-3d-grid-cell': '#D6E1DD',
      '--canvas-3d-grid-section': '#9FB7B1',
      '--canvas-3d-selection-overlay': '#A3B91F',
      '--canvas-3d-dormer-cutout': '#A3B91F',
      '--canvas-3d-fallback-edge': '#5F7774',
      '--canvas-3d-thermal-bridge-emissive': '#849917',
      '--canvas-3d-window-edge': '#0F766E',
      '--canvas-3d-door-edge': '#A34F00',
      '--canvas-3d-window-emissive': '#0B5F59',
      '--canvas-3d-door-emissive': '#783600',
      '--canvas-3d-vent-free-area': '#0F766E',
      '--canvas-3d-vent-max-open': '#9A6700',
      '--canvas-3d-vent-frame': '#19383A',
    }),
  },
  {
    id: 'high-contrast-light',
    label: 'High Contrast Light',
    theme: makeTheme({
      '--bg-primary': '#FFFFFF',
      '--bg-secondary': '#F1F5F2',
      '--bg-hover': '#DCEBE6',
      '--surface-overlay-solid': '#FFFFFF',
      '--accent-primary': '#004F46',
      '--accent-hover': '#003C36',
      '--text-primary': '#001B1D',
      '--text-secondary': '#12373A',
      '--text-muted': '#315357',
      '--text-on-accent': '#FFFFFF',
      '--border-strong': '#12373A',
      '--chart-series-1': '#003C36',
      '--chart-series-2': '#8A4F00',
      '--chart-series-3': '#1D4ED8',
      '--chart-series-4': '#B91C1C',
      '--chart-series-5': '#166534',
      '--chart-series-6': '#6D28D9',
      '--chart-series-7': '#9F1239',
      '--chart-series-8': '#075985',
      '--canvas-element-selected': '#004F46',
      '--canvas-element-external-wall-stroke': '#6D858A',
      '--canvas-element-internal-wall-stroke': '#007AA3',
      '--canvas-element-party-wall-stroke': '#8B5CF6',
      '--canvas-element-adjacent-unconditioned-stroke': '#A34F00',
      '--canvas-element-door-stroke': '#8A3E00',
      '--canvas-element-window-stroke': '#005B7C',
      '--canvas-element-ground-stroke': '#1F5C35',
      '--canvas-element-context-stroke': '#4D5B5F',
      '--canvas-element-thermal-bridge-stroke': '#8A2500',
      '--canvas-element-thermal-bridge-selected-stroke': '#B93800',
      '--canvas-element-shading-stroke': '#5F3600',
      '--canvas-element-lighting-stroke': '#8A3E00',
      '--canvas-element-ductwork-stroke': '#14532D',
      '--canvas-element-pipework-stroke': '#00445D',
      '--canvas-element-emitter-stroke': '#1E40AF',
      '--canvas-element-appliance-stroke': '#374151',
      '--canvas-element-hot-water-stroke': '#991B1B',
      '--canvas-element-vent-stroke': '#075985',
      '--canvas-element-mechanical-ventilation-stroke': '#0B5F59',
      '--canvas-element-combustion-stroke': '#8A2500',
      '--canvas-element-onsite-generation-stroke': '#6C5B00',
      '--canvas-element-battery-stroke': '#5B21B6',
      '--canvas-element-system-stroke': '#7C2D12',
      '--canvas-drawing-guide': '#004F46',
      '--canvas-drawing-handle-fill': '#004F46',
      '--canvas-3d-bg': '#FFFFFF',
      '--canvas-3d-grid-cell': '#D6E0DC',
      '--canvas-3d-grid-section': '#12373A',
      '--canvas-3d-selection-overlay': '#004F46',
      '--canvas-3d-dormer-cutout': '#004F46',
      '--canvas-3d-fallback-edge': '#315357',
      '--canvas-3d-thermal-bridge-emissive': '#003C36',
      '--canvas-3d-window-edge': '#005B7C',
      '--canvas-3d-door-edge': '#8A3E00',
      '--canvas-3d-window-emissive': '#00445D',
      '--canvas-3d-door-emissive': '#6B2F00',
      '--canvas-3d-vent-free-area': '#005B7C',
      '--canvas-3d-vent-max-open': '#8A4F00',
      '--canvas-3d-vent-frame': '#001B1D',
    }),
  },
  {
    id: 'midnight-blue',
    label: 'Airflow',
    theme: makeTheme({
      '--bg-primary': '#0E1B2A',
      '--bg-secondary': '#152A42',
      '--bg-hover': '#203D5C',
      '--surface-overlay-solid': '#0A1421',
      '--accent-primary': '#62D4F2',
      '--accent-hover': '#38BFE2',
      '--text-primary': '#F8FBFF',
      '--text-secondary': '#C3D7EE',
      '--text-muted': '#9FB6D1',
      '--text-on-accent': '#07131F',
      '--border-strong': '#375A7C',
      '--success-text': '#7DD3FC',
      '--chart-series-1': '#F8FBFF',
      '--chart-series-2': '#62D4F2',
      '--chart-series-3': '#93C5FD',
      '--canvas-element-selected': '#62D4F2',
      '--canvas-element-external-wall-stroke': '#D7E7E1',
      '--canvas-element-internal-wall-stroke': '#93C5FD',
      '--canvas-element-party-wall-stroke': '#C084FC',
      '--canvas-element-adjacent-unconditioned-stroke': '#FCD34D',
      '--canvas-element-window-stroke': '#62D4F2',
      '--canvas-drawing-guide': '#62D4F2',
      '--canvas-drawing-handle-fill': '#62D4F2',
      '--canvas-3d-bg': '#08111A',
      '--canvas-3d-grid-cell': '#1F3B59',
      '--canvas-3d-grid-section': '#375A7C',
      '--canvas-3d-selection-overlay': '#62D4F2',
      '--canvas-3d-dormer-cutout': '#62D4F2',
      '--canvas-3d-window-edge': '#62D4F2',
      '--canvas-3d-vent-free-area': '#22D3EE',
    }),
  },
  {
    id: 'warm-neutral',
    label: 'Solar Gain',
    theme: makeTheme({
      '--bg-primary': '#FAF7EC',
      '--bg-secondary': '#FFFFFF',
      '--bg-hover': '#EFE6CF',
      '--surface-overlay-solid': '#FFFFFF',
      '--accent-primary': '#B35D00',
      '--accent-hover': '#9F5200',
      '--text-primary': '#2B2416',
      '--text-secondary': '#5C4E34',
      '--text-muted': '#766B55',
      '--text-on-accent': '#FFFFFF',
      '--border-strong': '#C8B88A',
      '--chart-series-1': '#C46A00',
      '--chart-series-2': '#0F766E',
      '--chart-series-3': '#2563EB',
      '--chart-series-4': '#C2410C',
      '--chart-series-5': '#15803D',
      '--chart-series-6': '#7C3AED',
      '--chart-series-7': '#BE123C',
      '--chart-series-8': '#5C4E34',
      '--canvas-element-selected': '#C46A00',
      '--canvas-element-external-wall-stroke': '#8A8170',
      '--canvas-element-internal-wall-stroke': '#0B86B6',
      '--canvas-element-party-wall-stroke': '#8B5CF6',
      '--canvas-element-adjacent-unconditioned-stroke': '#B35D00',
      '--canvas-element-door-stroke': '#9A4F00',
      '--canvas-element-window-stroke': '#006F95',
      '--canvas-element-ground-stroke': '#2F6F45',
      '--canvas-element-context-stroke': '#746D60',
      '--canvas-element-thermal-bridge-stroke': '#C46A00',
      '--canvas-element-thermal-bridge-selected-stroke': '#C2410C',
      '--canvas-element-shading-stroke': '#7A4A00',
      '--canvas-element-lighting-stroke': '#9A4F00',
      '--canvas-element-ductwork-stroke': '#2F6F45',
      '--canvas-element-pipework-stroke': '#006F95',
      '--canvas-element-emitter-stroke': '#2563EB',
      '--canvas-element-appliance-stroke': '#565044',
      '--canvas-element-hot-water-stroke': '#B91C1C',
      '--canvas-element-vent-stroke': '#0F766E',
      '--canvas-element-mechanical-ventilation-stroke': '#0F766E',
      '--canvas-element-combustion-stroke': '#C2410C',
      '--canvas-element-onsite-generation-stroke': '#6C5B00',
      '--canvas-element-battery-stroke': '#7C3AED',
      '--canvas-element-system-stroke': '#9A3412',
      '--canvas-drawing-guide': '#C46A00',
      '--canvas-drawing-handle-fill': '#C46A00',
      '--canvas-3d-bg': '#FAF7EC',
      '--canvas-3d-grid-cell': '#E6D9BC',
      '--canvas-3d-grid-section': '#C8B88A',
      '--canvas-3d-selection-overlay': '#C46A00',
      '--canvas-3d-dormer-cutout': '#C46A00',
      '--canvas-3d-fallback-edge': '#746D60',
      '--canvas-3d-thermal-bridge-emissive': '#9F5200',
      '--canvas-3d-window-edge': '#006F95',
      '--canvas-3d-door-edge': '#9A4F00',
      '--canvas-3d-window-emissive': '#00506D',
      '--canvas-3d-door-emissive': '#6F3900',
      '--canvas-3d-vent-free-area': '#006F95',
      '--canvas-3d-vent-max-open': '#C46A00',
      '--canvas-3d-vent-frame': '#2B2416',
    }),
  },
  {
    id: 'studio-indigo-light',
    label: 'Studio indigo',
    visible: false,
    theme: makeTheme({
      '--bg-primary': '#F7F8FA',
      '--bg-secondary': '#FFFFFF',
      '--bg-hover': '#E7EAF0',
      '--surface-overlay-solid': '#FFFFFF',
      '--accent-primary': '#3B5BDB',
      '--accent-hover': '#2F49B5',
      '--text-primary': '#101828',
      '--text-secondary': '#475467',
      '--text-muted': '#667085',
      '--text-on-accent': '#FFFFFF',
      '--border-strong': '#B8C0CC',
      '--success-text': '#15803D',
      '--error-text': '#DC2626',
      '--chart-series-1': '#3B5BDB',
      '--chart-series-2': '#9A3412',
      '--chart-series-3': '#0F766E',
      '--chart-series-4': '#9333EA',
      '--chart-series-5': '#BE123C',
      '--chart-series-6': '#0369A1',
      '--chart-series-7': '#A16207',
      '--chart-series-8': '#475467',
      '--canvas-element-selected': '#3B5BDB',
      '--canvas-element-external-wall-stroke': '#72859A',
      '--canvas-element-internal-wall-stroke': '#2F80ED',
      '--canvas-element-party-wall-stroke': '#A855F7',
      '--canvas-element-adjacent-unconditioned-stroke': '#B7791F',
      '--canvas-element-door-stroke': '#B45309',
      '--canvas-element-window-stroke': '#2563EB',
      '--canvas-element-ground-stroke': '#15803D',
      '--canvas-element-context-stroke': '#6B7280',
      '--canvas-element-thermal-bridge-stroke': '#B45309',
      '--canvas-element-thermal-bridge-selected-stroke': '#C2410C',
      '--canvas-element-shading-stroke': '#A16207',
      '--canvas-element-lighting-stroke': '#B45309',
      '--canvas-element-ductwork-stroke': '#15803D',
      '--canvas-element-pipework-stroke': '#0891B2',
      '--canvas-element-emitter-stroke': '#2563EB',
      '--canvas-element-appliance-stroke': '#475467',
      '--canvas-element-hot-water-stroke': '#BE123C',
      '--canvas-element-vent-stroke': '#0891B2',
      '--canvas-element-mechanical-ventilation-stroke': '#0F766E',
      '--canvas-element-combustion-stroke': '#C2410C',
      '--canvas-element-onsite-generation-stroke': '#A16207',
      '--canvas-element-battery-stroke': '#9333EA',
      '--canvas-element-system-stroke': '#9A3412',
      '--canvas-drawing-guide': '#3B5BDB',
      '--canvas-drawing-handle-fill': '#3B5BDB',
      '--canvas-3d-bg': '#F7F8FA',
      '--canvas-3d-grid-cell': '#D8DEE8',
      '--canvas-3d-grid-section': '#B8C0CC',
      '--canvas-3d-selection-overlay': '#3B5BDB',
      '--canvas-3d-dormer-cutout': '#3B5BDB',
      '--canvas-3d-fallback-edge': '#667085',
      '--canvas-3d-thermal-bridge-emissive': '#2F49B5',
      '--canvas-3d-window-edge': '#2563EB',
      '--canvas-3d-door-edge': '#B45309',
      '--canvas-3d-window-emissive': '#1D4ED8',
      '--canvas-3d-door-emissive': '#7C2D12',
      '--canvas-3d-vent-free-area': '#0891B2',
      '--canvas-3d-vent-max-open': '#A16207',
      '--canvas-3d-vent-frame': '#101828',
    }),
  },
  {
    id: 'graphite-copper-dark',
    label: 'Thermal Mass',
    theme: makeTheme({
      '--bg-primary': '#181B1D',
      '--bg-secondary': '#24282B',
      '--bg-hover': '#31373A',
      '--surface-overlay-solid': '#111315',
      '--accent-primary': '#C9822B',
      '--accent-hover': '#A9651E',
      '--text-primary': '#F4F5F7',
      '--text-secondary': '#C9D1D9',
      '--text-muted': '#9AA4AF',
      '--text-on-accent': '#1F1300',
      '--border-strong': '#56616D',
      '--success-text': '#4ADE80',
      '--error-text': '#FB7185',
      '--chart-series-1': '#C9822B',
      '--chart-series-2': '#E5E7EB',
      '--chart-series-3': '#60A5FA',
      '--chart-series-4': '#34D399',
      '--chart-series-5': '#F472B6',
      '--chart-series-6': '#A78BFA',
      '--chart-series-7': '#FCD34D',
      '--chart-series-8': '#94A3B8',
      '--canvas-element-selected': '#C9822B',
      '--canvas-element-external-wall-stroke': '#CBD5E1',
      '--canvas-element-internal-wall-stroke': '#60A5FA',
      '--canvas-element-party-wall-stroke': '#A78BFA',
      '--canvas-element-adjacent-unconditioned-stroke': '#FCD34D',
      '--canvas-element-door-stroke': '#FB923C',
      '--canvas-element-window-stroke': '#60A5FA',
      '--canvas-element-ground-stroke': '#4ADE80',
      '--canvas-element-context-stroke': '#94A3B8',
      '--canvas-drawing-guide': '#C9822B',
      '--canvas-drawing-handle-fill': '#C9822B',
      '--canvas-3d-bg': '#111315',
      '--canvas-3d-grid-cell': '#31373A',
      '--canvas-3d-grid-section': '#56616D',
      '--canvas-3d-selection-overlay': '#C9822B',
      '--canvas-3d-dormer-cutout': '#C9822B',
      '--canvas-3d-fallback-edge': '#9AA4AF',
      '--canvas-3d-thermal-bridge-emissive': '#A9651E',
      '--canvas-3d-window-edge': '#60A5FA',
      '--canvas-3d-door-edge': '#FB923C',
      '--canvas-3d-window-emissive': '#1E3A8A',
      '--canvas-3d-door-emissive': '#7C2D12',
      '--canvas-3d-vent-free-area': '#22D3EE',
      '--canvas-3d-vent-max-open': '#C9822B',
      '--canvas-3d-vent-frame': '#F4F5F7',
    }),
  },
  {
    id: 'aubergine-coral-dark',
    label: 'Infrared',
    theme: makeTheme({
      '--bg-primary': '#120B1E',
      '--bg-secondary': '#20112E',
      '--bg-hover': '#321847',
      '--surface-overlay-solid': '#0B0712',
      '--accent-primary': '#FF5C8A',
      '--accent-hover': '#FF7A3D',
      '--text-primary': '#FFF5F7',
      '--text-secondary': '#E8C9DD',
      '--text-muted': '#B999C5',
      '--text-on-accent': '#210611',
      '--border-strong': '#6F4D7A',
      '--success-text': '#86EFAC',
      '--error-text': '#FB7185',
      '--chart-series-1': '#FF5C8A',
      '--chart-series-2': '#FF7A3D',
      '--chart-series-3': '#FCD34D',
      '--chart-series-4': '#38BDF8',
      '--chart-series-5': '#C084FC',
      '--chart-series-6': '#C4B5FD',
      '--chart-series-7': '#FCD34D',
      '--chart-series-8': '#E8C9DD',
      '--canvas-element-selected': '#FF5C8A',
      '--canvas-element-external-wall-stroke': '#E9D5FF',
      '--canvas-element-internal-wall-stroke': '#38BDF8',
      '--canvas-element-party-wall-stroke': '#FCD34D',
      '--canvas-element-adjacent-unconditioned-stroke': '#FB923C',
      '--canvas-element-door-stroke': '#FB923C',
      '--canvas-element-window-stroke': '#38BDF8',
      '--canvas-element-ground-stroke': '#A3E635',
      '--canvas-element-context-stroke': '#A78BFA',
      '--canvas-element-thermal-bridge-stroke': '#FF7A3D',
      '--canvas-element-thermal-bridge-selected-stroke': '#FCD34D',
      '--canvas-drawing-guide': '#FF5C8A',
      '--canvas-drawing-handle-fill': '#FF5C8A',
      '--canvas-3d-bg': '#0B0712',
      '--canvas-3d-grid-cell': '#321847',
      '--canvas-3d-grid-section': '#6F4D7A',
      '--canvas-3d-selection-overlay': '#FF5C8A',
      '--canvas-3d-dormer-cutout': '#FCD34D',
      '--canvas-3d-fallback-edge': '#B999C5',
      '--canvas-3d-thermal-bridge-emissive': '#FF7A3D',
      '--canvas-3d-window-edge': '#38BDF8',
      '--canvas-3d-door-edge': '#FB923C',
      '--canvas-3d-window-emissive': '#164E63',
      '--canvas-3d-door-emissive': '#7C2D12',
      '--canvas-3d-vent-free-area': '#22D3EE',
      '--canvas-3d-vent-max-open': '#FCD34D',
      '--canvas-3d-vent-frame': '#FFF5F7',
    }),
  },
  {
    id: 'harbour-light',
    label: 'Daylight',
    theme: makeTheme({
      '--bg-primary': '#F7FAFC',
      '--bg-secondary': '#FFFFFF',
      '--bg-hover': '#E5EEF6',
      '--surface-overlay-solid': '#FFFFFF',
      '--accent-primary': '#0B6B9A',
      '--accent-hover': '#07577D',
      '--text-primary': '#10202B',
      '--text-secondary': '#415866',
      '--text-muted': '#5B6B78',
      '--text-on-accent': '#FFFFFF',
      '--border-strong': '#A9BBC8',
      '--success-text': '#15803D',
      '--error-text': '#DC2626',
      '--chart-series-1': '#0B6B9A',
      '--chart-series-2': '#0F766E',
      '--chart-series-3': '#2563EB',
      '--chart-series-4': '#C2410C',
      '--chart-series-5': '#15803D',
      '--chart-series-6': '#7C3AED',
      '--chart-series-7': '#BE123C',
      '--chart-series-8': '#5B6B78',
      '--canvas-element-selected': '#0B6B9A',
      '--canvas-element-external-wall-stroke': '#728A98',
      '--canvas-element-internal-wall-stroke': '#2F80ED',
      '--canvas-element-party-wall-stroke': '#8B5CF6',
      '--canvas-element-adjacent-unconditioned-stroke': '#B35D00',
      '--canvas-element-door-stroke': '#A34F00',
      '--canvas-element-window-stroke': '#0B6B9A',
      '--canvas-element-ground-stroke': '#15803D',
      '--canvas-element-context-stroke': '#5B6B78',
      '--canvas-element-thermal-bridge-stroke': '#B45309',
      '--canvas-element-thermal-bridge-selected-stroke': '#C2410C',
      '--canvas-element-shading-stroke': '#9A6700',
      '--canvas-element-lighting-stroke': '#A34F00',
      '--canvas-element-ductwork-stroke': '#15803D',
      '--canvas-element-pipework-stroke': '#0B6B9A',
      '--canvas-element-emitter-stroke': '#2563EB',
      '--canvas-element-appliance-stroke': '#415866',
      '--canvas-element-hot-water-stroke': '#DC2626',
      '--canvas-element-vent-stroke': '#0891B2',
      '--canvas-element-mechanical-ventilation-stroke': '#0F766E',
      '--canvas-element-combustion-stroke': '#C2410C',
      '--canvas-element-onsite-generation-stroke': '#9A6700',
      '--canvas-element-battery-stroke': '#7C3AED',
      '--canvas-element-system-stroke': '#A34F00',
      '--canvas-drawing-guide': '#0B6B9A',
      '--canvas-drawing-handle-fill': '#0B6B9A',
      '--canvas-3d-bg': '#F7FAFC',
      '--canvas-3d-grid-cell': '#DCE8F0',
      '--canvas-3d-grid-section': '#A9BBC8',
      '--canvas-3d-selection-overlay': '#0B6B9A',
      '--canvas-3d-dormer-cutout': '#0B6B9A',
      '--canvas-3d-fallback-edge': '#5B6B78',
      '--canvas-3d-thermal-bridge-emissive': '#07577D',
      '--canvas-3d-window-edge': '#0B6B9A',
      '--canvas-3d-door-edge': '#A34F00',
      '--canvas-3d-window-emissive': '#07577D',
      '--canvas-3d-door-emissive': '#783600',
      '--canvas-3d-vent-free-area': '#0891B2',
      '--canvas-3d-vent-max-open': '#9A6700',
      '--canvas-3d-vent-frame': '#10202B',
    }),
  },
  {
    id: 'studio-mauve-light',
    label: 'Studio mauve',
    visible: false,
    theme: makeTheme({
      '--bg-primary': '#FAF7F9',
      '--bg-secondary': '#FFFFFF',
      '--bg-hover': '#EFE6EE',
      '--surface-overlay-solid': '#FFFFFF',
      '--accent-primary': '#8E3A59',
      '--accent-hover': '#713047',
      '--text-primary': '#261B22',
      '--text-secondary': '#594653',
      '--text-muted': '#756473',
      '--text-on-accent': '#FFFFFF',
      '--border-strong': '#C8B8C2',
      '--success-text': '#15803D',
      '--error-text': '#C2415A',
      '--chart-series-1': '#8E3A59',
      '--chart-series-2': '#0F766E',
      '--chart-series-3': '#2563EB',
      '--chart-series-4': '#C2410C',
      '--chart-series-5': '#15803D',
      '--chart-series-6': '#7C3AED',
      '--chart-series-7': '#BE123C',
      '--chart-series-8': '#756473',
      '--canvas-element-selected': '#8E3A59',
      '--canvas-element-external-wall-stroke': '#847380',
      '--canvas-element-internal-wall-stroke': '#2F80ED',
      '--canvas-element-party-wall-stroke': '#8B5CF6',
      '--canvas-element-adjacent-unconditioned-stroke': '#B35D00',
      '--canvas-element-door-stroke': '#A34F00',
      '--canvas-element-window-stroke': '#2563EB',
      '--canvas-element-ground-stroke': '#15803D',
      '--canvas-element-context-stroke': '#756473',
      '--canvas-element-thermal-bridge-stroke': '#9F1239',
      '--canvas-element-thermal-bridge-selected-stroke': '#C2415A',
      '--canvas-element-shading-stroke': '#9A6700',
      '--canvas-element-lighting-stroke': '#A34F00',
      '--canvas-element-ductwork-stroke': '#15803D',
      '--canvas-element-pipework-stroke': '#2563EB',
      '--canvas-element-emitter-stroke': '#2563EB',
      '--canvas-element-appliance-stroke': '#594653',
      '--canvas-element-hot-water-stroke': '#C2415A',
      '--canvas-element-vent-stroke': '#0891B2',
      '--canvas-element-mechanical-ventilation-stroke': '#0F766E',
      '--canvas-element-combustion-stroke': '#C2410C',
      '--canvas-element-onsite-generation-stroke': '#9A6700',
      '--canvas-element-battery-stroke': '#7C3AED',
      '--canvas-element-system-stroke': '#8E3A59',
      '--canvas-drawing-guide': '#8E3A59',
      '--canvas-drawing-handle-fill': '#8E3A59',
      '--canvas-3d-bg': '#FAF7F9',
      '--canvas-3d-grid-cell': '#E8DCE5',
      '--canvas-3d-grid-section': '#C8B8C2',
      '--canvas-3d-selection-overlay': '#8E3A59',
      '--canvas-3d-dormer-cutout': '#8E3A59',
      '--canvas-3d-fallback-edge': '#756473',
      '--canvas-3d-thermal-bridge-emissive': '#713047',
      '--canvas-3d-window-edge': '#2563EB',
      '--canvas-3d-door-edge': '#A34F00',
      '--canvas-3d-window-emissive': '#1D4ED8',
      '--canvas-3d-door-emissive': '#783600',
      '--canvas-3d-vent-free-area': '#0891B2',
      '--canvas-3d-vent-max-open': '#9A6700',
      '--canvas-3d-vent-frame': '#261B22',
    }),
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; theme: VulcanCustomTheme; visible?: boolean }>;

export type BuiltInVulcanThemeId = (typeof BUILT_IN_VULCAN_THEMES)[number]['id'];

export const CUSTOM_VULCAN_THEME_ID = 'custom';

export type VulcanThemeId = BuiltInVulcanThemeId | typeof CUSTOM_VULCAN_THEME_ID;

export const BUILT_IN_VULCAN_THEME_OPTIONS: ReadonlyArray<{ id: BuiltInVulcanThemeId; label: string }> =
  BUILT_IN_VULCAN_THEMES.map(({ id, label }) => ({ id, label }));

const VISIBLE_BUILT_IN_VULCAN_THEME_ORDER: ReadonlyArray<BuiltInVulcanThemeId> = [
  'vulcan-dark',
  'light',
  'harbour-light',
  'midnight-blue',
  'warm-neutral',
  'graphite-copper-dark',
  'aubergine-coral-dark',
  'low-glare-dark',
  'high-contrast-dark',
  'high-contrast-light',
];

export const VISIBLE_BUILT_IN_VULCAN_THEME_OPTIONS: ReadonlyArray<{ id: BuiltInVulcanThemeId; label: string }> =
  VISIBLE_BUILT_IN_VULCAN_THEME_ORDER.map((id) => {
    const option = BUILT_IN_VULCAN_THEME_OPTIONS.find((candidate) => candidate.id === id);
    if (!option) throw new Error(`Missing visible theme option for ${id}`);
    return option;
  });

export const VULCAN_THEME_OPTIONS: ReadonlyArray<{ id: VulcanThemeId; label: string }> = [
  ...VISIBLE_BUILT_IN_VULCAN_THEME_OPTIONS,
  { id: CUSTOM_VULCAN_THEME_ID, label: 'Custom' },
];

export const ALL_VULCAN_THEME_OPTIONS: ReadonlyArray<{ id: VulcanThemeId; label: string }> = [
  ...BUILT_IN_VULCAN_THEME_OPTIONS,
  { id: CUSTOM_VULCAN_THEME_ID, label: 'Custom' },
];

export const BUILT_IN_CUSTOM_THEME_BASES = Object.fromEntries(
  BUILT_IN_VULCAN_THEMES.map(({ id, theme }) => [id, theme]),
) as Record<BuiltInVulcanThemeId, VulcanCustomTheme>;

interface ThemeState {
  themeId: VulcanThemeId;
  customBaseThemeId: BuiltInVulcanThemeId;
  customTheme: VulcanCustomTheme;
  setThemeId: (themeId: VulcanThemeId) => void;
  setCustomThemeValue: (varName: VulcanEditableThemeVar, value: string) => void;
  resetCustomTheme: () => void;
}

function isVulcanThemeId(value: unknown): value is VulcanThemeId {
  return ALL_VULCAN_THEME_OPTIONS.some((option) => option.id === value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function sanitizeCustomTheme(
  value: unknown,
  fallbackTheme: VulcanCustomTheme = DEFAULT_CUSTOM_THEME,
): VulcanCustomTheme {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return VULCAN_THEME_EDITABLE_TOKENS.reduce((theme, token) => {
    const stored = source[token.varName];
    const legacyFallback = THEME_TOKEN_LEGACY_FALLBACKS[token.varName]
      ?.map((legacyToken) => source[legacyToken])
      .find(isHexColor);
    theme[token.varName] = isHexColor(stored) ? stored : legacyFallback ?? fallbackTheme[token.varName];
    return theme;
  }, {} as VulcanCustomTheme);
}

function sanitizeCustomBaseThemeId(value: unknown): BuiltInVulcanThemeId {
  return BUILT_IN_VULCAN_THEME_OPTIONS.some((option) => option.id === value)
    ? value as BuiltInVulcanThemeId
    : 'vulcan-dark';
}

export function customThemeFromThemeId(themeId: VulcanThemeId, customTheme: VulcanCustomTheme = DEFAULT_CUSTOM_THEME): VulcanCustomTheme {
  if (themeId === CUSTOM_VULCAN_THEME_ID) return { ...customTheme };
  return { ...BUILT_IN_CUSTOM_THEME_BASES[themeId] };
}

function readStoredThemeState(): Pick<ThemeState, 'themeId' | 'customTheme' | 'customBaseThemeId'> {
  const fallback = {
    themeId: 'vulcan-dark' as VulcanThemeId,
    customTheme: DEFAULT_CUSTOM_THEME,
    customBaseThemeId: 'vulcan-dark' as BuiltInVulcanThemeId,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(VULCAN_THEME_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { themeId?: unknown; customTheme?: unknown; customBaseThemeId?: unknown };
      const customBaseThemeId = sanitizeCustomBaseThemeId(parsed.customBaseThemeId);
      return {
        themeId: isVulcanThemeId(parsed.themeId) ? parsed.themeId : fallback.themeId,
        customTheme: sanitizeCustomTheme(parsed.customTheme, BUILT_IN_CUSTOM_THEME_BASES[customBaseThemeId]),
        customBaseThemeId,
      };
    }

    const legacyThemeId = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    return {
      ...fallback,
      themeId: isVulcanThemeId(legacyThemeId) ? legacyThemeId : fallback.themeId,
    };
  } catch {
    return fallback;
  }
}

function writeStoredThemeState(themeId: VulcanThemeId, customTheme: VulcanCustomTheme, customBaseThemeId: BuiltInVulcanThemeId) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VULCAN_THEME_STORAGE_KEY, JSON.stringify({ themeId, customTheme, customBaseThemeId }));
  } catch {
    // Theme selection is a preference; storage failures should not block the app.
  }
}

function clearCustomThemeProperties(style: CSSStyleDeclaration) {
  for (const token of VULCAN_THEME_EDITABLE_TOKENS) {
    style.removeProperty(token.varName);
  }
  for (const token of NON_EDITABLE_THEME_TOKENS) {
    style.removeProperty(token);
  }
  style.removeProperty('--surface-overlay');
}

function applyThemeProperties(style: CSSStyleDeclaration, theme: VulcanCustomTheme) {
  for (const [varName, value] of Object.entries(theme) as [VulcanEditableThemeVar, string][]) {
    style.setProperty(varName, value);
  }
}

function applyDerivedThemeProperties(style: CSSStyleDeclaration, theme: VulcanCustomTheme) {
  const isLightBackground = relativeLuminance(theme['--bg-primary']) > 0.55;
  style.setProperty(
    '--brand-logo-filter',
    isLightBackground ? BRAND_LOGO_FILTER_FOR_LIGHT_BACKGROUND : BRAND_LOGO_FILTER_FOR_DARK_BACKGROUND,
  );
  const validationPresentation = isLightBackground
    ? VALIDATION_PRESENTATION_FOR_LIGHT_BACKGROUND
    : VALIDATION_PRESENTATION_FOR_DARK_BACKGROUND;
  for (const [varName, value] of Object.entries(validationPresentation)) {
    style.setProperty(varName, value);
  }
}

export function applyVulcanTheme(
  themeId: VulcanThemeId,
  customTheme: VulcanCustomTheme = DEFAULT_CUSTOM_THEME,
  customBaseThemeId: BuiltInVulcanThemeId = 'vulcan-dark',
) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  clearCustomThemeProperties(root.style);
  root.removeAttribute('data-vulcan-custom-theme');
  root.removeAttribute('data-vulcan-custom-base');

  if (themeId === CUSTOM_VULCAN_THEME_ID) {
    const baseThemeId = sanitizeCustomBaseThemeId(customBaseThemeId);
    root.setAttribute('data-vulcan-custom-theme', 'true');
    root.setAttribute('data-vulcan-custom-base', baseThemeId);
    if (baseThemeId === 'vulcan-dark') {
      root.removeAttribute('data-vulcan-theme');
    } else {
      root.setAttribute('data-vulcan-theme', baseThemeId);
    }
    applyThemeProperties(root.style, customTheme);
    applyDerivedThemeProperties(root.style, customTheme);
    return;
  }

  if (themeId === 'vulcan-dark') {
    root.removeAttribute('data-vulcan-theme');
  } else {
    root.setAttribute('data-vulcan-theme', themeId);
  }
  applyThemeProperties(root.style, BUILT_IN_CUSTOM_THEME_BASES[themeId]);
  applyDerivedThemeProperties(root.style, BUILT_IN_CUSTOM_THEME_BASES[themeId]);
}

const initialThemeState = readStoredThemeState();

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: initialThemeState.themeId,
  customBaseThemeId: initialThemeState.customBaseThemeId,
  customTheme: initialThemeState.customTheme,
  setThemeId: (themeId) => {
    const { customTheme, customBaseThemeId } = get();
    set({ themeId });
    applyVulcanTheme(themeId, customTheme, customBaseThemeId);
    writeStoredThemeState(themeId, customTheme, customBaseThemeId);
  },
  setCustomThemeValue: (varName, value) => {
    if (!isHexColor(value)) return;
    const { themeId, customBaseThemeId } = get();
    const nextBaseThemeId = themeId === CUSTOM_VULCAN_THEME_ID
      ? customBaseThemeId
      : sanitizeCustomBaseThemeId(themeId);
    const baseTheme = themeId === CUSTOM_VULCAN_THEME_ID
      ? get().customTheme
      : customThemeFromThemeId(themeId, get().customTheme);
    const nextTheme = { ...baseTheme, [varName]: value };
    set({ customTheme: nextTheme, themeId: CUSTOM_VULCAN_THEME_ID, customBaseThemeId: nextBaseThemeId });
    applyVulcanTheme(CUSTOM_VULCAN_THEME_ID, nextTheme, nextBaseThemeId);
    writeStoredThemeState(CUSTOM_VULCAN_THEME_ID, nextTheme, nextBaseThemeId);
  },
  resetCustomTheme: () => {
    const nextTheme = { ...DEFAULT_CUSTOM_THEME };
    set({ customTheme: nextTheme, themeId: CUSTOM_VULCAN_THEME_ID, customBaseThemeId: 'vulcan-dark' });
    applyVulcanTheme(CUSTOM_VULCAN_THEME_ID, nextTheme, 'vulcan-dark');
    writeStoredThemeState(CUSTOM_VULCAN_THEME_ID, nextTheme, 'vulcan-dark');
  },
}));
