// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEM Database products for HEM:EPC full input. The host passes the product CSVs its target
//! pins (`TransformRequest::product_data`, already checked against the target's
//! `productDataSha256`); the converter reads them here and never holds a copy of its own.

use crate::finalization::SchemaOmission;
use crate::{json_pointer, ProductSlot, ProductSource, ValidationError};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

pub type ProductData = BTreeMap<String, String>;

type Row = BTreeMap<String, String>;

/// One `ProductIdentification` row joined to its technology table row and that row's
/// child rows (test data, sub heat networks, a room heater's back boiler).
#[derive(Debug, Clone)]
pub struct Product {
    pub id: u64,
    /// `ProductIdentification.technologyType`, for example "Column Radiator".
    pub technology_type: String,
    /// Brand, model name and qualifier, as an assessor would recognise the product.
    pub label: String,
    /// The technology table (CSV file stem) holding the product's data: its product class.
    /// Empty for a listed product with no data row (four electric room heaters in 1.0.0a10).
    pub table: String,
    pub fields: Row,
    pub children: Vec<Row>,
}

impl Product {
    /// True when the product's own row, or one of its child rows, has `field` equal to `value`.
    pub fn has(&self, field: &str, value: &str) -> bool {
        self.fields.get(field).map(String::as_str) == Some(value)
            || self
                .children
                .iter()
                .any(|row| row.get(field).map(String::as_str) == Some(value))
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProductDatabase {
    pub products: BTreeMap<u64, Product>,
    /// `WeatherCompensationCurve` IDs and their gradients.
    pub weather_curves: BTreeMap<u64, f64>,
}

/// Tables of reference values with no product rows.
const REFERENCE_TABLES: &[&str] = &[
    "BoilerDefaults",
    "HeatPumpSingleValueDefaults",
    "HeatingControlRequirements",
    "HemDatabaseVersion",
    "HotWaterOnlyInUseFactors",
    "MVInUseFactors",
    "Manufacturer",
    "WeatherCompensationCurve",
];

/// The data has no escaped quotes and no line breaks inside a field.
fn split_line(line: &str) -> Vec<String> {
    let mut cells = vec![String::new()];
    let mut quoted = false;
    for c in line.chars() {
        match c {
            '"' => quoted = !quoted,
            ',' if !quoted => cells.push(String::new()),
            _ => cells.last_mut().unwrap().push(c),
        }
    }
    cells
}

fn rows(text: &str) -> Vec<Row> {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    // `WarmAirElectric.csv` prefixes each header with its table name.
    let header: Vec<String> = lines
        .next()
        .map(split_line)
        .unwrap_or_default()
        .into_iter()
        .map(|h| h.rsplit('.').next().unwrap_or_default().to_string())
        .collect();
    lines
        .map(|line| header.iter().cloned().zip(split_line(line)).collect())
        .collect()
}

impl ProductDatabase {
    pub fn parse(files: &ProductData) -> Result<Self, String> {
        let table = |name: &str| {
            files
                .get(&format!("{name}.csv"))
                .map(|text| rows(text))
                .ok_or_else(|| format!("The product data has no {name}.csv."))
        };
        let mut products = BTreeMap::new();
        for row in table("ProductIdentification")? {
            let id = row["ID"].parse::<u64>().map_err(|_| {
                format!("ProductIdentification ID '{}' is not a number.", row["ID"])
            })?;
            let label = [&row["brandName"], &row["modelName"], &row["modelQualifier"]]
                .into_iter()
                .filter(|v| !v.is_empty() && v.as_str() != "NULL")
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");
            products.insert(
                id,
                Product {
                    id,
                    technology_type: row["technologyType"].clone(),
                    label,
                    table: String::new(),
                    fields: Row::new(),
                    children: Vec::new(),
                },
            );
        }
        for (file, text) in files {
            let name = file.trim_end_matches(".csv");
            if name == "ProductIdentification" || REFERENCE_TABLES.contains(&name) {
                continue;
            }
            // A back boiler row extends the room heater product it is fitted to.
            let child =
                name.ends_with("TestData") || ["SubheatNetworks", "BackBoiler"].contains(&name);
            for row in rows(text) {
                let id = row.get("productID").and_then(|v| v.parse::<u64>().ok());
                // A heat network is identified by its own table; ProductIdentification omits it.
                if let (Some(id), "HeatNetworks") = (id, name) {
                    products.entry(id).or_insert_with(|| Product {
                        id,
                        technology_type: "Heat Network".into(),
                        label: row["communityHeatNetworkName"].clone(),
                        table: String::new(),
                        fields: Row::new(),
                        children: Vec::new(),
                    });
                }
                let product = id.and_then(|id| products.get_mut(&id)).ok_or_else(|| {
                    format!(
                        "{file} names product {id:?}, which ProductIdentification does not list."
                    )
                })?;
                if child {
                    product.children.push(row);
                } else if product.table.is_empty() {
                    product.table = name.to_string();
                    product.fields = row;
                } else {
                    return Err(format!(
                        "Product {} has rows in {} and {name}.",
                        product.id, product.table
                    ));
                }
            }
        }
        let weather_curves = table("WeatherCompensationCurve")?
            .into_iter()
            .filter_map(|row| Some((row["ID"].parse().ok()?, row["Gradient"].parse().ok()?)))
            .collect();
        Ok(Self {
            products,
            weather_curves,
        })
    }

    pub fn in_table<'a>(&'a self, table: &'a str) -> impl Iterator<Item = &'a Product> + 'a {
        self.products.values().filter(move |p| p.table == table)
    }
}

// ---------------------------------------------------------------------------------------------
// Resolver: which product each system that needs one carries.
//
// Order: a product picked on the element (`product_id` in its row's `extra_json`), then a
// model setting (radiators and UFH only), then an automatic rule. An automatic rule exists
// only where DESNZ defines the default or the pinned data holds a single product for the
// type; every other system fails until the user picks. Each rule carries a one-line marking.

/// Model settings: CSV Metadata rows. Never HEM input, never code constants.
pub(crate) const RADIATOR_SETTING: &str = "Product_radiator";
pub(crate) const UFH_SETTING: &str = "Product_ufh";
pub(crate) const RADIATOR_LENGTH_SETTING: &str = "Product_radiator_length";

/// Radiator length descriptors and lengths (m). DESNZ-defined (EPC 06, 6.3.2.1); medium is
/// DESNZ's default descriptor.
const RADIATOR_LENGTHS: [(&str, f64); 3] = [("small", 0.6), ("medium", 0.9), ("large", 1.2)];

#[derive(Debug, Default, Clone)]
pub(crate) struct Settings {
    pub radiator: Option<u64>,
    pub ufh: Option<u64>,
    /// The stated descriptor; None uses DESNZ's default, medium.
    pub radiator_length: Option<&'static str>,
}

impl Settings {
    /// Reads the settings from Metadata values (`value(name)`); a value that is not one is an
    /// error naming the row.
    pub(crate) fn read(
        value: impl Fn(&str) -> Option<Value>,
        errors: &mut Vec<ValidationError>,
    ) -> Self {
        let text = |name: &str| {
            value(name).map(|v| match v {
                Value::String(s) => s.trim().to_string(),
                other => other.to_string(),
            })
        };
        let mut id = |name: &str| {
            let raw = text(name)?;
            let parsed = raw.parse::<u64>().ok();
            if parsed.is_none() {
                errors.push(error(
                    "E_PRODUCT_SETTING",
                    "/Metadata".into(),
                    format!("Metadata row '{name}' is '{raw}'. Enter a HEM Database product ID."),
                ));
            }
            parsed
        };
        let radiator = id(RADIATOR_SETTING);
        let ufh = id(UFH_SETTING);
        let radiator_length = text(RADIATOR_LENGTH_SETTING).and_then(|raw| {
            let found = RADIATOR_LENGTHS.iter().find(|(name, _)| name.eq_ignore_ascii_case(&raw));
            if found.is_none() {
                errors.push(error("E_PRODUCT_SETTING", "/Metadata".into(), format!("Metadata row '{RADIATOR_LENGTH_SETTING}' is '{raw}'. Enter small, medium or large.")));
            }
            found.map(|(name, _)| *name)
        });
        Self {
            radiator,
            ufh,
            radiator_length,
        }
    }
}

impl Settings {
    /// A radiator with no drawn length: DESNZ's length for the model's descriptor (medium
    /// unless the setting states one), times its unit count, and the notice saying so.
    pub(crate) fn radiator_length(&self, row: &str, units: f64) -> (f64, SchemaOmission) {
        let descriptor = self.radiator_length.unwrap_or("medium");
        let length = RADIATOR_LENGTHS
            .iter()
            .find(|(d, _)| *d == descriptor)
            .unwrap()
            .1;
        let source = if self.radiator_length.is_some() {
            format!("Metadata row {RADIATOR_LENGTH_SETTING}")
        } else {
            format!("the default descriptor; set the Metadata row {RADIATOR_LENGTH_SETTING} to small, medium or large")
        };
        let each = if units > 1.0 {
            format!(" per unit, {} m for {units} units", length * units)
        } else {
            String::new()
        };
        let message = format!("Wet Emitters row '{row}' has no drawn length, so it uses {length} m{each}, DESNZ's length for a {descriptor} radiator ({source}).");
        (
            length * units,
            notice(&json_pointer(&["Wet Emitters", row, "length"]), message),
        )
    }
}

fn error(code: &str, path: String, message: String) -> ValidationError {
    ValidationError {
        code: code.into(),
        path,
        message,
        schema_path: None,
        keyword: None,
    }
}

fn notice(path: &str, message: String) -> SchemaOmission {
    SchemaOmission {
        code: crate::target_mappings::TARGET_INPUT_WARNING.into(),
        path: path.into(),
        message,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Rule {
    /// The one product of `table` that has `filter`.
    Auto {
        table: &'static str,
        filter: Option<(&'static str, String)>,
    },
    /// The user picks a product of one of `tables`; `ask` says what. `filter` narrows the
    /// products the message lists; `setting` names the model setting that can pick once.
    Pick {
        tables: &'static [&'static str],
        filter: Option<(&'static str, String)>,
        ask: String,
        setting: Option<&'static str>,
    },
}

const HEAT_PUMP_TABLES: &[&str] = &[
    "AirSourceHeatPump",
    "GroundSourceHeatPump",
    "WaterSourceHeatPump",
    "ExhaustAirMevHeatPump",
    "ExhaustAirMvhrHeatPump",
    "ExhaustAirMixedHeatPump",
    "HybridHeatPump",
    "BoosterHeatPump",
];

fn auto(table: &'static str) -> Option<Rule> {
    Some(Rule::Auto {
        table,
        filter: None,
    })
}

fn pick(tables: &'static [&'static str], ask: impl Into<String>) -> Option<Rule> {
    Some(Rule::Pick {
        tables,
        filter: None,
        ask: ask.into(),
        setting: None,
    })
}

/// A system type Vulcan has no row type for: it fails, naming the system, unless picked.
fn no_row_type(tables: &'static [&'static str], what: &str) -> Option<Rule> {
    pick(
        tables,
        format!(
            "Vulcan has no {what} system yet, so there is no default; pick its product on the row"
        ),
    )
}

fn text<'a>(system: &'a Map<String, Value>, field: &str) -> &'a str {
    system
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
}

/// The rule for one product slot: `pattern` is the `PRODUCT_SLOTS` path, `kind` the system's
/// discriminator value, `name` its key in the model. None: no rule (a gap the coverage test
/// rejects).
pub(crate) fn rule(
    pattern: &str,
    kind: &str,
    name: &str,
    system: &Map<String, Value>,
    model: &Value,
) -> Option<Rule> {
    match (pattern, kind) {
        // Our interpretation would be needed to tell condensing from non-condensing, so the
        // user picks (question to Baz). The candidates listed follow the model's own facts.
        ("HeatSourceWet/*", "Boiler") => {
            let combi = model["HotWaterSource"].as_object().into_iter().flatten().any(|(_, source)| {
                source["type"] == "CombiBoiler" && source["HeatSourceWet"] == name
            });
            let fuel = model["EnergySupply"][text(system, "EnergySupply")]["fuel"]
                .as_str()
                .map(|fuel| if fuel.starts_with("LPG") { "LPG_bulk" } else { fuel })
                .unwrap_or_default()
                .to_string();
            Some(Rule::Pick {
                tables: if combi { &["CombiBoiler"] } else { &["RegularBoiler"] },
                ask: format!("pick the {} boiler product, condensing or non-condensing", if combi { "combi" } else { "regular" }),
                filter: Some(("fuel", fuel)),
                setting: None,
            })
        }
        ("HeatSourceWet/*", "BackBoiler") => no_row_type(&["RoomHeater"], "back boiler"),
        ("HeatSourceWet/*", "DirectElectricBoiler") => no_row_type(&["ElectricBoiler"], "electric boiler"),
        ("HeatSourceWet/*", "SolidFuelBoiler") => no_row_type(&["SolidFuelBoiler"], "solid-fuel boiler"),
        ("HeatSourceWet/*", "PrimaryThermalStore") => no_row_type(&["PrimaryThermalStore"], "primary thermal store"),
        // Single product for the type (DESNZ also names it, EPC 06, 6.2.3.1).
        ("HeatSourceWet/*", "HIU") => auto("HeatInterfaceUnit"),
        // Single product for each battery type.
        ("HeatSourceWet/*", "HeatBattery") => match text(system, "battery_type") {
            "dry_core" => auto("HeatBatteryDryCore"),
            "pcm" => auto("HeatBatteryPCM"),
            _ => pick(&["HeatBatteryDryCore", "HeatBatteryPCM"], "state the battery type, or pick the heat battery product"),
        },
        ("HeatSourceWet/*", "HeatPump") => heat_pump_rule(system),
        // DESNZ: the assessor identifies the network; there is no default.
        ("HeatSourceWet/*/EnergySupply" | "HeatSourceWet/*/EnergySupply_heat_network", _) => {
            pick(&["HeatNetworks"], "identify the heat network: enter its HEM Database ID")
        }
        // Single product for the type.
        (
            "HeatSourceWet/*/HeatSource/*"
            | "HotWaterSource/*"
            | "HotWaterSource/*/HeatSource/*"
            | "PreHeatedWaterSource/preheated tank/HeatSource/*",
            "HeatPump_HWOnly",
        ) => auto("HotWaterOnlyHeatPump"),
        // Single product for the type.
        ("HeatSourceWarmAir/*", "WarmAirCombustion") => auto("WarmAirCombustion"),
        ("HeatSourceWarmAir/*", "WarmAirElectric") => pick(&["WarmAirElectric"], "the pinned HEM Database has no electric warm-air product, so there is none to pick yet"),
        ("SpaceHeatSystem/*", "CombustionRoomHeater") => no_row_type(&["RoomHeater"], "room heater"),
        // DESNZ: the assessor selects; high heat retention or standard is a user choice and
        // capacity rounding would be our interpretation (question to Baz).
        ("SpaceHeatSystem/*", "ElecStorageHeater") => pick(&["StorageHeater"], "pick the storage heater product: high heat retention or standard, and its capacity"),
        // Single product for the type.
        ("SpaceHeatSystem/*", "InstantElecHeater") => auto("DirectElectricHeaters"),
        // DESNZ-defined (EPC 06, 6.3.2.3: the default product) and single product.
        ("SpaceHeatSystem/*/emitters/*", "fancoil") => auto("FanCoils"),
        // DESNZ: radiators are always illustrative and categorised by type and height; the
        // assessor records both, so there is no default.
        ("SpaceHeatSystem/*/emitters/*", "radiator") => Some(Rule::Pick {
            tables: &["ConvectorRadiator"],
            filter: None,
            ask: format!("pick a radiator type and height on the emitter, or once for the model with the Metadata row {RADIATOR_SETTING}"),
            setting: Some(RADIATOR_SETTING),
        }),
        // DESNZ: the assessor records the system type, floor finish and system name.
        ("SpaceHeatSystem/*/emitters/*", "ufh") => Some(Rule::Pick {
            tables: &["UnderFloorHeating"],
            filter: None,
            ask: format!("pick the underfloor heating system on the emitter, or once for the model with the Metadata row {UFH_SETTING}"),
            setting: Some(UFH_SETTING),
        }),
        // Single product for each type.
        ("InfiltrationVentilation/MechanicalVentilation/*", _) => match text(system, "vent_type") {
            "Centralised continuous MEV" => auto("CentralisedMev"),
            "Decentralised continuous MEV" => auto("DecentralisedMev"),
            "MVHR" => auto("CentralisedMvhr"),
            _ => pick(&["CentralisedMev", "DecentralisedMev", "CentralisedMvhr", "CentralisedMv"], "state the ventilation type, or pick the product"),
        },
        // Single product for the type.
        ("HotWaterSource/*", "SmartHotWaterTank") => auto("SmartHotWaterTank"),
        // DESNZ: the collector type is a required assessor input; nearest-coefficient matching
        // would be our interpretation (question to Baz).
        ("HotWaterSource/*/HeatSource/*" | "PreHeatedWaterSource/preheated tank/HeatSource/*", "SolarThermalSystem") => {
            pick(&["SolarThermal"], "pick the solar collector type")
        }
        // Single product for the type.
        ("HotWaterSource/*/flue_gas_heat_recovery", _) => auto("FlueGasHeatRecoverySystem"),
        // Single product for each system type (A, B, C), read from the showers it serves.
        ("WWHRS/*", "WWHRS_Instantaneous") => {
            let letters: std::collections::BTreeSet<&str> = model["HotWaterDemand"]["Shower"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, shower)| shower["WWHRS"] == name)
                .filter_map(|(_, shower)| shower["WWHRS_configuration"].as_str())
                .collect();
            match letters.into_iter().collect::<Vec<_>>()[..] {
                [letter] => Some(Rule::Auto {
                    table: "InstantaneousWwhrSystem",
                    filter: Some(("systemType", letter.to_string())),
                }),
                _ => pick(&["InstantaneousWwhrSystem"], "give each shower it serves one WWHRS_configuration (A, B or C), or pick the product"),
            }
        }
        // Single product for the type.
        ("EnergySupply/*/ElectricBattery" | "EnergySupply/*/ElectricBattery/*", _) => auto("ElectricBattery"),
        ("Zone/*/BuildingElement/*/has_smart_air_brick", _) => pick(&["SmartAirBrick"], "the pinned HEM Database has no smart air brick product, so there is none to pick yet"),
        ("Zone/*/BuildingElement/*/treatment/*", _) => pick(&["WindowShuttersBlinds"], "the pinned HEM Database has no window treatment product, so there is none to pick yet"),
        _ => None,
    }
}

fn heat_pump_rule(system: &Map<String, Value>) -> Option<Rule> {
    // DESNZ gives no size rule: matching test data to the nearest size would be our
    // interpretation (question to Baz, and E8 for DESNZ), so a family of sizes is a pick.
    let size = |table: &'static str, sink: Option<&str>| {
        Some(Rule::Pick {
            tables: std::slice::from_ref(HEAT_PUMP_TABLES.iter().find(|t| **t == table).unwrap()),
            filter: sink.map(|sink| ("sinkType", sink.to_string())),
            ask: "pick the heat-pump size".into(),
            setting: None,
        })
    };
    if system.get("boiler").is_some_and(|b| !b.is_null()) {
        // Single product for the type.
        return auto("HybridHeatPump");
    }
    match (text(system, "source_type"), text(system, "sink_type")) {
        // Single product for each type.
        ("HeatNetwork", _) => auto("BoosterHeatPump"),
        ("ExhaustAirMEV", _) => auto("ExhaustAirMevHeatPump"),
        ("ExhaustAirMVHR", _) => auto("ExhaustAirMvhrHeatPump"),
        ("ExhaustAirMixed", _) => auto("ExhaustAirMixedHeatPump"),
        // Single product for the type (air-to-air).
        ("OutsideAir", "Air") => Some(Rule::Auto {
            table: "AirSourceHeatPump",
            filter: Some(("sinkType", "Air".into())),
        }),
        ("OutsideAir", _) => size("AirSourceHeatPump", Some("Water")),
        ("Ground", _) => size("GroundSourceHeatPump", None),
        ("WaterGround" | "WaterSurface", _) => size("WaterSourceHeatPump", None),
        _ => pick(
            HEAT_PUMP_TABLES,
            "state the heat pump's source type, or pick its product",
        ),
    }
}

impl Rule {
    fn tables(&self) -> &[&'static str] {
        match self {
            Rule::Auto { table, .. } => std::slice::from_ref(table),
            Rule::Pick { tables, .. } => tables,
        }
    }

    fn filter(&self) -> Option<&(&'static str, String)> {
        match self {
            Rule::Auto { filter, .. } | Rule::Pick { filter, .. } => filter.as_ref(),
        }
    }

    /// Products of the rule's tables that have its filter.
    pub(crate) fn candidates<'a>(&'a self, db: &'a ProductDatabase) -> Vec<&'a Product> {
        db.products
            .values()
            .filter(|p| self.tables().contains(&p.table.as_str()))
            .filter(|p| self.filter().is_none_or(|(f, v)| p.has(f, v)))
            .collect()
    }
}

/// Fills every product slot of the converted model (see the module order above) and states
/// each radiator's length. Returns one `ProductSlot` per system that needs a product.
pub(crate) fn resolve_products(
    model: &mut Value,
    db: &ProductDatabase,
    settings: &Settings,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) -> Vec<ProductSlot> {
    let snapshot = model.clone();
    let mut slots = Vec::new();
    for slot_rule in crate::epc_mappings::PRODUCT_SLOTS {
        let mut found = Vec::new();
        crate::epc_mappings::collect(model, slot_rule.path, Vec::new(), &mut found);
        for (segments, system) in found {
            let Some(object) = system.as_object_mut() else {
                continue;
            };
            let kind = ["type", "wet_emitter_type", "vent_type"]
                .into_iter()
                .map(|f| text(object, f))
                .find(|v| !v.is_empty())
                .unwrap_or_default()
                .to_string();
            if slot_rule
                .requires
                .is_some_and(|(f, values)| !values.contains(&text(object, f)))
                || slot_rule
                    .inline
                    .is_some_and(|(f, values)| values.contains(&text(object, f)))
            {
                continue;
            }
            let segments: Vec<&str> = segments.iter().map(String::as_str).collect();
            let path = json_pointer(&segments);
            let name = segments.last().copied().unwrap_or_default();
            let system_type = if kind.is_empty() {
                "system".to_string()
            } else {
                kind.clone()
            };
            let who = if name.parse::<usize>().is_ok() {
                format!("This {system_type}")
            } else {
                format!("'{name}' ({system_type})")
            };
            let pattern = slot_rule.path.join("/");
            let Some(rule) = rule(&pattern, &kind, name, object, &snapshot) else {
                errors.push(error("E_PRODUCT_REQUIRED", path.clone(), format!("{who} needs a HEM Database product, and Vulcan has no product rule for it. Pick its product on the row.")));
                slots.push(ProductSlot {
                    path,
                    system_type,
                    product_id: None,
                    source: ProductSource::Product,
                    label: None,
                    rule: "no rule".into(),
                    technology_types: vec![],
                });
                continue;
            };
            let technology_types: Vec<String> = db
                .products
                .values()
                .filter(|p| rule.tables().contains(&p.table.as_str()))
                .map(|p| p.technology_type.clone())
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
            let setting = match &rule {
                Rule::Pick {
                    setting: Some(setting),
                    ..
                } => {
                    let value = if *setting == RADIATOR_SETTING {
                        settings.radiator
                    } else {
                        settings.ufh
                    };
                    value.map(|id| (id, format!("model setting {setting}")))
                }
                _ => None,
            };
            let picked = object
                .get("product_id")
                .and_then(Value::as_u64)
                .map(|id| (id, "picked on the element".to_string()))
                .or(setting);
            let (product_id, source, label, rule_text) = if let Some((id, how)) = picked {
                match db.products.get(&id) {
                    Some(product) if rule.tables().contains(&product.table.as_str()) => (
                        Some(id),
                        ProductSource::Product,
                        Some(product.label.clone()),
                        how,
                    ),
                    found => {
                        let is = found.map_or("not in the pinned HEM Database".to_string(), |p| {
                            format!(
                                "a {} ({}), which this system cannot use",
                                p.technology_type, p.label
                            )
                        });
                        errors.push(error(
                            "E_PRODUCT_INVALID",
                            path.clone(),
                            format!(
                                "{who}: product {id} ({how}) is {is}. Pick a {} product.",
                                technology_types.join(" or ")
                            ),
                        ));
                        (None, ProductSource::Product, None, how)
                    }
                }
            } else {
                let candidates = rule.candidates(db);
                match (&rule, candidates.as_slice()) {
                    (Rule::Auto { table, filter }, [product]) => {
                        let why = match filter {
                            Some((field, value)) => format!("the only {table} product with {field} {value} in the pinned HEM Database"),
                            None => format!("the only {table} product in the pinned HEM Database"),
                        };
                        let replaced = object
                            .get("capacity")
                            .and_then(Value::as_f64)
                            .filter(|_| *table == "ElectricBattery")
                            .map(|c| format!(" It replaces the authored capacity {c} kWh with the product's {} kWh.", product.fields.get("capacity").map_or("", String::as_str)))
                            .unwrap_or_default();
                        notices.push(notice(&path, format!("{who} uses HEM Database product {} ({}): {why}.{replaced} Pick a product on the row to change it.", product.id, product.label)));
                        (
                            Some(product.id),
                            ProductSource::Default,
                            Some(product.label.clone()),
                            why,
                        )
                    }
                    (Rule::Auto { table, .. }, found) => {
                        errors.push(error("E_PRODUCT_REQUIRED", path.clone(), format!("{who} needs a HEM Database product. The pinned data has {} {table} products for it, so there is no default; pick one on the row.", found.len())));
                        (None, ProductSource::Product, None, "no default".into())
                    }
                    (Rule::Pick { ask, .. }, found) => {
                        let listed = match found.len() {
                            0 => String::new(),
                            1..=6 => format!(
                                " Products: {}.",
                                found
                                    .iter()
                                    .map(|p| format!("{} {}", p.id, p.label))
                                    .collect::<Vec<_>>()
                                    .join("; ")
                            ),
                            n => format!(
                                " The pinned HEM Database has {n} {} products.",
                                technology_types.join(" and ")
                            ),
                        };
                        errors.push(error(
                            "E_PRODUCT_REQUIRED",
                            path.clone(),
                            format!("{who} needs a HEM Database product: {ask}.{listed}"),
                        ));
                        (None, ProductSource::Product, None, ask.clone())
                    }
                }
            };
            if let Some(id) = product_id {
                object.insert("product_id".into(), json!(id));
            }
            slots.push(ProductSlot {
                path,
                system_type,
                product_id,
                source,
                label,
                rule: rule_text,
                technology_types,
            });
        }
    }
    slots
}

/// An ecodesign class with weather compensation (II, III, VI, VII) needs its curve: either
/// `weather_comp_a`, `_b`, `_c` with `min_flow_temp`, or a `weather_compensation_curve_id`
/// without `min_flow_temp` (the curve sets it). New build must state one (Input Requirements:
/// full information). Existing build with neither takes DESNZ's curve for its heat source and
/// emitters, DESNZ-defined (EPC 06, 6.3.2.4): boiler with UFH 2, boiler with radiators 7, heat
/// pump with UFH 1, heat pump with radiators 5.
pub(crate) fn apply_weather_curves(
    model: &mut Value,
    db: &ProductDatabase,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    let heat_sources = model["HeatSourceWet"].clone();
    let existing = model["IsExistingBuilding"] == true;
    let Some(systems) = model
        .get_mut("SpaceHeatSystem")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    for (name, system) in systems {
        if system["type"] != "WetDistribution" {
            continue;
        }
        let source = heat_sources[system["HeatSource"]["name"].as_str().unwrap_or_default()]
            ["type"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let emitters: std::collections::BTreeSet<String> = system["emitters"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| e["wet_emitter_type"].as_str().map(str::to_string))
            .collect();
        let Some(controller) = system
            .get_mut("ecodesign_controller")
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        let class = controller
            .get("ecodesign_control_class")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if !matches!(class, 2 | 3 | 6 | 7) {
            continue;
        }
        let path = format!("/SpaceHeatSystem/{name}/ecodesign_controller");
        let curve_id = controller
            .get("weather_compensation_curve_id")
            .and_then(Value::as_u64);
        let has_min = controller.contains_key("min_flow_temp");
        let comps = ["weather_comp_a", "weather_comp_b", "weather_comp_c"]
            .iter()
            .filter(|k| controller.contains_key(**k))
            .count();
        let required = |why: &str| {
            error("E_WEATHER_CURVE_REQUIRED", path.clone(), format!("'{name}' has ecodesign class {class} (weather compensation), {why} State weather_comp_a, weather_comp_b, weather_comp_c and min_flow_temp, or pick a weather_compensation_curve_id, on its ecodesign controller."))
        };
        match (curve_id, comps, has_min) {
            (Some(_), _, true) | (Some(_), 1.., _) => {
                errors.push(error("E_WEATHER_CURVE_CONFLICT", path.clone(), format!("'{name}' picks weather compensation curve {} and also states min_flow_temp or weather_comp values. The curve sets them: remove them, or remove the curve.", curve_id.unwrap_or_default())));
                continue;
            }
            (Some(id), 0, false) => {
                if !db.weather_curves.contains_key(&id) {
                    errors.push(error("E_WEATHER_CURVE_REQUIRED", path.clone(), format!("'{name}' picks weather compensation curve {id}, which the pinned HEM Database does not have (1 to {}).", db.weather_curves.len())));
                }
                continue;
            }
            (None, 3, true) => continue,
            (None, 1.., _) => {
                errors.push(required("and states only part of its curve."));
                continue;
            }
            (None, 0, _) if !existing => {
                errors.push(required("and a new-build EPC must state its curve."));
                continue;
            }
            (None, _, _) => {}
        }
        let emitter = match emitters.iter().map(String::as_str).collect::<Vec<_>>()[..] {
            ["radiator"] => "radiators",
            ["ufh"] => "UFH",
            _ => "",
        };
        let curve = match (source.as_str(), emitter) {
            ("Boiler", "UFH") => 2,
            ("Boiler", "radiators") => 7,
            ("HeatPump", "UFH") => 1,
            ("HeatPump", "radiators") => 5,
            _ => {
                errors.push(required("and DESNZ gives a curve only for a boiler or heat pump with radiators or with UFH alone."));
                continue;
            }
        };
        let gradient = db.weather_curves[&curve];
        let replaced = controller
            .remove("min_flow_temp")
            .map(|t| format!(" The curve sets the minimum flow temperature, so the authored min_flow_temp {t} is not sent."))
            .unwrap_or_default();
        controller.insert("weather_compensation_curve_id".into(), json!(curve));
        notices.push(notice(&path, format!("'{name}' has ecodesign class {class} (weather compensation) and states no curve, so this existing building uses weather compensation curve {curve} (gradient {gradient}), DESNZ's curve for a {} with {emitter}.{replaced}", if source == "Boiler" { "boiler" } else { "heat pump" })));
    }
}

/// The convective fraction each product table gives the system it is substituted into.
const FRAC_CONVECTIVE_FIELDS: [(&str, &str); 4] = [
    ("ConvectorRadiator", "convectiveHeatingRadiation"),
    ("UnderFloorHeating", "convectiveHeatingRadiation"),
    ("FanCoils", "fracConvective"),
    ("StorageHeater", "frac_convective"),
];

/// Each zone with a heating system states `frac_convective_heating` (required by the wrapper's
/// zone model when the zone is heated). Derived as HEMIE 0.18.1 derives it
/// (`Dwelling.zone`): the convective fraction of the zone's first space heating system, which
/// for a wet distribution is its first emitter's; here that is the fraction the slot's product
/// gives, else the system's own authored `frac_convective`. Otherwise an error names the zone.
pub(crate) fn derive_zone_frac_convective(
    model: &mut Value,
    db: &ProductDatabase,
    slots: &[ProductSlot],
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    let systems = model["SpaceHeatSystem"].clone();
    let Some(zones) = model.get_mut("Zone").and_then(Value::as_object_mut) else {
        return;
    };
    for (zone, zone_value) in zones {
        let first = match &zone_value["SpaceHeatSystem"] {
            Value::String(name) => Some(name.clone()),
            Value::Array(names) => names.first().and_then(Value::as_str).map(str::to_string),
            _ => None,
        };
        let Some(system_name) = first else {
            continue;
        };
        if zone_value
            .get("frac_convective_heating")
            .is_some_and(|v| !v.is_null())
        {
            continue;
        }
        let system = &systems[&system_name];
        let (object, path) = if system["type"] == "WetDistribution" {
            (
                &system["emitters"][0],
                json_pointer(&["SpaceHeatSystem", &system_name, "emitters", "0"]),
            )
        } else {
            (system, json_pointer(&["SpaceHeatSystem", &system_name]))
        };
        let slot = slots.iter().find(|slot| slot.path == path);
        // A product still to be picked already has its error; the fraction follows the pick.
        if slot.is_some_and(|slot| slot.product_id.is_none()) {
            continue;
        }
        let from_product = slot
            .and_then(|slot| db.products.get(&slot.product_id?))
            .and_then(|product| {
                let (_, field) = FRAC_CONVECTIVE_FIELDS
                    .iter()
                    .find(|(table, _)| *table == product.table)?;
                Some((
                    product.fields.get(*field)?.parse::<f64>().ok()?,
                    format!("product {}", product.id),
                ))
            });
        let found = from_product.or_else(|| {
            object["frac_convective"]
                .as_f64()
                .map(|f| (f, "its authored frac_convective".to_string()))
        });
        let zone_path = json_pointer(&["Zone", zone, "frac_convective_heating"]);
        match found {
            Some((fraction, source)) => {
                zone_value["frac_convective_heating"] = json!(fraction);
                notices.push(notice(&zone_path, format!("Zone '{zone}' takes frac_convective_heating {fraction} from its heating system '{system_name}' ({source}), as HEMIE derives it from the first system's first emitter.")));
            }
            None => errors.push(error("E_EPC_ZONE_FRAC_CONVECTIVE", zone_path, format!("Zone '{zone}' needs frac_convective_heating, and its heating system '{system_name}' gives no convective fraction (its product has none and the row states none). State frac_convective on the system or its first emitter."))),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// The product data the HEM:EPC 0.13.2 target pins, as a host would pass it.
    pub(crate) fn pinned() -> ProductData {
        let dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../data/hem_database/1.0.0a10"
        );
        std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                (
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    std::fs::read_to_string(&path).unwrap(),
                )
            })
            .collect()
    }

    #[test]
    fn the_pinned_data_parses_into_445_products_of_36_types() {
        let data = pinned();
        assert_eq!(data.len(), 70);
        let mut db = ProductDatabase::parse(&data).unwrap();
        // Plus the one heat network, which only HeatNetworks.csv lists.
        assert_eq!(db.products.len(), 446);
        assert_eq!(db.products[&210008].table, "HeatNetworks");
        db.products.remove(&210008);
        let types: BTreeSet<&str> = db
            .products
            .values()
            .map(|p| p.technology_type.as_str())
            .collect();
        assert_eq!(types.len(), 36);
        let no_data: Vec<u64> = db
            .products
            .values()
            .filter(|p| p.table.is_empty())
            .map(|p| p.id)
            .collect();
        assert_eq!(no_data, [820691, 820692, 820693, 820694]);
        let hp = &db.products[&693001];
        assert_eq!(
            (hp.table.as_str(), hp.fields["sinkType"].as_str()),
            ("AirSourceHeatPump", "Water")
        );
        assert_eq!(hp.children.len(), 12);
        assert_eq!(db.products[&650060].table, "ConvectorRadiator");
        assert_eq!(db.products[&650060].label, "HEM Default 2-column 200");
        assert!(db.products[&83001].has("systemType", "B"));
        assert_eq!(db.weather_curves.len(), 12);
        assert_eq!(db.weather_curves[&7], 1.8);
    }

    #[test]
    fn a_row_for_an_unlisted_product_is_an_error() {
        let mut data = pinned();
        data.insert("SolarThermal.csv".into(), "ID,productID\n1,1\n".into());
        assert!(ProductDatabase::parse(&data)
            .unwrap_err()
            .contains("names product Some(1)"));
    }
    fn db() -> ProductDatabase {
        ProductDatabase::parse(&pinned()).unwrap()
    }

    /// Every `PRODUCT_SLOTS` discriminator has a rule; each automatic rule gives exactly one
    /// product of the pinned data, and each pick names tables the data has.
    #[test]
    fn every_slot_has_a_rule_and_each_automatic_rule_one_product() {
        let db = db();
        let data = pinned();
        let shower = |letter: &str| json!({"HotWaterDemand": {"Shower": {"s": {"WWHRS": "w", "WWHRS_configuration": letter}}}});
        let mut checked = 0;
        for slot in crate::epc_mappings::PRODUCT_SLOTS {
            let pattern = slot.path.join("/");
            let kinds: Vec<&str> = match (slot.requires, slot.inline) {
                (Some((_, values)), _) => values.to_vec(),
                // Mechanical ventilation: every schema vent type that needs a product.
                (None, Some(_)) => vec![
                    "Centralised continuous MEV",
                    "Decentralised continuous MEV",
                    "MVHR",
                ],
                (None, None) => vec![""],
            };
            for kind in kinds {
                let mut variants: Vec<(Map<String, Value>, Value)> = vec![(Map::new(), json!({}))];
                match kind {
                    "HeatPump" => {
                        variants.clear();
                        for source in [
                            "Ground",
                            "OutsideAir",
                            "ExhaustAirMEV",
                            "ExhaustAirMVHR",
                            "ExhaustAirMixed",
                            "WaterGround",
                            "WaterSurface",
                            "HeatNetwork",
                        ] {
                            for sink in ["Water", "Air"] {
                                variants.push((
                                    json!({"source_type": source, "sink_type": sink})
                                        .as_object()
                                        .unwrap()
                                        .clone(),
                                    json!({}),
                                ));
                            }
                        }
                        variants.push((
                            json!({"source_type": "OutsideAir", "boiler": {}})
                                .as_object()
                                .unwrap()
                                .clone(),
                            json!({}),
                        ));
                    }
                    "HeatBattery" => {
                        variants = ["dry_core", "pcm"]
                            .map(|t| {
                                (
                                    json!({"battery_type": t}).as_object().unwrap().clone(),
                                    json!({}),
                                )
                            })
                            .to_vec();
                    }
                    "WWHRS_Instantaneous" => {
                        variants = ["A", "B", "C"].map(|l| (Map::new(), shower(l))).to_vec();
                    }
                    _ => {}
                }
                for (mut system, model) in variants {
                    let field = slot.requires.map_or("vent_type", |(f, _)| f);
                    system.insert(field.into(), json!(kind));
                    let rule = rule(&pattern, kind, "w", &system, &model)
                        .unwrap_or_else(|| panic!("no rule for {pattern} {kind}"));
                    for table in rule.tables() {
                        assert!(data.contains_key(&format!("{table}.csv")), "{table}");
                    }
                    if let Rule::Auto { .. } = rule {
                        assert_eq!(rule.candidates(&db).len(), 1, "{pattern} {kind} {system:?}");
                    }
                    checked += 1;
                }
            }
        }
        assert_eq!(checked, 53);
    }

    fn resolve(
        model: &mut Value,
        settings: &Settings,
    ) -> (Vec<ProductSlot>, Vec<ValidationError>, Vec<SchemaOmission>) {
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        let slots = resolve_products(model, &db(), settings, &mut errors, &mut notices);
        (slots, errors, notices)
    }

    #[test]
    fn each_rule_picks_its_product_or_asks_for_one() {
        let mut model = json!({
            "EnergySupply": {"mains gas": {"fuel": "mains_gas"}, "mains elec": {"fuel": "electricity", "ElectricBattery": {"type": "stationary", "capacity": 5.0}}},
            "HeatSourceWet": {
                "hiu": {"type": "HIU"},
                "a2a": {"type": "HeatPump", "source_type": "OutsideAir", "sink_type": "Air"},
                "a2w": {"type": "HeatPump", "source_type": "OutsideAir", "sink_type": "Water"},
                "picked": {"type": "HeatPump", "source_type": "OutsideAir", "sink_type": "Water", "product_id": 693002},
                "wrong": {"type": "HeatPump", "source_type": "Ground", "sink_type": "Water", "product_id": 650000},
                "boiler": {"type": "Boiler", "EnergySupply": "mains gas"},
                "network": {"type": "HIU", "EnergySupply": {"name": "heat network"}}
            },
            "HotWaterSource": {"combi": {"type": "CombiBoiler", "HeatSourceWet": "boiler"}},
            "SpaceHeatSystem": {
                "rads": {"type": "WetDistribution", "emitters": [
                    {"wet_emitter_type": "radiator"},
                    {"wet_emitter_type": "radiator", "length": 1.4, "product_id": 650061},
                    {"wet_emitter_type": "ufh"},
                    {"wet_emitter_type": "fancoil"}
                ]},
                "storage": {"type": "ElecStorageHeater"}
            },
            "InfiltrationVentilation": {"MechanicalVentilation": {"cmev": {"vent_type": "Centralised continuous MEV"}}},
            "WWHRS": {"w": {"type": "WWHRS_Instantaneous"}},
            "HotWaterDemand": {"Shower": {"s": {"WWHRS": "w", "WWHRS_configuration": "B"}}}
        });
        let settings = Settings {
            radiator: Some(650060),
            ufh: None,
            radiator_length: None,
        };
        let (slots, errors, notices) = resolve(&mut model, &settings);
        let got: BTreeMap<&str, (Option<u64>, ProductSource)> = slots
            .iter()
            .map(|s| (s.path.as_str(), (s.product_id, s.source)))
            .collect();
        use ProductSource::{Default as D, Product as P};
        assert_eq!(
            got,
            BTreeMap::from([
                ("/EnergySupply/mains elec/ElectricBattery", (Some(70007), D)),
                ("/HeatSourceWet/a2a", (Some(693000), D)),
                ("/HeatSourceWet/a2w", (None, P)),
                ("/HeatSourceWet/boiler", (None, P)),
                ("/HeatSourceWet/hiu", (Some(410000), D)),
                ("/HeatSourceWet/network", (Some(410000), D)),
                ("/HeatSourceWet/network/EnergySupply", (None, P)),
                ("/HeatSourceWet/picked", (Some(693002), P)),
                ("/HeatSourceWet/wrong", (None, P)),
                (
                    "/InfiltrationVentilation/MechanicalVentilation/cmev",
                    (Some(600001), D)
                ),
                ("/SpaceHeatSystem/rads/emitters/0", (Some(650060), P)),
                ("/SpaceHeatSystem/rads/emitters/1", (Some(650061), P)),
                ("/SpaceHeatSystem/rads/emitters/2", (None, P)),
                ("/SpaceHeatSystem/rads/emitters/3", (Some(310000), D)),
                ("/SpaceHeatSystem/storage", (None, P)),
                ("/WWHRS/w", (Some(83001), D)),
            ])
        );
        let error = |path: &str| {
            errors
                .iter()
                .find(|e| e.path == path)
                .map(|e| (e.code.as_str(), e.message.as_str()))
                .unwrap()
        };
        assert_eq!(error("/HeatSourceWet/a2w").0, "E_PRODUCT_REQUIRED");
        assert!(error("/HeatSourceWet/a2w")
            .1
            .contains("pick the heat-pump size. Products: 693001"));
        assert!(error("/HeatSourceWet/boiler")
            .1
            .contains("combi boiler product, condensing or non-condensing. Products: 690201"));
        assert!(
            !error("/HeatSourceWet/boiler").1.contains("690203"),
            "an LPG combi is not listed for a mains gas boiler"
        );
        assert!(error("/HeatSourceWet/network/EnergySupply")
            .1
            .contains("identify the heat network"));
        assert_eq!(error("/HeatSourceWet/wrong").0, "E_PRODUCT_INVALID");
        assert!(error("/HeatSourceWet/wrong")
            .1
            .contains("650000 (picked on the element) is a Convector Radiator"));
        assert!(error("/SpaceHeatSystem/rads/emitters/2").1.starts_with(
            "This ufh needs a HEM Database product: pick the underfloor heating system"
        ));
        assert!(error("/SpaceHeatSystem/storage")
            .1
            .contains("high heat retention or standard"));
        assert_eq!(errors.len(), 6);
        // The model setting picks a radiator; a product on the emitter overrides it.
        assert_eq!(
            slots
                .iter()
                .find(|s| s.path.ends_with("emitters/0"))
                .unwrap()
                .rule,
            "model setting Product_radiator"
        );
        let said = |text: &str| notices.iter().any(|n| n.message.contains(text));
        assert!(said("'a2a' (HeatPump) uses HEM Database product 693000"));
        assert!(said(
            "replaces the authored capacity 5 kWh with the product's 3.84 kWh"
        ));
        assert!(said(
            "the only InstantaneousWwhrSystem product with systemType B"
        ));
        // Defaults are written to the converted model only.
        assert_eq!(model["HeatSourceWet"]["hiu"]["product_id"], 410000);
    }

    #[test]
    fn a_radiator_with_no_length_takes_desnz_length_for_its_descriptor() {
        let (length, notice) = Settings::default().radiator_length("Hall", 1.0);
        assert_eq!(length, 0.9);
        assert!(notice
            .message
            .contains("uses 0.9 m, DESNZ's length for a medium radiator (the default descriptor"));
        let large = Settings {
            radiator_length: Some("large"),
            ..Settings::default()
        };
        let (length, notice) = large.radiator_length("Hall", 2.0);
        assert_eq!(length, 2.4);
        assert!(notice.message.contains("1.2 m per unit, 2.4 m for 2 units, DESNZ's length for a large radiator (Metadata row Product_radiator_length)"));
    }

    #[test]
    fn model_settings_are_read_from_metadata_and_bad_values_named() {
        let mut errors = Vec::new();
        let rows = BTreeMap::from([
            (RADIATOR_SETTING, json!(650060)),
            (UFH_SETTING, json!("x")),
            (RADIATOR_LENGTH_SETTING, json!("Small")),
        ]);
        let settings = Settings::read(|name| rows.get(name).cloned(), &mut errors);
        assert_eq!(
            (settings.radiator, settings.ufh, settings.radiator_length),
            (Some(650060), None, Some("small"))
        );
        assert_eq!(errors.len(), 1);
        assert!(errors[0]
            .message
            .contains("Metadata row 'Product_ufh' is 'x'"));
    }

    #[test]
    fn an_existing_building_with_no_curve_takes_desnz_curve_for_source_and_emitters() {
        let wet = |source: &str, emitter: &str, controller: Value| json!({"type": "WetDistribution", "HeatSource": {"name": source}, "emitters": [{"wet_emitter_type": emitter}], "ecodesign_controller": controller});
        let mut model = json!({
            "IsExistingBuilding": true,
            "HeatSourceWet": {"hp": {"type": "HeatPump"}, "b": {"type": "Boiler"}, "hiu": {"type": "HIU"}},
            "SpaceHeatSystem": {
                "hp rads": wet("hp", "radiator", json!({"ecodesign_control_class": 2, "min_flow_temp": 30})),
                "hp ufh": wet("hp", "ufh", json!({"ecodesign_control_class": 3})),
                "b rads": wet("b", "radiator", json!({"ecodesign_control_class": 6})),
                "b ufh": wet("b", "ufh", json!({"ecodesign_control_class": 7})),
                "stated": wet("hp", "radiator", json!({"ecodesign_control_class": 2, "weather_comp_a": 1, "weather_comp_b": 1, "weather_comp_c": 1, "min_flow_temp": 25})),
                "no comp": wet("hp", "radiator", json!({"ecodesign_control_class": 1})),
                "hiu": wet("hiu", "radiator", json!({"ecodesign_control_class": 2}))
            }
        });
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        apply_weather_curves(&mut model, &db(), &mut errors, &mut notices);
        let curve = |name: &str| {
            model["SpaceHeatSystem"][name]["ecodesign_controller"]["weather_compensation_curve_id"]
                .clone()
        };
        assert_eq!(
            [
                curve("hp rads"),
                curve("hp ufh"),
                curve("b rads"),
                curve("b ufh")
            ],
            [json!(5), json!(1), json!(7), json!(2)]
        );
        assert!(curve("stated").is_null() && curve("no comp").is_null() && curve("hiu").is_null());
        assert!(model["SpaceHeatSystem"]["hp rads"]["ecodesign_controller"]
            .get("min_flow_temp")
            .is_none());
        assert!(notices
            .iter()
            .any(|n| n.message.contains(
                "this existing building uses weather compensation curve 5 (gradient 1.2)"
            ) && n.message.contains("authored min_flow_temp 30 is not sent")));
        assert_eq!(
            errors
                .iter()
                .map(|e| (e.code.as_str(), e.path.as_str()))
                .collect::<Vec<_>>(),
            [(
                "E_WEATHER_CURVE_REQUIRED",
                "/SpaceHeatSystem/hiu/ecodesign_controller"
            )]
        );
    }

    #[test]
    fn a_new_building_states_its_curve_or_fails() {
        let wet = |controller: Value| json!({"type": "WetDistribution", "HeatSource": {"name": "hp"}, "emitters": [{"wet_emitter_type": "radiator"}], "ecodesign_controller": controller});
        let mut model = json!({
            "IsExistingBuilding": false,
            "HeatSourceWet": {"hp": {"type": "HeatPump"}},
            "SpaceHeatSystem": {
                "picked": wet(json!({"ecodesign_control_class": 2, "weather_compensation_curve_id": 4})),
                "stated": wet(json!({"ecodesign_control_class": 2, "weather_comp_a": 1, "weather_comp_b": 1, "weather_comp_c": 1, "min_flow_temp": 25})),
                "none": wet(json!({"ecodesign_control_class": 2})),
                "both": wet(json!({"ecodesign_control_class": 2, "weather_compensation_curve_id": 4, "min_flow_temp": 25})),
                "part": wet(json!({"ecodesign_control_class": 2, "weather_comp_a": 1, "min_flow_temp": 25})),
                "unknown": wet(json!({"ecodesign_control_class": 2, "weather_compensation_curve_id": 99}))
            }
        });
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        apply_weather_curves(&mut model, &db(), &mut errors, &mut notices);
        assert!(notices.is_empty());
        assert_eq!(
            model["SpaceHeatSystem"]["both"]["ecodesign_controller"]["min_flow_temp"],
            25
        );
        let got: Vec<_> = errors
            .iter()
            .map(|e| (e.code.as_str(), e.path.split('/').nth(2).unwrap()))
            .collect();
        let mut got = got;
        got.sort();
        assert_eq!(
            got,
            [
                ("E_WEATHER_CURVE_CONFLICT", "both"),
                ("E_WEATHER_CURVE_REQUIRED", "none"),
                ("E_WEATHER_CURVE_REQUIRED", "part"),
                ("E_WEATHER_CURVE_REQUIRED", "unknown"),
            ]
        );
        assert!(errors[0]
            .message
            .contains("a new-build EPC must state its curve"));
    }

    #[test]
    fn a_heated_zone_takes_its_first_systems_convective_fraction() {
        let mut model = json!({
            "SpaceHeatSystem": {
                "rads": {"type": "WetDistribution", "emitters": [{"wet_emitter_type": "radiator", "product_id": 650047}]},
                "inline": {"type": "InstantElecHeater", "frac_convective": 0.95},
                "none": {"type": "InstantElecHeater"}
            },
            "Zone": {"a": {"SpaceHeatSystem": "rads"}, "b": {"SpaceHeatSystem": ["inline", "rads"]}, "c": {"SpaceHeatSystem": "none"}, "d": {}}
        });
        let slots = vec![ProductSlot {
            path: "/SpaceHeatSystem/rads/emitters/0".into(),
            system_type: "radiator".into(),
            product_id: Some(650047),
            source: ProductSource::Product,
            label: None,
            rule: String::new(),
            technology_types: vec![],
        }];
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        derive_zone_frac_convective(&mut model, &db(), &slots, &mut errors, &mut notices);
        assert_eq!(model["Zone"]["a"]["frac_convective_heating"], 0.82);
        assert_eq!(model["Zone"]["b"]["frac_convective_heating"], 0.95);
        assert!(model["Zone"]["d"].get("frac_convective_heating").is_none());
        assert!(notices[0].message.contains("(product 650047)"));
        assert_eq!(
            errors
                .iter()
                .map(|e| (e.code.as_str(), e.path.as_str()))
                .collect::<Vec<_>>(),
            [(
                "E_EPC_ZONE_FRAC_CONVECTIVE",
                "/Zone/c/frac_convective_heating"
            )]
        );
    }
}
