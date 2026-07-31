// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { withCanvasAlpha, type ElementCanvasPalette } from '../../lib/shapeUtils';

export type CanvasElementRendererPalette = ElementCanvasPalette & { hover: string };

export interface CanvasInteractionPalette {
  snap: string;
  handleFill: string;
  handleStroke: string;
  handleStrokeOnSnap: string;
  guide: string;
  guideFill: string;
  dormerGuide: string;
  warningGuide: string;
}

export function readRootCssVar(varName: string, fallback: string, seen = new Set<string>()): string {
  if (typeof window === 'undefined') return fallback;
  if (seen.has(varName)) return fallback;
  seen.add(varName);
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!value || value.includes('color-mix(')) return fallback;
  const varMatch = value.match(/^var\((--[^,\s)]+)(?:,\s*([^)]+))?\)$/);
  if (varMatch) return readRootCssVar(varMatch[1], varMatch[2]?.trim() || fallback, seen);
  return value;
}

export function getHexRelativeLuminance(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const channel = (index: number) => {
    const value = parseInt(match[1].slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * channel(0)) + (0.7152 * channel(2)) + (0.0722 * channel(4));
}

export function readCanvasElementPalette(): CanvasElementRendererPalette {
  const accent = readRootCssVar('--accent-primary', '#eafd5a');
  const externalWallStroke = readRootCssVar('--canvas-element-external-wall-stroke', readRootCssVar('--canvas-element-wall-stroke', '#cccccc'));
  const internalWallStroke = readRootCssVar('--canvas-element-internal-wall-stroke', readRootCssVar('--canvas-element-adjacent-stroke', '#8BD3FF'));
  const partyWallStroke = readRootCssVar('--canvas-element-party-wall-stroke', readRootCssVar('--canvas-element-adjacent-stroke', '#C084FC'));
  const adjacentUnconditionedStroke = readRootCssVar('--canvas-element-adjacent-unconditioned-stroke', readRootCssVar('--canvas-element-adjacent-stroke', '#FBBF24'));
  const customLightTheme =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-vulcan-custom-theme') === 'true' &&
    (getHexRelativeLuminance(readRootCssVar('--bg-primary', '#19383A')) ?? 0) > 0.55;
  if (customLightTheme) {
    const lightExternalWallStroke = readRootCssVar('--canvas-element-light-external-wall-stroke', externalWallStroke);
    const lightInternalWallStroke = readRootCssVar('--canvas-element-light-internal-wall-stroke', internalWallStroke);
    const lightPartyWallStroke = readRootCssVar('--canvas-element-light-party-wall-stroke', partyWallStroke);
    const lightAdjacentUnconditionedStroke = readRootCssVar('--canvas-element-light-adjacent-unconditioned-stroke', adjacentUnconditionedStroke);
    return {
      selected: accent,
      hover: readRootCssVar('--accent-hover', '#004f46'),
      externalWallStroke: lightExternalWallStroke,
      externalWallFill: withCanvasAlpha(lightExternalWallStroke, '#50676b', '29'),
      internalWallStroke: lightInternalWallStroke,
      internalWallFill: withCanvasAlpha(lightInternalWallStroke, '#006F95', '29'),
      partyWallStroke: lightPartyWallStroke,
      partyWallFill: withCanvasAlpha(lightPartyWallStroke, '#7C3AED', '29'),
      adjacentUnconditionedStroke: lightAdjacentUnconditionedStroke,
      adjacentUnconditionedFill: withCanvasAlpha(lightAdjacentUnconditionedStroke, '#9A6700', '29'),
      wallStroke: lightExternalWallStroke,
      wallFill: withCanvasAlpha(lightExternalWallStroke, '#50676b', '29'),
      doorStroke: readRootCssVar('--canvas-element-light-door-stroke', '#a34f00'),
      doorFill: readRootCssVar('--canvas-element-light-door-fill', 'rgba(163, 79, 0, 0.18)'),
      windowStroke: readRootCssVar('--canvas-element-light-window-stroke', '#0077a3'),
      windowFill: readRootCssVar('--canvas-element-light-window-fill', 'rgba(0, 119, 163, 0.18)'),
      groundStroke: readRootCssVar('--canvas-element-light-ground-stroke', '#2f6f45'),
      groundFill: readRootCssVar('--canvas-element-light-ground-fill', 'rgba(47, 111, 69, 0.28)'),
      adjacentStroke: lightInternalWallStroke,
      adjacentFill: withCanvasAlpha(lightInternalWallStroke, '#006F95', '29'),
      contextStroke: readRootCssVar('--canvas-element-light-context-stroke', '#697479'),
      contextFill: readRootCssVar('--canvas-element-light-context-fill', 'rgba(105, 116, 121, 0.15)'),
      thermalBridgeStroke: readRootCssVar('--canvas-element-thermal-bridge-stroke', '#B93800'),
      thermalBridgeSelectedStroke: readRootCssVar('--canvas-element-thermal-bridge-selected-stroke', '#D94A1F'),
      shadingStroke: readRootCssVar('--canvas-element-shading-stroke', '#7A4A00'),
      lightingStroke: readRootCssVar('--canvas-element-lighting-stroke', '#A34F00'),
      ductworkStroke: readRootCssVar('--canvas-element-ductwork-stroke', '#1F6B38'),
      pipeworkStroke: readRootCssVar('--canvas-element-pipework-stroke', '#005B7C'),
      emitterStroke: readRootCssVar('--canvas-element-emitter-stroke', '#1D4ED8'),
      applianceStroke: readRootCssVar('--canvas-element-appliance-stroke', '#4B5563'),
      hotWaterStroke: readRootCssVar('--canvas-element-hot-water-stroke', '#B91C1C'),
      ventStroke: readRootCssVar('--canvas-element-vent-stroke', '#007C89'),
      mechanicalVentilationStroke: readRootCssVar('--canvas-element-mechanical-ventilation-stroke', '#0F766E'),
      combustionStroke: readRootCssVar('--canvas-element-combustion-stroke', '#B93800'),
      onsiteGenerationStroke: readRootCssVar('--canvas-element-onsite-generation-stroke', '#8A6A00'),
      batteryStroke: readRootCssVar('--canvas-element-battery-stroke', '#6D28D9'),
      systemStroke: readRootCssVar('--canvas-element-system-stroke', '#9A3412'),
    };
  }
  return {
    selected: readRootCssVar('--canvas-element-selected', '#00a2ff'),
    hover: readRootCssVar('--canvas-element-hover', accent),
    externalWallStroke,
    externalWallFill: withCanvasAlpha(externalWallStroke, '#cccccc', '29'),
    internalWallStroke,
    internalWallFill: withCanvasAlpha(internalWallStroke, '#8BD3FF', '29'),
    partyWallStroke,
    partyWallFill: withCanvasAlpha(partyWallStroke, '#C084FC', '29'),
    adjacentUnconditionedStroke,
    adjacentUnconditionedFill: withCanvasAlpha(adjacentUnconditionedStroke, '#FBBF24', '29'),
    wallStroke: externalWallStroke,
    wallFill: withCanvasAlpha(externalWallStroke, '#cccccc', '29'),
    doorStroke: readRootCssVar('--canvas-element-door-stroke', '#ff8c00'),
    doorFill: readRootCssVar('--canvas-element-door-fill', '#ff8c0022'),
    windowStroke: readRootCssVar('--canvas-element-window-stroke', '#87ceeb'),
    windowFill: readRootCssVar('--canvas-element-window-fill', '#87ceeb22'),
    groundStroke: readRootCssVar('--canvas-element-ground-stroke', '#228b22'),
    groundFill: readRootCssVar('--canvas-element-ground-fill', '#228b2255'),
    adjacentStroke: internalWallStroke,
    adjacentFill: withCanvasAlpha(internalWallStroke, '#8BD3FF', '29'),
    contextStroke: readRootCssVar('--canvas-element-context-stroke', '#808080'),
    contextFill: readRootCssVar('--canvas-element-context-fill', '#80808022'),
    thermalBridgeStroke: readRootCssVar('--canvas-element-thermal-bridge-stroke', '#FF6B35'),
    thermalBridgeSelectedStroke: readRootCssVar('--canvas-element-thermal-bridge-selected-stroke', '#FF7A3D'),
    shadingStroke: readRootCssVar('--canvas-element-shading-stroke', '#F4C430'),
    lightingStroke: readRootCssVar('--canvas-element-lighting-stroke', '#FFB347'),
    ductworkStroke: readRootCssVar('--canvas-element-ductwork-stroke', '#4ADE80'),
    pipeworkStroke: readRootCssVar('--canvas-element-pipework-stroke', '#38BDF8'),
    emitterStroke: readRootCssVar('--canvas-element-emitter-stroke', '#60A5FA'),
    applianceStroke: readRootCssVar('--canvas-element-appliance-stroke', '#CBD5E1'),
    hotWaterStroke: readRootCssVar('--canvas-element-hot-water-stroke', '#FB7185'),
    ventStroke: readRootCssVar('--canvas-element-vent-stroke', '#22D3EE'),
    mechanicalVentilationStroke: readRootCssVar('--canvas-element-mechanical-ventilation-stroke', '#2DD4BF'),
    combustionStroke: readRootCssVar('--canvas-element-combustion-stroke', '#FF7A3D'),
    onsiteGenerationStroke: readRootCssVar('--canvas-element-onsite-generation-stroke', '#FACC15'),
    batteryStroke: readRootCssVar('--canvas-element-battery-stroke', '#A78BFA'),
    systemStroke: readRootCssVar('--canvas-element-system-stroke', '#FB923C'),
  };
}

export function readCanvasInteractionPalette(): CanvasInteractionPalette {
  return {
    snap: readRootCssVar('--semantic-snap', '#1E90FF'),
    handleFill: readRootCssVar('--canvas-drawing-handle-fill', '#DDEE63'),
    handleStroke: readRootCssVar('--semantic-snap', '#1E90FF'),
    handleStrokeOnSnap: readRootCssVar('--canvas-drawing-handle-stroke', '#FFFFFF'),
    guide: readRootCssVar('--canvas-drawing-guide', '#DDEE63'),
    guideFill: readRootCssVar('--canvas-drawing-guide-fill', 'rgba(221, 238, 99, 0.14)'),
    dormerGuide: readRootCssVar('--canvas-drawing-guide', '#f6df5a'),
    warningGuide: readRootCssVar('--validation-warning', '#F59E0B'),
  };
}
