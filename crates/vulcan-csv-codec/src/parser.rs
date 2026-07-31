// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: Apache-2.0

use crate::error::ParseError;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq)]
pub enum ParserState {
    Initial,
    InSection,
}

pub struct CSVParser {
    state: ParserState,
    current_section: Option<String>,
    current_line_number: usize,
    section_data: HashMap<String, Vec<HashMap<String, Value>>>,
    section_headers: HashMap<String, Vec<String>>,
    seen_sections: HashSet<String>,
    defined_zones: HashSet<String>,
    seen_names: HashMap<String, HashSet<String>>,
}

/// True when a CSV cell has no meaningful content (trim + NBSP + Excel-style spaces).
/// Unicode NBSP is not removed by `str::trim()` and often appears in exports / paste from spreadsheets.
fn cell_is_empty(s: &str) -> bool {
    s.replace('\u{00A0}', " ").trim().is_empty()
}

/// Normalize a cell for section names and header matching (NBSP → space, then trim).
fn normalize_csv_cell(s: &str) -> String {
    s.replace('\u{00A0}', " ").trim().to_string()
}

impl Default for CSVParser {
    fn default() -> Self {
        Self::new()
    }
}

impl CSVParser {
    pub fn new() -> Self {
        Self {
            state: ParserState::Initial,
            current_section: None,
            current_line_number: 0,
            section_data: HashMap::new(),
            section_headers: HashMap::new(),
            seen_sections: HashSet::new(),
            defined_zones: HashSet::new(),
            seen_names: HashMap::new(),
        }
    }

    pub fn parse_csv(
        &mut self,
        content: &str,
    ) -> Result<HashMap<String, Vec<HashMap<String, Value>>>, ParseError> {
        self.reset();

        // Excel / Windows editors often save UTF-8 with BOM; paste can include it. That breaks the
        // first section cell (`\u{FEFF}Metadata` ≠ `Metadata`) and surfaces as E003 on line 1.
        let content = content.strip_prefix('\u{FEFF}').unwrap_or(content);
        // JS / Unicode line/paragraph separators — `str::lines()` only splits on `\n` / `\r\n`.
        let content = content.replace(['\u{2028}', '\u{2029}'], "\n");

        let lines: Vec<&str> = content.lines().collect();
        let mut section_column_counts: HashMap<String, usize> = HashMap::new();

        for (line_num, line) in lines.iter().enumerate() {
            self.current_line_number = line_num + 1;
            let trimmed_line = line.trim();

            if trimmed_line.is_empty() {
                continue;
            }

            let columns = self.split_csv_line(trimmed_line);

            // Skip rows where all columns are empty (like ",,,,,,,,,,,,")
            if columns.iter().all(|col| cell_is_empty(col)) {
                continue;
            }

            // Check if this is a section header
            if self.is_section_header(&columns) {
                let section_name = normalize_csv_cell(&columns[0]);

                if !self.is_valid_section(&section_name) {
                    return Err(ParseError {
                        code: "E001".to_string(),
                        message: format!("Invalid section: {section_name}"),
                        line_number: self.current_line_number,
                        section: Some(section_name.clone()),
                        field: None,
                    });
                }

                if self.seen_sections.contains(&section_name) {
                    return Err(ParseError {
                        code: "E002".to_string(),
                        message: format!("Duplicate section: {section_name}"),
                        line_number: self.current_line_number,
                        section: Some(section_name.clone()),
                        field: None,
                    });
                }

                self.current_section = Some(section_name.clone());
                self.seen_sections.insert(section_name);
                self.state = ParserState::InSection;
                continue;
            }

            // Must be in a section to process data rows
            if self.current_section.is_none() {
                return Err(ParseError {
                    code: "E003".to_string(),
                    message: "Data row found outside of any section".to_string(),
                    line_number: self.current_line_number,
                    section: None,
                    field: None,
                });
            }

            // Extract section name early to avoid borrowing conflicts
            let section_name = self.current_section.as_ref().unwrap().clone();

            // First non-header row in section becomes the header
            if !self.section_headers.contains_key(&section_name) {
                self.section_headers
                    .insert(section_name.clone(), columns.clone());
                section_column_counts.insert(section_name.clone(), columns.len());
                continue;
            }

            // Get expected column count for this section
            let expected = section_column_counts.get(&section_name).unwrap();

            // Handle rectangular CSV: pad or truncate columns to match expected count
            let mut adjusted_columns = columns.clone();
            match adjusted_columns.len().cmp(expected) {
                std::cmp::Ordering::Less => {
                    // Pad with empty strings if too few columns
                    adjusted_columns.resize(*expected, String::new());
                }
                std::cmp::Ordering::Greater => {
                    // Truncate if too many columns (but warn if there's actual data)
                    let extra_data = adjusted_columns[*expected..]
                        .iter()
                        .any(|col| !col.trim().is_empty());
                    if extra_data {
                        return Err(ParseError {
                            code: "E004".to_string(),
                            message: format!(
                                "Row has {} columns but section expects {} columns. Extra data will be lost.",
                                adjusted_columns.len(), expected
                            ),
                            line_number: self.current_line_number,
                            section: Some(section_name.clone()),
                            field: None,
                        });
                    }
                    adjusted_columns.truncate(*expected);
                }
                std::cmp::Ordering::Equal => {
                    // Already the right size, no adjustment needed
                }
            }

            // Process data row
            let headers = self.section_headers.get(&section_name).unwrap();
            let mut row_data = HashMap::new();

            for (i, header) in headers.iter().enumerate() {
                let value = adjusted_columns.get(i).map(|v| v.as_str()).unwrap_or("");
                let parsed_value = if header == "extra_json" {
                    self.parse_extra_json_value(value)?
                } else {
                    self.parse_value(value)?
                };
                row_data.insert(header.clone(), parsed_value);
            }

            // Validate row data
            self.validate_row(&row_data, &section_name)?;

            // Add to section data
            self.section_data
                .entry(section_name)
                .or_default()
                .push(row_data);
        }

        // Ensure all seen sections are present in section_data, even if empty
        for section in &self.seen_sections {
            self.section_data.entry(section.clone()).or_default();
        }

        Ok(self.section_data.clone())
    }

    fn split_csv_line(&self, line: &str) -> Vec<String> {
        let mut columns = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;
        let mut chars = line.chars().peekable();

        while let Some(ch) = chars.next() {
            match ch {
                '"' => {
                    if in_quotes && chars.peek() == Some(&'"') {
                        // Escaped quote
                        current.push('"');
                        chars.next(); // consume the second quote
                    } else {
                        in_quotes = !in_quotes;
                    }
                }
                ',' if !in_quotes => {
                    columns.push(current.trim().to_string());
                    current.clear();
                }
                _ => {
                    current.push(ch);
                }
            }
        }

        // Add the last column (even if empty)
        columns.push(current.trim().to_string());

        columns
    }

    fn is_section_header(&self, columns: &[String]) -> bool {
        // Section headers have only one non-empty column, or first column is a valid section name
        // and the rest are empty (allowing for trailing commas)
        if columns.is_empty() {
            return false;
        }

        let first_col = normalize_csv_cell(&columns[0]);
        if first_col.is_empty() {
            return false;
        }

        if !self.is_valid_section(&first_col) {
            return false;
        }

        // Trailing cells must look empty (NBSP / Excel spaces), not `trim()` alone.
        columns[1..].iter().all(|col| cell_is_empty(col))
    }

    fn is_valid_section(&self, section_name: &str) -> bool {
        Self::SECTIONS.contains(&section_name)
    }

    fn parse_value(&self, value: &str) -> Result<Value, ParseError> {
        let trimmed = value.trim();

        if trimmed.is_empty() {
            return Ok(Value::Null);
        }

        // Try to parse as number first
        if let Ok(num) = trimmed.parse::<f64>() {
            // Check if it's actually an integer
            if num.fract() == 0.0 {
                return Ok(Value::Number(serde_json::Number::from(num as i64)));
            } else {
                return Ok(Value::Number(serde_json::Number::from_f64(num).unwrap()));
            }
        }

        // Try to parse as boolean
        match trimmed.to_lowercase().as_str() {
            "true" => return Ok(Value::Bool(true)),
            "false" => return Ok(Value::Bool(false)),
            _ => {}
        }

        // Default to string
        Ok(Value::String(trimmed.to_string()))
    }

    fn parse_extra_json_value(&self, value: &str) -> Result<Value, ParseError> {
        let trimmed = value.trim();

        if trimmed.is_empty() {
            return Ok(Value::Null);
        }

        // Try to parse as JSON first
        if let Ok(mut json_value) = serde_json::from_str::<Value>(trimmed) {
            // `_`-prefixed keys are Vulcan UI metadata (e.g. `_system_source`). They live
            // in the saved CSV only; the merged dwelling JSON must contain pure HEM input.
            if let Some(obj) = json_value.as_object_mut() {
                obj.retain(|k, _| !k.starts_with('_'));
            }
            return Ok(json_value);
        }

        // If JSON parsing fails, treat as string (for malformed JSON)
        Ok(Value::String(trimmed.to_string()))
    }

    fn validate_row(
        &mut self,
        row_data: &HashMap<String, Value>,
        section: &str,
    ) -> Result<(), ParseError> {
        // Skip validation for completely empty rows (all values are null or empty strings)
        let has_data = row_data.values().any(|v| {
            match v {
                Value::Null => false,
                Value::String(s) => !s.trim().is_empty(),
                _ => true, // Numbers, booleans, etc. are considered data
            }
        });

        if !has_data {
            return Ok(()); // Skip validation for empty rows
        }

        // Check for required fields based on section
        if let Some(required_fields) = Self::REQUIRED_COLUMNS.iter().find(|(s, _)| *s == section) {
            for field in required_fields.1 {
                if !row_data.contains_key(*field) {
                    return Err(ParseError {
                        code: "E006".to_string(),
                        message: format!("Missing required field: {field}"),
                        line_number: self.current_line_number,
                        section: Some(section.to_string()),
                        field: Some(field.to_string()),
                    });
                }
            }
        }

        // Special validation for MechanicalVentilation vent_type
        if section == "Ventilation Systems" {
            if let Some(Value::String(type_str)) = row_data.get("Type") {
                if type_str == "MechanicalVentilation" {
                    if let Some(Value::String(vent_type)) = row_data.get("vent_type") {
                        let valid_vent_types = [
                            "Intermittent MEV",
                            "Centralised continuous MEV",
                            "Decentralised continuous MEV",
                            "MVHR",
                        ];
                        if !valid_vent_types.contains(&vent_type.as_str()) {
                            return Err(ParseError {
                                code: "E009".to_string(),
                                message: format!("Invalid vent_type '{}' for MechanicalVentilation. Must be one of: {}", 
                                    vent_type, valid_vent_types.join(", ")),
                                line_number: self.current_line_number,
                                section: Some(section.to_string()),
                                field: Some("vent_type".to_string()),
                            });
                        }
                    }
                }
            }
        }

        // Check for duplicate names within section
        if let Some(Value::String(name)) = row_data.get("Name") {
            let section_names = self.seen_names.entry(section.to_string()).or_default();
            if section_names.contains(name) {
                return Err(ParseError {
                    code: "E007".to_string(),
                    message: format!("Duplicate name '{name}' in section '{section}'"),
                    line_number: self.current_line_number,
                    section: Some(section.to_string()),
                    field: Some("Name".to_string()),
                });
            }
            section_names.insert(name.clone());
        }

        // Special validation for Zone section
        if section == "Zone" {
            if let Some(Value::String(name)) = row_data.get("Name") {
                self.defined_zones.insert(name.clone());
            }
        }

        // Validate zone references (only if Zone field is present and not empty)
        if let Some(Value::String(zone_name)) = row_data.get("Zone") {
            if !zone_name.is_empty() && !self.defined_zones.contains(zone_name) {
                return Err(ParseError {
                    code: "E008".to_string(),
                    message: format!("Referenced zone '{zone_name}' not defined"),
                    line_number: self.current_line_number,
                    section: Some(section.to_string()),
                    field: Some("Zone".to_string()),
                });
            }
        }

        Ok(())
    }

    fn reset(&mut self) {
        self.state = ParserState::Initial;
        self.current_section = None;
        self.current_line_number = 0;
        self.section_data.clear();
        self.section_headers.clear();
        self.seen_sections.clear();
        self.defined_zones.clear();
        self.seen_names.clear();
    }

    const SECTIONS: &'static [&'static str] = &[
        "Metadata",
        "Exposed Elements",
        "Window Elements",
        "Ground Elements",
        "Non-Exposed Elements",
        "Thermal Bridging Elements",
        "Zone",
        "Window Shading",
        "Lighting",
        "Ventilation Systems",
        "Combustion Appliances",
        "Water Pipework",
        "Wet Emitters",
        "Appliances",
        "Hot Water Outlets",
        "Context Shading",
        "On-Site Generation",
        "Systems",
        "Space Labels",
        "Test Section",
    ];

    const REQUIRED_COLUMNS: &'static [(&'static str, &'static [&'static str])] = &[
        ("Zone", &["Name", "Type"]),
        ("Exposed Elements", &["Name", "Zone", "Type"]),
        ("Window Elements", &["Name", "Zone", "Type"]),
        ("Ground Elements", &["Name", "Zone", "Type"]),
        ("Non-Exposed Elements", &["Name", "Zone", "Type"]),
        ("Thermal Bridging Elements", &["Name", "Zone", "Type"]),
        ("Window Shading", &["Name", "Zone", "Type"]),
        ("Lighting", &["Name", "Zone"]),
        ("Ventilation Systems", &["Name", "Type"]),
        ("Combustion Appliances", &["Name", "Type"]),
        ("Water Pipework", &["Name", "Type"]),
        ("Wet Emitters", &["Name", "Zone", "Type"]),
        ("Appliances", &["Name", "Type"]),
        ("Hot Water Outlets", &["Name", "Type"]),
        ("Context Shading", &["Name", "Type"]),
        (
            "Space Labels",
            &["Name", "Zone", "storey", "room_type", "coords"],
        ),
    ];
}
