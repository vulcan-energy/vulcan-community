// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Global dedupe for auto façade TB proposals (Option A)** — runs **after** all proposers concatenate,
 * **before** the preview offers rows to create `ThermalBridgeLinear` elements.
 *
 * ## Where the rules live
 *
 * - **Precedence tiers** — {@link junctionDedupeTier} below (single source of truth). Lower tier =
 *   processed first = **kept** when two proposals **substantially overlap** in 3D.
 * - **“Substantially overlap”** — {@link FACADE_PROPOSAL_SUBSTANTIAL_OVERLAP_FRAC} in
 *   `thermalBridgeTolerances.ts`, using the same 3D parallel overlap geometry as inventory
 *   (`linearTbSegmentOverlap.overlapLengthBetweenSegmentElements`).
 *
 * ## Tie-breaks (same tier)
 *
 * 1. **Longer 3D segment first** — favours keeping the longer colinear run when junction types tie on tier;
 *    favours keeping the dominant ridge segment when storeys duplicate **R4**.
 * 2. **Lower storey index first** — when `floors` + element ids on the proposal resolve via
 *    {@link elementFloorZIndexForTb} (uses `hostElementIds`, `roofAdjacentPairIds`, `openingId`,
 *    `cornerHostWallIds`).
 * 3. **`proposalId`** lexicographic — stable ordering.
 *
 * ## Precedence intent (tiers 0 = highest)
 *
 * | Tier | Typical junction codes | Rationale |
 * |------|------------------------|-----------|
 * | 0 | E1–E4, R1–R3, R11 | Opening / roof-window surrounds must not be eaten by wall or roof lines. |
 * | 1 | E20, E21 | Discrete exposed-floor × external-wall segments beat continuous wall–floor strips. |
 * | 2 | P2, P3 | Party wall × intermediate floor before generic roof overlaps. |
 * | 3 | E10, E11 | Eaves lines. |
 * | 4 | E12, E13 | Gable / roof-plane edges beat **R8/R9** only when known host identities match. |
 * | 5 | R4, R5 | Ridge (after gable tier so gable wins if same line — rare). |
 * | 6 | R8, R9, R10 | Roof ↔ vertical wall / dormer cuts — loses to gable when coincident. |
 * | 7 | E5, E19, E6 | Continuous wall–floor lines — beat mislabelled **P1** / legacy party codes when coincident. |
 * | 8 | P4, P5 | Party ↔ roof edge. |
 * | 8 | P1, P6, P7, P8 | Party-wall floor junctions — lower precedence than **E5** on coincident external wall–ground lines. |
 * | 9+ | E16–E18, E7, E22, … | Corners and other junctions; unknown codes default to tier 50. |
 *
 * **Adjust policy** by changing {@link junctionDedupeTier} only — keep this docblock in sync.
 */

import type { Floor } from '../../stores/geometryStore';
import { elementFloorZIndexForTb } from '../../lib/geometry3dMapper';
import type { Element } from '../types';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { overlapLengthBetweenSegmentElements } from './linearTbSegmentOverlap';
import { knownHostElementIdsForAutoTbProposal } from './resolveTbHostFloorId';
import { FACADE_PROPOSAL_SUBSTANTIAL_OVERLAP_FRAC } from './thermalBridgeTolerances';

/** @see module doc — exported for unit tests and tooling. */
export function junctionDedupeTier(junctionCode: string): number {
  const c = junctionCode.trim().toUpperCase();
  if (/^E[1234]$/.test(c)) return 0;
  if (/^R[123]$/.test(c)) return 0;
  if (c === 'R11') return 0;

  if (c === 'E20' || c === 'E21') return 1;

  if (c === 'P2' || c === 'P3') return 2;

  if (c === 'E10' || c === 'E11') return 3;

  if (c === 'E12' || c === 'E13') return 4;

  if (c === 'R4' || c === 'R5') return 5;

  if (c === 'R8' || c === 'R9' || c === 'R10') return 6;

  if (c === 'E5' || c === 'E19' || c === 'E6') return 7;

  if (c === 'P1' || c === 'P6' || c === 'P7' || c === 'P8') return 8;

  if (c === 'P4' || c === 'P5') return 9;

  if (c === 'E16' || c === 'E17' || c === 'E18' || c === 'E7' || c === 'E22') return 10;

  if (c === 'E14' || c === 'E15') return 11;

  return 50;
}

function segmentLength3d(coords: FacadeOpeningTbProposal['coordinates']): number {
  const a = coords[0]!;
  const b = coords[1]!;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function facadeProposalsSubstantiallyOverlap3D(a: FacadeOpeningTbProposal, b: FacadeOpeningTbProposal): boolean {
  const overlap = overlapLengthBetweenSegmentElements(
    { coordinates: a.coordinates },
    { coordinates: b.coordinates },
  );
  if (overlap <= 0) return false;
  const la = segmentLength3d(a.coordinates);
  const lb = segmentLength3d(b.coordinates);
  const shorter = Math.min(la, lb);
  if (shorter < 1e-6) return false;
  return overlap / shorter >= FACADE_PROPOSAL_SUBSTANTIAL_OVERLAP_FRAC;
}

function proposalHostIds(p: FacadeOpeningTbProposal, byId: Record<string, Element>): Set<string> {
  return knownHostElementIdsForAutoTbProposal(p, byId);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function proposalsCanDedupeByHostIdentity(
  a: FacadeOpeningTbProposal,
  b: FacadeOpeningTbProposal,
  byId: Record<string, Element>,
): boolean {
  if (a.junctionCode.trim().toUpperCase() === b.junctionCode.trim().toUpperCase()) return true;
  const aIds = proposalHostIds(a, byId);
  const bIds = proposalHostIds(b, byId);
  if (aIds.size === 0 || bIds.size === 0) return true;
  return setsEqual(aIds, bIds);
}

function proposalFloorZIndexForSort(
  p: FacadeOpeningTbProposal,
  byId: Record<string, Element>,
  floors: Floor[] | undefined,
): number {
  if (!floors || floors.length === 0) return 0;

  const ids: string[] = [];
  ids.push(...knownHostElementIdsForAutoTbProposal(p, byId));

  let best = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const el = byId[id];
    if (!el) continue;
    best = Math.min(best, elementFloorZIndexForTb(el, floors));
  }
  return Number.isFinite(best) ? best : 0;
}

/** Lower junction tier first; then longer segment; then lower storey; then proposalId. */
export function compareProposalsForDedupePrecedence(
  a: FacadeOpeningTbProposal,
  b: FacadeOpeningTbProposal,
  byId: Record<string, Element>,
  floors: Floor[] | undefined,
): number {
  const ta = junctionDedupeTier(a.junctionCode);
  const tb = junctionDedupeTier(b.junctionCode);
  if (ta !== tb) return ta - tb;

  const la = segmentLength3d(a.coordinates);
  const lb = segmentLength3d(b.coordinates);
  if (Math.abs(lb - la) > 1e-6) return lb - la;

  const fa = proposalFloorZIndexForSort(a, byId, floors);
  const fb = proposalFloorZIndexForSort(b, byId, floors);
  if (fa !== fb) return fa - fb;

  return a.proposalId.localeCompare(b.proposalId);
}

export interface DedupeFacadeThermalBridgeProposalsContext {
  elements: readonly Element[];
  floors?: Floor[];
}

/**
 * Drop proposals that **substantially** overlap in 3D a **higher-precedence** proposal (see module doc).
 * Original concatenation order of the kept proposals is preserved.
 */
export function dedupeFacadeThermalBridgeProposals(
  proposals: FacadeOpeningTbProposal[],
  ctx: DedupeFacadeThermalBridgeProposalsContext,
): FacadeOpeningTbProposal[] {
  if (proposals.length <= 1) return [...proposals];

  const byId: Record<string, Element> = {};
  for (const e of ctx.elements) {
    if (e?.id) byId[e.id] = e;
  }

  const sorted = [...proposals].sort((a, b) => compareProposalsForDedupePrecedence(a, b, byId, ctx.floors));

  const kept: FacadeOpeningTbProposal[] = [];
  for (const cand of sorted) {
    let overlapsPrior = false;
    for (const acc of kept) {
      if (
        proposalsCanDedupeByHostIdentity(cand, acc, byId) &&
        facadeProposalsSubstantiallyOverlap3D(cand, acc)
      ) {
        overlapsPrior = true;
        break;
      }
    }
    if (!overlapsPrior) kept.push(cand);
  }

  const keepIds = new Set(kept.map((p) => p.proposalId));
  return proposals.filter((p) => keepIds.has(p.proposalId));
}
