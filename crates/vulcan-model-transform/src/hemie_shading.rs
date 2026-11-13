// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEMIE shading for existing buildings. HEMIE takes categories, not measured objects:
//! - Distant shading: four 90° segments centred on the reference orientation (segment 1) and
//!   clockwise from it, each with a level of sky blocked and whether the roof is shaded. The
//!   `HEMIE_distant_shading` setting states them, else they are derived from Context Shading.
//! - Close shading: a category per kind on each window (`overhang`, `side_fin_left`,
//!   `side_fin_right`, `obstacle`), stated on the window row. A measured Window Shading row
//!   needs the category of its kind. Reveals are not sent (see `NO_REVEAL`).

use super::{error, notice, quoted, Ctx, El, Settings, SETTING, STOREY_GAP};
use crate::finalization::SchemaOmission;
use crate::ValidationError;
use serde_json::{json, Map, Value};

/// HEMIE's segment keys, segment 1 to 4.
const SEGMENTS: [&str; 4] = [
    "shading_segment_reference_orientation",
    "reference_segment_reference_orientation_plus_90",
    "reference_segment_reference_orientation_plus_180",
    "reference_segment_reference_orientation_plus_270",
];

/// DESNZ-defined (HEMIE code): the floor-to-floor height HEMIE gives each storey below the
/// dwelling when it takes the base height from the base storey (2.2 m plus the storey gap).
const STOREY_BELOW: f64 = 2.2 + STOREY_GAP;

/// DESNZ-defined: the level for a fraction of sky blocked. Bands: very heavy over 90%, heavy
/// 60–90%, average ("Moderate" in HEMIE) 40–60%, light 10–40%, very light under 10% (open sky
/// included: there is no "none"). ours: a fraction on a shared bound takes the heavier level.
fn level(blocked: f64) -> &'static str {
    match blocked {
        f if f > 0.9 => "Very heavy",
        f if f >= 0.6 => "Heavy",
        f if f >= 0.4 => "Moderate",
        f if f >= 0.1 => "Light",
        _ => "Very light",
    }
}

fn num(row: &super::Row, keys: &[&str]) -> Option<f64> {
    let value = keys.iter().find_map(|k| row.get(*k))?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse().ok())
        .filter(|v: &f64| v.is_finite())
}

fn text<'r>(row: &'r super::Row, keys: &[&str]) -> Option<&'r str> {
    keys.iter()
        .find_map(|k| row.get(*k)?.as_str())
        .filter(|s| !s.is_empty())
}

/// A drawn Context Shading object as the sky sees it from the lowest storey.
struct Object<'r> {
    name: &'r str,
    start: f64,
    end: f64,
    /// Elevation (°) of its top (obstacle) or of its underside (overhang).
    angle: f64,
    overhang: bool,
    /// Height above the ventilation zone base.
    height: f64,
}

impl Object<'_> {
    fn covers(&self, azimuth: f64) -> bool {
        let span = self.end - self.start;
        span.abs() >= 360.0 || (azimuth - self.start).rem_euclid(360.0) < span.rem_euclid(360.0)
    }
}

/// The fraction of the sky dome from the horizon to overhead blocked at one azimuth: an obstacle
/// blocks up to its angle, an overhang above its angle.
fn blocked_at(objects: &[Object], azimuth: f64) -> f64 {
    let (mut below, mut above) = (0.0_f64, 90.0_f64);
    for o in objects.iter().filter(|o| o.covers(azimuth)) {
        if o.overhang {
            above = above.min(o.angle);
        } else {
            below = below.max(o.angle);
        }
    }
    ((below + 90.0 - above) / 90.0).min(1.0)
}

/// DESNZ-defined (TN-007 2.2): the share of a segment's sky dome the objects block, the mean of
/// the blocked elevation over the segment's azimuths. Exact: the blocked elevation changes only
/// at an object's start or end.
fn blocked(objects: &[Object], centre: f64) -> f64 {
    let lo = centre - 45.0;
    let mut cuts = vec![lo, lo + 90.0];
    for o in objects {
        for a in [o.start, o.end] {
            let a = lo + (a - lo).rem_euclid(360.0);
            if a < lo + 90.0 {
                cuts.push(a);
            }
        }
    }
    cuts.sort_by(f64::total_cmp);
    cuts.windows(2)
        .map(|w| (w[1] - w[0]) * blocked_at(objects, (w[0] + w[1]) / 2.0))
        .sum::<f64>()
        / 90.0
}

/// HEMIE's distant shading input, from the setting or the Context Shading drawn around
/// `geometry` (the HEMIE Geometry input).
pub(super) fn distant(
    settings: &Settings,
    geometry: &Value,
    notices: &mut Vec<SchemaOmission>,
) -> Result<Value, ValidationError> {
    let rows = settings
        .csv
        .get("Context Shading")
        .map_or(&[][..], Vec::as_slice);
    let field = format!("{SETTING}distant_shading");
    if let Some(stated) = settings.raw(&field) {
        let parsed = match stated {
            Value::String(s) => serde_json::from_str::<Map<String, Value>>(s).ok(),
            Value::Object(map) => Some(map.clone()),
            _ => None,
        };
        let Some(segments) = parsed else {
            return Err(error("/Metadata".into(), format!("The model setting {field} is malformed. Give a JSON object of HEMIE's four segments, for example {{\"{}\": {{\"shading_fraction\": \"Light\", \"roof_shading\": false}}, …}}.", SEGMENTS[0])));
        };
        if !rows.is_empty() {
            notices.push(notice("/ExternalConditions/shading_segments", format!("The model setting {field} states the distant shading, so the Context Shading rows are not used.")));
        }
        return Ok(json!({"model_type": "hemie", "DwellingShadingSegments": segments}));
    }

    // Measured from the lowest storey (DESNZ-defined): the ventilation zone base height, or as
    // HEMIE takes it from the base storey.
    let base = geometry["ventilation_zone_base_height"]
        .as_f64()
        .or_else(|| Some(geometry["base_storey_of_dwelling"].as_f64()? * STOREY_BELOW))
        .unwrap_or(0.0);
    // As HEMIE derives the dwelling height: the tallest part's storeys and the gaps between them.
    let dwelling_height = geometry["building_parts"]
        .as_object()
        .into_iter()
        .flat_map(|parts| parts.values())
        .map(|part| {
            let ceilings: Vec<f64> = part["storeys"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|s| s["ceiling_height"].as_f64())
                .collect();
            ceilings.iter().sum::<f64>() + STOREY_GAP * (ceilings.len() as f64 - 1.0)
        })
        .fold(0.0, f64::max);
    let reference = geometry["reference_orientation"].as_f64().unwrap_or(0.0);

    let mut objects = Vec::new();
    for row in rows {
        let name = text(row, &["Name"]).unwrap_or_default();
        let kind = text(row, &["shading_type", "Type"]);
        let (Some(start), Some(end), Some(kind @ ("obstacle" | "overhang"))) = (
            num(row, &["start_angle", "start angle"]),
            num(row, &["end_angle", "end angle"]),
            kind,
        ) else {
            continue; // the full-input converter reports the row (E027)
        };
        let (Some(height), Some(distance)) = (num(row, &["height"]), num(row, &["distance"]))
        else {
            return Err(error(super::json_pointer(&["Context Shading", name]), format!("Context Shading row '{name}' has no height or distance, which HEMIE's distant shading is measured from. Give both.")));
        };
        // DESNZ-defined: objects below the lowest storey are ignored.
        let height = height - base;
        if height <= 0.0 && kind == "obstacle" {
            continue;
        }
        objects.push(Object {
            name,
            start,
            end,
            angle: height.max(0.0).atan2(distance).to_degrees(),
            overhang: kind == "overhang",
            height,
        });
    }

    let mut segments = Map::new();
    let mut described = Vec::new();
    for (k, key) in SEGMENTS.iter().enumerate() {
        let centre = (reference + 90.0 * k as f64).rem_euclid(360.0);
        let fraction = blocked(&objects, centre);
        // ours (DESNZ: "tall enough to affect the roof"): the roof is shaded when an object in
        // the segment rises above the dwelling, as HEMIE's unshaded-roof object stops at its
        // height (TN-007 2.2).
        let tall: Vec<&str> = objects
            .iter()
            .filter(|o| o.height > dwelling_height)
            .filter(|o| (0..90).any(|d| o.covers(centre - 44.5 + f64::from(d))))
            .map(|o| o.name)
            .collect();
        let shading = level(fraction);
        segments.insert(
            (*key).into(),
            json!({"shading_fraction": shading, "roof_shading": !tall.is_empty()}),
        );
        described.push(format!(
            "segment {} ({centre:.0}°) {:.0}% {shading}, roof {}",
            k + 1,
            fraction * 100.0,
            if tall.is_empty() {
                "not shaded".to_string()
            } else {
                format!("shaded by {}", quoted(&tall))
            }
        ));
    }
    let source = if objects.is_empty() {
        "No Context Shading rises above the lowest storey, so each segment is open sky".to_string()
    } else {
        format!("HEMIE's distant shading is derived from the Context Shading as the share of sky blocked from {base:.2} m (the lowest storey), with the roof shaded where an object rises above the dwelling's {dwelling_height:.2} m")
    };
    notices.push(notice(
        "/ExternalConditions/shading_segments",
        format!("{source}: {}.", described.join("; ")),
    ));
    Ok(json!({"model_type": "hemie", "DwellingShadingSegments": segments}))
}

/// The HEMIE field for a measured Window Shading type, and the categories it takes.
const KINDS: [(&str, &str, &str); 4] = [
    ("overhang", "overhang", "common roof, common open porch, small fixed canopy, small veranda, large canopy, extended or balcony"),
    ("sidefinleft", "side_fin_left", "opaque, frosted glass or bars"),
    ("sidefinright", "side_fin_right", "opaque, frosted glass or bars"),
    ("object", "obstacle", "front balcony facade"),
];

/// Why no reveal is sent: HEMIE 0.18.1's only reveal category ("deep window") expands to a
/// window shading object of type "reveal", which HEM Core 2.0.0a4 rejects.
const NO_REVEAL: &str = "HEMIE's reveal category does not run in this release (HEM Core rejects a reveal), so no reveal is sent";

/// The window's close-shading categories. Stated categories are the assessor's; a measured
/// Window Shading row needs the category of its kind (what the feature is: a canopy or a
/// balcony, opaque or frosted, is not in the drawing). Reveals are not sent (`NO_REVEAL`).
pub(super) fn close(ctx: &mut Ctx, e: &El, w: &mut Value) {
    for field in ["overhang", "side_fin_left", "side_fin_right", "obstacle"] {
        if let Some(category) = e.get(field) {
            w[field] = category.clone();
        }
    }
    if let Some(stated) = e.get("reveal") {
        ctx.errors.push(error(
            e.path(),
            format!(
                "Window '{}' states reveal {stated}. {NO_REVEAL}: remove the reveal category.",
                e.name
            ),
        ));
    }
    let mut shown = Vec::new();
    for row in ctx
        .settings
        .csv
        .get("Window Shading")
        .into_iter()
        .flatten()
        .filter(|r| text(r, &["linked_window"]) == Some(e.name))
    {
        let kind = text(row, &["Type", "shading_type"]).unwrap_or("object");
        let depth = num(row, &["depth"]);
        let measured = match depth {
            Some(d) => format!("{kind} {d} m deep"),
            None => kind.to_string(),
        };
        if kind == "reveal" {
            shown.push(format!("{measured}: {NO_REVEAL}"));
            continue;
        }
        let Some((_, field, choices)) = KINDS.iter().find(|(k, _, _)| *k == kind) else {
            ctx.errors.push(error(
                e.path(),
                format!(
                    "Window '{}' has Window Shading of type '{kind}', which HEMIE does not take.",
                    e.name
                ),
            ));
            continue;
        };
        match w.get(*field) {
            Some(stated) => shown.push(format!("{measured} → stated {field} {stated}")),
            None => ctx.errors.push(error(e.path(), format!("Window '{}' has a measured {measured}. HEMIE takes its category, not its size: give the window its {field} ({choices}).", e.name))),
        }
    }
    if !shown.is_empty() {
        ctx.notices.push(notice(
            &e.path(),
            format!("Window '{}' close shading: {}.", e.name, shown.join("; ")),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{box_walls, csv, gable_roof, ground, house, run, BOX, SETTINGS};
    use super::*;

    fn geometry(reference: f64) -> Value {
        json!({"reference_orientation": reference, "ventilation_zone_base_height": 0.0,
            "building_parts": {"Main": {"storeys": [{"ceiling_height": 2.5}, {"ceiling_height": 2.5}]}}})
    }

    fn derive(rows: &[&str], reference: f64) -> (Value, Vec<SchemaOmission>) {
        let text = format!(
            "Context Shading\nName,Type,shading_type,start_angle,end_angle,distance,height\n{}\n",
            rows.join("\n")
        );
        let csv = crate::parser::CSVParser::new()
            .parse_csv(&text)
            .expect("csv");
        let settings = Settings {
            csv: &csv,
            missing: Default::default(),
        };
        let mut notices = Vec::new();
        let value = distant(&settings, &geometry(reference), &mut notices).expect("derived");
        (value["DwellingShadingSegments"].clone(), notices)
    }

    #[test]
    fn a_full_width_obstacle_blocks_its_angle_over_90_degrees() {
        // 10 m high at 10 m: 45° of 90°, half the sky, across the whole south segment.
        let (s, _) = derive(&["Block,ContextShading,obstacle,135,225,10,10"], 180.0);
        assert_eq!(s[SEGMENTS[0]]["shading_fraction"], "Moderate");
        // It rises above the 5.25 m dwelling, so the roof is shaded.
        assert_eq!(s[SEGMENTS[0]]["roof_shading"], true);
        for key in &SEGMENTS[1..] {
            assert_eq!(
                s[*key],
                json!({"shading_fraction": "Very light", "roof_shading": false})
            );
        }
    }

    #[test]
    fn a_narrow_obstacle_counts_for_its_share_of_the_segment() {
        // 45° high over 60° of the 90° segment: a third of the sky.
        let (s, notices) = derive(&["Block,ContextShading,obstacle,330,30,10,10"], 0.0);
        assert_eq!(s[SEGMENTS[0]]["shading_fraction"], "Light");
        assert!(
            notices[0].message.contains("segment 1 (0°) 33% Light"),
            "{notices:?}"
        );
        // A low wall shades the walls only.
        let (s, _) = derive(&["Wall,ContextShading,obstacle,135,225,8,3"], 180.0);
        assert_eq!(s[SEGMENTS[0]]["roof_shading"], false);
        // Segments follow the reference orientation clockwise: east is segment 2 from north.
        let (s, _) = derive(&["Hill,ContextShading,obstacle,45,135,100,1000"], 0.0);
        assert_eq!(s[SEGMENTS[1]]["shading_fraction"], "Very heavy");
    }

    #[test]
    fn an_overhang_blocks_the_sky_above_it_and_obstacles_below_the_storey_are_ignored() {
        let (s, _) = derive(&["Canopy,ContextShading,overhang,135,225,10,10"], 180.0);
        assert_eq!(s[SEGMENTS[0]]["shading_fraction"], "Moderate");
        let (s, notices) = derive(&["Fence,ContextShading,obstacle,135,225,3,0"], 180.0);
        assert_eq!(s[SEGMENTS[0]]["shading_fraction"], "Very light");
        assert!(notices[0]
            .message
            .starts_with("No Context Shading rises above"));
    }

    #[test]
    fn levels_follow_the_desnz_bands() {
        assert_eq!(
            [0.0, 0.09, 0.1, 0.39, 0.4, 0.59, 0.6, 0.9, 0.91].map(level),
            [
                "Very light",
                "Very light",
                "Light",
                "Light",
                "Moderate",
                "Moderate",
                "Heavy",
                "Heavy",
                "Very heavy"
            ]
        );
    }

    fn window_house(window_extra: &str, shading_rows: &str) -> String {
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed.extend(gable_roof());
        exposed.push(format!(
            "W1,Z,BuildingElementTransparent,2,90,1,1.2,180,1,FALSE,FALSE,W00,\"1,0,0|2,0,0\",\"{{\"\"window_sections\"\":[{{\"\"window_type\"\":\"\"full opening\"\"}}]{}}}\"",
            window_extra.replace('"', "\"\"")
        ));
        let settings = format!("{SETTINGS}\nHEMIE_construction_window,\"{{\"\"frame_material\"\":\"\"wood or PVC\"\",\"\"glazing_type\"\":\"\"single\"\",\"\"areal_heat_capacity\"\":0}}\"");
        let extra = format!(
            "{}\n\nWindow Shading\nName,Zone,Type,linked_window,depth,height,distance,transparency\n{shading_rows}",
            ground(&BOX)
        );
        csv(&settings, &exposed, &extra)
    }

    fn window_of(model: &Value) -> Value {
        model["Zone"]["building_parts"]["Main"]["walls"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|w| w["windows"].as_array().cloned().unwrap_or_default())
            .next()
            .expect("window")
    }

    #[test]
    fn a_reveal_is_not_sent_as_hem_core_rejects_it() {
        let (model, errors, notices) = run(&window_house("", "R,Z,reveal,W1,0.2,,0.03,"));
        assert!(errors.is_empty(), "{errors:#?}");
        assert!(window_of(&model).get("reveal").is_none());
        assert!(notices.iter().any(|n| n
            .message
            .contains("reveal 0.2 m deep: HEMIE's reveal category does not run")));
        let (_, errors, _) = run(&window_house(r#","reveal":"deep window""#, ""));
        assert!(
            errors
                .iter()
                .any(|e| e.message.contains("remove the reveal category")),
            "{errors:#?}"
        );
    }

    #[test]
    fn a_measured_overhang_needs_its_stated_category() {
        let (_, errors, _) = run(&window_house("", "C,Z,overhang,W1,0.6,,0.1,"));
        assert!(
            errors.iter().any(|e| e.path == "/Zone/Z/BuildingElement/W1"
                && e.message.contains("measured overhang 0.6 m deep")
                && e.message.contains("give the window its overhang")),
            "{errors:#?}"
        );
        let (model, errors, notices) = run(&window_house(
            r#","overhang":"small fixed canopy","side_fin_left":"opaque""#,
            "C,Z,overhang,W1,0.6,,0.1,",
        ));
        assert!(errors.is_empty(), "{errors:#?}");
        let w = window_of(&model);
        assert_eq!(w["overhang"], "small fixed canopy");
        assert_eq!(w["side_fin_left"], "opaque");
        assert!(notices.iter().any(|n| n
            .message
            .contains("overhang 0.6 m deep → stated overhang \"small fixed canopy\"")));
    }

    #[test]
    fn the_model_takes_hemie_distant_shading() {
        let (model, errors, _) = run(&house(gable_roof()));
        assert!(errors.is_empty(), "{errors:#?}");
        let shading = &model["ExternalConditions"]["shading_segments"];
        assert_eq!(shading["model_type"], "hemie");
        assert_eq!(
            shading["DwellingShadingSegments"][SEGMENTS[2]]["shading_fraction"],
            "Very light"
        );
    }
}
