// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { ZONE_NAME_SUGGESTIONS } from './constants';

export type ZoneName = typeof ZONE_NAME_SUGGESTIONS[number] | string;

export type SpaceLabelSource = 'inferred' | 'manual' | 'edited_inferred';

/** SAP 10.2 `Built-Form` code. This is explicit assessment data, never geometry-derived. */
export type SapBuiltFormCode = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Metrics-only footprint (Space labels): room/void polygons for compliance derivation.
 * Not merged into HEM fabric JSON; serialized in the `Space Labels` CSV section.
 */
export interface SpaceLabel {
  id: string;
  name: string;
  zoneId: string;
  /** Authoring storey index (0 = ground), aligned with schedule / canvas floor Z bands. */
  storey: number;
  /** Registry key (e.g. bedroom, void); empty string = unassigned type. */
  room_type: string;
  coordinates: Array<{ x: number; y: number; z: number }>;
  /** Provenance for wall-inferred vs user-authored footprints. */
  source?: SpaceLabelSource;
  /** Optional vertical extent override (m); walls/storey used when absent. */
  height_override?: number;
  /**
   * When true/undefined, name is derived from room type like element auto-naming; set false after manual edit.
   * Authored state persists through the scoped override-provenance marker in `extra_json`.
   */
  _nameAutoSync?: boolean;
  /** Forward-compatible bag (mirrors other CSV rows). */
  extra_json?: Record<string, unknown>;
}

export interface Zone {
  id: string;
  name: ZoneName;
  floorArea: number; // Treated floor area — derived from ground + horizontal floor polygons (see zoneDerivation)
  /** FHS-only manual split for the primary export zone. */
  livingroom_area?: number;
  /** FHS-only manual split for the primary export zone. */
  restofdwelling_area?: number;
  height: number; // Average height (derived from wall elements)
  volume?: number; // Volume (derived: area × height)
  // NEW: CSV v3 properties
  simplifiedThermalBridging?: boolean;
  isPlaceholder?: boolean;
  // Metadata for derived floor area (used for reset-to-default UI)
  _derivedFloorArea?: number; // Always-calculated geometry-derived floor area
  _areaSource?: string; // Human-readable description of where the floor area came from
  _floorAreaUserOverride?: boolean; // When true, floorArea is user-set and won't auto-update from geometry
  // Metadata for derived height (used for reset-to-default UI)
  _derivedHeight?: number; // Always-calculated geometry-derived height (weighted avg of line-wall heights)
  _heightUserOverride?: boolean; // When true, height is user-set and won't auto-update from wall heights
  // Metadata for multi-floor ground element validation
  _groundFloorLevels?: number[]; // Distinct Z-levels of BuildingElementGround elements in this zone
}

// Element types as specified in BATCH_MODEL_TODO.md
export type ElementType =
  | 'BuildingElementOpaque'
  | 'BuildingElementTransparent'
  | 'BuildingElementGround'
  | 'BuildingElementAdjacentConditionedSpace'
  | 'BuildingElementAdjacentUnconditionedSpace_Simple'
  | 'BuildingElementPartyWall'
  | 'ThermalBridgeLinear'
  | 'ThermalBridgePoint'
  // NEW: CSV v3 types
  | 'WindowShading'
  | 'Lighting'
  | 'MechanicalVentilationDuctwork'
  | 'MechanicalVentilationTerminal'
  | 'WaterPipework'
  | 'WetEmitter'
  | 'Appliance'
  | 'HotWaterDemand'
  | 'ContextShading'
  // NEW: InfiltrationVentilation types
  | 'Vents'
  | 'MechanicalVentilation'
  | 'CombustionAppliances'
  | 'OnSiteGeneration'
  | 'ElectricBattery'
  // NEW: PCDB System element
  | 'System';

// Floor interface
export interface Floor {
  id: string;
  name: string;
  zIndex: number; // Maps to z-coordinate (0, 1, 2, etc.)
  /**
   * Stored storey height in metres. The *effective* storey height is derived live from line walls
   * on the floor (maximum height of qualifying vertical fabric walls); see
   * `getEffectiveStoreyHeight`. This stored value is only used as the effective height when
   * `heightUserOverride === true` — i.e. the user has explicitly typed a value into the floor
   * picker. Otherwise walls drive.
   */
  height: number;
  /**
   * True when the user has explicitly set `height` via the floor picker, decoupling it from walls.
   * When true, wall-height changes do not affect this floor's effective storey height. A "stale
   * override" warning surfaces in the picker if walls diverge.
   */
  heightUserOverride?: boolean;
  /**
   * Explicit slab/base elevation in metres above the model datum. When absent, the base is
   * derived from the floor stack for backwards compatibility with existing models.
   */
  baseHeight?: number;
  /** True when the user has explicitly set `baseHeight` in the floor picker. */
  baseHeightUserOverride?: boolean;
  isRoofSpace: boolean;
}

// Base element interface
export interface BaseElement {
  id: string;
  name: string;
  /** Internal UX state: auto-sync name to driving type fields until user edits manually. */
  _nameAutoSync?: boolean;
  /** Internal UX state: drawn sloped-polygon width is no longer auto-synced to the canvas. */
  _widthUserOverride?: boolean;
  /** Internal UX state: drawn sloped-polygon height is no longer auto-synced to the canvas. */
  _heightUserOverride?: boolean;
  zoneId?: string; // Made optional for global objects
  type: ElementType;
  isPlaceholder?: boolean;
  parent_element: string | null;
  extra_json?: Record<string, unknown>; // Advanced fields storage

  // Coordinate-based positioning (replaces position_xyz)
  coordinates: Array<{ x: number; y: number; z: number }>;

  // Floor assignment (auto-derived from z-coordinate)
  floorId?: string; // Auto-assigned based on z-coordinate

  /** Viewer-only absolute elevation above model ground for types without a HEM `base_height` field. */
  _base_height?: number;

  // Label placement cache for stickiness
  preferredLabelPosition?: { x: number; y: number; anchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' };

  // Version tracking for freshness verification
  _v?: number;

}

// BuildingElementOpaque / BuildingElementTransparent
export interface BuildingElementOpaque extends BaseElement {
  type: 'BuildingElementOpaque';
  width: number;
  height: number;
  area: number; // read-only = width × height
  pitch?: number;
  orientation360?: number;
  base_height?: number;
  is_unheated_pitched_roof?: boolean;
  is_external_door?: boolean;
  parent_element: string | null;
}

export interface BuildingElementTransparent extends BaseElement {
  type: 'BuildingElementTransparent';
  width: number;
  height: number;
  area: number;
  pitch?: number;
  orientation360?: number;
  base_height?: number;
  parent_element: string | null;
  frame_area_fraction?: number;
  free_area_height?: number;
  mid_height?: number;
  max_window_open_area?: number;
}

// BuildingElementGround
export interface BuildingElementGround extends BaseElement {
  type: 'BuildingElementGround';
  width: number;
  height: number;
  area: number; // read-only
  /** Whole physical ground-floor area shared by every split ground element. */
  total_area: number;
  perimeter: number;
  floor_type: 'Heated_basement' | 'Slab_no_edge_insulation' | 'Slab_edge_insulation' | 'Suspended_floor' | 'Unheated_basement';
  depth_basement_floor?: number;
  thickness_walls?: number;
  parent_element: string | null;
  /** Viewer / CSV merge: slab elevation in 3D; not the same as HEM fabric base_height. */
  _base_height?: number;
}

// BuildingElementAdjacentConditionedSpace / BuildingElementAdjacentUnconditionedSpace_Simple
export interface BuildingElementAdjacentConditionedSpace extends BaseElement {
  type: 'BuildingElementAdjacentConditionedSpace';
  width: number;
  height: number;
  area: number;
  pitch?: number;
  parent_element: string | null;
  /** Viewer / CSV: plot elevation for 3D; merged column maps here — not sent as HEM `base_height`. */
  _base_height?: number;
}

export interface BuildingElementAdjacentUnconditionedSpace_Simple extends BaseElement {
  type: 'BuildingElementAdjacentUnconditionedSpace_Simple';
  width: number;
  height: number;
  area: number;
  pitch?: number;
  parent_element: string | null;
  _base_height?: number;
}

export interface BuildingElementPartyWall extends BaseElement {
  type: 'BuildingElementPartyWall';
  width: number;
  height: number;
  area: number;
  pitch?: number;
  base_height?: number;
  /** Viewer / CSV: optional plot elevation; used when HEM `base_height` is cleared. */
  _base_height?: number;
  parent_element: string | null;
}

// Thermal Bridge – Linear
/** `extra_json` may include `junction_type`, `detail_id` (Vulcan junction detail id), `thermal_bridge_source`, etc. */
export interface ThermalBridgeLinear extends BaseElement {
  type: 'ThermalBridgeLinear';
  length: number;
  linear_thermal_transmittance: number;
  parent_element: string | null;
}

// Thermal Bridge – Point
export interface ThermalBridgePoint extends BaseElement {
  type: 'ThermalBridgePoint';
  heat_transfer_coeff: number;
  parent_element: string | null;
}

// NEW: CSV v3 Zone-specific objects (have zoneId for parent-child relationship)
export interface WindowShading extends BaseElement {
  type: 'WindowShading';
  shading_type: 'object' | 'overhang' | 'sidefinright' | 'sidefinleft' | 'reveal';
  // Conditional fields based on shading_type:
  // For 'object': height, distance, transparency are required
  // For others: depth, distance are required
  depth?: number;
  height?: number;
  distance?: number;
  transparency?: number;
  // Note: Uses parent_element (inherited from BaseElement) internally, maps to linked_window in CSV
}

export interface Lighting extends BaseElement {
  type: 'Lighting';
  simplified_lighting: boolean;
  efficacy: number;
  // Conditional fields (only required if simplified_lighting is FALSE):
  count?: number;
  power?: number;
  bulbs?: Record<string, { efficacy?: number; count?: number; power?: number }>;
}

export interface MechanicalVentilationDuctwork extends BaseElement {
  type: 'MechanicalVentilationDuctwork';
  duct_type: 'supply' | 'extract' | 'intake' | 'exhaust';
  length: number;
  parent_element: string | null; // Required - must reference a MechanicalVentilation system
  // Override zoneId to be optional for global objects
  zoneId?: string; // Not required for global objects
}

export interface MechanicalVentilationTerminal extends BaseElement {
  type: 'MechanicalVentilationTerminal';
  terminal_type: 'intake' | 'exhaust';
  parent_element: string | null; // Required - must reference an MVHR MechanicalVentilation system
  host_element: string | null; // External wall/window host, or null for manual external placement
  mid_height_air_flow_path?: number; // Derived from the terminal point's physical z height
  orientation360?: number; // Required when host_element is null
  pitch?: number; // Required when host_element is null
  zoneId?: string; // Not required for global objects
}

export interface WetEmitter extends BaseElement {
  type: 'WetEmitter';
  subcategory: 'radiator' | 'ufh' | 'fancoil';
  // Conditional fields:
  // area only required if subcategory is 'ufh'
  // unit_number only required if subcategory is 'radiator' or 'fancoil'
  area?: number;
  unit_number?: number;
  space_heat_system?: string;
}

// NEW: CSV v3 Global objects (no zoneId required)
export interface WaterPipework extends BaseElement {
  type: 'WaterPipework';
  simplified_pipework: boolean;
  location: 'internal' | 'external';
  pipework_type: 'primary' | 'distribution';
  length: number;
  // Override zoneId to be optional for global objects
  zoneId?: string; // Not required for global objects
}

export interface Appliance extends BaseElement {
  type: 'Appliance';
  appliancekey: 'Clothes_drying' | 'Clothes_washing' | 'Dishwasher' | 'Fridge' | 'Fridge-Freezer' | 'Freezer' | 'Hobs' | 'Kettle' | 'Microwave' | 'Otherdevices' | 'Oven';
  // Override zoneId to be optional for global objects
  zoneId?: string; // Not required for global objects
}

export interface HotWaterDemand extends BaseElement {
  type: 'HotWaterDemand';
  subcategory: 'OtherWaterUseDetails' | 'MixerShower' | 'InstantElecShower' | 'Bath';
  // Conditional fields:
  // size only required if subcategory is 'Bath'
  // rated_power instead of flowrate if subcategory is "InstantElecShower"
  allow_low_flowrate?: boolean;
  size?: number;
  flowrate?: number;
  rated_power?: number;
  // Override zoneId to be optional for global objects
  zoneId?: string; // Not required for global objects
}

export interface ContextShading extends BaseElement {
  type: 'ContextShading';
  shading_type: 'obstacle' | 'overhang';
  start_angle: number;
  end_angle: number;
  distance: number;
  height: number;
  parent_element: string | null; // NEW: Reference to polygon element
  // Override zoneId to be optional for global objects
  zoneId?: string; // Not required for global objects
}

// NEW: InfiltrationVentilation interfaces
export interface Vents extends BaseElement {
  type: 'Vents';
  mid_height_air_flow_path: number; // USER EDITABLE
  area_cm2: number; // USER EDITABLE
  orientation360?: number; // Inherited from parent (UX only)
  pitch?: number; // Inherited from parent (UX only)
  parent_element: string | null; // Recommended - must reference BuildingElementOpaque or BuildingElementTransparent when set
  // pressure_difference_ref will use default value (20)
  // Override zoneId to be optional for global objects
  zoneId?: string; // Not required for global objects
}

export interface MechanicalVentilation extends BaseElement {
  type: 'MechanicalVentilation';
  vent_type: 'Intermittent MEV' | 'Centralised continuous MEV' | 'Decentralised continuous MEV' | 'MVHR';
  // Override zoneId to be optional for global objects
  zoneId?: string; // Not required for global objects
}

export interface CombustionAppliances extends BaseElement {
  type: 'CombustionAppliances';
  appliance_type: 'open_fireplace' | 'closed_with_fan' | 'open_gas_flue_balancer' | 'open_gas_kitchen_stove' | 'open_gas_fire' | 'closed_fire';
  exhaust_situation: 'into_room' | 'into_separate_duct' | 'into_mech_vent';
  fuel_type: 'wood' | 'gas' | 'oil' | 'coal';
  supply_situation: 'room_air' | 'outside';
  // Override zoneId to be optional for global objects
  zoneId?: string; // Not required for global objects
}

// OnSiteGeneration (Polygon or Slope)
export interface OnSiteGeneration extends BaseElement {
  type: 'OnSiteGeneration';
  generation_type: 'PhotovoltaicSystem'; // Only type in schema
  zoneId?: string; // Optional - often roof-level (no zone)
  pitch?: number; // Determines if polygon (=0) or slope (>0) - required, 0-90
  orientation360?: number; // For slope orientation - required, 0-360
  base_height?: number; // Distance from ground to lowest edge - required, 0-500
  height?: number; // Height of PV panel - required, 0-100, derived from polygon (with trigonometry for slopes)
  width?: number; // Width of PV panel - required, 0-100, derived from polygon
  area?: number; // Calculated from polygon coordinates
  peak_power?: number; // kWp - required, 0.001-100
  // Advanced fields in extra_json:
  // - ventilation_strategy, EnergySupply, shading, inverter_* fields
  /** Soft host link: id of the BuildingElementOpaque roof this panel currently sits on (auto-detected by plan-view centroid). */
  _pvHostRoofId?: string;
  _baseHeightUserOverride?: boolean;
  _pitchUserOverride?: boolean;
  _orientationUserOverride?: boolean;
}

// ElectricBattery (Point-based)
export interface ElectricBattery extends BaseElement {
  type: 'ElectricBattery';
  zoneId?: string; // Optional - can be global or zone-specific
  // Main UI fields:
  capacity?: number; // kWh - required, 0-50
  charge_discharge_efficiency_round_trip?: number; // Required, 0-1
  battery_location?: 'inside' | 'outside'; // Required
  // Advanced fields in extra_json:
  // - charge/discharge rates, grid charging thresholds (if enabled)
}

// System rows are a PCDB authoring shell: subcategory is the resolved FHS root family.
export type SystemSubcategory =
  | 'HeatSourceWet'
  | 'HotWaterSource'
  | 'HotWaterDemand'
  | 'InfiltrationVentilation'
  | 'SpaceCoolSystem'
  | 'SpaceHeatSystem'
  | 'WWHRS';

// System element (PCDB MVP) – point-based, global
export interface System extends BaseElement {
  type: 'System';
  subcategory: SystemSubcategory;
  system_preset?: string; // preset filename without .json, e.g. "hp", "combi_boiler"
  zoneId?: string; // Optional – global element
}

// Union type for all elements
export type Element =
  | BuildingElementOpaque
  | BuildingElementTransparent
  | BuildingElementGround
  | BuildingElementAdjacentConditionedSpace
  | BuildingElementAdjacentUnconditionedSpace_Simple
  | BuildingElementPartyWall
  | ThermalBridgeLinear
  | ThermalBridgePoint
  // NEW: CSV v3 elements
  | WindowShading
  | Lighting
  | MechanicalVentilationDuctwork
  | MechanicalVentilationTerminal
  | WaterPipework
  | WetEmitter
  | Appliance
  | HotWaterDemand
  | ContextShading
  // NEW: InfiltrationVentilation elements
  | Vents
  | MechanicalVentilation
  | CombustionAppliances
  | OnSiteGeneration
  | ElectricBattery
  | System;

/**
 * Public input accepted by the geometry store when creating an element.
 * Creation is deliberately less strict than a persisted `Element`: callers
 * create placeholders and merge incomplete CSV rows, so variant fields are
 * optional here. The `type` discriminant still controls which variant fields
 * may be supplied, while common authoring metadata remains available on every
 * draft.
 */
type ElementDraftMember<ElementMember extends Element> = {
  name: string;
  type: ElementMember['type'];
  zoneId?: string;
  parent_element: string | null;
  coordinates: BaseElement['coordinates'] | string;
} & Partial<Omit<BaseElement, 'id' | 'type' | 'name' | 'zoneId' | 'parent_element' | 'coordinates'>>
  & Partial<Omit<ElementMember, keyof BaseElement | 'id' | 'type'>>;

type ElementDraftUnion = {
  [Type in Element['type']]: ElementDraftMember<Extract<Element, { type: Type }>>;
}[Element['type']];

type UnionKeys<Union> = Union extends Union ? keyof Union : never;
type StrictUnionHelper<Member, All> = Member extends All
  ? Member & Partial<Record<Exclude<UnionKeys<All>, keyof Member>, never>>
  : never;

export type ElementDraft = StrictUnionHelper<ElementDraftUnion, ElementDraftUnion>;
