// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Canonical, host-independent Geometry CSV to HEM model transformation.
//!
//! Hosts supply CSV, schema, defaults, selected profile and upstream version
//! metadata as content. This crate performs no workspace lookup and exposes no
//! calculation, batch, SAP/RdSAP, detailed-solver, telemetry or product runtime.

pub mod builder;
pub mod error {
    pub use vulcan_csv_codec::error::*;
}
pub mod parser {
    pub use vulcan_csv_codec::parser::*;
}
mod epc_mappings;
pub mod epc_products;
pub mod finalization;
pub mod preflight_diagnostics;
mod schema_validation;
mod target_mappings;
pub use builder::add_builtin_energy_supplies;
pub use target_mappings::map_target_unobstructed_shading;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelProfile {
    Core,
    Fhs,
    /// HEM:EPC full input (new build), validated against the HEM:EPC Orchestrator input
    /// schema (`data/schemas/hem_epc_orchestrator_input.schema.json`, Orchestrator 0.13.2a0).
    Epc,
}

/// Each question a profile answers. Exhaustive matches only: a new profile must
/// answer every question here before the crate compiles. EPC evidence cites the
/// vendored Orchestrator schema (`$defs/...`) and the EPC wrapper 0.13.2 source.
impl ModelProfile {
    /// Input runs through a wrapper (FHS or EPC), so the request must carry that
    /// wrapper's version. EPC: the Orchestrator runs EPC wrapper 0.13.2.
    pub fn requires_wrapper_version(self) -> bool {
        match self {
            Self::Core => false,
            Self::Fhs | Self::Epc => true,
        }
    }

    /// Merged JSON must also parse as the HEM engine's own `Input` (E049).
    /// EPC: the input is wrapper input for Core 2.0, not the pinned engine's `Input`.
    pub(crate) fn parses_as_core_engine_input(self) -> bool {
        match self {
            Self::Core => true,
            Self::Fhs | Self::Epc => false,
        }
    }

    /// CSV zones are consolidated into the first. FHS: the input schema allows one zone.
    /// EPC: true, but nothing is ever merged: several zones are rejected before consolidation
    /// (`rejects_several_zones`), so with its one zone this only sends every wet emitter to
    /// that zone, as for FHS.
    pub(crate) fn consolidates_to_single_zone(self) -> bool {
        match self {
            Self::Core => false,
            Self::Fhs | Self::Epc => true,
        }
    }

    /// Several CSV zones are an error naming them, never merged. EPC: `Zone` is a map, but a
    /// model with more than one heated zone needs `ZoneProcessingOrder` (EPC wrapper
    /// `models/input.py`), which has no Vulcan source yet.
    pub(crate) fn rejects_several_zones(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// Zones carry `livingroom_area` + `restofdwelling_area` and no `area`, `height`
    /// or `temp_setpnt_init`. EPC: `$defs/Zone` requires both areas and has no `area`.
    pub(crate) fn zone_uses_living_and_rest_areas(self) -> bool {
        match self {
            Self::Core => false,
            Self::Fhs | Self::Epc => true,
        }
    }

    /// A transparent element with no positive `area` gets width × height as its area.
    /// EPC: `$defs/BuildingElementTransparent` has no `area`.
    pub(crate) fn derives_transparent_area_from_dimensions(self) -> bool {
        match self {
            Self::Core => true,
            Self::Fhs | Self::Epc => false,
        }
    }

    /// `orientation360` and `pitch` must be integers. EPC differs from FHS: every
    /// EPC `orientation360` and `pitch` is `"type": "number"`.
    pub(crate) fn requires_integer_orientation_and_pitch(self) -> bool {
        match self {
            Self::Core | Self::Epc => false,
            Self::Fhs => true,
        }
    }

    /// Hot-water source and wet heat plant come only from authored `Systems` rows,
    /// never from defaults-template entries. This also repoints a hot-water source's
    /// missing wet heat source reference to the first wet heat source. EPC: every
    /// system needs a HEM Database product, which a template entry cannot carry.
    pub(crate) fn requires_authored_heating_systems(self) -> bool {
        match self {
            Self::Core => false,
            Self::Fhs | Self::Epc => true,
        }
    }

    /// Output takes the wrapper family's shared field shapes: `metadata.hem_core_version`,
    /// the cold-water source chosen in CSV Metadata, the enum `test_pressure`, and
    /// wrapper cleanup of Core-only root keys, building elements and energy supplies.
    /// EPC: `$defs/Metadata`, `$defs/TestPressure`, no root `SimulationTime`/`InternalGains`/`Control`.
    pub(crate) fn uses_wrapper_field_shapes(self) -> bool {
        match self {
            Self::Core => false,
            Self::Fhs | Self::Epc => true,
        }
    }

    /// Root `ColdWaterSource` is an object keyed by the source name (`{"mains water": {}}`).
    /// EPC differs: `$defs/ColdWaterSource` is the bare string enum.
    pub(crate) fn keys_cold_water_source_by_name(self) -> bool {
        match self {
            Self::Core | Self::Fhs => true,
            Self::Epc => false,
        }
    }

    /// Every wet heat source states `is_heat_network` (false unless authored).
    /// EPC differs: only its HIU and DirectFeed definitions declare it, and require it, so it
    /// is authored on those systems and never inserted.
    pub(crate) fn wet_heat_sources_state_is_heat_network(self) -> bool {
        match self {
            Self::Core | Self::Epc => false,
            Self::Fhs => true,
        }
    }

    /// `InfiltrationVentilation.cross_vent_possible` is kept. FHS removes it; EPC differs:
    /// its InfiltrationVentilation requires it.
    pub(crate) fn keeps_cross_vent_possible(self) -> bool {
        match self {
            Self::Core | Self::Epc => true,
            Self::Fhs => false,
        }
    }

    /// Root booleans whose absent Metadata row means `false` (the Geometry CSV contract).
    /// EPC differs: it has neither FHS field, and its own root booleans
    /// (`IsExistingBuilding`, `HasElectricitySmartMeter`) come from Metadata or the
    /// target's defaults, never from a code constant.
    pub(crate) fn implicit_false_root_booleans(self) -> &'static [&'static str] {
        match self {
            Self::Core | Self::Epc => &[],
            Self::Fhs => &[
                "KitchenExtractorHoodExternal",
                "PartO_active_cooling_required",
            ],
        }
    }

    /// `General.build_type` is the built form (`detached`, `semi_detached_end_terrace`,
    /// `mid_terrace`, ...), derived from party walls unless Metadata states a schema value.
    /// EPC differs: `$defs/BuildType` replaces the FHS `house`/`flat`.
    pub(crate) fn derives_build_type_from_party_walls(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// A PV system lists its arrays in `panels[]`; inverter fields stay on the system.
    /// EPC differs: `$defs/PhotovoltaicSystemWithPanels`.
    pub(crate) fn lists_pv_panels(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// Opaque elements state `solar_absorption_coeff`, not `colour`. EPC differs:
    /// `$defs/BuildingElementOpaque` requires the coefficient and has no `colour`.
    pub(crate) fn uses_solar_absorption_coeff(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// Appliances are presence flags (`has_dryer`, `has_dishwasher`,
    /// `has_separate_fridge_or_freezer`) plus `Oven` and `Hobs` with an energy supply.
    /// EPC differs: `$defs/Appliances`, `$defs/CookingAppliance`.
    pub(crate) fn states_appliance_presence(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// A cylinder's wet coil states `primary_flow_rate` and `heat_transfer_rate_W_per_K`,
    /// and its thermostat sits in `tank_controls`. EPC differs:
    /// `$defs/epc_wrapper__models__hot_water__TankHeatSourceWetServiceWaterRegular`, `$defs/TankControl`.
    pub(crate) fn states_cylinder_coil_and_tank_controls(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// Systems reference HEM Database products (`product_id`), resolved from
    /// `TransformRequest::product_data` (`epc_products`). EPC differs: 46 schema definitions require
    /// `product_id`; the Orchestrator substitutes each product record before the wrapper runs.
    pub(crate) fn references_products(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// Metadata rows the model must state: an absent row is an error, never the template's
    /// value. EPC differs: DESNZ marks these inputs required.
    pub(crate) fn required_metadata_rows(self) -> &'static [&'static str] {
        match self {
            Self::Core | Self::Fhs => &[],
            Self::Epc => &[
                "PartGcompliance",
                "HasElectricitySmartMeter",
                "NumberOfBedrooms",
                "NumberOfWetRooms",
                "HeatingControlType",
                "IsExistingBuilding",
                "ColdWaterSource",
                "Ventilation_cross_vent_possible",
                "Ventilation_altitude",
                "Ventilation_shield_class",
                "Ventilation_terrain_class",
                "Ventilation_noise_nuisance",
                "AirPermeability_test_pressure",
                "AirPermeability_test_result",
                "AirPermeability_ventilation_zone_height",
            ],
        }
    }

    /// A zone row may state `frac_convective_heating`. EPC differs: the wrapper's zone model
    /// requires it for a heated zone.
    pub(crate) fn states_zone_convective_fraction(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// A battery keeps an authored `grid_charging_possible`. FHS and Core strip it as a legacy
    /// field their schemas lack. EPC differs: its battery requires it.
    pub(crate) fn keeps_battery_grid_charging(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }

    /// A party wall states `party_wall_lining_type` exactly when its cavity type takes one.
    /// EPC differs: HEM Core 2.0.0a4 `BuildingElementPartyWall.validate_party_wall_lining_type`
    /// (pydantic) rejects a lining type on any other cavity, which the JSON schema allows.
    pub(crate) fn checks_party_wall_lining(self) -> bool {
        match self {
            Self::Core | Self::Fhs => false,
            Self::Epc => true,
        }
    }
}

/// Explicit converter contract; release labels never select translation rules implicitly.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversionProfile {
    #[default]
    CurrentRustFhs,
    PythonFhsA9,
    PythonFhsA8,
    DividedOpeningHalfPartitionV1,
    PhysicalOpeningFullPartitionV1,
    #[serde(rename = "physical_opening_full_partition_party_wall_u_v1")]
    PhysicalOpeningFullPartitionPartyWallUV1,
    /// HEM:EPC full input as the Orchestrator 0.13.2a0 schema defines it.
    EpcFullInputV1,
}

/// Input meaning, independent of the implementation language and release label.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ElementInputConvention {
    DividedOpeningHalfPartition,
    PhysicalOpeningFullPartition,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct InputContract {
    pub elements: ElementInputConvention,
    pub party_wall_requires_whole_u: bool,
    pub requires_main_hot_water_source: bool,
    pub requires_detailed_thermal_bridges: bool,
    pub uses_exact_empty_shading_sectors: bool,
    /// Pinned Python core meters fan-coil power through the wet system's own `EnergySupply` and
    /// crashes when it is absent.
    pub fan_coil_needs_energy_supply: bool,
    /// Pinned Python core reads an extract fan's exhaust position only from the flat fields.
    pub fan_reads_flat_exhaust_position: bool,
    /// Rust a7's schema rejects Appliances that name neither Fridge nor Fridge-Freezer.
    pub schema_needs_named_cold_appliance: bool,
}

impl ConversionProfile {
    /// Compatibility boundary for published preparation artifacts. New profiles
    /// describe the same contracts without tying them to a language or release.
    pub(crate) fn input_contract(self) -> InputContract {
        let (physical_openings, whole_u, detailed_bridges) = match self {
            Self::CurrentRustFhs | Self::DividedOpeningHalfPartitionV1 => (false, false, false),
            Self::PythonFhsA8 | Self::PhysicalOpeningFullPartitionV1 => (true, false, true),
            Self::PythonFhsA9 | Self::PhysicalOpeningFullPartitionPartyWallUV1 => {
                (true, true, false)
            }
            // `window_part_list` is required and party walls take only
            // `thermal_resistance_construction` (no `u_value_whole_wall`).
            Self::EpcFullInputV1 => (true, false, false),
        };
        InputContract {
            elements: if physical_openings {
                ElementInputConvention::PhysicalOpeningFullPartition
            } else {
                ElementInputConvention::DividedOpeningHalfPartition
            },
            party_wall_requires_whole_u: whole_u,
            requires_main_hot_water_source: physical_openings,
            requires_detailed_thermal_bridges: detailed_bridges,
            uses_exact_empty_shading_sectors: physical_openings,
            fan_coil_needs_energy_supply: physical_openings,
            fan_reads_flat_exhaust_position: physical_openings,
            schema_needs_named_cold_appliance: !physical_openings,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionMetadata {
    pub hem_core_version: String,
    /// Version of the wrapper the input runs through (FHS or EPC).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrapper_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformRequest {
    pub csv: String,
    pub schema_json: String,
    pub defaults_json: String,
    pub profile: ModelProfile,
    #[serde(default)]
    pub conversion_profile: ConversionProfile,
    pub version_metadata: VersionMetadata,
    /// The HEM Database product CSVs the target pins, keyed by file name (for example
    /// `ProductIdentification.csv`). The host passes its target's verified bytes; a profile
    /// that references products fails without them. Ignored by every other profile.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub product_data: epc_products::ProductData,
}

/// Where a slot's product came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProductSource {
    /// Picked by the user: on the element, or by a model setting.
    Product,
    /// Chosen by a rule on this conversion; never stored on the element.
    Default,
}

/// A system that needs a HEM Database product, as the converted model holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProductSlot {
    /// Model path of the system object in the converted model.
    pub path: String,
    /// The system's own type (`type`, `wet_emitter_type` or `vent_type`).
    pub system_type: String,
    /// The product the slot carries, if any. None means the model is invalid.
    pub product_id: Option<u64>,
    pub source: ProductSource,
    /// The product's brand, model name and qualifier.
    pub label: Option<String>,
    /// How the product was chosen, or what the user must pick.
    pub rule: String,
    /// The HEM Database technology types this slot accepts.
    pub technology_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformOutput {
    pub model: Value,
    pub validation: ValidationResult,
    pub schema_omissions: Vec<finalization::SchemaOmission>,
    pub version_metadata: VersionMetadata,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub product_slots: Vec<ProductSlot>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub code: String,
    pub path: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyword: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ValidationResult {
    pub errors: Vec<ValidationError>,
    pub is_valid: bool,
}

#[derive(thiserror::Error, Debug)]
pub enum TransformError {
    // Each message is a full sentence for the user, so it carries no outer frame.
    #[error("{0}")]
    InvalidRequest(String),
    #[error("CSV parsing failed: {0}")]
    Csv(String),
    #[error("JSON building failed: {0}")]
    Build(builder::BuildError),
    #[error("Schema/defaults error: {0}")]
    Schema(String),
}

/// Clone a merged product model for validation by the unchanged HEM/FHS contracts.
pub fn clone_for_hem_validation(model: &Value) -> Value {
    let mut validation_model = model.clone();
    if let Some(general) = validation_model
        .get_mut("General")
        .and_then(Value::as_object_mut)
    {
        general.remove("built_form");
    }
    validation_model
}

/// Merge caller-supplied Geometry CSV and defaults into a HEM model, then
/// validate the HEM/FHS projection against the caller-supplied schema.
pub fn transform_geometry_csv(
    request: TransformRequest,
) -> Result<TransformOutput, TransformError> {
    validate_request(&request)?;

    let mut parser = parser::CSVParser::new();
    let csv_data = parser
        .parse_csv(&request.csv)
        .map_err(|error| TransformError::Csv(error.to_string()))?;

    let mut builder = builder::JSONBuilder::from_json_inputs(
        &request.schema_json,
        &request.defaults_json,
        request.profile,
        &request.version_metadata,
    )
    .map_err(|error| TransformError::Schema(error.to_string()))?;
    builder.set_conversion_profile(request.conversion_profile);
    if request.profile.references_products() {
        if request.product_data.is_empty() {
            return Err(TransformError::InvalidRequest("This target references HEM Database products, but the request has no product data. Prepare the model through its pinned target.".into()));
        }
        builder.set_product_database(
            epc_products::ProductDatabase::parse(&request.product_data)
                .map_err(TransformError::InvalidRequest)?,
        );
    }
    let model = builder
        .build_json(&csv_data)
        .map_err(TransformError::Build)?;

    let mut schema_omissions = builder.take_schema_omissions();
    let schema: Value = serde_json::from_str(&request.schema_json)
        .map_err(|error| TransformError::Schema(error.to_string()))?;
    let finalized =
        finalization::finalize_model(&model, &schema).map_err(TransformError::Schema)?;
    schema_omissions.extend(finalized.omissions);
    let model = finalized.model;
    let mut errors = builder.take_non_fatal_errors();
    let validation_model = clone_for_hem_validation(&model);
    let mut schema_errors = finalized.validation.errors;
    builder.name_csv_rows(&mut schema_errors);
    // An EPC mapping error (`E_EPC_*`) explains a value it left out on purpose; the schema's
    // "required" error for the same field would only repeat it. Other converter errors keep
    // their schema errors, so FHS and Core validation is unchanged.
    schema_errors.retain(|schema_error| {
        let missing = (schema_error.keyword.as_deref() == Some("required"))
            .then(|| schema_error.message.split('"').nth(1))
            .flatten()
            .map(|field| json_pointer_child(&schema_error.path, field));
        !errors
            .iter()
            .any(|error| error.code.starts_with("E_EPC_") && Some(&error.path) == missing.as_ref())
    });
    errors.extend(schema_errors);
    errors.extend(validate_target_input(
        &model,
        request.conversion_profile,
        &request.version_metadata,
    ));
    let validation = ValidationResult {
        is_valid: errors.is_empty(),
        errors,
    };

    enforce_pure_hem_input(&builder, &validation_model, &validation, request.profile)?;

    Ok(TransformOutput {
        model,
        validation,
        schema_omissions,
        version_metadata: request.version_metadata,
        product_slots: builder.take_product_slots(),
    })
}

/// Source-verified wrapper readiness beyond a release's JSON schema. Diagnose
/// missing main hot-water sources and a8 scalar bridges without inventing facts
/// or silently renaming authored systems.
pub fn validate_target_input(
    model: &Value,
    profile: ConversionProfile,
    version: &VersionMetadata,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let contract = profile.input_contract();
    let hem = format!("HEM {}", version.hem_core_version);
    if contract.requires_main_hot_water_source
        && model
            .get("HotWaterSource")
            .and_then(Value::as_object)
            .is_some_and(|sources| !sources.contains_key("hw cylinder"))
    {
        // Both FHS schemas declare only this main-source key (including
        // PointOfUse). Notional edit_storagetank indexes it unconditionally;
        // an empty schema-valid object is not a usable hot-water source.
        errors.push(ValidationError {
            code: "E_PYTHON_FHS_HOT_WATER_SOURCE".into(),
            path: "/HotWaterSource/hw cylinder".into(),
            message: format!("{hem} requires the main hot-water source under 'hw cylinder', including point-of-use systems. Supply a compatible main source; unsupported names are preserved in the authored CSV and are not renamed automatically."),
            schema_path: None, keyword: None,
        });
    }
    if contract.requires_detailed_thermal_bridges {
        if let Some(zones) = model.get("Zone").and_then(Value::as_object) {
            for (name, zone) in zones {
                if zone.get("ThermalBridging").is_some_and(Value::is_number) {
                    errors.push(ValidationError {
                        code: "E_A8_THERMAL_BRIDGING".into(),
                        path: json_pointer(&["Zone", name, "ThermalBridging"]),
                        message: format!("{hem} requires detailed thermal-bridge records during wrapper preprocessing, even though its schema accepts a single total. Supply the actual bridge records; a total cannot be expanded without evidence."),
                        schema_path: None, keyword: None,
                    });
                }
            }
        }
    }
    errors
}

fn json_pointer_child(path: &str, key: &str) -> String {
    format!("{path}{}", json_pointer(&[key]))
}

/// RFC 6901 pointer from raw segments (names may contain '/' or '~').
pub(crate) fn json_pointer(segments: &[&str]) -> String {
    segments
        .iter()
        .map(|segment| format!("/{}", segment.replace('~', "~0").replace('/', "~1")))
        .collect()
}

fn validate_request(request: &TransformRequest) -> Result<(), TransformError> {
    if (request.profile == ModelProfile::Epc)
        != (request.conversion_profile == ConversionProfile::EpcFullInputV1)
    {
        return Err(TransformError::InvalidRequest(
            "The EPC model profile and the EPC full-input conversion profile are used together."
                .into(),
        ));
    }
    if request.conversion_profile.input_contract().elements
        == ElementInputConvention::PhysicalOpeningFullPartition
        && !request.profile.requires_wrapper_version()
    {
        return Err(TransformError::InvalidRequest(
            "Physical-opening/full-partition conversion requires a wrapper profile (FHS or EPC)."
                .into(),
        ));
    }
    let required_python_version = match request.conversion_profile {
        ConversionProfile::PythonFhsA8 => Some("1.0.0a8"),
        ConversionProfile::PythonFhsA9 => Some("1.0.0a9"),
        ConversionProfile::CurrentRustFhs
        | ConversionProfile::DividedOpeningHalfPartitionV1
        | ConversionProfile::PhysicalOpeningFullPartitionV1
        | ConversionProfile::PhysicalOpeningFullPartitionPartyWallUV1
        | ConversionProfile::EpcFullInputV1 => None,
    };
    if let Some(version) = required_python_version {
        if request.version_metadata.hem_core_version != version
            || request.version_metadata.wrapper_version.as_deref() != Some(version)
        {
            return Err(TransformError::InvalidRequest(format!("The selected Python conversion profile requires matching core and wrapper {version} metadata.")));
        }
    }
    let mut missing = Vec::new();
    if request.csv.trim().is_empty() {
        missing.push("CSV");
    }
    if request.schema_json.trim().is_empty() {
        missing.push("schema JSON");
    }
    if request.defaults_json.trim().is_empty() {
        missing.push("defaults JSON");
    }
    if request.version_metadata.hem_core_version.trim().is_empty() {
        missing.push("HEM core version");
    }
    if request.profile.requires_wrapper_version()
        && request
            .version_metadata
            .wrapper_version
            .as_deref()
            .map(str::trim)
            .is_none_or(str::is_empty)
    {
        missing.push("wrapper version");
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(TransformError::InvalidRequest(format!(
            "The transform request has no {}.",
            missing.join(", ")
        )))
    }
}

fn enforce_pure_hem_input(
    builder: &builder::JSONBuilder,
    json: &Value,
    validation: &ValidationResult,
    profile: ModelProfile,
) -> Result<(), TransformError> {
    let unknown_property_errors: Vec<ValidationError> = validation
        .errors
        .iter()
        .filter(|error| {
            matches!(
                error.keyword.as_deref(),
                Some("unevaluatedProperties") | Some("additionalProperties")
            )
        })
        .filter(|error| {
            // Only a concrete schema error explains an unknown property; converter
            // errors (no keyword) must not soften the pure-HEM-input gate.
            !validation.errors.iter().any(|other| {
                other.keyword.is_some()
                    && !matches!(
                        other.keyword.as_deref(),
                        Some("unevaluatedProperties") | Some("additionalProperties")
                    )
                    && (other.path == error.path
                        || other.path.starts_with(&format!("{}/", error.path)))
            })
        })
        .cloned()
        .collect();
    if !unknown_property_errors.is_empty() {
        let details: Vec<String> = unknown_property_errors
            .iter()
            .map(|error| format!("{}: {}", error.path, error.message))
            .collect();
        return Err(TransformError::Build(
            builder::BuildError::with_validation_errors(
                "E047",
                &format!(
                    "Merged JSON contains keys not in the HEM schema — {}. The dwelling model JSON must contain only HEM inputs; UI-only data belongs in the geometry CSV.",
                    details.join("; ")
                ),
                unknown_property_errors,
            ),
        ));
    }

    let allowed_root = builder.schema_root_property_names();
    if !allowed_root.is_empty() {
        if let Some(object) = json.as_object() {
            let unknown_root: BTreeSet<&String> = object
                .keys()
                .filter(|key| !allowed_root.contains(*key))
                .collect();
            if !unknown_root.is_empty() {
                let keys: Vec<String> = unknown_root.iter().map(|key| (*key).clone()).collect();
                return Err(TransformError::Build(builder::BuildError::new(
                    "E048",
                    &format!(
                        "Merged JSON contains top-level keys not in the HEM schema: {}. The dwelling model JSON must contain only HEM inputs.",
                        keys.join(", ")
                    ),
                )));
            }
        }
    }

    if profile.parses_as_core_engine_input() {
        if let Err(error) = serde_json::from_value::<hem_upstream::input::Input>(json.clone()) {
            let message = error.to_string();
            if message.contains("unknown field") {
                return Err(TransformError::Build(builder::BuildError::new(
                    "E049",
                    &format!("Merged JSON rejected by the HEM engine input parser: {message}"),
                )));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
#[macro_export]
macro_rules! include_fhs_upstream_schema_json {
    () => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../data/schemas/input_fhs.schema.json"
        ))
    };
}

#[cfg(test)]
pub(crate) mod schema_paths {
    pub const CORE_UPSTREAM_SCHEMA_REL_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../data/schemas/core-input.schema.json"
    );
    pub const FHS_UPSTREAM_SCHEMA_REL_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../data/schemas/input_fhs.schema.json"
    );
}
