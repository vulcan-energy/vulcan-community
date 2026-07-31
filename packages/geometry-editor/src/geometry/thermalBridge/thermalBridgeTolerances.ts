// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Single source of truth for thermal-bridge geometric tolerances (proposers + validation + inventory).
 * Keep values in sync when changing snap/dedupe behaviour.
 */

/** Dedupe / coincidence tolerance used across façade TB proposals and validation (m). */
export const DEFAULT_TB_DEDUPE_TOLERANCE_M = 0.12;

/** Party/adjacent ↔ external wall coincidence (perpendicular), {@link proposeAdjacentWallJunction} (m). */
export const ADJACENT_WALL_COINCIDENT_PERP_TOL_M = 0.12;

/** Parent outline: TB midpoint farther than this from nearest plan edge → warning (m). */
export const FAR_FROM_HOST_TOL_M = 0.35;

/** Inventory: TB length vs matched edge span — absolute tolerance (m). */
export const LENGTH_VS_SPAN_ABS_TOL_M = 0.08;

/** Inventory: TB length vs matched edge span — relative tolerance. */
export const LENGTH_VS_SPAN_REL_TOL = 0.02;

/** E16/E17: TB plan position vs intersection of the two host wall lines (m). */
export const E16_E17_CORNER_PLAN_TOL_M = 0.18;

/**
 * TB plan segment longer than this (m): require parallel-to-edge and endpoints-on-edge checks
 * relative to the matched host outline edge.
 */
export const TB_MIN_PLAN_LENGTH_FOR_ALIGNMENT_M = 0.08;

/** Min |cos(angle)| between TB plan direction and matched host edge direction — ~10° slack. */
export const TB_PLAN_EDGE_PARALLEL_MIN_ABS_DOT = 0.9849;

/** Allowed overshoot when projecting TB endpoints onto the host edge (m along line). */
export const TB_ENDPOINT_EDGE_MARGIN_M = 0.15;

/** TB↔TB overlap: max perpendicular distance from segment endpoints to the mate’s infinite line (m). */
export const TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M = DEFAULT_TB_DEDUPE_TOLERANCE_M;

/** TB↔TB overlap: ignore overlaps shorter than this (m) — numerical noise / corner kisses. */
export const TB_SEGMENT_OVERLAP_MIN_LENGTH_M = 0.03;

/** TB↔TB overlap: min |cos θ| between segment directions (parallel cone). ~0.996 ≈ 5°. */
export const TB_SEGMENT_PARALLEL_MIN_ABS_DOT = 0.996;

/**
 * Global façade TB proposal dedupe: two segments are “the same junction line” when overlap length /
 * min(segment lengths) ≥ this fraction ({@link dedupeFacadeThermalBridgeProposals}).
 */
export const FACADE_PROPOSAL_SUBSTANTIAL_OVERLAP_FRAC = 0.72;
