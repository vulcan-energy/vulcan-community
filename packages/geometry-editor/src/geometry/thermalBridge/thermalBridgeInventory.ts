// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inventory buckets and classification for linear TB list UI (all zones).
 */
import type { Element, ThermalBridgeLinear } from '../types';
import { isJunctionAutoSuggestedByFacadeTool } from './facadeAutoTbScope';
import type { LinearThermalBridgeIssue, LinearThermalBridgeIssueCategory } from './findLinearThermalBridgeIssues';
import {
  bestPlanEdgeMatchForLinearTb,
  readThermalBridgeSourceWallIds,
  resolveHostElementForLinearTb,
  shouldSkipOutlineChecksForTwoHostRoofJunction,
  tbPlanSegmentLengthM,
} from './tbLinkage';
import {
  LENGTH_VS_SPAN_ABS_TOL_M,
  LENGTH_VS_SPAN_REL_TOL,
  TB_MIN_PLAN_LENGTH_FOR_ALIGNMENT_M,
} from './thermalBridgeTolerances';

export type ThermalBridgeInventoryBucket = 'validated' | 'problematic' | 'manual_only';

export interface ThermalBridgeInventoryRow {
  tb: ThermalBridgeLinear;
  bucket: ThermalBridgeInventoryBucket;
  /** General validation class when {@link findLinearThermalBridgeIssues} reported an issue for this TB */
  linearTbIssueCategory?: LinearThermalBridgeIssueCategory;
  /** Human-readable notes for problematic rows or span mismatch */
  notes: string[];
  zoneName: string;
  junctionType: string | undefined;
  tbLengthM: number | undefined;
  impliedHostSpanM: number | undefined;
}

function zoneNameForId(zones: ReadonlyArray<{ id: string; name?: string }>, zoneId: string | undefined): string {
  if (!zoneId) return '—';
  const z = zones.find((x) => x.id === zoneId);
  return (z?.name && String(z.name).trim()) || zoneId.slice(0, 8);
}

/**
 * Plan length (m) of the host edge closest to this TB midline — single segment for 2-point hosts,
 * or best matching closed-polygon edge (same rule as auto TB proposals on roofs).
 */
export function impliedPlanSpanMForLinearTbHost(tb: ThermalBridgeLinear, host: Element): number | undefined {
  const m = bestPlanEdgeMatchForLinearTb(tb, host);
  return m !== null ? m.spanM : undefined;
}

export function linearTbSegmentLengthM(tb: ThermalBridgeLinear): number | undefined {
  const len = typeof tb.length === 'number' && Number.isFinite(tb.length) && tb.length > 0 ? tb.length : undefined;
  if (len !== undefined) return len;
  const c = tb.coordinates;
  if (!c || c.length < 2) return undefined;
  const p0 = c[0]!;
  const p1 = c[1]!;
  const L = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  return L > 1e-6 ? L : undefined;
}

function lengthMismatchWithHostSpan(tbLen: number, span: number): boolean {
  const diff = Math.abs(tbLen - span);
  if (diff <= LENGTH_VS_SPAN_ABS_TOL_M) return false;
  const maxLen = Math.max(tbLen, span);
  if (maxLen < 1e-6) return false;
  return diff / maxLen > LENGTH_VS_SPAN_REL_TOL;
}

function severityOrder(s: LinearThermalBridgeIssue['severity']): number {
  return s === 'error' ? 0 : 1;
}

/** Group validation issues; errors before warnings; stable by kind. */
export function groupLinearThermalBridgeIssuesByElementId(
  issues: LinearThermalBridgeIssue[],
): Map<string, LinearThermalBridgeIssue[]> {
  const m = new Map<string, LinearThermalBridgeIssue[]>();
  for (const i of issues) {
    const arr = m.get(i.elementId) ?? [];
    arr.push(i);
    m.set(i.elementId, arr);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => {
      const sd = severityOrder(a.severity) - severityOrder(b.severity);
      if (sd !== 0) return sd;
      return a.kind.localeCompare(b.kind);
    });
  }
  return m;
}

function staleThermalBridgeSourceNotes(tb: ThermalBridgeLinear, elementsById: Record<string, Element>): string[] {
  const ex = tb.extra_json;
  if (!ex || typeof ex !== 'object') return [];
  const raw = (ex as Record<string, unknown>).thermal_bridge_source;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const o = raw as Record<string, unknown>;
  const notes: string[] = [];
  const a = typeof o.host_wall_id === 'string' ? o.host_wall_id.trim() : '';
  const b = typeof o.host_wall_b_id === 'string' ? o.host_wall_b_id.trim() : '';
  if (a && !elementsById[a]) {
    notes.push(`Saved thermal bridge host link "${a}" is not present in this loaded model`);
  }
  if (b && !elementsById[b]) {
    notes.push(`Saved thermal bridge host link "${b}" is not present in this loaded model`);
  }
  return notes;
}

/**
 * Classify one linear TB for inventory (disjoint buckets: problematic > manual_only > validated).
 */
export function classifyThermalBridgeForInventory(
  tb: ThermalBridgeLinear,
  elementsById: Record<string, Element>,
  zones: ReadonlyArray<{ id: string; name?: string }>,
  issuesByElementId: Map<string, LinearThermalBridgeIssue[]>,
): ThermalBridgeInventoryRow {
  const notes: string[] = [];
  const jt =
    tb.extra_json &&
    typeof tb.extra_json === 'object' &&
    !Array.isArray(tb.extra_json) &&
    typeof (tb.extra_json as Record<string, unknown>).junction_type === 'string'
      ? String((tb.extra_json as Record<string, unknown>).junction_type).trim()
      : undefined;

  if (tb.isPlaceholder) {
    notes.push('Placeholder element');
  }
  const nm = typeof tb.name === 'string' ? tb.name.trim() : '';
  if (!nm) {
    notes.push('Unnamed thermal bridge');
  }

  const issueList = issuesByElementId.get(tb.id);
  if (issueList) {
    for (const issue of issueList) {
      notes.push(issue.message);
    }
  }
  const linearTbIssueCategory = issueList?.[0]?.category;

  notes.push(...staleThermalBridgeSourceNotes(tb, elementsById));

  const exObj =
    tb.extra_json && typeof tb.extra_json === 'object' && !Array.isArray(tb.extra_json)
      ? (tb.extra_json as Record<string, unknown>)
      : undefined;

  const parentStr = tb.parent_element?.trim() ?? '';
  const host = parentStr ? resolveHostElementForLinearTb(parentStr, tb.zoneId, elementsById) : null;
  const tbLen = linearTbSegmentLengthM(tb);
  let impliedSpan: number | undefined;
  if (host && !shouldSkipOutlineChecksForTwoHostRoofJunction(jt, exObj, elementsById)) {
    impliedSpan = impliedPlanSpanMForLinearTbHost(tb, host);
    const planLen = tbPlanSegmentLengthM(tb);
    const spanCompareLen =
      planLen >= TB_MIN_PLAN_LENGTH_FOR_ALIGNMENT_M ? planLen : undefined;
    if (
      spanCompareLen !== undefined &&
      impliedSpan !== undefined &&
      lengthMismatchWithHostSpan(spanCompareLen, impliedSpan)
    ) {
      notes.push(
        `Length ${spanCompareLen.toFixed(3)} m vs nearest host plan edge span ${impliedSpan.toFixed(3)} m — check partial line or parent`,
      );
    }
  } else if (host) {
    impliedSpan = impliedPlanSpanMForLinearTbHost(tb, host);
  }
  const { a: idA, b: idB } = readThermalBridgeSourceWallIds(exObj);
  if ((jt === 'E16' || jt === 'E17') && (!idA || !idB)) {
    notes.push('Corner TB needs links to its two host walls');
  }

  const bucket: ThermalBridgeInventoryBucket = (() => {
    if (notes.length > 0) return 'problematic';
    if (!isJunctionAutoSuggestedByFacadeTool(jt)) return 'manual_only';
    return 'validated';
  })();

  return {
    tb,
    bucket,
    linearTbIssueCategory,
    notes: bucket === 'problematic' ? notes : bucket === 'manual_only' ? [`Junction ${jt ?? '—'} not in auto-suggest set`] : [],
    zoneName: zoneNameForId(zones, tb.zoneId),
    junctionType: jt,
    tbLengthM: tbLen,
    impliedHostSpanM: impliedSpan,
  };
}

export function buildThermalBridgeInventoryRows(
  elementsById: Record<string, Element>,
  zones: ReadonlyArray<{ id: string; name?: string }>,
  issues: LinearThermalBridgeIssue[],
): ThermalBridgeInventoryRow[] {
  const issueMap = groupLinearThermalBridgeIssuesByElementId(issues);

  const rows: ThermalBridgeInventoryRow[] = [];
  for (const el of Object.values(elementsById)) {
    if (el.type !== 'ThermalBridgeLinear') continue;
    const tb = el as ThermalBridgeLinear;
    rows.push(classifyThermalBridgeForInventory(tb, elementsById, zones, issueMap));
  }
  rows.sort((a, b) => {
    const za = a.tb.zoneId ?? '';
    const zb = b.tb.zoneId ?? '';
    if (za !== zb) return za.localeCompare(zb);
    return (a.tb.name || a.tb.id).localeCompare(b.tb.name || b.tb.id);
  });
  return rows;
}
