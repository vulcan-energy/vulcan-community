// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * HEM guidance tooltip overrides (Option A + UI-only fields), and — since R4.6b-3 —
 * the FIELD LABEL CONTENT RULE that decides what an Advanced Fields row is called.
 *
 * We treat the active browser schema (core or FHS) as the source of truth.
 * However:
 * - Some schema nodes have missing/empty descriptions (we can't edit upstream engine trees).
 * - Some fields are UI/CSV-only and are intentionally *not* in the schema.
 *
 * This file is the **single location** for HEM/FHS guidance-aligned tooltip descriptions
 * (including summaries aligned with `HEM_FHS_Guidance/Dwelling Details.pdf` where noted).
 *
 * Policy:
 * - If schema provides a non-empty description: **use schema**
 * - Else if an override exists here: **use HEM guidance override**
 * - Else fall back to showing schema metadata only (type/enum/constraints)
 *
 * The label rule lives at the BOTTOM of this file (`resolveFieldLabelContent`), for the
 * same reason the descriptions live here: a field's display text is override-able data
 * plus one resolution policy, and splitting the two across modules is what produced the
 * per-field label patches R4.6b spent three slices retiring. `HardcodedFieldInfo` grew a
 * `label` field rather than a second parallel map.
 */

export type TooltipDescriptionSource = 'schema' | 'hem_guidance';

export type FieldUnitSemantic = 'fraction' | 'unitless';

export interface HardcodedFieldInfo {
  /**
   * OPTIONAL since R4.6b-3 only so that a `label`-only entry can exist. Every
   * description-bearing entry below is unchanged, and an entry with no description
   * still reports no metadata match (`getFieldMetadata`), so it can never turn into
   * an empty tooltip.
   */
  description?: string;
  type?: string;
  units?: string;
  /** Explicit meaning for numeric values whose schema has no useful physical unit. */
  unitSemantic?: FieldUnitSemantic;
  /** UI-only numeric model field included in completeness diagnostics. */
  modelAuthoring?: boolean;
  /**
   * R4.6b-3: the row's label, when neither the schema `title` nor the key can produce
   * it. Read by `resolveFieldLabelContent` (bottom of this file) and by NOTHING else —
   * in particular `getFieldMetadata` still requires a description/unit to report a
   * match, so a label-only entry adds no tooltip.
   *
   * Reserve it for keys where the rule cannot win by construction, not for taste:
   * abbreviated keys whose expansion is not in the key (`sup_air_flw_ctrl`), and keys
   * embedding a standard number that start-casing splits (`test_data_EN14825` ->
   * "Test Data EN 14825"). Anything else belongs in the rule.
   */
  label?: string;
}

export interface FieldMetadataContext {
  mode?: 'core' | 'fhs';
  propertyKey: string;
  elementType?: string;
  subtype?: string;
  opaqueFabricVariant?: string;
  label?: string;
}

export interface FieldMetadataMatch {
  info: HardcodedFieldInfo;
  key: string;
}

/** Short field label in Advanced Fields (tooltip body uses `WINDOW_SECURITY_RISK_HELPER` only — no repeated question). */
export const WINDOW_SECURITY_RISK_LABEL = 'Security Risk?' as const;
export const WINDOW_SECURITY_RISK_HELPER =
  'A window is a security risk if you are unable to leave it open at night. If it is on the ground floor, in a basement, or is easily accessible, it is a security risk.' as const;

/**
 * Single registry of tooltip overrides (schema-backed + UI-only).
 *
 * Keying (supported by lookup helpers below):
 * - **Preferred**: `${elementType}:${paramId}` (explicit element-scoped override)
 * - **Legacy element-scoped**: `${paramId}_${elementType}` (kept for existing entries)
 * - **Global**: `*:${paramId}` (wildcard; use sparingly)
 * - **Raw label**: `label:${fieldLabel}` (use for UI-only labels that would otherwise collide)
 * - **Bare**: `${paramId}` (global fallback; only if you're sure it won't collide)
 */
export const TOOLTIP_OVERRIDES: Record<string, HardcodedFieldInfo> = {
  // CSV structural fields (explicitly excluded from JSON merge - see builder.rs line 420)
  // These are used to organize/identify elements but not stored as element properties
  'name': {
    description: 'The name of this element. Used for identification and cross-referencing between elements (e.g., windows referencing their parent wall). This field is CSV-only and is not merged into the JSON schema as an element property.',
    type: 'string',
  },
  'label:Name': {
    description: 'The name of this element (CSV column header). Used for identification and cross-referencing between elements. This field is CSV-only and is not merged into the JSON schema as an element property.',
    type: 'string',
  },
  'label:Type': {
    description: 'The element type identifier used in CSV files (e.g., "Wall", "Window", "Floor"). This is typically set automatically based on the element type selection. This field is CSV-only and is not merged into the JSON schema as an element property. Note: The lowercase "type" field IS in the schema as a required const property (e.g., "BuildingElementOpaque").',
    type: 'string',
  },
  'label:Zone': {
    description: 'The zone name this element belongs to. Used during CSV merge to organize elements into zones, but not stored as an element property in the final JSON. This field is CSV-only for element rows.',
    type: 'string',
  },
  'position_xyz': {
    description: 'The 3D coordinates of this element. Used for geometry positioning in CSV files. This field is CSV-only and is not merged into the JSON schema.',
    type: 'string',
  },
  // CSV relationship fields (intentionally ignored for schema compliance during CSV→JSON merge)
  'parent_element': {
    description: 'The name of the parent element this element is attached to. For windows, this should be the name of the wall they are mounted in. This field is CSV-only and is intentionally ignored during JSON merge for schema compliance.',
    type: 'string',
  },
  'mvhr_unit': {
    description: 'Assigns this duct or terminal to the MVHR unit used in the exported model.',
    type: 'string',
  },
  'mounted_on': {
    description: 'External wall or window that sets this terminal’s position, pitch, and orientation.',
    type: 'string',
  },
  // Element-specific variant for Vents
  'parent_element_Vents': {
    description: 'The name of the parent opaque building element (wall/roof) this vent is attached to. The vent automatically inherits orientation360 and pitch from this parent element. This field is CSV-only and is intentionally ignored during JSON merge for schema compliance.',
    type: 'string',
  },
  'linked_wall': {
    description: 'The name of the wall this window is linked to. The window inherits pitch and orientation from this wall and is visually snapped to the wall\'s internal face. This field is CSV-only and is intentionally ignored during JSON merge.',
    type: 'string',
  },
  // CSV control fields (affect processing but not merged into schema)
  'simplified_thermal_bridging': {
    description: 'When TRUE, uses simplified thermal bridging calculation (0.2 * exposed_area). When FALSE, uses explicit thermal bridging elements. This is a CSV control field that affects zone-level thermal bridging but is not a schema property.',
    type: 'boolean',
  },
  // CSV reference fields (used for lookups but not merged directly)
  // Note: appliancekey becomes the key in the Appliances map in the schema, not a property
  'appliancekey': {
    description: 'Appliance type identifier (e.g., "Fridge", "Dishwasher", "Oven"). Used to look up appliance properties and energy consumption profiles in HEM calculations.',
    type: 'string',
  },
  'appliance_key': {
    description: 'Appliance type identifier (e.g., "Fridge", "Dishwasher", "Oven"). Used to look up appliance properties and energy consumption profiles in HEM calculations.',
    type: 'string',
  },
  // Schema fields that lack descriptions - provide Vulcan descriptions
  'junction_type': {
    description: 'The junction type code for this thermal bridge (Home Energy Model Table 3.7 — for example E1, P1, or R1). Each junction type has an associated default linear thermal transmittance (ψ) that can be applied from the shipped CSV. Junction types define specific construction details at junctions between building elements.',
    type: 'string',
  },
  // On-site generation (PV) specific clarifications
  'shading': {
    description: 'List of shading geometry objects (overhangs, side fins, obstacles) that model obstructions affecting the PV array. Used to calculate shading reduction factors for solar radiation, affecting electricity generation.',
    type: 'array',
  },
  'inverter_peak_power_dc': {
    description: 'Peak electrical DC power input to the inverter, in kilowatts (kW). This represents the maximum DC power the PV array can deliver into the inverter under standard test conditions.',
    type: 'number',
    units: 'kW',
  },
  'inverter_peak_power_ac': {
    description: 'Peak electrical AC power output from the inverter, in kilowatts (kW). This represents the maximum AC power the inverter can supply to the dwelling or grid.',
    type: 'number',
    units: 'kW',
  },
  'inverter_is_inside': {
    description: 'Whether the inverter is considered to be located inside the thermal envelope of the dwelling. This affects where inverter losses are counted (internal gains vs external losses).',
    type: 'boolean',
  },
  'ventilation_strategy': {
    description: 'How the rear surface of the PV array is ventilated. This affects operating temperature and hence efficiency. Options typically include unventilated, moderately ventilated, strongly/forced ventilated, or rear-surface-free.',
    type: 'string',
  },
  'inverter_type': {
    description: 'Type of inverter used for this PV system. For example, a string inverter (single unit serving a whole string of panels) or an optimised/optimiser-based inverter (module-level power electronics that can improve performance under partial shading).',
    type: 'string',
  },
  'EnergySupply': {
    description: 'Reference to an EnergySupply entry (e.g., "mains elec", "mains gas") that provides the energy source. Links the system to fuel type, emissions factors, and energy prices.',
    type: 'string',
  },
  // WindowShading - CSV-only field
  'linked_window': {
    description: 'The name of the window element this shading object is attached to. WindowShading elements are linked to BuildingElementTransparent (window) elements to model shading effects (overhangs, side fins, reveals, or nearby obstacles) that reduce solar gains on the window.',
    type: 'string',
  },
  // WetEmitter
  'subcategory': {
    description: 'Element subcategory type. Determines which fields are required and how the element is calculated.',
    type: 'string',
  },
  'subcategory_WetEmitter': {
    description:
      'Type of heat emitter (wet): radiator, underfloor heating, or fan coil (HEM Emitters §5.4.2.1–2). Determines required inputs and how the circuit is described; full HEM intake also ties products to the PCDB.',
    type: 'string',
  },
  'subcategory_HotWaterDemand': {
    description: 'Type of hot water demand: "Bath" (requires size), "MixerShower" (requires flowrate and whether low-flow operation is allowed), "InstantElecShower" (requires rated_power), or "OtherWaterUseDetails" (requires flowrate). Each subcategory has different required fields and calculation methods.',
    type: 'string',
  },
  'HotWaterDemand:allow_low_flowrate': {
    description: 'Whether this mixer shower is an air pressure shower. Air pressure showers can be used at a lower flow rate by mixing air into the water stream.',
    type: 'boolean',
  },
  'area': {
    description: 'Surface area of the building element (unit: m²).',
    type: 'number',
    units: 'm²',
  },
  'area_BuildingElementTransparent': {
    description: 'Surface area of the window (unit: m²). Calculated as width × height.',
    type: 'number',
    units: 'm²',
  },
  'area_BuildingElementOpaque': {
    description: 'Net area of the opaque building element (unit: m²), excluding any windows, doors, or other openings.',
    type: 'number',
    units: 'm²',
  },
  'area_BuildingElementGround': {
    description: 'Area of the ground floor element within this zone (unit: m²).',
    type: 'number',
    units: 'm²',
  },
  'area_BuildingElementAdjacentConditionedSpace': {
    description: 'Area of the building element adjacent to a conditioned space (unit: m²).',
    type: 'number',
    units: 'm²',
  },
  'area_BuildingElementAdjacentUnconditionedSpace_Simple': {
    description: 'Area of the building element adjacent to an unconditioned space (unit: m²).',
    type: 'number',
    units: 'm²',
  },
  'area_BuildingElementPartyWall': {
    description: 'Area of the party wall element (unit: m²).',
    type: 'number',
    units: 'm²',
  },
  'area_WetEmitter': {
    description:
      'Underfloor heating: gross heated floor area (m²) for this UFH entry. HEM Emitters §5.4.2.2 notes UFH uses total area rather than the same “number of elements” convention as radiators and fan coils.',
    type: 'number',
    units: 'm²',
  },
  // FHS wet emitter item fields — `input_fhs` omits descriptions on `emitters[]` items; copy below is aligned to HEM_FHS_Guidance/Emitters.pdf (§5.4.x).
  'WetEmitter:length': {
    description:
      'Standard radiator (§5.4.3.2): horizontal length of one panel. HEM text uses millimetres from PCDB sizing; this field is metres (mm ÷ 1000). For the c_per_m branch, Vulcan multiplies this by Unit number before sending total length to HEM. Towel radiators (§5.4.3.3): model as T10 and enter equivalent length from heat‑emitting area — not duct length or linear‑bridge geometry.',
    type: 'number',
    units: 'm',
  },
  'WetEmitter:n': {
    description:
      'Radiator: exponent n in the catalogue characteristic equation (BS EN 442 style). Separate from HEM “Number of elements” (§5.4.2.2), i.e. how many radiators/fancoils share this spec — use Unit number for that count.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'WetEmitter:c': {
    description:
      'Radiator: overall characteristic constant c (dimensionless) paired with thermal_mass when heat output is not expressed per metre of panel length (alternative branch to length + c_per_m; see §5.4.3.2 and PCDB / catalogue data).',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'WetEmitter:c_per_m': {
    description:
      'Radiator: characteristic constant per metre of horizontal panel length — use with length and thermal_mass_per_m when catalogue data is per metre (§5.4.3.2 length of radiator).',
    type: 'number',
    units: '1/m',
  },
  'WetEmitter:thermal_mass': {
    description:
      'Radiator: emitter thermal mass (kWh/K) for the overall‑c branch; complements c when not using the per‑metre c_per_m + length path.',
    type: 'number',
    units: 'kWh/K',
  },
  'WetEmitter:thermal_mass_per_m': {
    description:
      'Radiator: thermal mass per metre of panel length (kWh/K/m) for the per‑metre branch together with c_per_m and length.',
    type: 'number',
    units: 'kWh/K/m',
  },
  'WetEmitter:frac_convective': {
    description:
      'Convection fraction: portion of heat to the room delivered by convection (0–1); 1 means fully convective. Same idea as §5.4.1.2 for instant electric; for wet emitters see §5.4.2 general inputs (this value is per emitter item on the circuit). If left blank HEM applies a default by emitter type — radiator 0.4, UFH 0.43, fancoil 1.0 — so set it explicitly to keep emitters on the same circuit consistent.',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'WetEmitter:equivalent_specific_thermal_mass': {
    description:
      'Underfloor heating: equivalent thermal mass per m² of heated floor (kJ/m²K). Part of the UFH thermal response together with system performance factor and floor area (§5.4.2 wet distribution; UFH area handling per §5.4.2.2 footnote).',
    type: 'number',
    units: 'kJ/m²K',
  },
  'WetEmitter:system_performance_factor': {
    description:
      'Underfloor heating: heat output capability per m² of heated floor (W/m²K), used with equivalent specific thermal mass and gross heated floor area for that UFH entry.',
    type: 'number',
    units: 'W/m²K',
  },
  'WetEmitter:emitter_floor_area': {
    description:
      'Underfloor heating: gross heated floor area (m²) for this emitter object. The batch build maps the main Area field here; edit in Advanced only for an intentional override (§5.4.2.2 footnote on UFH total area vs element counts).',
    type: 'number',
    units: 'm²',
  },
  'WetEmitter:n_units': {
    description:
      'Fan coil: number of units of this specification in the zone (§5.4.2.2 “Number of elements” for fan coils). Prefer Unit number in the main form — it is merged into n_units on export.',
    type: 'integer',
    unitSemantic: 'unitless',
  },
  'WetEmitter:fancoil_test_data': {
    description:
      'Fan coil manufacturer test data (§5.4.3.4–5): temperature difference vs heat output points and fan power (W). Use the structured fields in Advanced — do not paste raw JSON. Full HEM intake normally selects fan coils from the PCDB.',
    type: 'object',
  },
  'WetEmitter:fancoil:temperature_diff': {
    description: 'Fan-coil test temperature difference between water and room air (unit: K).',
    type: 'number',
    units: 'K',
  },
  'WetEmitter:unit_number': {
    description:
      'Number of radiators or fan coil systems with this specification in the dwelling (HEM §5.4.2.2 “Number of elements”). Underfloor heating is described by total floor area instead of this count.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'design_flow_temp': {
    description:
      'Wet distribution design flow temperature (deg C). For weather-compensating Ecodesign classes II, III, VI, and VII, the engine uses this as the upper/max flow-temperature end of the compensation curve; otherwise it is the fixed flow temperature.',
    type: 'number',
    units: 'deg C',
  },
  'ecodesign_control_class': {
    description:
      'Ecodesign controller class for the wet distribution. Classes II, III, VI and VII use weather compensation; for these HEM uses design_flow_temp, min_flow_temp, min_outdoor_temp and max_outdoor_temp as the flow-temperature curve. Choose the class matching the installed controller and heat-source control arrangement.',
    type: 'integer',
    unitSemantic: 'unitless',
  },
  'min_flow_temp': {
    description:
      'Weather-compensation minimum flow temperature (deg C). For Ecodesign classes II, III, VI, and VII, this is the lower flow-temperature end used when outdoor temperature is at or above max_outdoor_temp. It is not a room setpoint or radiator surface temperature.',
    type: 'number',
    units: 'deg C',
  },
  'min_outdoor_temp': {
    description:
      'Outdoor-temperature lower endpoint for the weather-compensation curve (deg C). At or below this outdoor temperature, the wet distribution flow temperature is capped at design_flow_temp.',
    type: 'number',
    units: 'deg C',
  },
  'max_outdoor_temp': {
    description:
      'Outdoor-temperature upper endpoint for the weather-compensation curve (deg C). At or above this outdoor temperature, the wet distribution flow temperature is capped at min_flow_temp.',
    type: 'number',
    units: 'deg C',
  },
  'temp_flow_limit_upper': {
    description:
      'Heat source upper flow-temperature operating limit (deg C). This is a plant limit, separate from the wet distribution design_flow_temp / min_flow_temp weather-compensation curve.',
    type: 'number',
    units: 'deg C',
  },
  // Nested System advanced fields use the enclosing System/subtype context.
  // These entries intentionally mirror the same wet-emitter semantics above.
  'System:SpaceHeatSystem:c': {
    description: 'Emitter characteristic constant used by the overall-c radiator branch.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:SpaceHeatSystem:c_per_m': {
    description: 'Emitter characteristic constant per metre of radiator length.',
    type: 'number',
    units: '1/m',
  },
  'System:SpaceHeatSystem:n': {
    description: 'Exponent in the radiator characteristic equation.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:SpaceHeatSystem:frac_convective': {
    description: 'Fraction of emitter heat delivered by convection (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:SpaceHeatSystem:n_units': {
    description: 'Number of emitter or heater units represented by this entry.',
    type: 'integer',
    unitSemantic: 'unitless',
  },
  'System:SpaceHeatSystem:bypass_fraction_recirculated': {
    description: 'Fraction of return water recirculated into the flow (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:SpaceHeatSystem:ecodesign_control_class': {
    description: 'Integer Ecodesign controller class.',
    type: 'integer',
    unitSemantic: 'unitless',
  },
  'System:SpaceHeatSystem:state_of_charge_init': {
    description: 'Initial state of charge of the heat store (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HotWaterSource:efficiency': {
    description: 'Dimensionless efficiency or performance ratio for the selected heat-source branch.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:HotWaterSource:first_order_hlc': {
    description: 'First-order solar collector heat-loss coefficient (unit: W/m²·K).',
    type: 'number',
    units: 'W/m²·K',
  },
  'System:HotWaterSource:second_order_hlc': {
    description: 'Second-order solar collector heat-loss coefficient (unit: W/m²·K²).',
    type: 'number',
    units: 'W/m²·K²',
  },
  'System:HotWaterSource:heater_position': {
    description: 'Vertical heater position as a fraction of tank height (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HotWaterSource:thermostat_position': {
    description: 'Vertical thermostat position as a fraction of tank height (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HotWaterSource:in_use_factor_mismatch': {
    description: 'Dimensionless in-use multiplier applied to heat-pump efficiency.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:HotWaterSource:incidence_angle_modifier': {
    description: 'Solar collector hemispherical incidence-angle modifier (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HotWaterSource:modules': {
    description: 'Number of solar collector modules installed.',
    type: 'integer',
    unitSemantic: 'unitless',
  },
  'System:HotWaterSource:peak_collector_efficiency': {
    description: 'Peak solar collector efficiency (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HotWaterSource:power': {
    description: 'Rated power for the selected hot-water heat-source branch (unit: kW).',
    type: 'number',
    units: 'kW',
  },
  'System:HotWaterSource:cop_dhw': {
    description: 'Domestic-hot-water coefficient of performance measured during the test.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:HotWaterSource:tilt': {
    description: 'Solar thermal collector tilt from horizontal (unit: degrees).',
    type: 'number',
    units: 'degrees',
  },
  'System:HotWaterSource:rejected_factor_3': {
    description: 'Dimensionless rejected-energy factor used by the combi-boiler calculation.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  // R4.6b-3 (DECISION 2, as CORRECTED by measurement): these two rows used to show a
  // tooltip belonging to a DIFFERENT parameter — `Distribution` showed
  // HeatSourceWetHeatPump.temp_distribution_heat_network's heat-network temperature
  // text, `Bath` showed NumberOfBathrooms' description down to its "Type: integer" line.
  // R4.6b-1's informed lookup removed both, correctly. These are NEW descriptions
  // written for the parameters that actually exist, from their own schema shapes; no
  // sentence of the old text survives, deliberately. Neither is mode-scoped, for two
  // different reasons: `Distribution` is a CORE-ONLY key (FHS's HotWaterDemand declares
  // Shower/Bath/Other and nothing else), so there is no second profile to disagree with;
  // `Bath` exists on both and means the same thing, so the copy is written to be true of
  // both — Core's `$defs/Bath` requires `flowrate` alongside `size` and `ColdWaterSource`
  // where FHS requires only the latter two, and the sentence covers that superset even
  // though Core reads its own schema description today and never shows this one.
  'System:HotWaterDemand:Distribution': {
    description: 'Hot-water distribution pipework carrying water from the hot water source to the outlets. Each pipe run is described by its internal diameter, length and location, either as one list for the dwelling or as a list per hot water source.',
    type: 'object',
  },
  'System:HotWaterDemand:Bath': {
    description: 'The baths in the dwelling, keyed by name. Each entry gives the volume the bath holds, its flow rate, and the cold water source that fills it.',
    type: 'object',
  },
  'System:HeatSourceWet:A': {
    description: 'Dimensionless heat-battery characteristic parameter A.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:HeatSourceWet:B': {
    description: 'Dimensionless heat-battery characteristic parameter B.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:HeatSourceWet:repeat': {
    description: 'Number of times a schedule entry repeats.',
    type: 'integer',
    unitSemantic: 'unitless',
  },
  'System:HeatSourceWet:cost_schedule_start_day': {
    description: 'Day index on which the hybrid cost series begins.',
    type: 'integer',
    units: 'day',
  },
  'System:HeatSourceWet:cost_schedule_time_series_step': {
    description: 'Time interval between hybrid cost-series values (unit: h).',
    type: 'number',
    units: 'h',
  },
  'System:HeatSourceWet:efficiency_full_load': {
    description: 'Boiler net efficiency at full load.',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HeatSourceWet:efficiency_part_load': {
    description: 'Boiler net efficiency at part load; test values may exceed one.',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HeatSourceWet:modulation_load': {
    description: 'Boiler modulation load ratio (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HeatSourceWet:min_modulation_rate_20': {
    description: 'Minimum modulation rate at 20 °C flow temperature (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HeatSourceWet:min_modulation_rate_35': {
    description: 'Minimum modulation rate at 35 °C flow temperature (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HeatSourceWet:min_modulation_rate_55': {
    description: 'Minimum modulation rate at 55 °C flow temperature (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HeatSourceWet:pwr_in': {
    description: 'Heat-battery charging power (unit: kW).',
    type: 'number',
    units: 'kW',
  },
  'System:HeatSourceWet:rated_power_instant': {
    description: 'Rated instantaneous heat output (unit: kW).',
    type: 'number',
    units: 'kW',
  },
  'System:HeatSourceWet:heat_storage_capacity': {
    description: 'Heat-storage capacity (unit: kWh).',
    type: 'number',
    units: 'kWh',
  },
  'System:HeatSourceWet:fan_pwr': {
    description: 'Fan electrical power (unit: W).',
    type: 'number',
    units: 'W',
  },
  'System:HeatSourceWet:number_of_units': {
    description: 'Number of heat-battery units represented by this entry.',
    type: 'integer',
    unitSemantic: 'unitless',
  },
  'System:HeatSourceWet:state_of_charge_init': {
    description: 'Initial heat-battery state of charge (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:HeatSourceWet:capacity': {
    description: 'Heat-pump output capacity at the test condition (unit: kW).',
    type: 'number',
    units: 'kW',
  },
  'System:HeatSourceWet:cop': {
    description: 'Coefficient of performance at the heat-pump test condition.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:HeatSourceWet:eahp_mixed_ext_air_ratio': {
    description: 'External-air portion of mixed air for an exhaust-air heat pump (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:SpaceCoolSystem:cooling_capacity': {
    description: 'Maximum cooling capacity (unit: kW).',
    type: 'number',
    units: 'kW',
  },
  'System:SpaceCoolSystem:efficiency': {
    description: 'Seasonal energy-efficiency ratio for the cooling system.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'System:SpaceCoolSystem:frac_convective': {
    description: 'Fraction of cooling delivered convectively (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'System:SpaceCoolSystem:advanced_start': {
    description: 'How long before the cooling period the system may start (unit: h).',
    type: 'number',
    units: 'h',
  },
  'System:SpaceCoolSystem:temp_setback': {
    description: 'Cooling setback temperature (unit: °C).',
    type: 'number',
    units: '°C',
  },
  'BuildingElementAdjacentUnconditionedSpace_Simple:thermal_resistance_unconditioned_space': {
    description: 'Effective thermal resistance of the adjacent unconditioned space (unit: m²·K/W).',
    type: 'number',
    units: 'm²·K/W',
  },
  'BuildingElementGround:Slab_edge_insulation:edge_thermal_resistance': {
    description: 'Thermal resistance of the floor-edge insulation (unit: m²·K/W).',
    type: 'number',
    units: 'm²·K/W',
  },
  'area_OnSiteGeneration': {
    description: 'Surface area of the photovoltaic (PV) array (unit: m²).',
    type: 'number',
    units: 'm²',
  },
  'unit_number': {
    description: 'Number of units. For WetEmitter: number of emitter units installed, required when subcategory is "radiator" or "fancoil". For radiators, used to calculate the characteristic constant (c value) for heat output.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'wet_emitter_subcategory': {
    description:
      'Wet heat emitter category: radiator, underfloor heating, or fan coil (HEM Emitters §5.4.2). Same role as subcategory on geometry rows.',
    type: 'string',
  },
  'wet_emitter_area': {
    description:
      'UFH gross heated floor area (m²) for this entry — HEM Emitters §5.4.2.2 (UFH uses total area; radiator/fancoil use element counts).',
    type: 'number',
    units: 'm²',
  },
  'wet_emitter_unit_number': {
    description:
      'Radiator/fancoil count for this specification (HEM §5.4.2.2 “Number of elements”). Distinct from radiator catalogue exponent n.',
    type: 'number',
  },
  // MechanicalVentilationDuctwork - CSV reference field
  'parent_mechanical_ventilation_system': {
    description: 'The name of the mechanical ventilation system this ductwork belongs to. Used to link ductwork elements to their parent ventilation system for calculating ductwork losses and airflow distribution. This field is CSV-only and is used to organize ductwork within ventilation systems.',
    type: 'string',
  },
  // HotWaterDemand
  'size': {
    description: 'Size/volume measurement. For HotWaterDemand: volume held by bath (unit: litre), required when subcategory is "Bath". Used to calculate the total volume of water needed to fill the bath.',
    type: 'number',
    units: 'L',
  },
  'flowrate': {
    description: 'Flow rate measurement. For HotWaterDemand: tap/outlet flow rate (unit: litre/minute), required for Bath, MixerShower, and OtherWaterUseDetails subcategories. Used to calculate hot water demand based on usage duration.',
    type: 'number',
    units: 'L/min',
  },
  'rated_power': {
    description: 'Rated power output. For HotWaterDemand: shower\'s rated electrical power (unit: kW), required when subcategory is "InstantElecShower". Used to calculate electrical energy consumption for instantaneous electric showers that heat cold water on-demand.',
    type: 'number',
    units: 'kW',
  },
  // Element-specific variants for clarity
  'hot_water_demand_subcategory': {
    description: 'The type of hot water demand: "Bath" (requires size and flowrate), "MixerShower" (requires flowrate), "InstantElecShower" (requires rated_power), or "OtherWaterUseDetails" (requires flowrate). Each subcategory has different required fields and calculation methods.',
    type: 'string',
  },
  'hot_water_demand_size': {
    description: 'Volume held by bath (unit: litre). Required when subcategory is "Bath". Used to calculate the total volume of water needed to fill the bath.',
    type: 'number',
    units: 'L',
  },
  'hot_water_demand_flowrate': {
    description: 'Tap/outlet flow rate (unit: litre/minute). Required for Bath, MixerShower, and OtherWaterUseDetails subcategories. Used to calculate hot water demand based on usage duration.',
    type: 'number',
    units: 'L/min',
  },
  'hot_water_demand_rated_power': {
    description: 'Shower\'s rated electrical power (unit: kW). Required when subcategory is "InstantElecShower". Used to calculate electrical energy consumption for instantaneous electric showers that heat cold water on-demand.',
    type: 'number',
    units: 'kW',
  },
  // ContextShading
  'shading_type': {
    description: 'Type of shading geometry. For WindowShading: "overhang" (horizontal projection above window), "sidefinright" or "sidefinleft" (vertical fins on sides), "reveal" (recessed window), or "obstacle" (nearby obstruction). Determines which geometric parameters are required.',
    type: 'string',
  },
  'shading_type_WindowShading': {
    description: 'Type of shading geometry: "overhang" (horizontal projection above window), "sidefinright" or "sidefinleft" (vertical fins on sides), "reveal" (recessed window), or "obstacle" (nearby obstruction). Determines which geometric parameters are required.',
    type: 'string',
  },
  'shading_type_ContextShading': {
    description: 'Type of external shading object: "obstacle" (nearby building or structure) or "overhang" (horizontal projection). Used to model external shading that affects solar gains on building elements.',
    type: 'string',
  },
  'start_angle': {
    description: 'Starting azimuth angle of the shading object\'s angular range (unit: degrees, 0°=North, 90°=East, 180°=South, 270°=West). Defines the beginning of the angular sector where shading occurs relative to the parent element.',
    type: 'number',
    units: 'degrees',
  },
  'end_angle': {
    description: 'Ending azimuth angle of the shading object\'s angular range (unit: degrees, 0°=North, 90°=East, 180°=South, 270°=West). Defines the end of the angular sector where shading occurs relative to the parent element.',
    type: 'number',
    units: 'degrees',
  },
  'distance': {
    description: 'Distance measurement. For ContextShading: horizontal distance from the parent element to the shading object (unit: m). Used to calculate the shading effect on solar gains based on the geometry and position of external obstructions.',
    type: 'number',
    units: 'm',
  },
  'height': {
    description: 'Height of the building element (unit: m).',
    type: 'number',
    units: 'm',
  },
  'height_BuildingElementTransparent': {
    description: 'Height of the window (unit: m). This is the vertical dimension of the window opening.',
    type: 'number',
    units: 'm',
  },
  'height_BuildingElementOpaque': {
    description: 'Height of the opaque building element (unit: m). This is the vertical dimension of the wall, door, or roof element.',
    type: 'number',
    units: 'm',
  },
  'height_ContextShading': {
    description: 'Height of the shading object above ground level (unit: m). Used together with distance and angles to calculate the shading effect on solar gains for the parent element.',
    type: 'number',
    units: 'm',
  },
  'context_shading_type': {
    description: 'Type of external shading object: "obstacle" (nearby building or structure) or "overhang" (horizontal projection). Used to model external shading that affects solar gains on building elements.',
    type: 'string',
  },
  'context_shading_distance': {
    description: 'Horizontal distance from the parent element to the shading object (unit: m). Used to calculate the shading effect on solar gains based on the geometry and position of external obstructions.',
    type: 'number',
    units: 'm',
  },
  'context_shading_height': {
    description: 'Height of the shading object above ground level (unit: m). Used together with distance and angles to calculate the shading effect on solar gains for the parent element.',
    type: 'number',
    units: 'm',
  },
  // Vents
  'mid_height_air_flow_path': {
    description: 'Mid-height of air flow path relative to the ventilation zone (unit: m, range: 1-60). Used in natural ventilation calculations to determine airflow through vents based on pressure differences (BS EN 16798-7).',
    type: 'number',
    units: 'm',
  },
  'MechanicalVentilationTerminal:mid_height_air_flow_path': {
    description: 'Mid-height of the MVHR terminal air flow path, derived from the terminal point’s 3D z height.',
    type: 'number',
    units: 'm',
  },
  'area_cm2': {
    description: 'Equivalent free area of the vent opening (unit: cm², range: 1-999999). Used to calculate airflow through the vent based on pressure differences and vent opening ratio. Based on Section 6.4.3.6 Airflow through vents from BS EN 16798-7.',
    type: 'number',
    units: 'cm²',
  },
  'area_cm2_Vents': {
    description: 'Equivalent free area of the vent opening (unit: cm², range: 1-999999). Used in natural ventilation calculations to determine airflow through the vent based on pressure differences and wind direction (BS EN 16798-7).',
    type: 'number',
    units: 'cm²',
  },
  'orientation360': {
    description: 'Orientation angle of the inclined surface, expressed as the geographical azimuth angle of the horizontal projection of the inclined surface normal (unit: degrees, range: 0-360, where 0°=North, 90°=East, 180°=South, 270°=West).',
    type: 'number',
    units: 'degrees',
  },
  'pitch': {
    description: 'Tilt angle of the surface from horizontal (unit: degrees, range: 0-180, where 0°=external surface facing up, 90°=vertical, 180°=external surface facing down).',
    type: 'number',
    units: 'degrees',
  },
  'orientation360_Vents': {
    description: 'Orientation of the vent (unit: degrees, range: 0-360, where 0°=North, 90°=East, 180°=South, 270°=West). Used to calculate wind-driven ventilation effects based on wind direction relative to the vent.',
    type: 'number',
    units: 'degrees',
  },
  'orientation360_OnSiteGeneration': {
    description: 'Orientation of the photovoltaic (PV) array surface relative to north (unit: degrees, range: 0-360, where 0°=North, 90°=East, 180°=South, 270°=West). Used to calculate solar irradiance and electricity generation.',
    type: 'number',
    units: 'degrees',
  },
  'pitch_Vents': {
    description: 'Pitch (tilt angle) of the vent surface (unit: degrees, range: 0-180, where 0°=horizontal, 90°=vertical, 180°=horizontal inverted). Used in natural ventilation calculations to account for the effect of vent angle on airflow.',
    type: 'number',
    units: 'degrees',
  },
  'pitch_OnSiteGeneration': {
    description: 'Tilt angle of the PV panel from horizontal, measured upwards facing (unit: degrees, range: 0-90, where 0°=horizontal, 90°=vertical). Used to calculate solar irradiance and electricity generation.',
    type: 'number',
    units: 'degrees',
  },
  'base_height': {
    description: 'Base height of the building element above ground level (unit: m). This is the distance from the ground to the lowest edge of the element.',
    type: 'number',
    units: 'm',
  },
  '*:_base_height': {
    description: 'Optional absolute elevation used for editor placement (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'BuildingElementOpaque:unheated_pitched_roof_ceiling_elevation': {
    description: 'Ceiling or heat-loss-boundary elevation for an unheated pitched roof (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'ThermalBridgeLinear:tb_z0': {
    description: 'Editor elevation at the start of the thermal-bridge line (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'ThermalBridgeLinear:tb_z1': {
    description: 'Editor elevation at the end of the thermal-bridge line (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'MechanicalVentilationDuctwork:service_line_z0': {
    description: 'Editor elevation at the start of the ductwork line (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'MechanicalVentilationDuctwork:service_line_z1': {
    description: 'Editor elevation at the end of the ductwork line (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'WaterPipework:service_line_z0': {
    description: 'Editor elevation at the start of the pipework line (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'WaterPipework:service_line_z1': {
    description: 'Editor elevation at the end of the pipework line (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'base_height_OnSiteGeneration': {
    description: 'Base height of the photovoltaic (PV) array above ground level (unit: m). This is the height of the bottom edge of the PV panel array.',
    type: 'number',
    units: 'm',
  },
  'width': {
    description: 'Width of the building element (unit: m).',
    type: 'number',
    units: 'm',
  },
  'width_OnSiteGeneration': {
    description: 'Width of the photovoltaic (PV) array (unit: m). This is the horizontal dimension of the PV panel array.',
    type: 'number',
    units: 'm',
  },
  'width_BuildingElementOpaque': {
    description: 'Width of the opaque building element (unit: m). This is the horizontal dimension of the wall, door, or roof element.',
    type: 'number',
    units: 'm',
  },
  'width_BuildingElementTransparent': {
    description: 'Width of the transparent building element (window) (unit: m). This is the horizontal dimension of the window opening.',
    type: 'number',
    units: 'm',
  },
  'width_BuildingElementAdjacentConditionedSpace': {
    description: 'Width of the building element adjacent to a conditioned space (unit: m). This is the horizontal dimension of the element that separates the zone from an adjacent conditioned space.',
    type: 'number',
    units: 'm',
  },
  'width_BuildingElementAdjacentUnconditionedSpace_Simple': {
    description: 'Width of the building element adjacent to an unconditioned space (unit: m). This is the horizontal dimension of the element that separates the zone from an adjacent unconditioned space.',
    type: 'number',
    units: 'm',
  },
  'width_BuildingElementPartyWall': {
    description: 'Width of the party wall element (unit: m). This is the horizontal dimension of the wall segment.',
    type: 'number',
    units: 'm',
  },
  'vents_orientation360': {
    description: 'The orientation of the vent (unit: degrees, range: 0-360, where 0°=North, 90°=East, 180°=South, 270°=West). Used to calculate wind-driven ventilation effects based on wind direction relative to the vent.',
    type: 'number',
    units: 'degrees',
  },
  'vents_pitch': {
    description: 'The pitch (tilt angle) of the vent surface (unit: degrees, range: 0-180, where 0°=horizontal, 90°=vertical, 180°=horizontal inverted). Used in natural ventilation calculations to account for the effect of vent angle on airflow.',
    type: 'number',
    units: 'degrees',
  },
  // MechanicalVentilation
  'ventilation_type': {
    description: 'Ventilation system type: "Intermittent MEV", "Centralised continuous MEV", "Decentralised continuous MEV", or "MVHR" (balanced with heat recovery). Each type has different airflow characteristics and energy consumption.',
    type: 'string',
  },
  'vent_type': {
    description: 'Ventilation system type: "Intermittent MEV", "Centralised continuous MEV", "Decentralised continuous MEV", or "MVHR" (balanced with heat recovery). Each type has different airflow characteristics and energy consumption.',
    type: 'string',
  },
  'Control_MechanicalVentilation': {
    description: 'Reference to a control object that defines when the mechanical ventilation system operates. References a key in the Control section (e.g., for intermittent MEV systems, this defines the on/off schedule).',
    type: 'string',
  },
  'EnergySupply_MechanicalVentilation': {
    description: 'Reference to an EnergySupply entry (e.g., "mains elec", "mains gas") that provides the energy source for the ventilation fans. This links the mechanical ventilation system to fuel type, emissions factors, and energy prices.',
    type: 'string',
  },
  'SFP': {
    description: 'Specific fan power (unit: W/l/s). Power consumption of the fan per unit of airflow. Lower values indicate more efficient fans. Assumed to include in-use factors unless SFP_in_use_factor is also provided.',
    type: 'number',
    units: 'W/l/s',
  },
  'SFP_in_use_factor': {
    description: 'Adjustment applied to the entered SFP to account for in-use effects such as ducting. Typical values are 1–2.5. Leave at 1 when the SFP value already includes the in-use factor.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'design_outdoor_air_flow_rate': {
    description: 'Design outdoor air flow rate (unit: m³/hour). Required airflow rate for the mechanical ventilation system to meet ventilation requirements. Used to calculate fan power and energy consumption.',
    type: 'number',
    units: 'm³/hour',
  },
  'design_zone_cooling_covered_by_mech_vent': {
    description: 'Design cooling load covered by the mechanical ventilation system for the served zone. Use 0 if the ventilation system does not provide space cooling.',
    type: 'number',
    units: 'kW',
  },
  'design_zone_heating_covered_by_mech_vent': {
    description: 'Design heating load covered by the mechanical ventilation system for the served zone. Use 0 if the ventilation system does not provide space heating.',
    type: 'number',
    units: 'kW',
  },
  'ductwork': {
    description: 'List of ductwork elements installed in this mechanical ventilation system. Each ductwork element defines the physical characteristics (length, diameter, insulation) of supply or extract ducts, used to calculate heat losses and pressure drops.',
    type: 'array',
  },
  'mvhr_eff': {
    description: 'MVHR (Mechanical Ventilation with Heat Recovery) efficiency (unit: dimensionless, range: 0-1). The fraction of heat recovered from exhaust air and transferred to supply air. Higher values (e.g., 0.85-0.95) indicate more efficient heat recovery. Only applicable for MVHR systems.',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'mvhr_location': {
    description: 'Location of the MVHR unit: "inside" (within the thermal envelope) or "outside" (outside the thermal envelope). Affects heat losses and energy consumption calculations. Only applicable for MVHR systems.',
    type: 'string',
  },
  // R4.6b-3: both keys abbreviate words that are not in the key at all, so neither the
  // schema title (the pydantic class names `SupplyAirFlowRateControlType` /
  // `SupplyAirTemperatureControlType`) nor start-casing ("Sup Air Flw Ctrl") can produce
  // a readable label. The expansion is taken from each field's own description below.
  'sup_air_flw_ctrl': {
    label: 'Supply Air Flow Rate Control',
    description: 'Supply air flow rate control type: "ODA" (Outdoor Air - flow rate based on outdoor air requirements). Determines how the supply air flow rate is controlled and calculated.',
    type: 'string',
  },
  'sup_air_temp_ctrl': {
    label: 'Supply Air Temperature Control',
    description: 'Supply air temperature control type: "CONST" (constant temperature), "NO_CTRL" (no temperature control), or "LOAD_COM" (load compensation - temperature varies based on heating/cooling demand). Determines how the supply air temperature is controlled.',
    type: 'string',
  },
  // R4.6b-3, the standard-number class: start-casing splits the digits off the standard
  // it belongs to ("Test Data EN 14825"), and the schema title ("Test Data En14825") has
  // lost the acronym. Any future key embedding a standard number needs the same entry.
  'test_data_EN14825': {
    label: 'Test Data EN14825',
  },
  'measured_air_flow_rate': {
    description: 'Measured air flow rate (unit: litres per second, optional). Actual measured airflow used with measured fan power to derive SFP.',
    type: 'number',
    units: 'l/s',
  },
  'measured_fan_power': {
    description: 'Measured fan power (unit: W, optional). Actual measured fan power consumption for validation or calibration instead of calculated fan power based on SFP.',
    type: 'number',
    units: 'W',
  },
  // CombustionAppliances
  'appliance_type': {
    description: 'Type of combustion appliance: "open_fireplace", "closed_with_fan", "open_gas_flue_balancer", "open_gas_kitchen_stove", "open_gas_fire", or "closed_fire". Used to determine combustion air requirements and ventilation needs.',
    type: 'string',
  },
  'exhaust_situation': {
    description: 'How flue gases are exhausted: "into_room" (flue gases enter the room, e.g., open fires), "into_separate_duct" (dedicated flue/duct system), or "into_mech_vent" (exhausted through mechanical ventilation system). Affects indoor air quality and ventilation requirements.',
    type: 'string',
  },
  'fuel_type': {
    description: 'Type of fuel burned: "wood", "gas", "oil", or "coal". Used to calculate combustion air requirements, flue gas characteristics, and ventilation needs based on fuel-specific combustion properties.',
    type: 'string',
  },
  'supply_situation': {
    description: 'Source of combustion air: "room_air" (air drawn from the room) or "outside" (air supplied directly from outside via dedicated intake). Affects ventilation requirements and indoor air quality calculations.',
    type: 'string',
  },
  // OnSiteGeneration
  'peak_power': {
    description: 'Peak power of the photovoltaic system (unit: kWp). Electrical power output at 1 kW/m² solar irradiance and 25°C. Used to calculate electricity generation.',
    type: 'number',
    units: 'kWp',
  },
  'onsite_generation_peak_power': {
    description: 'Peak power of the photovoltaic system (unit: kWp). Electrical power output at 1 kW/m² solar irradiance and 25°C. Used to calculate electricity generation.',
    type: 'number',
    units: 'kWp',
  },
  // ElectricBattery
  'charge_discharge_efficiency_round_trip': {
    description: 'Round trip efficiency of the battery system (range: 0-1). Fraction of energy recovered after a full charge-discharge cycle. Example: 0.9 means 90% of stored energy can be retrieved.',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'label:charge/discharge_efficiency': {
    description: 'Round trip efficiency of the battery system (range: 0-1). Fraction of energy recovered after a full charge-discharge cycle. Example: 0.9 means 90% of stored energy can be retrieved.',
    type: 'number',
  },
  // BuildingElementOpaque
  'is_unheated_pitched_roof': {
    description: 'Whether this is an unheated pitched roof (boolean). When true, the internal pitch is set to 0° (horizontal) for heat transfer calculations, regardless of the external pitch.',
    type: 'boolean',
  },
  'is_external_door': {
    description: 'Whether this is an external door (boolean). When true, the element uses door-specific U-values and air permeability in fabric heat loss calculations. If the door is more than 60% glazed, model it as a window instead (HEM:FHS Building Fabric guidance).',
    type: 'boolean',
  },
  // BuildingElementTransparent
  'free_area_height': {
    description: 'Effective vertical airflow opening height used by the window ventilation model (unit: m). This is the open aperture height used to place airflow paths and pressure differences, not the full frame height. Use the openable airflow height at maximum opening.',
    type: 'number',
    units: 'm',
  },
  'mid_height': {
    description: 'Mid-height of the window opening relative to the ventilation zone (unit: m, range: 1-60). Used in natural ventilation calculations to determine pressure differences and airflow rates.',
    type: 'number',
    units: 'm',
  },
  'max_window_open_area': {
    description: 'Maximum effective openable area for airflow (unit: m²). This is the total opening area at maximum opening. Distinct from free_area_height (m), which is the vertical aperture height used for airflow-path positioning.',
    type: 'number',
    units: 'm²',
  },
  'BuildingElementTransparent:frame_area_fraction': {
    description: 'Fraction of the window area occupied by the frame (0–1). The stored value remains a fraction; 0.25 means one quarter.',
    type: 'number',
    unitSemantic: 'fraction',
  },
  // BuildingElementGround
  'floor_type': {
    description: 'Type of ground floor construction. The selected type controls which ISO 13370-style helper inputs are required and how the steady ground-floor u_value is calculated.',
    type: 'string',
  },
  // ThermalBridgeLinear
  'length': {
    description: 'Length of the linear thermal bridge (unit: m). Used with linear thermal transmittance (psi-value) to calculate total heat loss.',
    type: 'number',
    units: 'm',
  },
  'length_MechanicalVentilationDuctwork': {
    description: 'Length of the ventilation ductwork (unit: m). Used to calculate heat losses through the ductwork system.',
    type: 'number',
    units: 'm',
  },
  'linear_thermal_transmittance': {
    description: 'Linear thermal transmittance (psi-value) of the thermal bridge (unit: W/m·K). Additional heat loss per unit length beyond what would occur through building elements alone.',
    type: 'number',
    units: 'W/m·K',
  },
  // ThermalBridgePoint
  'heat_transfer_coeff': {
    description: 'Heat transfer coefficient of the point thermal bridge (unit: W/K). Additional heat loss through a point thermal bridge (e.g., bolt or bracket) beyond building elements alone.',
    type: 'number',
    units: 'W/K',
  },
  // WindowShading
  'transparency': {
    description: 'Transparency of the shading object (dimensionless, range: 0-1). 0 = completely opaque (blocks all solar radiation), 1 = completely transparent (no shading effect).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'depth': {
    description: 'Depth of the shading object (unit: m). For overhangs: horizontal projection distance from window plane. For side fins/reveals: depth perpendicular to window surface.',
    type: 'number',
    units: 'm',
  },
  // Lighting
  'efficacy': {
    description: 'Luminous efficacy of the lighting system (unit: lm/W). Light output (lumens) per unit of electrical power (watts). Typical values: 50-150 lm/W for LED lighting.',
    type: 'number',
    units: 'lm/W',
  },
  'count': {
    description: 'Number of light bulbs or fixtures in the zone. Used with power per unit to calculate total lighting energy consumption.',
    type: 'number',
    unitSemantic: 'unitless',
  },
  'power': {
    description: 'Electrical power per light bulb or fixture (unit: W). Used with count to calculate total lighting energy consumption in the zone.',
    type: 'number',
    units: 'W',
  },
  // MechanicalVentilationDuctwork
  'duct_type': {
    description: 'Type of MVHR ductwork: supply and extract are the room-side air paths; intake and exhaust are the external air paths.',
    type: 'string',
  },
  'cross_section_shape': {
    description: 'Cross-section shape of the ductwork: "circular" or "rectangular" (square). Determines how dimensions are specified (diameter for circular, perimeter for rectangular).',
    type: 'string',
  },
  'duct_perimeter_mm': {
    description: 'Cross-sectional perimeter length of rectangular ductwork (unit: mm). Required for rectangular ducts, not used for circular ducts.',
    type: 'number',
    units: 'mm',
  },
  'external_diameter_mm': {
    description: 'External diameter (unit: mm).',
    type: 'number',
    units: 'mm',
  },
  'external_diameter_mm_MechanicalVentilationDuctwork': {
    description: 'External diameter of circular ductwork (unit: mm). Used for circular ducts to calculate heat losses through the ductwork system.',
    type: 'number',
    units: 'mm',
  },
  'external_diameter_mm_WaterPipework': {
    description: 'External diameter of the pipework (unit: mm). Used to calculate heat losses through the pipework system.',
    type: 'number',
    units: 'mm',
  },
  'internal_diameter_mm': {
    description: 'Internal diameter (unit: mm).',
    type: 'number',
    units: 'mm',
  },
  'internal_diameter_mm_MechanicalVentilationDuctwork': {
    description: 'Internal diameter of circular ductwork (unit: mm). Used for circular ducts to calculate airflow characteristics.',
    type: 'number',
    units: 'mm',
  },
  'internal_diameter_mm_WaterPipework': {
    description: 'Internal diameter of the pipework (unit: mm). Used to calculate flow characteristics and heat transfer.',
    type: 'number',
    units: 'mm',
  },
  'insulation_thermal_conductivity': {
    description: 'Thermal conductivity of insulation (unit: W/m·K). Lower values indicate better insulation.',
    type: 'number',
    units: 'W/m·K',
  },
  'insulation_thermal_conductivity_MechanicalVentilationDuctwork': {
    description: 'Thermal conductivity of the ductwork insulation (unit: W/m·K). Lower values indicate better insulation, reducing heat losses through the ductwork.',
    type: 'number',
    units: 'W/m·K',
  },
  'insulation_thermal_conductivity_WaterPipework': {
    description: 'Thermal conductivity of the pipework insulation (unit: W/m·K). Lower values indicate better insulation, reducing heat losses through the pipework.',
    type: 'number',
    units: 'W/m·K',
  },
  'insulation_thickness_mm': {
    description: 'Thickness of insulation (unit: mm). Thicker insulation reduces heat losses.',
    type: 'number',
    units: 'mm',
  },
  'insulation_thickness_mm_MechanicalVentilationDuctwork': {
    description: 'Thickness of the ductwork insulation (unit: mm). Thicker insulation reduces heat losses through the ductwork.',
    type: 'number',
    units: 'mm',
  },
  'insulation_thickness_mm_WaterPipework': {
    description: 'Thickness of the pipework insulation (unit: mm). Thicker insulation reduces heat losses through the pipework.',
    type: 'number',
    units: 'mm',
  },
  'reflective': {
    description: 'Whether the ductwork surface is reflective (boolean). Reflective surfaces reduce radiative heat transfer.',
    type: 'boolean',
  },
  // WaterPipework
  'location': {
    description: 'Location of the water pipework: "internal" (within heated space) or "external" (outside heated space). Internal pipework contributes to internal gains, external has heat losses.',
    type: 'string',
  },
  'pipe_contents': {
    description: 'Contents of the pipework: "water" (water), "air" (air), or "glycol25" (25% glycol solution). Determines temperature and heat loss/gain characteristics.',
    type: 'string',
  },
  'WaterPipeContentsType': {
    description: 'Contents of the pipework: "water" (water), "air" (air), or "glycol25" (25% glycol solution). Determines temperature and heat loss/gain characteristics.',
    type: 'string',
  },
  'surface_reflectivity': {
    description: 'Whether the pipework surface is reflective (boolean). Reflective surfaces reduce radiative heat transfer.',
    type: 'boolean',
  },
  'pipework_type': {
    description: 'Pipework classification: "primary" (main supply pipework) or "distribution" (distribution pipework). Used to organize pipework in the JSON structure.',
    type: 'string',
  },
  // ElectricBattery
  'capacity': {
    description: 'Energy storage capacity of the battery system (unit: kWh). Maximum amount of electrical energy that can be stored.',
    type: 'number',
    units: 'kWh',
  },
  'battery_location': {
    description: 'Location of the battery system: "inside" (within heated space) or "outside" (outside heated space). Internal batteries contribute to internal gains.',
    type: 'string',
  },
  'grid_charging_possible': {
    description: 'Whether the battery can be charged from the electrical grid (boolean). When true, the battery can import electricity from the grid in addition to on-site generation (e.g., PV).',
    type: 'boolean',
  },
  // BuildingElementAdjacent
  'mass_distribution_class_BuildingElementAdjacentConditionedSpace': {
    description: 'Mass distribution class describing where the thermal mass sits within the construction: `D: Mass equally distributed`, `E: Mass concentrated at external side`, `I: Mass concentrated at internal side`, `IE: Mass divided over internal and external side`, or `M: Mass concentrated inside`.',
    type: 'string',
  },
  'mass_distribution_class_BuildingElementAdjacentUnconditionedSpace_Simple': {
    description: 'Mass distribution class describing where the thermal mass sits within the construction: `D: Mass equally distributed`, `E: Mass concentrated at external side`, `I: Mass concentrated at internal side`, `IE: Mass divided over internal and external side`, or `M: Mass concentrated inside`.',
    type: 'string',
  },
  'mass_distribution_class_BuildingElementPartyWall': {
    description: 'Mass distribution class used for the party wall construction.',
    type: 'string',
  },
  'u_value_BuildingElementAdjacentConditionedSpace': {
    description: 'Thermal transmittance (U-value) of the building element adjacent to a conditioned space (unit: W/m²·K). For adjacent conditioned spaces, heat loss is typically zero, but U-value may be used for reference.',
    type: 'number',
    units: 'W/m²·K',
  },
  'u_value_BuildingElementAdjacentUnconditionedSpace_Simple': {
    description: 'Thermal transmittance (U-value) of the building element adjacent to an unconditioned space (unit: W/m²·K). Used to calculate heat loss through the element to the adjacent unconditioned space.',
    type: 'number',
    units: 'W/m²·K',
  },
  'u_value_BuildingElementPartyWall': {
    description: 'Thermal transmittance (U-value) of the party wall element (unit: W/m²·K).',
    type: 'number',
    units: 'W/m²·K',
  },
  'BuildingElementOpaque:u_value': {
    description: 'Thermal transmittance (U-value) of the opaque building element (unit: W/m²·K). Lower values mean less heat is lost through the construction.',
    type: 'number',
    units: 'W/m²·K',
  },
  'BuildingElementTransparent:u_value': {
    description: 'Thermal transmittance (U-value) of the transparent building element (unit: W/m²·K). Lower values mean less heat is lost through the window or glazed door.',
    type: 'number',
    units: 'W/m²·K',
  },
  'BuildingElementGround:u_value': {
    description: 'Steady-state thermal transmittance of the ground floor in accordance with BS EN ISO 13370, including internal surface resistance and the effect of the ground (unit: W/m²·K).',
    type: 'number',
    units: 'W/m²·K',
  },
  'core:*:areal_heat_capacity': {
    description: 'Effective areal heat capacity of the construction (unit: J/m²·K).',
    type: 'number',
    units: 'J/m²·K',
  },
  '*:areal_heat_capacity': {
    description: 'This is the effective areal heat capacity of the construction: the sum of the heat capacities of all construction layers. In HEM:FHS it is classified into five bands from Very light to Very heavy. Note that this is not the same as kappa, which only reflects the thermal mass directly active at the internal surface.',
    type: 'string',
  },
  'BuildingElementOpaque:solar_absorption_coeff': {
    description: 'Fraction of incident solar radiation absorbed at the external surface (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  '*:mass_distribution_class': {
    description: 'This describes where the main thermal mass sits relative to the insulation or thermal resistance through the build-up. As a rule of thumb: external insulation means mass concentrated at the internal side; internal insulation means mass concentrated at the external side; insulation between two heavy layers means mass divided over internal and external side; uninsulated or negligible-mass constructions are usually equally distributed; and insulation on both sides of a heavy core means mass concentrated inside.',
    type: 'string',
  },
  'BuildingElementOpaque:colour': {
    description: 'This is the external surface colour band used to represent solar absorption. Choose the band that best matches the visible outside finish: light for pale finishes, intermediate for typical red brick / grey tile / aged bitumen, and dark for black or very dark finishes. This field is only needed for opaque elements exposed to the external environment.',
    type: 'string',
  },
  'party_wall_cavity_type': {
    description: 'Party wall cavity treatment used by the upstream schema.',
    type: 'string',
  },
  'party_wall_lining_type': {
    description: 'Party wall lining treatment used when the chosen cavity type requires it.',
    type: 'string',
  },
  'thermal_resistance_cavity': {
    description: 'Thermal resistance assigned to the party wall cavity (unit: m²·K/W).',
    type: 'number',
    units: 'm²·K/W',
  },
  'thermal_resistance_construction': {
    description: 'Thermal resistance of the construction (unit: m²·K/W). This is the inverse of U-value and represents the resistance to heat flow through the building element construction.',
    type: 'number',
    units: 'm²·K/W',
  },
  // BuildingElementGround
  'total_area': {
    description: 'Total area of the ground floor element across the entire dwelling (unit: m²). If the floor spans multiple zones, this is the sum across all zones.',
    type: 'number',
    units: 'm²',
  },
  'perimeter': {
    description: 'Exposed perimeter of the ground floor element (unit: m), measured along external wall runs on the floor outline. Used with total_area to calculate the ISO 13370-style characteristic dimension B′.',
    type: 'number',
    units: 'm',
  },
  'thickness_walls': {
    description: 'Wall thickness used in the ISO 13370-style ground-floor calculation (unit: m). For slab and suspended floors this is the perimeter wall thickness; for basements it is the wall thickness used in the basement floor / wall ground expressions.',
    type: 'number',
    units: 'm',
  },
  'thermal_resistance_floor_construction': {
    description: 'Thermal resistance of the floor construction (unit: m²·K/W). Used in ground heat loss calculations.',
    type: 'number',
    units: 'm²·K/W',
  },
  'psi_wall_floor_junc': {
    description: 'Linear thermal transmittance (psi-value) at the wall-floor junction (unit: W/m·K). This is required by HEM and is separate from the ground-floor area u_value calculated by the ISO 13370-style helper.',
    type: 'number',
    units: 'W/m·K',
  },
  'height_upper_surface': {
    description: 'Height of the upper surface of the ground floor element above ground level (unit: m).',
    type: 'number',
    units: 'm',
  },
  'shield_fact_location': {
    description: 'Wind shielding category for the suspended-floor ventilation term. Vulcan maps Sheltered, Average, and Exposed to the ISO 13370-style shielding factors used by the ground-floor helper.',
    type: 'string',
  },
  // Historical misspelling retained as a defensive alias for older UI lookups.
  'sheifl_fact_location': {
    description: 'Wind shielding category for the suspended-floor ventilation term. Vulcan maps Sheltered, Average, and Exposed to the ISO 13370-style shielding factors used by the ground-floor helper.',
    type: 'string',
  },
  'area_per_perimeter_vent': {
    description: 'Area of ventilation openings per unit perimeter run for a suspended floor void (m²/m). Used in the ISO 13370-style ventilation term.',
    type: 'number',
    units: 'm²/m',
  },
  'thermal_resist_insul': {
    description: 'Thermal resistance of insulation on the base of a suspended-floor underfloor void, excluding surface resistances (unit: m²·K/W).',
    type: 'number',
    units: 'm²·K/W',
  },
  'thermal_resist_walls_base': {
    description: 'Thermal resistance of basement walls below ground, excluding surface resistances (unit: m²·K/W). Required by HEM for basement floor types; Vulcan also uses it in the unheated-basement steady u_value helper.',
    type: 'number',
    units: 'm²·K/W',
  },
  'thermal_transm_walls': {
    description: 'Thermal transmittance of walls used by ground-floor variants that need adjacent-wall heat transfer (unit: W/m²·K). For suspended floors this is the underfloor void wall U-value; for unheated basements it is the above-ground basement wall U-value.',
    type: 'number',
    units: 'W/m²·K',
  },
  'BuildingElementGround:thermal_transm_walls': {
    description: 'Thermal transmittance of walls used by ground-floor variants that need adjacent-wall heat transfer (unit: W/m²·K). For suspended floors this is the underfloor void wall U-value; for unheated basements it is the above-ground basement wall U-value. It is not used by the heated-basement steady u_value helper.',
    type: 'number',
    units: 'W/m²·K',
  },
  'thermal_transm_envi_base': {
    description: 'Thermal transmittance of the floor between the heated space and an unheated basement, including surface resistances and calculated in accordance with ISO 6946 (unit: W/m²·K).',
    type: 'number',
    units: 'W/m²·K',
  },
  'height_basement_walls': {
    description: 'Height of unheated basement walls above ground level (unit: m). Used in the ISO 13370 unheated-basement Uub calculation and in basement geometry checks.',
    type: 'number',
    units: 'm',
  },
  'BuildingElementGround:depth_basement_floor': {
    description: 'Depth of the basement floor below ground level (unit: m).',
    type: 'number',
    units: 'm',
  },
  'edge_insulation': {
    description: 'Edge insulation details for slab-on-ground floors. Vulcan’s steady u_value helper treats this as an equivalent edge correction and, when multiple entries exist, uses the entry with the largest effective improvement rather than summing entries.',
    type: 'array',
  },
  // ElectricBattery - missing fields
  'battery_age': {
    description: 'Age of the battery system (years). Used to account for battery degradation over time, which affects capacity and efficiency.',
    type: 'number',
    units: 'years',
  },
  'maximum_charge_rate_one_way_trip': {
    description: 'Maximum charge rate of the battery (unit: kW). Maximum power at which the battery can be charged.',
    type: 'number',
    units: 'kW',
  },
  'maximum_discharge_rate_one_way_trip': {
    description: 'Maximum discharge rate of the battery (unit: kW). Maximum power at which the battery can be discharged.',
    type: 'number',
    units: 'kW',
  },
  'minimum_charge_rate_one_way_trip': {
    description: 'Minimum charge rate of the battery (unit: kW). Minimum power required to charge the battery.',
    type: 'number',
    units: 'kW',
  },
  // OnSiteGeneration - missing fields
  'photovoltaic_ventilation_strategy': {
    description: 'Ventilation strategy for the photovoltaic system inverter. Affects internal gains if the inverter is located inside the building.',
    type: 'string',
  },
  'BuildingElementTransparent:treatment': {
    description:
      'Blinds or curtains on this window (Home Energy Model section 3.6.4). When modelled as closed, they add extra thermal resistance (ΔR) and reduce solar gains. Use the table presets or enter custom values — not a generic “surface finish”.',
    type: 'array',
  },
  'BuildingElementTransparent:g_value': {
    description: 'Total solar energy transmittance of the glazing (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'BuildingElementTransparent:trans_red': {
    description: 'Solar transmittance reduction factor for the window treatment (0–1).',
    type: 'number',
    unitSemantic: 'fraction',
  },
  'BuildingElementTransparent:delta_r': {
    description: 'Additional thermal resistance from the closed window treatment (unit: m²·K/W).',
    type: 'number',
    units: 'm²·K/W',
  },
  'label:Blinds / curtains': {
    description:
      'Blinds or curtains for this glazing element. Controls solar transmittance reduction and extra thermal resistance when the treatment is closed, per HEM Table 3.6.b and `WindowTreatment` in the input schema.',
    type: 'array',
  },
  'treatment': {
    description:
      'For windows this means blinds/curtains (`WindowTreatment` array). For other element types it is rarely used.',
    type: 'string',
  },
  'window_parts_list': {
    description: 'List of window parts or components. Used for detailed window specification.',
    type: 'string',
  },
  'BuildingElementTransparent:security_risk': {
    description: WINDOW_SECURITY_RISK_HELPER,
    type: 'boolean',
  },
  // Dwelling / compliance root (`GeometryBuilder` merge): schema often omits descriptions — keep copy short.
  'Global:BuildingLength': {
    description: 'Longest internal footprint dimension (m) for characteristic dwelling size inputs.',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'Global:BuildingWidth': {
    description: 'Shorter internal footprint dimension (m); pairs with building length.',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'Global:GroundFloorArea': {
    description: 'Ground-floor area used by the compliance inputs (unit: m²).',
    type: 'number',
    units: 'm²',
    modelAuthoring: true,
  },
  'Global:NumberOfHabitableRooms': {
    description: 'Number of habitable rooms — number of rooms that are not used solely as a kitchen, bathroom, utility room, cellar or WC.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:NumberOfHotTappedRooms': {
    description: 'Total number of rooms with tapping points — number of rooms with at least one hot water tapping point that is fed from the hot water distribution system. This excludes electric showers and point of use water heaters.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:NumberOfUtilityRooms': {
    description: 'Number of utility rooms — number of wet rooms that are not kitchens, bathrooms, or WCs.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:NumberOfBathrooms': {
    description: 'Number of bathrooms — number of rooms containing a bath or shower.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:NumberOfSanitaryAccommodations': {
    description: 'Number of WCs — number of rooms containing one or more flush toilets or urinals but not a bath or shower.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:KitchenExtractorHoodExternal': {
    description: '**Dwelling details — kitchen extract:** set **true** when the kitchen cooker hood (or equivalent extract) **discharges to outside** fresh air, as used for ventilation / infiltration assumptions in compliance runs.',
    type: 'boolean',
  },
  'Global:General_build_type': {
    description: '**Dwelling details — build type:** whether the assessed dwelling is a house or a flat. Vulcan can suggest this from floor geometry: ground-contact floor geometry suggests house; floor geometry without ground contact suggests flat.',
    type: 'string',
  },
  'Global:General_built_form': {
    description: '**SAP built form:** the explicit SAP 10.2 dwelling-form code. This cannot be inferred from party-wall geometry because that does not distinguish semi-detached, end-terrace, or mid-terrace forms.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:General_storeys_in_dwelling': {
    description: '**Dwelling details — storeys in dwelling:** count of storeys within the assessed dwelling. Vulcan suggests this from distinct floor levels that contain ground-contact floor geometry or pitch-180 walkable floor polygons.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:General_storey_of_dwelling': {
    description: '**Dwelling details — storey of dwelling:** for flats, the lowest storey occupied by the dwelling within the building.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:General_storeys_in_building': {
    description: '**Dwelling details — storeys in building:** for flats, the number of storeys within the whole building that contain dwellings.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:AirPermeability_test_result': {
    description: 'Measured envelope air-flow rate per unit envelope area.',
    type: 'number',
    units: 'm³/(h·m²)',
    modelAuthoring: true,
  },
  'Global:AirPermeability_ventilation_zone_height': {
    description: 'Height of the ventilation zone (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'Global:Ventilation_altitude': {
    description: 'Site altitude above sea level (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'Global:Ventilation_ventilation_zone_base_height': {
    description: 'Height from external ground to the base of the ventilation zone (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'Global:defaultThermalBridging': {
    description: 'Fallback heat loss through junctions per zone (unit: W/K).',
    type: 'number',
    units: 'W/K',
    modelAuthoring: true,
  },
  'Zone:floorArea': {
    description: 'Zone floor area used for model authoring (unit: m²).',
    type: 'number',
    units: 'm²',
    modelAuthoring: true,
  },
  'Zone:height': {
    description: 'Effective zone height (unit: m).',
    type: 'number',
    units: 'm',
    modelAuthoring: true,
  },
  'Zone:volume': {
    description: 'Zone volume derived from floor area and effective height (unit: m³).',
    type: 'number',
    units: 'm³',
    modelAuthoring: true,
  },
  PartO_active_cooling_required: {
    description:
      'Part O overheating: when applicable, the dwelling is assessed including active (mechanical) cooling where required.',
    type: 'boolean',
  },
  'Global:NumberOfBedrooms': {
    description: 'Number of bedrooms — number of rooms in the dwelling excluding the primary living area and any wet rooms or utility rooms.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  'Global:NumberOfWetRooms': {
    description: 'Total number of wet rooms — enter the total number of rooms used for domestic activities that produce significant amounts of airborne moisture. For example a kitchen, utility room, bathroom or WC.',
    type: 'integer',
    unitSemantic: 'unitless',
    modelAuthoring: true,
  },
  HeatingControlType: {
    description: 'SAP-style heating control (temperature vs time+temperature). Required when FHS validation is on.',
    type: 'string',
  },
  PartGcompliance: {
    description: 'Enables Part G domestic hot water checks in the compliance pathway.',
    type: 'boolean',
  },
};

function cleanDesc(s: string | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pushUnique(target: string[], value: string | undefined): void {
  if (value && !target.includes(value)) target.push(value);
}

/**
 * Resolve tooltip/unit metadata against a concrete field context.
 *
 * The long-form keys are intentionally optional: existing element-scoped and
 * legacy keys remain canonical data, while conditional fields can opt into
 * mode/subtype/fabric specificity without creating a second registry.
 */
export function getFieldMetadata(context: FieldMetadataContext): FieldMetadataMatch | null {
  const {
    mode,
    propertyKey,
    elementType,
    subtype,
    opaqueFabricVariant,
    label,
  } = context;
  const keys: string[] = [];

  if (mode && elementType && subtype && opaqueFabricVariant) {
    pushUnique(keys, `${mode}:${elementType}:${subtype}:${opaqueFabricVariant}:${propertyKey}`);
  }
  if (mode && elementType && subtype) {
    pushUnique(keys, `${mode}:${elementType}:${subtype}:${propertyKey}`);
  }
  if (mode && elementType && opaqueFabricVariant) {
    pushUnique(keys, `${mode}:${elementType}:${opaqueFabricVariant}:${propertyKey}`);
  }
  if (elementType && subtype && opaqueFabricVariant) {
    pushUnique(keys, `${elementType}:${subtype}:${opaqueFabricVariant}:${propertyKey}`);
  }
  if (elementType && subtype) {
    pushUnique(keys, `${elementType}:${subtype}:${propertyKey}`);
  }
  if (elementType && opaqueFabricVariant) {
    pushUnique(keys, `${elementType}:${opaqueFabricVariant}:${propertyKey}`);
  }
  if (mode && elementType) pushUnique(keys, `${mode}:${elementType}:${propertyKey}`);
  if (elementType) {
    pushUnique(keys, `${elementType}:${propertyKey}`);
    pushUnique(keys, `${propertyKey}_${elementType}`);
  }
  if (mode) pushUnique(keys, `${mode}:*:${propertyKey}`);
  pushUnique(keys, `*:${propertyKey}`);
  pushUnique(keys, propertyKey);
  if (label) pushUnique(keys, `label:${label}`);

  for (const key of keys) {
    const info = TOOLTIP_OVERRIDES[key];
    if (info && (cleanDesc(info.description) || info.units || info.unitSemantic)) {
      return { info, key };
    }
  }
  return null;
}

/**
 * Lookup helper for UI/tooling code that previously used `HARDCODED_FIELD_INFO`.
 * Supports both legacy (`${fieldName}_${elementType}`) and newer (`${elementType}:${paramId}` / `*:${paramId}`) keys.
 */
export function getHardcodedFieldInfo(fieldName: string, elementType?: string): HardcodedFieldInfo | null {
  return getFieldMetadata({
    propertyKey: fieldName,
    elementType,
    label: fieldName,
  })?.info ?? null;
}

/**
 * Schema overlay lookup used by `findParameterInSchema`.
 * Intentionally param-based only (no `label:` keys).
 */
export function getVulcanDescriptionOverride(elementType: string | undefined, paramId: string): string | null {
  const candidates: string[] = [];
  if (elementType) {
    candidates.push(`${elementType}:${paramId}`);
    candidates.push(`${paramId}_${elementType}`);
  }
  candidates.push(`*:${paramId}`);
  candidates.push(paramId);

  for (const k of candidates) {
    const hit = TOOLTIP_OVERRIDES[k];
    const desc = cleanDesc(hit?.description);
    if (desc) return desc;
  }
  return null;
}

/* ───────────────────────────────────────────────────────────────────────────────
 * R4.6b-3 — THE FIELD LABEL CONTENT RULE
 * ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Local start-case helper for schema keys with no `title`, e.g. `battery_age` ->
 * `Battery Age`, `EnergySupply` -> `Energy Supply`.
 *
 * R4.6b-3 MOVE NOTE: this lived in `../components/DirectAdvancedFields` (which still
 * re-exports it for the parent repo's `SimplifiedFabricEditor`) until the label rule
 * below acquired a second, third and fourth caller. Logic byte-for-byte; only its home
 * changed, and it moved TO the rule rather than the rule moving to it, because deriving
 * a label from a key is step 3 of the rule, not a component concern.
 *
 * R4.3 FINDING (generalizing past ElectricBattery surfaced this): the R4.2 spike's
 * original version only split on `_`, since every ElectricBattery key was snake_case.
 * OnSiteGeneration FHS's `EnergySupply` (a PascalCase key with no schema `title`)
 * broke that: on the retired JsonForms path, JsonForms' own `addLabel`/label-derivation
 * for a Control with no explicit uischema `label` fell back to `title` if present, else
 * lodash `startCase(scopeSegment)` (see node_modules/@jsonforms/core), which DOES split
 * camelCase/PascalCase boundaries -- rendered "Energy Supply"; the R4.2-era version
 * here rendered "EnergySupply" verbatim. This is now fixed by splitting at
 * lowercase->uppercase and acronym-run->titlecase boundaries too, matching lodash
 * `startCase`'s `words()` closely enough for the ASCII identifier-style keys HEM
 * schemas use (ordinary snake_case, PascalCase, camelCase, and digit runs) --
 * `words()`'s full Unicode-script handling is out of scope, nothing in these schemas
 * needs it.
 *
 * R4.5: also used by web's `SimplifiedFabricEditor` (parent repo), which dropped its
 * local `labelize` for it. NOT a zero-delta swap, and saying otherwise is what let the
 * claim stand unchallenged: `labelize` split only on `_` and lowercase->uppercase, never
 * on digit runs, so `orientation360` went from "Orientation360" to "Orientation 360".
 * The change is deliberate and better: it matches lodash `startCase`, which is what
 * @jsonforms/core's own label derivation used on the retired path, so it REMOVES an
 * inconsistency between the two editors. The merged parent commit says the same and
 * pins `orientation360` in its own characterization test.
 */
export function startCaseKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(/[_\-\s]+/)
    .filter((word) => word.length > 0);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Canonical spellings, applied WORD BY WORD (step 3).
 *
 * Audited against both published schemas rather than wished for. Entries that change a
 * live row today: MVHR (`mvhr_location`), ACH (`ach_max/min_static_calcs`), HP
 * (`min_temp_diff_flow_return_for_hp_to_operate`, `cost_schedule_hp`), DC/AC
 * (`inverter_peak_power_dc/ac`), SFP (the KEPT title "Sfp In Use Factor"), and `onoff`
 * (`time_constant_onoff_operation`). Entries that change nothing today and are kept so
 * the spelling cannot drift when a new key arrives: DHW (`separate_DHW_tests` already
 * start-cases correctly) and CoP. CoP earns its place from the other direction — Core's
 * `HeatPumpTestDatum.cop` is titled "CoP", which step 2 KEEPS (measured, and pinned in
 * `__tests__/fieldPresentation.test.ts`); this entry is what stops a titleless `cop`
 * anywhere else from rendering "Cop" beside it.
 *
 * Candidates deliberately NOT here because they match nothing in either schema: WWHRS,
 * HIU, PV, UFH, MEV, PIV, SAP, EPC, CO2. A dictionary entry that fires nowhere is a
 * claim about a schema we do not have.
 *
 * "Changes nothing today" has TWO causes and they decay differently. DHW's is stable —
 * no key it would rewrite renders differently from how it already reads. CoP's is not:
 * FHS carries titleless `cop` and `cop_dhw` keys that this entry WOULD move, and they
 * are quiet only because they sit inside `test_data_EN14825` array items and `test_data`
 * patternProperties, which neither walk enumerates. The day one of those becomes a row,
 * this entry starts doing work — which is the argument for it being here now rather than
 * being discovered missing later.
 *
 * `hp -> HP` IS SAFE ONLY BECAUSE PLANT KEYS NEVER REACH THIS RULE. `hp` is also a live
 * user plant key (Core renders its whole plant as one blob row labelled "Hp"), and
 * `buildSystemAdvancedUischema` labels those rows itself — off the merge-map annotation
 * `PLANT_KEYS_ARE_USER_NAMES` (`./systemAdvancedSchemaExpand`) — precisely so that a
 * user's own CSV name is never re-spelled by a schema-text rule. If plant keys are ever
 * routed through here, this entry must go, and so must `ac`/`dc`, which are just as
 * plausible as names for a cooling plant.
 */
const LABEL_WORD_SPELLINGS: ReadonlyMap<string, string> = new Map([
  ['mvhr', 'MVHR'],
  ['ach', 'ACH'],
  ['hp', 'HP'],
  ['dc', 'DC'],
  ['ac', 'AC'],
  ['sfp', 'SFP'],
  ['dhw', 'DHW'],
  ['cop', 'CoP'],
  ['onoff', 'On/Off'],
]);

/**
 * Whole-label hyphenations (step 3, after the word pass).
 *
 * Two entries, both the same case: a one-letter physics symbol bound to its noun, which
 * word-level spelling cannot express. Core already titles `u_value` "U-Value"; FHS
 * titles neither, so before this rule the same field read "U-Value" on one profile and
 * "U Value" on the other.
 */
const LABEL_HYPHENATIONS: ReadonlyMap<string, string> = new Map([
  ['u value', 'U-Value'],
  ['g value', 'G-Value'],
]);

/**
 * Trailing unit tokens dropped from a KEY-DERIVED label (step 1) — `External Diameter
 * Mm` -> `External Diameter`.
 *
 * `mm` alone, because `mm` is the only suffix every affected row was checked against.
 * The check is not a formality: dropping a unit from a label that has no other unit on
 * screen is information loss, so `stripKeyDerivedUnitSuffix` REQUIRES the row to carry
 * the same unit in its metadata before it strips anything, and FHS's
 * `inlet_diameter_mm` (no override, no schema description) consequently keeps its
 * suffix. Add a token here only alongside that evidence.
 *
 * Admissible titles never reach this step: a curated title carries its own spelling, and
 * every `_mm` title in Core is already written without the suffix.
 */
const LABEL_UNIT_SUFFIX_TOKENS: ReadonlySet<string> = new Set(['mm']);

/** Letters and digits only, case-folded — the comparison basis for step 2. */
function labelLetters(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Is this title a pydantic TYPE NAME rather than field copy?
 *
 * HEM's schemas title every `$def` with its generating class, and a `$ref`'d enum
 * property inherits it: `cross_section_shape` renders "DuctShape",
 * `shield_class` renders "VentilationShieldClass", `pipe_contents` renders
 * "PipeworkContents". These name the TYPE, not the field — the qualifier in front is the
 * type namespace (a `VentilationShieldClass` inside `System:InfiltrationVentilation`),
 * which is why dropping it is a correction and not a loss of context.
 *
 * The test is deliberately narrow: ONE alphanumeric token that start-cases into two or
 * more words of two or more letters each. "CoP" (words "Co"/"P") and "SFP" (one word)
 * therefore stay, which is the point — a short curated title is not a class name.
 */
function isTypeNameTitle(title: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(title)) return false;
  const words = startCaseKey(title).split(' ');
  return words.length >= 2 && words.every((word) => word.length >= 2);
}

/**
 * Does this title run together words the KEY keeps apart, gaining nothing by it?
 *
 * Only ever asked of a title whose letters are the key's letters, so the two word lists
 * cover the same characters and can be walked in step. A title word that swallows two or
 * more key words has lost a boundary; it is worth keeping ANYWAY if it carries an
 * internal capital, because that is information start-casing cannot invent:
 *
 *   "Coldwatersource"  vs "Cold Water Source"  -> boundary lost, nothing gained -> reject
 *   "Control Ventadjustmax" vs "Control Vent Adjust Max"                        -> reject
 *   "Sfp In Use Factor" vs "SFP In Use Factor" -> same boundaries               -> keep
 *   "First Order HLC"  vs "First Order Hlc"    -> same boundaries               -> keep
 *   "Heat Storage kJ Per K ..." vs "... K J Per K ..." -> "kJ" is informative   -> keep
 *
 * The two keeps are not hypothetical: `first_order_hlc` and the heat-battery
 * `heat_storage_kJ_per_K_*` keys render whenever a solar collector or heat battery is in
 * the model, and a letters-only test would degrade both.
 */
function titleRunsKeyWordsTogether(title: string, keyDerived: string): boolean {
  const titleWords = title.split(/\s+/).filter((word) => word.length > 0);
  const derivedWords = keyDerived.split(' ').filter((word) => word.length > 0);
  let next = 0;
  for (const titleWord of titleWords) {
    const target = labelLetters(titleWord);
    let covered = '';
    let consumed = 0;
    while (next < derivedWords.length && covered.length < target.length) {
      covered += labelLetters(derivedWords[next] ?? '');
      next += 1;
      consumed += 1;
    }
    // Misalignment means the two are not the same words differently spaced after all;
    // leave such a title alone rather than guess at it.
    if (covered !== target) return false;
    if (consumed >= 2 && !/[A-Z]/.test(titleWord.slice(1))) return true;
  }
  return false;
}

/**
 * Step 2 — is this schema `title` curated copy, or the schema talking to itself?
 *
 * A title with letters the key does not have is somebody's writing and is KEPT
 * ("ACH Maximum Static Calcs", "MVHR Efficiency", "Blinds / curtains"). The two
 * rejections are both cases where the title says LESS than the key: a pydantic class
 * name, and a title that has run the key's own words together.
 */
function titleIsAdmissible(propertyKey: string, title: string): boolean {
  if (isTypeNameTitle(title)) return false;
  if (labelLetters(title) !== labelLetters(propertyKey)) return true;
  return !titleRunsKeyWordsTogether(title, startCaseKey(propertyKey));
}

/**
 * Step 1, and only for key-derived labels. See `LABEL_UNIT_SUFFIX_TOKENS`.
 *
 * The evidence check goes through `getFieldMetadata`, the SAME ladder the unit adornment
 * resolves through (`resolveFieldPresentation` reads `overrideMetadata.info.units`), not
 * through a direct index of the bare key. The two agree on every `_mm` key today, so this
 * is inert — but they agree by coincidence: the ladder also carries element-scoped
 * entries (`external_diameter_mm_MechanicalVentilationDuctwork`,
 * `..._WaterPipework`), and an element-scoped entry that existed only there, or that
 * named a different unit, would have had this gate strip a suffix the row then never
 * showed. A gate must judge the same thing the render does, or it is not a gate.
 */
function stripKeyDerivedUnitSuffix(label: string, propertyKey: string, elementType?: string): string {
  const words = label.split(' ');
  const last = words[words.length - 1]?.toLowerCase() ?? '';
  if (words.length < 2 || !LABEL_UNIT_SUFFIX_TOKENS.has(last)) return label;
  const units = getFieldMetadata({ propertyKey, elementType })?.info.units;
  if (units?.trim().toLowerCase() !== last) return label;
  return words.slice(0, -1).join(' ');
}

/** Step 3 — canonical spellings, then the whole-label hyphenations. */
function applyLabelSpellings(label: string): string {
  const spelled = label
    .split(' ')
    .map((word) => LABEL_WORD_SPELLINGS.get(word.toLowerCase()) ?? word)
    .join(' ');
  return LABEL_HYPHENATIONS.get(spelled.toLowerCase()) ?? spelled;
}

/** Step 0 of the override ladder: an explicit `label` on this key's own entry. */
function labelOverrideFor(propertyKey: string): string | undefined {
  const info = TOOLTIP_OVERRIDES[propertyKey] ?? TOOLTIP_OVERRIDES[`*:${propertyKey}`];
  const label = info?.label?.trim();
  return label && label.length > 0 ? label : undefined;
}

/**
 * THE LABEL CONTENT RULE — what one Advanced Fields row is called (R4.6b-3).
 *
 * PREFIXES ARE NOT LABELS, AND DO NOT COME HERE. A System row's text is a structural
 * breadcrumb followed by a field label, and only the second half is this rule's
 * business:
 *  - a PREFIX is a plant key the user typed into their CSV ("hw cylinder",
 *    "Kitchen/Diner rads"), kept RAW, or a nested-object path part, START-CASED from its
 *    key. A prefix NEVER takes the node's schema `title`, even when it has one: Core's
 *    `InfiltrationVentilation.Leaks` resolves to a `$def` titled "VentilationLeaks" and
 *    the row still reads `Leaks · Env Area`. That is deliberate — a breadcrumb names the
 *    place in the user's document, and the user's document is keyed by keys.
 *  - a LEAF is the field's own label, and it is title-first, subject to step 2 below.
 * `leafControlLabel` (`./systemAdvancedUischema`) composes the two and calls this on the
 * tail only; the flat walk's `labelForProperty` (`../components/DirectAdvancedFields`)
 * calls it on the whole label, there being no prefix.
 *
 * THE STEPS, in order:
 *  0. an explicit `label` override wins outright (three keys; see `HardcodedFieldInfo`).
 *  1. a key-derived label drops a trailing unit token it can prove is shown elsewhere.
 *  2. a schema `title` is used only if ADMISSIBLE (`titleIsAdmissible`); otherwise the
 *     label is derived from the key, which is the more informative of the two.
 *  3. canonical spellings apply to BOTH outcomes — the kept title as well as the derived
 *     label, which is what makes "Sfp In Use Factor" read "SFP In Use Factor" without
 *     having to reject a perfectly well-spaced title to get there.
 *
 * OUT OF SCOPE, deliberately: user plant keys (see `LABEL_WORD_SPELLINGS`), and every
 * hand-authored label in the editor's own field groups — those are written by us, not
 * derived from a schema, and there is nothing for a rule to resolve.
 *
 * ONE TRIPWIRE, recorded because it is invisible from anything that renders today. A
 * census over every property node in both published schemas — not just the routes the
 * editor reaches — finds exactly two labels this rule would make WORSE: Core's `sol_loc`
 * (title "SolarCollectorLoopLocation" -> "Sol Loc") and `temp_setpnt_basis` (title
 * "ZoneTemperatureControlBasis" -> "Temp Setpnt Basis"), both keys whose abbreviation
 * carries less than the type name does. They are inert ONLY because both sit behind a
 * Core discriminated `oneOf` that the System walk never branch-selects, so no row exists
 * to be spoiled. Whoever teaches Core's flattening to select those branches inherits
 * both the same day; `HardcodedFieldInfo.label` is the reserved remedy, exactly as for
 * `sup_air_flw_ctrl`.
 */
export function resolveFieldLabelContent(
  propertyKey: string,
  title?: unknown,
  /**
   * Only step 1 reads it, and only to ask the unit-metadata ladder the same question the
   * adornment asks. Optional because the System walk has no element type to give — its
   * rows fall to the ladder's bare-key arm, which is where every `_mm` unit is recorded
   * anyway.
   */
  elementType?: string,
): string {
  const override = labelOverrideFor(propertyKey);
  if (override) return override;
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (trimmed && titleIsAdmissible(propertyKey, trimmed)) {
    return applyLabelSpellings(trimmed);
  }
  return applyLabelSpellings(
    stripKeyDerivedUnitSuffix(startCaseKey(propertyKey), propertyKey, elementType),
  );
}
