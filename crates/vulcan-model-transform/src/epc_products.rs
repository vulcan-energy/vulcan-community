// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEM Database products for HEM:EPC full input. The host passes the product CSVs its target
//! pins (`TransformRequest::product_data`, already checked against the target's
//! `productDataSha256`); the converter reads them here and never holds a copy of its own.

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
}
