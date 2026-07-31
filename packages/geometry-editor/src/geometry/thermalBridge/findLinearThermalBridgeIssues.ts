// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Orphan and mismatch flags for existing {@link ThermalBridgeLinear} elements (suggest-TB modal / health).
 * Pure functions — safe to test without React.
 *
 * Pairwise **overlap** uses {@link overlapLengthBetweenSegmentElements} — **3D** parallel segments within
 * perpendicular tolerance ({@link TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M}), not plan-only 2D projection.
 *
 * Each issue has a **category** ({@link LinearThermalBridgeIssueCategory}) for cross-junction grouping
 * and a **kind** ({@link LinearThermalBridgeIssueKind}) for the specific rule. New junction rules should
 * reuse an existing category where possible; add a new `kind` when the message or predicate is new.
 */
import type { BuildingElementGround, Element, ThermalBridgeLinear } from '../types';
import { JUNCTION_TYPE_ENUM } from '../../lib/simplifiedFabricMap';
import { e16e17CornerPlanMessage } from './linearTbCornerValidation';
import {
  DEFAULT_TB_DEDUPE_TOLERANCE_M,
  FAR_FROM_HOST_TOL_M,
} from './thermalBridgeTolerances';
import { getJunctionContract } from './junctionContractRegistry';
import {
  bestPlanEdgeMatchForLinearTb,
  planCoordinatesForHostElement,
  readThermalBridgeSourceWallIds,
  resolveHostElementForLinearTb,
  shouldSkipOutlineChecksForTwoHostRoofJunction,
  thermalBridgeSourceHostIdSet,
  tbPlanAlignmentMessageForMatchedEdge,
} from './tbLinkage';
import { validateHostForProposerPattern } from './junctionHostPredicates';
import { overlapLengthBetweenSegmentElements } from './linearTbSegmentOverlap';
import { basementFloorSurfaceElevationM, isBasementGroundElement } from '../../lib/basementGeometry';

const JUNCTION_SET = new Set(JUNCTION_TYPE_ENUM);
const BASEMENT_E22_ELEVATION_TOL_M = 0.03;

/**
 * Bridge-agnostic validation classes for UI grouping, analytics, and reuse across junction codes.
 * Fine-grained {@link LinearThermalBridgeIssue.kind} stays stable for tests and debugging.
 */
export type LinearThermalBridgeIssueCategory =
  /** Declared junction_type not in Table 3.7 / known enum */
  | 'vocabulary'
  /** parent_element does not resolve to an element in zone */
  | 'reference_unresolved'
  /** Required secondary references incomplete or broken (e.g. thermal_bridge_source host ids for corners) */
  | 'association_invalid'
  /** Resolved host fails junction-specific type/shape predicate (e.g. R1–R3 need roof window) */
  | 'host_type_mismatch'
  /** TB vs single-host plan outline: distance to edge, alignment, span — shared geometric layer */
  | 'outline_geometry'
  /** TB vs multiple hosts in plan (e.g. wall–wall intersection for corners) */
  | 'multi_host_geometry';

export type LinearThermalBridgeIssueKind =
  | 'orphan_unresolved_parent'
  | 'orphan_e16e17_incomplete_walls'
  | 'mismatch_e16e17_corner_plan'
  | 'mismatch_junction_parent_host_pattern'
  | 'mismatch_basement_e22_elevation'
  | 'orphan_segment_far_from_host'
  | 'mismatch_tb_plan_alignment'
  | 'overlap_duplicate_colinear_segment'
  | 'mismatch_unknown_junction_type';

export type LinearThermalBridgeIssueSeverity = 'error' | 'warning';

export interface LinearThermalBridgeIssue {
  elementId: string;
  name: string;
  junctionType: string | undefined;
  category: LinearThermalBridgeIssueCategory;
  kind: LinearThermalBridgeIssueKind;
  message: string;
  severity: LinearThermalBridgeIssueSeverity;
}

/** Stable mapping from fine-grained kind → general category (one category per kind today). */
export function categoryForLinearThermalBridgeIssueKind(kind: LinearThermalBridgeIssueKind): LinearThermalBridgeIssueCategory {
  switch (kind) {
    case 'mismatch_unknown_junction_type':
      return 'vocabulary';
    case 'orphan_unresolved_parent':
      return 'reference_unresolved';
    case 'orphan_e16e17_incomplete_walls':
      return 'association_invalid';
    case 'mismatch_e16e17_corner_plan':
      return 'multi_host_geometry';
    case 'mismatch_junction_parent_host_pattern':
      return 'host_type_mismatch';
    case 'mismatch_basement_e22_elevation':
      return 'outline_geometry';
    case 'orphan_segment_far_from_host':
    case 'mismatch_tb_plan_alignment':
    case 'overlap_duplicate_colinear_segment':
      return 'outline_geometry';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function linearThermalBridgeIssue(
  base: Omit<LinearThermalBridgeIssue, 'category'>,
): LinearThermalBridgeIssue {
  return {
    ...base,
    category: categoryForLinearThermalBridgeIssueKind(base.kind),
  };
}

function extraRecord(tb: ThermalBridgeLinear): Record<string, unknown> {
  const ex = tb.extra_json;
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) return ex as Record<string, unknown>;
  return {};
}

function junctionTypeFromExtra(ex: Record<string, unknown>): string | undefined {
  const jt = ex.junction_type;
  return typeof jt === 'string' && jt.trim() ? jt.trim() : undefined;
}

function basementE22ElevationMessage(
  tb: ThermalBridgeLinear,
  host: Element | undefined,
): string | null {
  if (host?.type !== 'BuildingElementGround') return null;
  const ground = host as BuildingElementGround;
  if (!isBasementGroundElement(ground)) return null;
  const surfaceM = basementFloorSurfaceElevationM(ground);
  if (surfaceM === null) return null;
  const coords = tb.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const z0 = coords[0]?.z;
  const z1 = coords[1]?.z;
  if (typeof z0 !== 'number' || !Number.isFinite(z0) || typeof z1 !== 'number' || !Number.isFinite(z1)) {
    return null;
  }
  const maxDiff = Math.max(Math.abs(z0 - surfaceM), Math.abs(z1 - surfaceM));
  if (maxDiff <= BASEMENT_E22_ELEVATION_TOL_M) return null;
  return `E22 basement floor line should sit at basement floor surface ${surfaceM.toFixed(2)} m; current endpoint elevations are ${z0.toFixed(2)} m and ${z1.toFixed(2)} m.`;
}

/**
 * All detected issues. Per-TB singleton checks emit at most one issue each (priority chain); pairwise overlap
 * may add further issues so the same TB can appear in multiple issue rows.
 */
export function findLinearThermalBridgeIssues(elements: Element[] | ReadonlyArray<Element>): LinearThermalBridgeIssue[] {
  const list = Array.isArray(elements) ? elements : [...elements];
  const byId: Record<string, Element> = {};
  for (const e of list) {
    if (e?.id) byId[e.id] = e;
  }

  const out: LinearThermalBridgeIssue[] = [];

  for (const el of list) {
    if (el.type !== 'ThermalBridgeLinear') continue;
    const tb = el as ThermalBridgeLinear;
    if (tb.isPlaceholder) continue;

    const ex = extraRecord(tb);
    const jt = junctionTypeFromExtra(ex);
    const junctionContract = jt ? getJunctionContract(jt) : undefined;
    const srcWallIds = readThermalBridgeSourceWallIds(ex);
    if (jt && !JUNCTION_SET.has(jt)) {
      out.push(
        linearThermalBridgeIssue({
          elementId: tb.id,
          name: tb.name || tb.id,
          junctionType: jt,
          kind: 'mismatch_unknown_junction_type',
          message: `junction_type "${jt}" is not a Table 3.7 ref (E1–E25, P1–P8, R1–R11).`,
          severity: 'warning',
        }),
      );
      continue;
    }

    const parentStr = tb.parent_element?.trim() ?? '';
    let resolvedHost: Element | undefined;
    if (parentStr) {
      const host = resolveHostElementForLinearTb(parentStr, tb.zoneId, byId);
      if (!host) {
        out.push(
          linearThermalBridgeIssue({
            elementId: tb.id,
            name: tb.name || tb.id,
            junctionType: jt,
            kind: 'orphan_unresolved_parent',
            message: `parent_element "${parentStr}" does not match any element id or name in this zone.`,
            severity: 'error',
          }),
        );
        continue;
      }
      resolvedHost = host;
    }

    if (
      resolvedHost &&
      junctionContract &&
      !junctionContract.validation.usesDualWallCornerRules
    ) {
      const pattern = junctionContract.proposerHostPattern;
      if (pattern !== 'general_linear_tb' && pattern !== 'external_wall_corner_two_opaque') {
        const v = validateHostForProposerPattern(resolvedHost, pattern, jt);
        if (!v.ok) {
          out.push(
            linearThermalBridgeIssue({
              elementId: tb.id,
              name: tb.name || tb.id,
              junctionType: jt,
              kind: 'mismatch_junction_parent_host_pattern',
              message: v.detail,
              severity: 'warning',
            }),
          );
          continue;
        }
      }
    }

    if (jt === 'E22' && resolvedHost) {
      const elevationMsg = basementE22ElevationMessage(tb, resolvedHost);
      if (elevationMsg) {
        out.push(
          linearThermalBridgeIssue({
            elementId: tb.id,
            name: tb.name || tb.id,
            junctionType: jt,
            kind: 'mismatch_basement_e22_elevation',
            message: elevationMsg,
            severity: 'warning',
          }),
        );
        continue;
      }
    }

    if (junctionContract?.validation.usesDualWallCornerRules) {
      const { a, b } = srcWallIds;
      if (!a || !b) {
        out.push(
          linearThermalBridgeIssue({
            elementId: tb.id,
            name: tb.name || tb.id,
            junctionType: jt,
            kind: 'orphan_e16e17_incomplete_walls',
            message: 'Corner TB needs links to its two host walls. Rebind hosts from geometry or recreate the corner TB.',
            severity: 'error',
          }),
        );
        continue;
      }
      if (!byId[a] || !byId[b]) {
        const missing = [!byId[a] ? a : '', !byId[b] ? b : ''].filter(Boolean).join(', ');
        out.push(
          linearThermalBridgeIssue({
            elementId: tb.id,
            name: tb.name || tb.id,
            junctionType: jt,
            kind: 'orphan_e16e17_incomplete_walls',
            message: `Corner TB points to wall links that are not present in this loaded model: ${missing}. Rebind hosts from geometry or recreate the corner TB.`,
            severity: 'error',
          }),
        );
        continue;
      }
      const cornerMsg = e16e17CornerPlanMessage(tb, byId[a]!, byId[b]!);
      if (cornerMsg) {
        out.push(
          linearThermalBridgeIssue({
            elementId: tb.id,
            name: tb.name || tb.id,
            junctionType: jt,
            kind: 'mismatch_e16e17_corner_plan',
            message: cornerMsg,
            severity: 'warning',
          }),
        );
        continue;
      }
    }

    const e16e17ok =
      (jt === 'E16' || jt === 'E17') &&
      !!srcWallIds.a &&
      !!srcWallIds.b &&
      !!byId[srcWallIds.a!] &&
      !!byId[srcWallIds.b!];

    const skipTwoHostRoofOutline = shouldSkipOutlineChecksForTwoHostRoofJunction(jt, ex, byId);

    if (
      parentStr &&
      resolvedHost &&
      !e16e17ok &&
      junctionContract?.validation.usesSingleParentOutlineChecks !== false &&
      !skipTwoHostRoofOutline
    ) {
      const host = resolvedHost;
      const edgeMatch = bestPlanEdgeMatchForLinearTb(tb, host);
      const tol = Math.max(FAR_FROM_HOST_TOL_M, DEFAULT_TB_DEDUPE_TOLERANCE_M * 2);
      if (edgeMatch && edgeMatch.midpointDistToEdgeM > tol) {
        const dist = edgeMatch.midpointDistToEdgeM;
        out.push(
          linearThermalBridgeIssue({
            elementId: tb.id,
            name: tb.name || tb.id,
            junctionType: jt,
            kind: 'orphan_segment_far_from_host',
            message: `TB midline is ${dist.toFixed(2)} m from the nearest plan edge of the parent (${edgeMatch.spanM.toFixed(3)} m span) — check coordinates or parent.`,
            severity: 'warning',
          }),
        );
        continue;
      }
      if (edgeMatch) {
        const plan = planCoordinatesForHostElement(host);
        if (plan) {
          const alignMsg = tbPlanAlignmentMessageForMatchedEdge(tb, plan, edgeMatch);
          if (alignMsg) {
            out.push(
              linearThermalBridgeIssue({
                elementId: tb.id,
                name: tb.name || tb.id,
                junctionType: jt,
                kind: 'mismatch_tb_plan_alignment',
                message: alignMsg,
                severity: 'warning',
              }),
            );
            continue;
          }
        }
      }
    }
  }

  appendColinearSegmentOverlapIssues(out, list);

  return out;
}

type ColinearOverlapGroup = {
  elementType: 'ThermalBridgeLinear' | 'MechanicalVentilationDuctwork' | 'WaterPipework';
  singular: string;
  riskNote: string;
};

const COLINEAR_OVERLAP_GROUPS: readonly ColinearOverlapGroup[] = [
  { elementType: 'ThermalBridgeLinear', singular: 'thermal bridge', riskNote: 'risk of double-counting ψ·L' },
  {
    elementType: 'MechanicalVentilationDuctwork',
    singular: 'duct run',
    riskNote: 'risk of double-counting duct length',
  },
  { elementType: 'WaterPipework', singular: 'pipe run', riskNote: 'risk of double-counting pipe length' },
];

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function shouldSuppressThermalBridgeColinearOverlapPair(
  jtA: string | undefined,
  jtB: string | undefined,
  tbA: ThermalBridgeLinear,
  tbB: ThermalBridgeLinear,
): boolean {
  if (!jtA || !jtB) return false;
  const aCode = jtA.trim();
  const bCode = jtB.trim();
  const set = new Set([aCode, bCode]);
  if (set.has('E5') && set.has('P1')) return true;

  if (aCode === bCode) return false;
  const aIds = thermalBridgeSourceHostIdSet(extraRecord(tbA));
  const bIds = thermalBridgeSourceHostIdSet(extraRecord(tbB));
  if (aIds.size === 0 || bIds.size === 0) return false;
  return !setsEqual(aIds, bIds);
}

/** TB × TB, duct × duct, pipe × pipe — not cross-type. */
function appendColinearSegmentOverlapIssues(out: LinearThermalBridgeIssue[], list: readonly Element[]): void {
  for (const g of COLINEAR_OVERLAP_GROUPS) {
    const els = list.filter((e) => e.type === g.elementType && !e.isPlaceholder) as Element[];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]!;
        const b = els[j]!;
        const overlapLen = overlapLengthBetweenSegmentElements(a, b);
        if (overlapLen <= 0) continue;

        const jta = g.elementType === 'ThermalBridgeLinear' ? junctionTypeFromExtra(extraRecord(a as ThermalBridgeLinear)) : undefined;
        const jtb = g.elementType === 'ThermalBridgeLinear' ? junctionTypeFromExtra(extraRecord(b as ThermalBridgeLinear)) : undefined;

        if (
          g.elementType === 'ThermalBridgeLinear' &&
          shouldSuppressThermalBridgeColinearOverlapPair(jta, jtb, a as ThermalBridgeLinear, b as ThermalBridgeLinear)
        ) {
          continue;
        }

        const msg = (other: Element): string => {
          const jtOther =
            g.elementType === 'ThermalBridgeLinear'
              ? junctionTypeFromExtra(extraRecord(other as ThermalBridgeLinear))
              : undefined;
          const suffix = jtOther ? ` (${jtOther})` : '';
          return `Overlaps another ${g.singular} (~${overlapLen.toFixed(2)} m along the common run) with "${other.name || other.id}"${suffix} — ${g.riskNote}.`;
        };

        out.push(
          linearThermalBridgeIssue({
            elementId: a.id,
            name: a.name || a.id,
            junctionType: jta,
            kind: 'overlap_duplicate_colinear_segment',
            message: msg(b),
            severity: 'error',
          }),
        );
        out.push(
          linearThermalBridgeIssue({
            elementId: b.id,
            name: b.name || b.id,
            junctionType: jtb,
            kind: 'overlap_duplicate_colinear_segment',
            message: msg(a),
            severity: 'error',
          }),
        );
      }
    }
  }
}
