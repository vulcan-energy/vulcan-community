// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { JUNCTION_TYPE_ENUM } from '../../lib/simplifiedFabricMap';

/**
 * Junction codes the auto thermal-bridge preview may assign (per-edge dropdowns).
 * Includes façade E-series, E7 party floor/ceiling, E10–E19, E22 basement, sloped eaves/gable/ridge, flat roof, roof R1–R3/R10/R11, party P1–P8 (incl. party wall × pitched or flat roof), E18, etc.
 * Excluded: E8/E9/E23 balcony details, E24 inverted eaves, E25 staggered party wall, and R6/R7 roof catch-alls — no geometry-only auto row.
 */
const FACADE_PREVIEW_JUNCTION_CODES = new Set<string>([
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
  'R1',
  'R2',
  'R3',
  'R4',
  'R5',
  'R8',
  'R9',
  'R10',
  'R11',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
]);

/** True when this Table 3.7 code can appear on an auto-suggestion row (vs manual-only in inventory). */
export function isJunctionAutoSuggestedByFacadeTool(code: string | undefined): boolean {
  if (!code || typeof code !== 'string') return false;
  return FACADE_PREVIEW_JUNCTION_CODES.has(code.trim());
}

/** Canonical ordered list of junction codes the auto TB preview can assign (dropdowns). Kept in sync with `proposedJunctionContractCoverage.test.ts`. */
export function junctionCodesInFacadeAutoModal(): string[] {
  return [...FACADE_PREVIEW_JUNCTION_CODES].sort(junctionCodeSort);
}

/** Table 3.7 junction codes never surfaced as rows in the façade auto preview. */
export function junctionCodesNotAutoSuggestedByFacadeTool(): string[] {
  return JUNCTION_TYPE_ENUM.filter((c) => !FACADE_PREVIEW_JUNCTION_CODES.has(c));
}

export function junctionCodesGroupedBySeries(codes: string[]): { series: string; codes: string[] }[] {
  const by: Record<string, string[]> = {};
  for (const c of codes) {
    const series = /^[EPR]/i.test(c) ? c[0]!.toUpperCase() : '?';
    (by[series] ??= []).push(c);
  }
  const order = ['E', 'P', 'R'];
  const primary = order
    .filter((s) => (by[s]?.length ?? 0) > 0)
    .map((series) => ({ series, codes: [...(by[series] ?? [])].sort(junctionCodeSort) }));
  const rest = Object.keys(by)
    .filter((s) => !order.includes(s))
    .sort()
    .map((series) => ({ series, codes: [...by[series]!].sort(junctionCodeSort) }));
  return [...primary, ...rest];
}

function junctionCodeSort(a: string, b: string): number {
  const sa = a[0];
  const sb = b[0];
  if (sa !== sb) return a.localeCompare(b);
  const na = parseInt(a.slice(1), 10);
  const nb = parseInt(b.slice(1), 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}
