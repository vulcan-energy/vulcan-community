// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Stable, host-independent diagnostics for upstream FHS preflight failures.

use serde_json::{json, Value};

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    let haystack = haystack.as_bytes();
    let needle = needle.as_bytes();
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    (0..=(haystack.len() - needle.len()))
        .find(|&index| haystack[index..index + needle.len()].eq_ignore_ascii_case(needle))
}

fn strip_invalid_request_prefix(raw_error: &str) -> &str {
    const REQUEST_LINE: &str = "Request was considered invalid due to error: ";
    const REQUEST_BLOCK: &str = "Request was considered invalid due to error:\n";
    raw_error
        .trim()
        .strip_prefix(REQUEST_BLOCK)
        .or_else(|| raw_error.trim().strip_prefix(REQUEST_LINE))
        .unwrap_or(raw_error)
        .trim_start()
}

fn json_pointer_segment(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

fn extract_between<'a>(value: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let from = value.find(start)? + start.len();
    let to = value[from..].find(end)? + from;
    Some(&value[from..to])
}

fn fhs_preflight_error(
    path: String,
    code: &str,
    category: &str,
    message: &str,
    user_message: &str,
    technical_message: &str,
) -> Value {
    json!({
        "path": path,
        "code": code,
        "category": category,
        "message": message,
        "user_message": user_message,
        "technical_message": technical_message.trim(),
    })
}

/// Build the fallback diagnostic used when no more specific upstream failure
/// classification applies.
pub fn generic_fhs_preflight_error(technical_message: &str) -> Value {
    let technical_message = technical_message.trim();
    fhs_preflight_error(
        "/".to_string(),
        "fhs_preflight",
        "fhs_preflight",
        if technical_message.is_empty() {
            "FHS compliance preprocessing failed."
        } else {
            technical_message
        },
        "Check FHS inputs.",
        technical_message,
    )
}

/// Classify one upstream FHS preflight failure without hiding unknown messages.
pub fn classify_fhs_preflight_error_line(message: &str) -> Value {
    let technical_message = message.trim();
    let lower = technical_message.to_ascii_lowercase();

    if lower.starts_with("bath too small") || lower.contains("bath too small, fill_vol_l") {
        return fhs_preflight_error(
            "/HotWaterDemand/Bath".to_string(),
            "fhs_hot_water_bath_too_small",
            "hot_water",
            "Bath size is too small for FHS hot-water generation.",
            "Increase bath size.",
            technical_message,
        );
    }

    if lower.contains("dwelling lacks any mechanical vents") {
        return fhs_preflight_error(
            "/part_f".to_string(),
            "fhs_part_f",
            "part_f",
            "FHS Part F ventilation validation failed.",
            "Add mechanical ventilation.",
            technical_message,
        );
    }

    if lower.contains("fhs input validation failed") && lower.contains("part f") {
        return fhs_preflight_error(
            "/part_f".to_string(),
            "fhs_part_f",
            "part_f",
            "FHS Part F ventilation validation failed.",
            "Check ventilation.",
            technical_message,
        );
    }

    if lower.starts_with("zone '")
        && lower.contains("must contain at least one buildingelementtransparent")
    {
        let zone = extract_between(technical_message, "Zone '", "'").unwrap_or("");
        let path = if zone.is_empty() {
            "/Zone".to_string()
        } else {
            format!("/Zone/{}/BuildingElement", json_pointer_segment(zone))
        };
        let user_message = if zone.is_empty() {
            "Add a window.".to_string()
        } else {
            format!("Add a window to {zone}.")
        };
        return fhs_preflight_error(
            path,
            "fhs_window_required",
            "windows",
            "FHS requires at least one window in this zone.",
            &user_message,
            technical_message,
        );
    }

    if lower.starts_with("window '")
        && lower.contains(" has base_height ")
        && lower.contains(" below ventilation_zone_base_height")
    {
        let window = extract_between(technical_message, "Window '", "'").unwrap_or("");
        let zone = extract_between(technical_message, " in Zone '", "'").unwrap_or("");
        let path = if !zone.is_empty() && !window.is_empty() {
            format!(
                "/Zone/{}/BuildingElement/{}/base_height",
                json_pointer_segment(zone),
                json_pointer_segment(window),
            )
        } else {
            "/InfiltrationVentilation/ventilation_zone_base_height".to_string()
        };
        return fhs_preflight_error(
            path,
            "fhs_window_base_height",
            "windows",
            "Window base height is below the ventilation zone base height.",
            "Raise window base height.",
            technical_message,
        );
    }

    if lower.contains("'storeys_in_building'") && lower.contains("'storeys_in_dwelling'") {
        return fhs_preflight_error(
            "/General/storeys_in_building".to_string(),
            "fhs_storeys",
            "dwelling_details",
            "Building storeys must be at least dwelling storeys.",
            "Check building and dwelling storeys.",
            technical_message,
        );
    }

    if lower.starts_with("heatsourcewet '") && lower.contains("sleeved dhn") {
        let heat_source = extract_between(technical_message, "HeatSourceWet '", "'").unwrap_or("");
        let path = if heat_source.is_empty() {
            "/HeatSourceWet".to_string()
        } else {
            format!("/HeatSourceWet/{}", json_pointer_segment(heat_source))
        };
        return fhs_preflight_error(
            path,
            "fhs_sleeved_dhn",
            "heat_source",
            "Sleeved DHN heat sources must serve both space heating and hot water.",
            "Use sleeved DHN for space heating and hot water.",
            technical_message,
        );
    }

    generic_fhs_preflight_error(technical_message)
}

fn extract_fhs_preflight_failure_lines(raw_error: &str) -> Vec<String> {
    const PART_F_BANNER: &str =
        "FHS input validation failed, see part F of the building regulations.";
    let body = strip_invalid_request_prefix(raw_error).trim();
    if let Some(index) = find_ascii_case_insensitive(body, "Failure(s):") {
        let from = index + "Failure(s):".len();
        if from <= body.len() {
            let tail = body[from..].trim();
            if !tail.is_empty() {
                let items: Vec<String> = tail
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(ToOwned::to_owned)
                    .collect();
                if !items.is_empty() {
                    return items;
                }
            }
        }
    }

    let mut from_lines: Vec<String> = body
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.eq_ignore_ascii_case(PART_F_BANNER)
                && !line.starts_with("Request was considered invalid due to error:")
        })
        .map(ToOwned::to_owned)
        .collect();
    if !from_lines.is_empty() {
        return from_lines;
    }
    if !body.is_empty() {
        from_lines.push(body.to_string());
    }
    from_lines
}

/// Turn the upstream error report into stable structured diagnostics for UI and
/// portable-document consumers.
pub fn extract_fhs_preflight_errors(raw_error: &str) -> Vec<Value> {
    extract_fhs_preflight_failure_lines(raw_error)
        .into_iter()
        .map(|message| classify_fhs_preflight_error_line(&message))
        .collect()
}
