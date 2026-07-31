// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Types for the assembly / layered U-value calculator (Phase 1).
 * Layer order: inside (heated side) → outside.
 */

import type { FhsMassDistributionClass } from './assemblyMassHeuristic';

export type AssemblyElementMode =
  | 'BuildingElementOpaque'
  | 'BuildingElementGround'
  | 'BuildingElementAdjacentUnconditionedSpace_Simple'
  | 'BuildingElementAdjacentConditionedSpace'
  | 'BuildingElementPartyWall'
  /** 2D thermal-bridge junction regions — includes subgrade soils (unlike opaque wall assemblies). */
  | 'ThermalBridgeJunctionRegion';

/** Citation for thermal-mass design values transcribed from standards (audit / mass heuristics). */
export interface ThermalPropertiesSource {
  standard: string;
  table?: string;
  row?: string;
}

export interface MaterialRow {
  id: string;
  /** Picker grouping — matches `materialCategories[].id` in `materials.json`. */
  category?: string;
  name: string;
  /** Short label used when composing assembly `name` strings (layer stack summaries). */
  shortName: string;
  lambda_W_mK: number;
  /** Single citation line (e.g. BR 443 section + ρ,c note). */
  sourceRef?: string;
  /** Design mass density ρ (kg/m³). */
  density_kg_m3?: number;
  /** Design specific heat c (J/(kg·K)). */
  specific_heat_J_kg_K?: number;
  /**
   * Design volumetric heat capacity (MJ/(m³·K)) if the standard gives C_v directly
   * (alternative to combining ρ and c).
   */
  volumetric_heat_capacity_MJ_m3K?: number;
  thermalPropertiesSource?: ThermalPropertiesSource;
  /** @deprecated optional — prefer sourceRef */
  sourceType?: string;
  sourceSection?: string;
  sourceQuote?: string;
  surfaceDensity_kg_m2_max?: number;
}

export interface CavityRow {
  cavityType: string;
  fixedResistance_m2K_W: number;
  /** Plain-language fragment for assembly names, e.g. "Unventilated wall cavity". */
  shortLabel: string;
  sourceSection?: string;
  heatFlowNote?: string;
  /**
   * Suggested BS EN ISO 6946 Annex F Table F.1 level (0–2) for ΔU_g when this cavity type is used.
   * Review against ISO 6946:2017; omitted defaults to 0 in code.
   */
  iso6946AnnexFAirVoidLevelDefault?: 0 | 1 | 2;
}

/**
 * Repeating in-plane bridge parallel to the base solid material (ISO 6946 parallel-path style).
 * Fractions are **area fractions** of the layer; remaining area uses the layer’s main material.
 */
export type RepeatingBridgeDefinition =
  | { mode: 'framing_fraction'; framingFraction: number }
  | { mode: 'spacing_width'; spacing_m: number; width_m: number };

export interface RepeatingBridgeRow {
  /** Stable id for React keys / editing (not persisted in HEM). */
  id: string;
  bridgeMaterialId: string;
  definition: RepeatingBridgeDefinition;
}

export interface AssemblyLayerSolid {
  kind: 'solid';
  materialId: string;
  thickness_m: number;
  /** Optional parallel-path bridges within this thickness (e.g. studs in insulated frame). */
  repeatingBridges?: RepeatingBridgeRow[];
}

export interface AssemblyLayerCavity {
  kind: 'cavity';
  /**
   * Legacy cavity preset id / provenance tag. Explicit cavities may omit this and derive thermal
   * resistance from the fields below instead.
   */
  cavityType?: string;
  /** Legacy fixed R (m²K/W); explicit cavities should leave this unset. */
  fixedResistance_m2K_W?: number;
  /** Explicit cavity ventilation class. */
  ventilation?: 'unventilated' | 'well_ventilated';
  /** Physical air-gap thickness (m) in the heat-flow direction. */
  gap_thickness_m?: number;
  /** Bounding-surface emissivity for explicit cavities. */
  surface_emissivity?: 'high' | 'low';
  /**
   * Optional override for Annex F Table F.1 air-void level (ΔU_g). When omitted, use library default for `cavityType`.
   */
  annexFAirVoidLevelOverride?: 0 | 1 | 2;
}

export type AssemblyLayer = AssemblyLayerSolid | AssemblyLayerCavity;

export interface ExternalDetailProfileLink {
  /** External detail library/source id, e.g. Recognised Construction Details. */
  source: 'recognised_construction_details' | string;
  /** Stable id of the selected source profile. */
  profileId: string;
  /** Human-readable label persisted for old snapshots and CSV round-trips. */
  label: string;
}

export interface AssemblyExample {
  id: string;
  name: string;
  elementType: string;
  layers: Array<{
    kind: 'solid' | 'cavity';
    materialId?: string;
    thickness_m?: number;
    cavityType?: string;
    fixedResistance_m2K_W?: number;
    ventilation?: 'unventilated' | 'well_ventilated';
    gap_thickness_m?: number;
    surface_emissivity?: 'high' | 'low';
    annexFAirVoidLevelOverride?: 0 | 1 | 2;
    repeatingBridges?: RepeatingBridgeRow[];
  }>;
  /** User-saved assemblies (`user:asm:…`) set `user`. */
  sourceType?: string;
  externalDetailProfile?: ExternalDetailProfileLink;
}

/** Audit snapshot of BS EN ISO 6946 Annex F inputs and computed ΔU (under `vulcan_assembly_v1` only). */
export interface Iso6946AnnexFEnvelopeV1 {
  airVoidLevel: 0 | 1 | 2;
  airVoidLayerIndex: number;
  fastenerNf_per_m2: number;
  fastenerChi_W_per_m2K: number;
  invertedRoof: boolean;
  p_mm_per_day: number;
  f_times_x: number;
  deltaU_g_W_m2K: number;
  deltaU_f_W_m2K: number;
  deltaU_r_W_m2K: number;
  uBeforeAnnexF_W_m2K: number;
  uAfterAnnexF_beforeRounding_W_m2K: number;
}

/** Persisted under extra_json.vulcan_assembly_v1 (audit / round-trip). */
export interface VulcanAssemblyV1Envelope {
  schemaVersion: 1;
  assemblyId: string;
  assemblySnapshot: {
    layers: AssemblyLayer[];
    pitchDegrees: number;
    elementMode: AssemblyElementMode;
    /**
     * When several cavity layers exist, which one drives Annex F ΔU_g / R₁ for F.3.
     * Omitted when there is at most one cavity (implicit).
     */
    annexFPrimaryCavityLayerIndex?: number | null;
    /**
     * Ground floor only: number of layers from the **outside** face (toward soil/crawl) assigned to
     * HEM `thermal_resist_insul` (R_g). Remaining inner layers = `thermal_resistance_floor_construction` (R_f).
     */
    groundRgLayerCountFromOutside?: number;
    /** Optional assembly-level link to an external construction-detail profile. */
    externalDetailProfile?: ExternalDetailProfileLink;
  };
  appliedAt: string;
  uncorrectedU_W_m2K: number;
  /**
   * Final U for HEM (BS EN ISO 6946 Annex F when corrections applied): U_c = U + ΣΔU, rounded to
   * two significant figures. Same value written to `extra_json.u_value` for fabric elements.
   */
  correctedU_W_m2K: number;
  /** Combined-method U (§6.7) before Annex F corrections — audit only. */
  combinedMethodU_W_m2K?: number;
  /** Annex F inputs + intermediate ΔU terms — omitted when all corrections are zero. */
  annexF_v1?: Iso6946AnnexFEnvelopeV1;
  /** Omitted when ground floor U is not overwritten (construction R only). */
  uValueWrittenToElement_W_m2K?: number;
  thermalResistanceConstruction_m2K_W: number;
  /** Ground floor: ISO 6946 mean R for insulation on base of underfloor space (HEM `thermal_resist_insul`). */
  thermalResistanceGroundInsulation_m2K_W?: number;
  /**
   * Suspended ground floor: void height (m) written to `extra_json.height_upper_surface` when derived
   * from a ventilated cavity in the applied assembly. Used for “Reset to assembly” in Advanced Fields.
   */
  suspendedHeightUpperSurfaceM?: number;
  /** ISO 6946 lower-limit construction R (m²K/W) before mean; optional audit field. */
  rConstructionLowerLimit_m2K_W?: number;
  /** ISO 6946 upper-limit construction R (m²K/W) before mean; optional audit field. */
  rConstructionUpperLimit_m2K_W?: number;
  /** FHS `MassDistributionClass` enum string (same as element `mass_distribution_class`). */
  massDistributionClass?: FhsMassDistributionClass;
  /**
   * Sum of ρ·c·d over solid layers (cavities ~0); parallel bridges area-weighted like U-value.
   * J/(m²·K). Layer-stack audit; see `arealHeatCapacityWrittenToElement_J_m2K` for the value merged
   * into `extra_json.areal_heat_capacity` for HEM.
   */
  arealHeatCapacity_J_m2K?: number;
  /** Numeric J/(m².K) counterpart of the last-applied element value (for FHS labels, this is the matching band value). */
  arealHeatCapacityWrittenToElement_J_m2K?: number;
  calculationEngineVersion: string;
}
