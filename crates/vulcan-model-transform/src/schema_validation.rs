// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

use serde_json::Value;

const LEGACY_DRAFT_2019_09_HTTP_URI: &str = "http://json-schema.org/draft/2019-09/schema#";
const DRAFT_2019_09_HTTPS_URI: &str = "https://json-schema.org/draft/2019-09/schema";
const LEGACY_DRAFT_2020_12_HTTP_URI: &str = "http://json-schema.org/draft/2020-12/schema#";
const DRAFT_2020_12_HTTPS_URI: &str = "https://json-schema.org/draft/2020-12/schema";

fn normalize_schema_document_in_place(value: &mut Value) {
    match value {
        Value::Object(map) => {
            if let Some(schema_uri) = map.get("$schema").and_then(Value::as_str) {
                let replacement = match schema_uri {
                    LEGACY_DRAFT_2019_09_HTTP_URI => Some(DRAFT_2019_09_HTTPS_URI),
                    LEGACY_DRAFT_2020_12_HTTP_URI => Some(DRAFT_2020_12_HTTPS_URI),
                    _ => None,
                };
                if let Some(next) = replacement {
                    map.insert("$schema".to_string(), Value::String(next.to_string()));
                }
            }
            for child in map.values_mut() {
                normalize_schema_document_in_place(child);
            }
        }
        Value::Array(items) => {
            for item in items {
                normalize_schema_document_in_place(item);
            }
        }
        _ => {}
    }
}

pub fn normalized_schema_document(mut value: Value) -> Value {
    normalize_schema_document_in_place(&mut value);
    value
}
