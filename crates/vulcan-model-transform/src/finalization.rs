// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Schema projection shared by standalone conversion and changed scenarios.
//! Projection uses declarations, never validator error lists: a failed conditional
//! can report valid declared fields as unevaluated alongside the actual error.
use crate::{
    clone_for_hem_validation, schema_validation::normalized_schema_document, ValidationError,
    ValidationResult,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SchemaOmission {
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinalizedModel {
    pub model: Value,
    pub omissions: Vec<SchemaOmission>,
    pub validation: ValidationResult,
}

pub fn finalize_model(candidate: &Value, schema: &Value) -> Result<FinalizedModel, String> {
    let (model, omissions) = project_model(candidate, schema)?;
    let schema = normalized_schema_document(schema.clone());
    let validator = jsonschema::validator_for(&schema).map_err(|e| e.to_string())?;
    let validation_model = clone_for_hem_validation(&model);
    let errors = validator
        .iter_errors(&validation_model)
        .map(|e| {
            let schema_path = e.schema_path().to_string();
            ValidationError {
                code: "E026".into(),
                path: e.instance_path().to_string(),
                message: e.to_string(),
                keyword: schema_path.rsplit('/').next().map(str::to_owned),
                schema_path: Some(schema_path),
            }
        })
        .collect::<Vec<_>>();
    Ok(FinalizedModel {
        model,
        omissions,
        validation: ValidationResult {
            is_valid: errors.is_empty(),
            errors,
        },
    })
}

/// The source is never mutated. `General.built_form` is product/SAP metadata;
/// retain it in the prepared model and exclude it only at the engine boundary.
pub fn project_model(
    candidate: &Value,
    schema: &Value,
) -> Result<(Value, Vec<SchemaOmission>), String> {
    let schema = normalized_schema_document(schema.clone());
    let mut model = candidate.clone();
    let mut omissions = Vec::new();
    loop {
        let prior_omissions = omissions.len();
        project(&mut model, &[&schema], &schema, "", &mut omissions)?;
        // Removing an undeclared condition input can change the applicable branch.
        // Projection only removes fields, so reaching no further omissions terminates.
        if omissions.len() == prior_omissions {
            break;
        }
    }
    omissions.sort_by(|a, b| a.path.cmp(&b.path));
    Ok((model, omissions))
}

fn pointer(path: &str, key: &str) -> String {
    format!("{}/{}", path, key.replace('~', "~0").replace('/', "~1"))
}

fn resolve<'a>(schema: &'a Value, root: &'a Value) -> Result<&'a Value, String> {
    let Some(reference) = schema.get("$ref").and_then(Value::as_str) else {
        return Ok(schema);
    };
    let fragment = reference
        .strip_prefix('#')
        .ok_or_else(|| format!("Unsupported external schema reference {reference}"))?;
    root.pointer(fragment)
        .ok_or_else(|| format!("Unresolved schema reference {reference}"))
}

fn matches_condition(condition: &Value, instance: &Value, root: &Value) -> Result<bool, String> {
    let mut document = json!({"allOf": [condition]});
    for key in ["$schema", "$defs", "definitions"] {
        if let Some(value) = root.get(key) {
            document[key] = value.clone();
        }
    }
    jsonschema::validator_for(&document)
        .map(|v| v.is_valid(instance))
        .map_err(|e| e.to_string())
}

// Select variants by value kind and explicit discriminators, not by full validity.
// An invalid declared optional field must not deselect its own branch. Ambiguous
// alternatives are preserved unchanged, leaving validation to report ambiguity.
fn compatible(
    schema: &Value,
    instance: &Value,
    root: &Value,
    depth: usize,
) -> Result<bool, String> {
    if depth > 128 {
        return Err("Schema reference nesting exceeds 128".into());
    }
    let resolved = resolve(schema, root)?;
    if !std::ptr::eq(resolved, schema) {
        return compatible(resolved, instance, root, depth + 1);
    }
    if let Some(kind) = schema.get("type").and_then(Value::as_str) {
        let matches = match kind {
            "object" => instance.is_object(),
            "array" => instance.is_array(),
            "null" => instance.is_null(),
            "string" => instance.is_string(),
            "boolean" => instance.is_boolean(),
            "number" | "integer" => instance.is_number(),
            _ => true,
        };
        if !matches {
            return Ok(false);
        }
    }
    if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
        for (key, definition) in properties {
            if let Some(actual) = instance.get(key) {
                if let Some(expected) = definition.get("const") {
                    if actual != expected {
                        return Ok(false);
                    }
                }
                // Enumerations can constrain ordinary declared inputs, not just
                // discriminators. Invalid enum values must remain validation errors.
            }
        }
    }
    for keyword in ["oneOf", "anyOf"] {
        if let Some(branches) = schema.get(keyword).and_then(Value::as_array) {
            let mut any = false;
            for branch in branches {
                any |= compatible(branch, instance, root, depth + 1)?;
            }
            if !any {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn selected_branches<'a>(
    branches: &'a [Value],
    instance: &Value,
    root: &'a Value,
    depth: usize,
) -> Result<Vec<&'a Value>, String> {
    let mut selected = Vec::new();
    for branch in branches {
        if compatible(branch, instance, root, depth + 1)? {
            selected.push(branch);
        }
    }
    if selected.len() > 1 {
        let mut with_required = Vec::new();
        for branch in &selected {
            let resolved = resolve(branch, root)?;
            let present = resolved
                .get("required")
                .and_then(Value::as_array)
                .is_none_or(|required| {
                    required
                        .iter()
                        .filter_map(Value::as_str)
                        .all(|key| instance.get(key).is_some())
                });
            if present {
                with_required.push(*branch);
            }
        }
        // Do not erase an invalid declared field by selecting a branch based on
        // its validation result. Only presence distinguishes structural alternatives.
        if !with_required.is_empty() {
            selected = with_required;
        }
    }
    Ok(selected)
}

fn applicable<'a>(
    schema: &'a Value,
    instance: &Value,
    root: &'a Value,
    nodes: &mut Vec<&'a Value>,
    depth: usize,
) -> Result<(), String> {
    if depth > 128 {
        return Err("Schema reference nesting exceeds 128".into());
    }
    nodes.push(schema);
    let resolved = resolve(schema, root)?;
    if !std::ptr::eq(resolved, schema) {
        applicable(resolved, instance, root, nodes, depth + 1)?;
    }
    if let Some(all) = schema.get("allOf").and_then(Value::as_array) {
        for branch in all {
            applicable(branch, instance, root, nodes, depth + 1)?;
        }
    }
    if let Some(condition) = schema.get("if") {
        let matches = matches_condition(condition, instance, root)?;
        // A successful `if` also evaluates its property declarations.
        if matches {
            applicable(condition, instance, root, nodes, depth + 1)?;
        }
        let branch = if matches { "then" } else { "else" };
        if let Some(branch) = schema.get(branch) {
            applicable(branch, instance, root, nodes, depth + 1)?;
        }
    }
    for keyword in ["oneOf", "anyOf"] {
        if let Some(branches) = schema.get(keyword).and_then(Value::as_array) {
            let selected = selected_branches(branches, instance, root, depth)?;
            if selected.len() == 1 {
                applicable(selected[0], instance, root, nodes, depth + 1)?;
            }
        }
    }
    Ok(())
}

fn key_matches(pattern: &str, key: &str) -> Result<bool, String> {
    let schema = json!({"type":"string", "pattern":pattern});
    jsonschema::validator_for(&schema)
        .map(|v| v.is_valid(&Value::String(key.into())))
        .map_err(|e| e.to_string())
}

fn project(
    value: &mut Value,
    schemas: &[&Value],
    root: &Value,
    path: &str,
    omissions: &mut Vec<SchemaOmission>,
) -> Result<(), String> {
    let mut nodes = Vec::new();
    for schema in schemas {
        applicable(schema, value, root, &mut nodes, 0)?;
    }
    let mut ambiguous = false;
    for node in &nodes {
        for keyword in ["oneOf", "anyOf"] {
            if let Some(branches) = node.get(keyword).and_then(Value::as_array) {
                let count = selected_branches(branches, value, root, 0)?.len();
                ambiguous |= count != 1;
            }
        }
    }
    if let Some(object) = value.as_object_mut() {
        let keys = object.keys().cloned().collect::<Vec<_>>();
        let mut removed = BTreeSet::new();
        for key in keys {
            if path == "/General" && key == "built_form" {
                continue;
            }
            let mut children = Vec::new();
            let mut declared = false;
            let mut local_forbidden = false;
            let mut unevaluated_closed = false;
            for node in &nodes {
                unevaluated_closed |=
                    node.get("unevaluatedProperties") == Some(&Value::Bool(false));
                let mut locally_declared = false;
                if let Some(property) = node.get("properties").and_then(|p| p.get(&key)) {
                    locally_declared = true;
                    children.push(property);
                }
                if let Some(patterns) = node.get("patternProperties").and_then(Value::as_object) {
                    for (pattern, child) in patterns {
                        if key_matches(pattern, &key)? {
                            locally_declared = true;
                            children.push(child);
                        }
                    }
                }
                declared |= locally_declared;
                if !locally_declared {
                    match node.get("additionalProperties") {
                        Some(Value::Bool(false)) => local_forbidden = true,
                        Some(Value::Bool(true)) => declared = true,
                        Some(child) if child.is_object() => {
                            declared = true;
                            children.push(child);
                        }
                        _ => {}
                    }
                }
            }
            // Ambiguous unions are validation errors, not permission to erase fields.
            if local_forbidden || (unevaluated_closed && !declared && !ambiguous) {
                removed.insert(key.clone());
                omissions.push(SchemaOmission { code:"TARGET_FIELD_OMITTED".into(), path:pointer(path, &key), message:"Field is not allowed by the selected target schema in this context; the authored source is preserved.".into() });
            } else if !children.is_empty() {
                project(
                    object.get_mut(&key).unwrap(),
                    &children,
                    root,
                    &pointer(path, &key),
                    omissions,
                )?;
            }
        }
        for key in removed {
            object.remove(&key);
        }
    } else if let Some(array) = value.as_array_mut() {
        for (index, child) in array.iter_mut().enumerate() {
            let children = nodes
                .iter()
                .filter_map(|n| {
                    n.get("prefixItems")
                        .and_then(Value::as_array)
                        .and_then(|p| p.get(index))
                        .or_else(|| n.get("items"))
                })
                .collect::<Vec<_>>();
            if !children.is_empty() {
                project(
                    child,
                    &children,
                    root,
                    &pointer(path, &index.to_string()),
                    omissions,
                )?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conditional_invalid_declared_data_survives_and_obsolete_fields_are_reported() {
        let schema = json!({"type":"object","properties":{"type":{"type":"string"}},"allOf":[{"if":{"properties":{"type":{"const":"window"}}},"then":{"properties":{"parts":{"type":"array"},"width":{"type":"number"}}}}],"unevaluatedProperties":false});
        let source = json!({"type":"window","parts":"invalid","width":2,"obsolete":1});
        let output = finalize_model(&source, &schema).unwrap();
        assert_eq!(
            output.model,
            json!({"type":"window","parts":"invalid","width":2})
        );
        assert!(!output.validation.is_valid);
        assert_eq!(output.omissions[0].path, "/obsolete");
        assert_eq!(source["obsolete"], 1);
        let again = finalize_model(&output.model, &schema).unwrap();
        assert_eq!(again.model, output.model);
        assert!(again.omissions.is_empty());
        assert_eq!(again.validation, output.validation);
    }
    #[test]
    fn named_entries_refs_and_arrays_are_projected() {
        let schema = json!({"$defs":{"entry":{"properties":{"parts":{"type":"array","items":{"properties":{"height":{}},"additionalProperties":false}}},"unevaluatedProperties":false}},"additionalProperties":{"$ref":"#/$defs/entry"}});
        let output = finalize_model(
            &json!({"name/a":{"parts":[{"height":2,"legacy":3}],"obsolete":4}}),
            &schema,
        )
        .unwrap();
        assert_eq!(output.model, json!({"name/a":{"parts":[{"height":2}]}}));
        assert_eq!(
            output
                .omissions
                .iter()
                .map(|o| o.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/name~1a/obsolete", "/name~1a/parts/0/legacy"]
        );
    }
    #[test]
    fn additional_properties_is_local_but_unevaluated_properties_spans_applicable_branches() {
        let base = json!({"properties":{"a":{}},"allOf":[{"properties":{"b":{}}}],"unevaluatedProperties":false});
        assert_eq!(
            project_model(&json!({"a":1,"b":2,"c":3}), &base).unwrap().0,
            json!({"a":1,"b":2})
        );
        let local = json!({"properties":{"a":{}},"allOf":[{"properties":{"b":{}}}],"additionalProperties":false});
        assert_eq!(
            project_model(&json!({"a":1,"b":2}), &local).unwrap().0,
            json!({"a":1})
        );
    }
    #[test]
    fn scalar_bridges_and_invalid_optional_values_remain_invalid() {
        let schema = json!({"properties":{"ThermalBridging":{"type":"object"},"optional":{"type":"number"}},"unevaluatedProperties":false});
        let output =
            finalize_model(&json!({"ThermalBridging":0.1,"optional":"bad"}), &schema).unwrap();
        assert!(!output.validation.is_valid);
        assert!(output.omissions.is_empty());
        assert_eq!(output.model["ThermalBridging"], 0.1);
    }
}

#[cfg(test)]
mod conditional_regressions {
    use super::*;
    #[test]
    fn named_pattern_and_else_fields_follow_context_without_erasing_invalid_data() {
        let schema = json!({"patternProperties":{"^system_":{"properties":{"mode":{}},"if":{"properties":{"mode":{"const":"MVHR"}}},"then":{"properties":{"ductwork":{"type":"array"}}},"else":{"properties":{"airflow":{"type":"number"}}},"unevaluatedProperties":false}},"additionalProperties":false});
        let output = finalize_model(
            &json!({"system_one":{"mode":"MVHR","ductwork":"bad","airflow":5,"legacy":8}}),
            &schema,
        )
        .unwrap();
        assert_eq!(
            output.model,
            json!({"system_one":{"mode":"MVHR","ductwork":"bad"}})
        );
        assert!(!output.validation.is_valid);
        assert_eq!(output.omissions.len(), 2);
    }
    #[test]
    fn changing_condition_after_removal_is_finalized_in_one_call() {
        let schema = json!({"if":{"required":["switch"]},"then":{"properties":{"x":{}}},"else":{"properties":{"y":{}}},"unevaluatedProperties":false});
        let output = finalize_model(&json!({"switch":true,"x":2}), &schema).unwrap();
        let again = finalize_model(&output.model, &schema).unwrap();
        assert_eq!(output.model, again.model);
        assert!(again.omissions.is_empty());
    }
    #[test]
    fn invalid_optional_enum_does_not_select_a_branch_that_erases_it() {
        let schema = json!({"oneOf":[{"properties":{"mode":{"enum":["valid"]}},"additionalProperties":false},{"properties":{},"additionalProperties":false}],"unevaluatedProperties":false});
        let source = json!({"mode":"invalid"});
        let output = finalize_model(&source, &schema).unwrap();
        assert_eq!(output.model, source);
        assert!(!output.validation.is_valid);
        assert!(output.omissions.is_empty());
    }
    #[test]
    fn ambiguous_variants_never_become_valid_by_erasure() {
        let schema = json!({"oneOf":[{"properties":{"a":{"type":"number"}},"additionalProperties":false},{"properties":{"b":{"type":"number"}},"additionalProperties":false}],"unevaluatedProperties":false});
        let source = json!({"a":"bad","b":2});
        let output = finalize_model(&source, &schema).unwrap();
        assert_eq!(output.model, source);
        assert!(!output.validation.is_valid);
        assert!(output.omissions.is_empty());
    }
}
