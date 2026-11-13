// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEMIE shading for existing buildings. HEMIE takes categories, not measured objects:
//! - Distant shading: four 90° segments centred on the reference orientation (segment 1) and
//!   clockwise from it, each with a level of sky blocked and whether the roof is shaded. Per
//!   segment: the `HEMIE_distant_shading` setting's stated level, else the level the drawn
//!   Context Shading gives, else very light (nothing drawn).
//! - Close shading: a category per kind on each window (`overhang`, `side_fin_left`,
//!   `side_fin_right`, `obstacle`), stated on the window row. A measured Window Shading row
//!   needs the category of its kind. Reveals are not sent (see `NO_REVEAL`).

use super::{error, notice, quoted, Ctx, El, Settings, SETTING, STOREY_GAP};
use crate::finalization::SchemaOmission;
use crate::ValidationError;
use serde::{Deserialize, Serialize};
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

/// The azimuths where what shades a segment can change: its bounds and each object's start and
/// end inside it, in order.
fn cuts(objects: &[Object], centre: f64) -> Vec<f64> {
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
    cuts
}

/// DESNZ-defined: the share of a segment's sky dome the objects block, the mean of the blocked
/// elevation over the segment's azimuths. Exact: the blocked elevation changes only at a cut.
fn blocked(objects: &[Object], centre: f64) -> f64 {
    cuts(objects, centre)
        .windows(2)
        .map(|w| (w[1] - w[0]) * blocked_at(objects, (w[0] + w[1]) / 2.0))
        .sum::<f64>()
        / 90.0
}

/// One distant shading segment as converted, for the editor's quadrant view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HemieQuadrant {
    /// HEMIE's segment key, which the stated setting is keyed by.
    pub key: String,
    /// "Front", "Right", "Back" or "Left", as seen looking out of the front door.
    pub name: String,
    /// Bearing of the segment's centre (°).
    pub centre: f64,
    /// The level sent, and where it comes from: "stated", "drawn" or "none" (nothing drawn).
    pub shading_fraction: String,
    pub source: String,
    /// The level the drawing gives; absent when nothing is drawn in the segment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drawn: Option<String>,
    /// Roof shading sent, and its source as for the level.
    pub roof_shading: bool,
    pub roof_source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drawn_roof: Option<bool>,
}

/// An existing building's distant shading as converted, for the editor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct HemieShading {
    /// The bearing segment 1 faces: out of the front-door wall (°).
    pub reference_orientation: f64,
    pub quadrants: Vec<HemieQuadrant>,
    /// Context Shading rows wholly in stated segments: they change nothing sent, so the editor
    /// fades them and their own issues are not raised.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unused_objects: Vec<String>,
}

const LEVELS: [&str; 5] = ["Very heavy", "Heavy", "Moderate", "Light", "Very light"];
const NAMES: [&str; 4] = ["Front", "Right", "Back", "Left"];
const SHADING_PATH: &str = "/ExternalConditions/shading_segments";

/// Plain words for a level: HEMIE's "Moderate" is the guidance's "Average".
fn plain(level: &str) -> &str {
    if level == "Moderate" {
        "Average"
    } else {
        level
    }
}

/// The stated segments: `HEMIE_distant_shading`, a JSON object keyed by HEMIE's segment keys,
/// each with an optional `shading_fraction` and `roof_shading`, and the `reference_orientation`
/// that segment was stated against (the front door then).
fn stated(settings: &Settings) -> Result<Map<String, Value>, ValidationError> {
    let field = format!("{SETTING}distant_shading");
    let Some(raw) = settings.raw(&field) else {
        return Ok(Map::new());
    };
    let parsed = match raw {
        Value::String(s) => serde_json::from_str::<Map<String, Value>>(s).ok(),
        Value::Object(map) => Some(map.clone()),
        _ => None,
    };
    let valid = parsed.filter(|map| {
        map.iter().all(|(key, value)| {
            SEGMENTS.contains(&key.as_str())
                && value.as_object().is_some_and(|v| {
                    v.iter().all(|(k, x)| match k.as_str() {
                        "shading_fraction" => x.as_str().is_some_and(|l| LEVELS.contains(&l)),
                        "roof_shading" => x.is_boolean(),
                        "reference_orientation" => x.is_number(),
                        _ => false,
                    })
                })
        })
    });
    valid.ok_or_else(|| error("/Metadata".into(), format!("The stated distant shading ({field}) is malformed. Choose each stated band again on the canvas, or give a JSON object keyed by segment, for example {{\"{}\": {{\"shading_fraction\": \"Light\"}}}}, with levels {}.", SEGMENTS[0], LEVELS.join(", "))))
}

/// HEMIE's distant shading input and the editor's view of it. Per segment, the level and roof
/// shading are each the stated value, else what the Context Shading drawn around `geometry`
/// gives, else very light and not shaded (nothing drawn). Notices name each segment's source,
/// and warn where a stated value is far from the drawing or the front door has moved since.
pub(super) fn distant(
    settings: &Settings,
    geometry: &Value,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) -> Option<(Value, HemieShading)> {
    let stated = match stated(settings) {
        Ok(stated) => stated,
        Err(e) => {
            errors.push(e);
            return None;
        }
    };
    let rows = settings
        .csv
        .get("Context Shading")
        .map_or(&[][..], Vec::as_slice);

    // Measured from the lowest storey (DESNZ-defined): the ventilation zone base height, or as
    // HEMIE takes it from the base storey.
    let base = geometry["ventilation_zone_base_height"]
        .as_f64()
        .or_else(|| Some(geometry["base_storey_of_dwelling"].as_f64()? * STOREY_BELOW))
        .expect("Geometry states a base height or base storey");
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
    let orientation = geometry["reference_orientation"]
        .as_f64()
        .expect("Geometry states its reference orientation");
    // As HEMIE centres the segments: on the whole degrees of the reference orientation.
    let reference = orientation.trunc();
    let centre = |k: usize| (reference + 90.0 * k as f64).rem_euclid(360.0);
    let in_segment = |start: f64, end: f64, k: usize| {
        let probe = Object {
            name: "",
            start,
            end,
            angle: 0.0,
            overhang: false,
            height: 0.0,
        };
        cuts(std::slice::from_ref(&probe), centre(k))
            .windows(2)
            .any(|w| probe.covers((w[0] + w[1]) / 2.0))
    };
    let is_stated = |k: usize| stated.contains_key(SEGMENTS[k]);

    let mut objects = Vec::new();
    let mut unused = Vec::new();
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
        // A row wholly in stated segments changes nothing sent (its drawn level is still shown),
        // so its own issues are not raised.
        // A row in no segment (start = end) is not wholly stated: its issues are still raised.
        let mut covered = (0..4).filter(|&k| in_segment(start, end, k)).peekable();
        let wholly_stated = covered.peek().is_some() && covered.all(is_stated);
        if wholly_stated {
            unused.push(name.to_string());
        }
        let (Some(height), Some(distance)) = (
            num(row, &["height"]),
            num(row, &["distance"]).filter(|d| *d > 0.0),
        ) else {
            if wholly_stated {
                continue;
            }
            errors.push(error(super::json_pointer(&["Context Shading", name]), format!("Context Shading row '{name}' has no height, or no distance above 0, which distant shading is measured from. Give both, or state the band of each quadrant it lies in.")));
            continue;
        };
        // DESNZ-defined: objects below the lowest storey are ignored, an overhang as well as an
        // obstacle.
        let height = height - base;
        if height <= 0.0 {
            continue;
        }
        objects.push(Object {
            name,
            start,
            end,
            angle: height.atan2(distance).to_degrees(),
            overhang: kind == "overhang",
            height,
        });
    }

    // Each stated segment faces the front door it was stated against: warn on each one the
    // front door has turned from since (by more than half a degree, either way round).
    for (k, key) in SEGMENTS.iter().enumerate() {
        let against = stated
            .get(*key)
            .and_then(|v| v.get("reference_orientation"))
            .and_then(Value::as_f64);
        let turned = against.is_none_or(|r| {
            let d = (r - orientation).rem_euclid(360.0);
            d.min(360.0 - d) > 0.5
        });
        if stated.contains_key(*key) && turned {
            let name = NAMES[k];
            notices.push(notice(&format!("{SHADING_PATH}/{name}"), format!("Front door changed: check the stated band of {name}. It is relative to the front door, so it now faces another compass direction. Choose it again, or reset it to the drawing.")));
        }
    }

    let mut segments = Map::new();
    let mut quadrants = Vec::new();
    let mut described = Vec::new();
    for (k, key) in SEGMENTS.iter().enumerate() {
        let name = NAMES[k];
        let path = format!("{SHADING_PATH}/{name}");
        let centre = centre(k);
        let cuts = cuts(&objects, centre);
        let inside: Vec<&Object> = objects
            .iter()
            .filter(|o| cuts.windows(2).any(|w| o.covers((w[0] + w[1]) / 2.0)))
            .collect();
        let fraction = blocked(&objects, centre);
        let drawn = (!inside.is_empty()).then(|| level(fraction).to_string());
        // ours: the roof is shaded when an object in the segment rises above the dwelling, as
        // HEMIE's unshaded-roof object stops at the dwelling height.
        let tall: Vec<&str> = inside
            .iter()
            .filter(|o| o.height > dwelling_height)
            .map(|o| o.name)
            .collect();
        let drawn_roof = drawn.is_some().then_some(!tall.is_empty());
        let given = stated.get(*key);
        let given_level = given.and_then(|g| g["shading_fraction"].as_str());
        let given_roof = given.and_then(|g| g["roof_shading"].as_bool());

        let (shading, source) = match (given_level, &drawn) {
            (Some(l), _) => (l.to_string(), "stated"),
            (None, Some(d)) => (d.clone(), "drawn"),
            // DESNZ-defined: open sky is very light.
            (None, None) => ("Very light".to_string(), "none"),
        };
        let (roof, roof_source) = match (given_roof, drawn_roof) {
            (Some(r), _) => (r, "stated"),
            (None, Some(r)) => (r, "drawn"),
            (None, None) => (false, "none"),
        };
        if let (Some(l), Some(d)) = (given_level, &drawn) {
            let rank = |x: &str| LEVELS.iter().position(|y| *y == x).expect("level");
            if rank(l).abs_diff(rank(d)) >= 2 {
                notices.push(notice(&path, format!("{name}: stated {}, the drawing gives {}. Check the band or reset to the drawing.", plain(l), plain(d))));
            }
        }
        if let (Some(r), Some(d)) = (given_roof, drawn_roof) {
            if r != d {
                let says = |shaded: bool| {
                    if shaded {
                        "roof shaded"
                    } else {
                        "roof not shaded"
                    }
                };
                notices.push(notice(&path, format!("{name}: stated {}, the drawing gives {}. Check roof shading or reset it to the drawing.", says(r), says(d))));
            }
        }
        if source == "none" {
            notices.push(notice(&path, format!("{name}: Very light assumed (nothing drawn). Draw what shades this side, or choose its band.")));
        }
        segments.insert(
            (*key).into(),
            json!({"shading_fraction": shading, "roof_shading": roof}),
        );
        described.push(format!(
            "{name} ({:.0}–{:.0}°) {}, {}; roof {}, {}",
            (centre - 45.0).rem_euclid(360.0),
            (centre + 45.0).rem_euclid(360.0),
            plain(&shading),
            match source {
                "drawn" => format!("from drawing ({:.0}% of the sky blocked)", fraction * 100.0),
                "none" => "nothing drawn".to_string(),
                s => s.to_string(),
            },
            if roof { "shaded" } else { "not shaded" },
            match (roof_source, tall.is_empty()) {
                ("drawn", false) => format!("from drawing ({})", quoted(&tall)),
                ("drawn", true) => "from drawing".to_string(),
                ("none", _) => "nothing drawn".to_string(),
                (s, _) => s.to_string(),
            },
        ));
        quadrants.push(HemieQuadrant {
            key: (*key).into(),
            name: name.into(),
            centre,
            shading_fraction: shading,
            source: source.into(),
            drawn,
            roof_shading: roof,
            roof_source: roof_source.into(),
            drawn_roof,
        });
    }
    notices.push(notice(
        SHADING_PATH,
        format!("Distant shading, seen from {base:.2} m (the lowest storey), the roof shaded where an object rises above the dwelling's {dwelling_height:.2} m: {}.", described.join("; ")),
    ));
    Some((
        json!({"model_type": "hemie", "DwellingShadingSegments": segments}),
        HemieShading {
            reference_orientation: orientation,
            quadrants,
            unused_objects: unused,
        },
    ))
}

/// The HEMIE field for a measured Window Shading type, and the categories it takes.
const KINDS: [(&str, &str, &str); 4] = [
    (
        "overhang",
        "overhang",
        "roof eaves overhang, open porch, canopy or veranda, or balcony above",
    ),
    (
        "sidefinleft",
        "side_fin_left",
        "opaque, frosted glass or bars",
    ),
    (
        "sidefinright",
        "side_fin_right",
        "opaque, frosted glass or bars",
    ),
    ("object", "obstacle", "balcony front"),
];

/// Why no reveal is sent: HEMIE 0.18.1's only reveal category ("deep window") expands to a
/// window shading object of type "reveal", which the EPC wrapper's preprocessing rejects (it
/// does not ask HEM Core to expand reveals).
const NO_REVEAL: &str = "the reveal category does not run in this release (the EPC calculation rejects a reveal), so no reveal is sent";

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
                    "Window '{}' has Window Shading of type '{kind}', which the existing-building EPC does not take.",
                    e.name
                ),
            ));
            continue;
        };
        match w.get(*field) {
            Some(stated) => shown.push(format!("{measured} → stated {field} {stated}")),
            None => {
                let what = match *field {
                    "side_fin_left" => "left side fin",
                    "side_fin_right" => "right side fin",
                    "obstacle" => "balcony front",
                    other => other,
                };
                ctx.errors.push(error(e.path(), format!("Window '{}' has a drawn {measured}. Choose what it is in the window's {what} field ({choices}); its size alone does not say.", e.name)))
            }
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

    fn geometry(reference: f64, base: f64) -> Value {
        json!({"reference_orientation": reference, "ventilation_zone_base_height": base,
            "building_parts": {"Main": {"storeys": [{"ceiling_height": 2.5}, {"ceiling_height": 2.5}]}}})
    }

    struct Out {
        segments: Value,
        shading: HemieShading,
        errors: Vec<ValidationError>,
        notices: Vec<String>,
    }

    impl Out {
        fn level(&self, k: usize) -> &str {
            self.segments[SEGMENTS[k]]["shading_fraction"]
                .as_str()
                .unwrap()
        }
        fn roof(&self, k: usize) -> bool {
            self.segments[SEGMENTS[k]]["roof_shading"]
                .as_bool()
                .unwrap()
        }
        fn notice(&self, text: &str) -> bool {
            self.notices.iter().any(|n| n.contains(text))
        }
    }

    /// Context Shading rows (Name, Type, shading_type, start, end, distance, height) around a
    /// dwelling 5.25 m high; `stated` is the `HEMIE_distant_shading` JSON, or "".
    fn derive_all(rows: &[&str], reference: f64, base: f64, stated: &str) -> Out {
        let metadata = if stated.is_empty() {
            String::new()
        } else {
            format!(
                "Metadata,,\nHEMIE_distant_shading,\"{}\"\n\n",
                stated.replace('"', "\"\"")
            )
        };
        let text = format!(
            "{metadata}Context Shading\nName,Type,shading_type,start_angle,end_angle,distance,height\n{}\n",
            rows.join("\n")
        );
        let csv = crate::parser::CSVParser::new()
            .parse_csv(&text)
            .expect("csv");
        let settings = Settings {
            csv: &csv,
            missing: Default::default(),
        };
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        let (value, shading) = distant(
            &settings,
            &geometry(reference, base),
            &mut errors,
            &mut notices,
        )
        .unwrap_or_default();
        Out {
            segments: value["DwellingShadingSegments"].clone(),
            shading,
            errors,
            notices: notices.into_iter().map(|n| n.message).collect(),
        }
    }

    fn derive(rows: &[&str], reference: f64) -> Out {
        derive_all(rows, reference, 0.0, "")
    }

    #[test]
    fn a_full_width_obstacle_blocks_its_angle_over_90_degrees() {
        // 10 m high at 10 m: 45° of 90°, half the sky, across the whole front (south) segment.
        let out = derive(&["Block,ContextShading,obstacle,135,225,10,10"], 180.0);
        assert_eq!(out.level(0), "Moderate");
        // It rises above the 5.25 m dwelling, so the roof is shaded.
        assert!(out.roof(0));
        for k in 1..4 {
            assert_eq!((out.level(k), out.roof(k)), ("Very light", false));
        }
        assert_eq!(out.shading.quadrants[0].source, "drawn");
        assert!(out.notice("Front (135–225°) Average, from drawing (50% of the sky blocked); roof shaded, from drawing ('Block')"), "{:?}", out.notices);
    }

    #[test]
    fn a_narrow_obstacle_counts_for_its_share_of_the_segment() {
        // 45° high over 60° of the 90° segment: a third of the sky.
        let out = derive(&["Block,ContextShading,obstacle,330,30,10,10"], 0.0);
        assert_eq!(out.level(0), "Light");
        // A low wall shades the walls only.
        assert!(!derive(&["Wall,ContextShading,obstacle,135,225,8,3"], 180.0).roof(0));
        // Segments follow the reference orientation clockwise: east is the right from north.
        let out = derive(&["Hill,ContextShading,obstacle,45,135,100,1000"], 0.0);
        assert_eq!(
            (out.level(1), out.shading.quadrants[1].name.as_str()),
            ("Very heavy", "Right")
        );
    }

    #[test]
    fn an_overhang_blocks_the_sky_above_it_and_objects_below_the_storey_are_ignored() {
        assert_eq!(
            derive(&["Canopy,ContextShading,overhang,135,225,10,10"], 180.0).level(0),
            "Moderate"
        );
        assert_eq!(
            derive(&["Fence,ContextShading,obstacle,135,225,3,0"], 180.0).level(0),
            "Very light"
        );
        // A canopy below an upper-floor flat shades nothing above its lowest storey.
        let out = derive_all(
            &["Canopy,ContextShading,overhang,135,225,2,2.5"],
            180.0,
            3.0,
            "",
        );
        assert_eq!(out.level(0), "Very light");
    }

    #[test]
    fn segments_centre_on_the_whole_degrees_of_the_reference() {
        let out = derive(&[], 180.7);
        assert_eq!(out.shading.quadrants[0].centre, 180.0);
        assert_eq!(out.shading.reference_orientation, 180.7);
    }

    #[test]
    fn a_stated_level_wins_per_segment_and_the_drawn_one_is_kept_for_the_editor() {
        let stated = r#"{"shading_segment_reference_orientation":{"shading_fraction":"Light","reference_orientation":180},"reference_segment_reference_orientation_plus_90":{"shading_fraction":"Heavy","roof_shading":true,"reference_orientation":180}}"#;
        let out = derive_all(
            &["Block,ContextShading,obstacle,135,225,10,10"],
            180.0,
            0.0,
            stated,
        );
        let q = &out.shading.quadrants;
        assert_eq!(
            (out.level(0), q[0].source.as_str(), q[0].drawn.as_deref()),
            ("Light", "stated", Some("Moderate"))
        );
        // The roof is not stated in front, so the drawing gives it.
        assert_eq!((out.roof(0), q[0].roof_source.as_str()), (true, "drawn"));
        assert_eq!(
            (
                out.level(1),
                out.roof(1),
                q[1].source.as_str(),
                q[1].drawn.as_deref()
            ),
            ("Heavy", true, "stated", None)
        );
        assert_eq!(
            (q[2].source.as_str(), out.level(2), q[2].centre),
            ("none", "Very light", 0.0)
        );
        assert!(
            out.notice("Right (225–315°) Heavy, stated; roof shaded, stated"),
            "{:?}",
            out.notices
        );
    }

    #[test]
    fn a_malformed_statement_fails() {
        for bad in [
            r#"{"shading_segment_reference_orientation":{"shading_fraction":"Average"}}"#,
            r#"{"front":{"shading_fraction":"Light"}}"#,
        ] {
            let out = derive_all(&[], 0.0, 0.0, bad);
            assert!(
                out.errors
                    .iter()
                    .any(|e| e.message.contains("is malformed")),
                "{:?}",
                out.errors
            );
        }
    }

    #[test]
    fn a_stated_band_two_or_more_from_the_drawing_is_a_warning() {
        let stated = |level: &str| {
            format!(
                r#"{{"shading_segment_reference_orientation":{{"shading_fraction":"{level}","reference_orientation":180}}}}"#
            )
        };
        // The drawing gives Heavy (a 30 m wall at 10 m, 72° of 90°).
        let rows = ["Wall,ContextShading,obstacle,135,225,10,30"];
        let out = derive_all(&rows, 180.0, 0.0, &stated("Very light"));
        assert!(out.notice("Front: stated Very light, the drawing gives Heavy. Check the band or reset to the drawing."), "{:?}", out.notices);
        let out = derive_all(&rows, 180.0, 0.0, &stated("Moderate"));
        assert!(!out.notice("Front: stated"), "{:?}", out.notices);
    }

    #[test]
    fn stated_roof_shading_that_differs_from_the_drawing_is_a_warning() {
        let stated = r#"{"shading_segment_reference_orientation":{"roof_shading":false,"reference_orientation":180}}"#;
        let out = derive_all(
            &["Tower,ContextShading,obstacle,135,225,10,30"],
            180.0,
            0.0,
            stated,
        );
        assert!(!out.roof(0));
        assert_eq!(out.shading.quadrants[0].drawn_roof, Some(true));
        assert!(
            out.notice("Front: stated roof not shaded, the drawing gives roof shaded."),
            "{:?}",
            out.notices
        );
    }

    #[test]
    fn a_moved_front_door_warns_on_each_band_until_it_is_stated_again() {
        // Front and Back stated against the front door at 180°; Right confirmed at 90°.
        let stated = |front: f64| {
            format!(
                r#"{{"shading_segment_reference_orientation":{{"shading_fraction":"Light","reference_orientation":{front}}},"reference_segment_reference_orientation_plus_90":{{"shading_fraction":"Heavy","reference_orientation":90}},"reference_segment_reference_orientation_plus_180":{{"roof_shading":true,"reference_orientation":180}}}}"#
            )
        };
        let out = derive_all(&[], 90.0, 0.0, &stated(180.0));
        assert!(
            out.notice("Front door changed: check the stated band of Front."),
            "{:?}",
            out.notices
        );
        assert!(out.notice("Front door changed: check the stated band of Back."));
        assert!(!out.notice("Front door changed: check the stated band of Right."));
        // Choosing Front again confirms Front only: Back still warns.
        let out = derive_all(&[], 90.0, 0.0, &stated(90.0));
        assert!(!out.notice("Front door changed: check the stated band of Front."));
        assert!(out.notice("Front door changed: check the stated band of Back."));
        // Bearings compare either way round north.
        let near = r#"{"shading_segment_reference_orientation":{"shading_fraction":"Light","reference_orientation":359.9}}"#;
        assert!(!derive_all(&[], 0.1, 0.0, near).notice("Front door changed"));
        // A band with no front door recorded is checked too.
        let bare = r#"{"shading_segment_reference_orientation":{"shading_fraction":"Light"}}"#;
        assert!(derive_all(&[], 90.0, 0.0, bare)
            .notice("Front door changed: check the stated band of Front."));
        // With nothing stated there is nothing to check.
        assert!(!derive(&[], 90.0).notice("Front door changed"));
    }

    #[test]
    fn an_object_in_no_segment_is_not_wholly_stated() {
        let stated = r#"{"shading_segment_reference_orientation":{"shading_fraction":"Light","reference_orientation":180},"reference_segment_reference_orientation_plus_90":{"shading_fraction":"Light","reference_orientation":180},"reference_segment_reference_orientation_plus_180":{"shading_fraction":"Light","reference_orientation":180},"reference_segment_reference_orientation_plus_270":{"shading_fraction":"Light","reference_orientation":180}}"#;
        let out = derive_all(
            &["Post,ContextShading,obstacle,200,200,,"],
            180.0,
            0.0,
            stated,
        );
        assert!(
            out.shading.unused_objects.is_empty(),
            "{:?}",
            out.shading.unused_objects
        );
    }

    #[test]
    fn nothing_drawn_and_nothing_stated_assumes_very_light() {
        let out = derive(&[], 180.0);
        for name in NAMES {
            assert!(
                out.notice(&format!("{name}: Very light assumed (nothing drawn).")),
                "{:?}",
                out.notices
            );
        }
    }

    #[test]
    fn an_object_wholly_in_stated_segments_raises_no_issue() {
        let rows = [
            "NoHeight,ContextShading,obstacle,150,210,10,",
            "Zero,ContextShading,obstacle,150,250,0,5",
        ];
        let out = derive(&rows, 180.0);
        assert_eq!(out.errors.len(), 2, "{:?}", out.errors);
        assert!(out.errors[0]
            .message
            .contains("'NoHeight' has no height, or no distance above 0"));
        // Front stated: NoHeight lies wholly in it and is unused; Zero crosses into the right.
        let stated = r#"{"shading_segment_reference_orientation":{"shading_fraction":"Light","reference_orientation":180}}"#;
        let out = derive_all(&rows, 180.0, 0.0, stated);
        assert_eq!(out.errors.len(), 1, "{:?}", out.errors);
        assert!(out.errors[0].path.ends_with("/Zero"));
        assert_eq!(out.shading.unused_objects, vec!["NoHeight".to_string()]);
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
    fn a_reveal_is_not_sent_as_the_epc_wrapper_rejects_it() {
        let (model, errors, notices) = run(&window_house("", "R,Z,reveal,W1,0.2,,0.03,"));
        assert!(errors.is_empty(), "{errors:#?}");
        assert!(window_of(&model).get("reveal").is_none());
        assert!(notices.iter().any(|n| n
            .message
            .contains("reveal 0.2 m deep: the reveal category does not run")));
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
                && e.message.contains("drawn overhang 0.6 m deep")
                && e.message.contains("the window's overhang field")),
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
