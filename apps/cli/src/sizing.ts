// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Heating sizing of a preprocessed HEM core model against its static design heat loss. The CLI
// runs no HEM target: the design heat loss comes from a Rust HEM:FHS target's design_heat_loss
// export, which the Vulcan repository's scripts/hem-targets/design-heat-loss.mjs writes with the
// preprocessed model.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sizeHeating, type DesignHeatLoss, type HeatingSizing, type ZoneDesignHeatLoss } from '../../../packages/geometry-editor/src/lib/heatingSizing';
import { designConditions, emitterOutputSentence, heatSourceExtras, heatSourceGivesSentence, heatSourceView, isSized, systemView } from '../../../packages/geometry-editor/src/lib/heatingSizingView';

/** Exit code of a sizing that could not be attempted (no usable design heat loss); 1 stays a real failure. */
export const SIZING_UNAVAILABLE_EXIT_CODE = 3;

const PRODUCE = 'Write it with the preprocessed model: node scripts/hem-targets/design-heat-loss.mjs in the Vulcan repository, on a Rust HEM:FHS target with design_heat_loss.';
export const NO_DESIGN_HEAT_LOSS_REASON = `Heating sizing needs the design heat loss: pass --design-heat-loss <file>. ${PRODUCE}`;

export type SizingResult =
  | ({ status: 'sized' } & HeatingSizing)
  | { status: 'unavailable'; reason: string };

const unavailable = (reason: string): SizingResult => ({ status: 'unavailable', reason });

const ZONE_FIELDS = ['htcWPerK', 'fabricWPerK', 'thermalBridgesWPerK', 'ventilationWPerK', 'designLossKw'] as const satisfies readonly (keyof ZoneDesignHeatLoss)[];

/** The design heat loss file, or why it cannot be used. */
function readDesignHeatLoss(path: string | undefined): DesignHeatLoss | SizingResult {
  if (path === undefined) return unavailable(NO_DESIGN_HEAT_LOSS_REASON);
  if (!existsSync(resolve(path))) return unavailable(`Design heat loss file not found: ${path}. ${PRODUCE}`);
  let loss: Partial<DesignHeatLoss>;
  try {
    loss = JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch {
    return unavailable(`${path} is not JSON. ${PRODUCE}`);
  }
  if (typeof loss?.coldestHourC !== 'number' || typeof loss.setpointC !== 'number' || typeof loss.weatherName !== 'string'
    || typeof loss.zones !== 'object' || loss.zones === null) {
    return unavailable(`${path} is not a design heat loss: it needs coldestHourC, setpointC, weatherName and zones. ${PRODUCE}`);
  }
  // A damaged zone is a failure (exit 1), not a missing input: sizing it would print wrong numbers.
  for (const [name, zone] of Object.entries(loss.zones as Record<string, unknown>)) {
    if (zone === null || typeof zone !== 'object' || Array.isArray(zone)) throw new Error(`${path}: zone "${name}" is not an object.`);
    for (const field of ZONE_FIELDS) {
      const value = (zone as Record<string, unknown>)[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path}: zone "${name}" has no finite ${field}.`);
    }
  }
  return loss as DesignHeatLoss;
}

/** Sizes the heating of a preprocessed core model JSON against a design heat loss JSON. */
export function sizeModel(modelPath: string, options: { designHeatLoss?: string }): SizingResult {
  const model = JSON.parse(readFileSync(resolve(modelPath), 'utf8')) as Record<string, unknown>;
  const loss = readDesignHeatLoss(options.designHeatLoss);
  if ('status' in loss) return loss;
  return { status: 'sized', ...sizeHeating(model, loss) };
}

export const sizingExitCode = (result: SizingResult): number => (result.status === 'sized' ? 0 : SIZING_UNAVAILABLE_EXIT_CODE);

/** The human report: each heat source and system with the panel's pill, sentence and numbers. */
export function sizingText(result: SizingResult): string[] {
  if (result.status === 'unavailable') return [`Not sized: ${result.reason}`];
  const lines = ['Heating sizing', designConditions(result)];
  for (const entry of result.heatSources) {
    const view = heatSourceView(entry, result);
    if (view.kind === 'note') {
      lines.push('', `Heat source "${entry.name}": ${view.text}`);
      continue;
    }
    lines.push('', `Heat source "${entry.name}": ${view.pill.label}`);
    if (view.sentence) lines.push(`  ${view.sentence}`);
    lines.push(`  ${view.bar.markerLabel}. ${heatSourceGivesSentence(entry, entry.maxKw!)}`);
    // The panel's basis line starts with the design conditions printed once above.
    const extras = heatSourceExtras(entry).join(' ');
    if (extras) lines.push(`  ${extras}`);
    for (const text of entry.notes) lines.push(`  Note: ${text}`);
  }
  for (const entry of result.systems) {
    const view = systemView(entry, result);
    const name = `System "${entry.name}"${entry.zone ? ` (${entry.zone})` : ''}`;
    if (view.kind === 'note') {
      lines.push('', `${name}: ${view.text}`);
      continue;
    }
    lines.push('', `${name}: ${view.pill.label}`, `  ${view.sentence}`);
    if (isSized(entry)) lines.push(`  ${emitterOutputSentence(entry, result.zoneCount)}`);
    for (const text of entry.notes) lines.push(`  Note: ${text}`);
  }
  if (result.heatSources.length === 0 && result.systems.length === 0) lines.push('', 'No space heating system or heat source to size.');
  for (const text of result.notes) lines.push('', text);
  return lines;
}
