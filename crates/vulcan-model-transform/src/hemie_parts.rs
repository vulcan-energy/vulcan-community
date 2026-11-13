// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Building parts that do not start on the dwelling's lowest floor, and the floors and ceilings
//! between a dwelling and what is under or over it: party floors and ceilings (flats), floors over
//! outside air or an unheated space, and basements. Sources are marked as in `hemie.rs`.

use super::*;

/// The party flag Vulcan sets on a horizontal conditioned-space element: a party floor (pitch
/// 180) or party ceiling (pitch 0).
const PARTY_FLAG: &str = "_vulcan_ui_party_element";
/// DESNZ-defined: the floor-to-ceiling height of each storey of the building under the dwelling
/// when its base height comes from its base storey (average 2.2 m plus the 0.25 m storey gap).
const STOREY_BELOW_DWELLING: f64 = 2.2 + STOREY_GAP;

fn horizontal(e: &El, ty: &str) -> bool {
    e.ty == ty && e.pts.len() >= 3
}

/// A party floor or party ceiling: a conditioned-space plane with Vulcan's party flag.
fn party(e: &El, floor: bool) -> bool {
    horizontal(e, "BuildingElementAdjacentConditionedSpace")
        && e.flag(PARTY_FLAG)
        && (e.num("pitch").unwrap_or(0.0) > 90.0) == floor
}

pub(super) fn is_party_ceiling(e: &El) -> bool {
    party(e, false)
}

/// A drawn floor that can be a building part's floor other than a ground floor: over outside
/// air, over an unheated space, or over another dwelling (derived from the model).
fn is_raised_floor(e: &El) -> bool {
    let down = e.num("pitch").is_some_and(|p| p > 90.0);
    (horizontal(e, "BuildingElementOpaque") && e.bundle().is_none() && down)
        || (horizontal(e, "BuildingElementAdjacentUnconditionedSpace_Simple") && down)
        || party(e, true)
}

/// The floors a plan point is inside, as (lowest, highest). Derived from the model: a building
/// part is one column of storeys, so a floor missing between two others at that point fails.
pub(super) fn column(p: P, rings: &[Vec<P>]) -> Option<Result<(usize, usize), usize>> {
    let levels: Vec<usize> = (0..rings.len()).filter(|&k| inside(p, &rings[k])).collect();
    let (&bottom, &top) = (levels.first()?, levels.last()?);
    Some(match (bottom..=top).find(|k| !levels.contains(k)) {
        Some(gap) => Err(gap),
        None => Ok((bottom, top)),
    })
}

/// Floor-to-floor height of each floor: the length-weighted mean of its walls' heights (derived
/// from the model: a Vulcan wall runs from its floor to the next floor or the roof).
pub(super) fn level_heights(walls: &[(&El, Kind)], levels: usize) -> Vec<f64> {
    (0..levels)
        .map(|k| {
            let (length, sum) = walls
                .iter()
                .filter(|(w, _)| w.level == k as i64)
                .filter_map(|(w, _)| Some((w.length(), w.num("height")?)))
                .fold((0.0, 0.0), |(l, s), (len, h)| (l + len, s + len * h));
            if length > 0.0 {
                sum / length
            } else {
                0.0
            }
        })
        .collect()
}

/// The dwelling's base height above the ground: the stated ventilation zone base height, or
/// HEMIE's estimate from the base storey (DESNZ-defined, EPC 11 11.3.3).
pub(super) fn dwelling_base(geometry: &Map<String, Value>) -> Option<f64> {
    geometry
        .get("ventilation_zone_base_height")
        .and_then(Value::as_f64)
        .or_else(|| {
            let storey = geometry.get("base_storey_of_dwelling")?.as_f64()?;
            Some(storey * STOREY_BELOW_DWELLING)
        })
}

/// A construction from the model setting alone, for a floor no element describes.
fn setting_construction(ctx: &mut Ctx, construction_type: &str) -> String {
    let mut c = ctx.settings.construction(construction_type);
    c.insert("construction_type".into(), json!(construction_type));
    ctx.require(construction_type, &mut c);
    ctx.constructions.add(c)
}

/// DESNZ-defined: a party floor or ceiling takes only its construction weight; with none
/// stated, HEMIE takes light (timber) (TN-039), reported.
fn party_construction(ctx: &mut Ctx, construction_type: &str, e: &El) -> String {
    let mut c = ctx.settings.construction(construction_type);
    c.insert("construction_type".into(), json!(construction_type));
    if let Some(weight) = e.text("construction_weight") {
        c.insert("construction_weight".into(), json!(weight));
    }
    if !c.contains_key("construction_weight") {
        ctx.notices.push(notice(&e.path(), format!("'{}' states no construction weight, so HEMIE takes a light (timber) party floor or ceiling.", e.name)));
    }
    ctx.constructions.add(c)
}

/// The roof of a part under a party ceiling (derived from the model). A part takes one roof, so
/// a party ceiling with roof planes fails naming both.
pub(super) fn party_ceiling_roof(ctx: &mut Ctx, ceilings: &[&El], planes: &[&El]) -> Option<Value> {
    let first = ceilings.first()?;
    if let Some(plane) = planes.first() {
        ctx.errors.push(error(first.path(), format!("Party ceiling '{}' and roof '{}' cover one building part. HEMIE gives each building part one roof; draw them over separate parts or remove one.", first.name, plane.name)));
        return None;
    }
    let key = party_construction(ctx, "party_ceiling", first);
    Some(json!({"roof_type": "Party", "construction": key}))
}

pub(super) struct PartFloor<'p> {
    pub name: &'p str,
    pub bottom: usize,
    pub point: P,
    pub ring: &'p [P],
}

/// The floor under a building part's lowest storey, by what is drawn there (derived from the
/// model; EPC 02 2.6.4.1: the floor type is what is under the floor). A part starting above the
/// lowest floor with no floor drawn under it is over outside air (ours, decided by Baz,
/// 13 November: an overhanging or side-by-side floor is its own part with an exposed floor).
pub(super) fn part_floor<'e>(
    ctx: &mut Ctx,
    els: &'e [El<'e>],
    part: &PartFloor,
    ground_total: f64,
    used: &mut BTreeSet<&'e str>,
) -> Option<Value> {
    let under: Vec<&El> = els
        .iter()
        .filter(|e| {
            (horizontal(e, "BuildingElementGround") || is_raised_floor(e))
                && e.level == part.bottom as i64
                && inside(part.point, &e.pts)
        })
        .collect();
    used.extend(under.iter().map(|e| e.name));
    let name = part.name;
    let e = match under.as_slice() {
        [e] => *e,
        [] if part.bottom == 0 => {
            ctx.errors.push(error("/Zone".into(), format!("Building part '{name}' has no ground floor drawn under it. Draw its ground floor, or the exposed, unheated-space or party floor under it.")));
            return None;
        }
        [] => {
            ctx.notices.push(notice("/Zone", format!("Building part '{name}' starts on floor {} with no floor drawn under it, so its floor is over outside air.", part.bottom)));
            let key = setting_construction(ctx, "above_external_area_floor");
            return Some(
                json!({"floor_type": "not next to ground (external)", "construction": key}),
            );
        }
        many => {
            ctx.errors.push(error(many[0].path(), format!("Building part '{name}' has floors {} under it. HEMIE gives each building part one floor; draw one floor under it.", quoted(&many.iter().map(|e| e.name).collect::<Vec<_>>()))));
            return None;
        }
    };
    match e.ty {
        "BuildingElementGround" => ground_floor(ctx, e, part, ground_total),
        "BuildingElementOpaque" => {
            let key = ctx.construction("above_external_area_floor", &[e], &[]);
            Some(json!({"floor_type": "not next to ground (external)", "construction": key}))
        }
        "BuildingElementAdjacentUnconditionedSpace_Simple" => {
            let Some(space) = e.text("adjacent_space_type") else {
                ctx.errors.push(error(e.path(), format!("Floor '{}' is over an unheated space but does not state which. Give it an adjacent_space_type: corridor, garage, roof void or stairwell.", e.name)));
                return None;
            };
            let key = ctx.construction("above_internal_unconditioned_area_floor", &[e], &[]);
            Some(
                json!({"floor_type": "not next to ground (unconditioned)", "adjacent_space": space, "construction": key}),
            )
        }
        _ => {
            let key = party_construction(ctx, "party_floor", e);
            Some(json!({"floor_type": "party", "construction": key}))
        }
    }
}

fn ground_floor(ctx: &mut Ctx, g: &El, part: &PartFloor, ground_total: f64) -> Option<Value> {
    // Derived from the model: a dwelling whose base storey is above the ground has no floor on
    // the ground (EPC 11 11.3.3 base storey; EPC 02 2.6.4.1 floor type by what is under it).
    if let Some(storey) = ctx.model["General"]["storey_of_dwelling"]
        .as_i64()
        .filter(|s| *s > 0)
    {
        ctx.errors.push(error(g.path(), format!("Ground floor '{}' is on the ground, but the dwelling's base storey is {storey} (General_storey_of_dwelling). Draw the party floor, exposed floor or floor over an unheated space under the dwelling instead, or correct the base storey.", g.name)));
        return None;
    }
    let mut floor = floor(ctx, g, ground_total)?;
    let basement = floor["floor_type"].as_str().unwrap_or_default().to_string();
    if !basement.ends_with("basement") {
        return Some(floor);
    }
    // Derived from the model: the basement measurements the element states. Unstated depths
    // and heights take HEMIE's DESNZ defaults for a partly underground basement, reported.
    let mut defaulted = Vec::new();
    let mut fields = vec!["depth_basement_floor"];
    if basement == "unheated basement" {
        fields.extend(["height_basement_walls", "basement_air_volume"]);
    }
    for key in fields {
        // A fully underground basement's walls are 0 m above the ground.
        match g
            .num(key)
            .filter(|v| *v > 0.0 || (key == "height_basement_walls" && *v == 0.0))
        {
            Some(v) => floor[key] = json!(v),
            None => defaulted.push(key),
        }
    }
    if !defaulted.is_empty() {
        ctx.notices.push(notice(&g.path(), format!("Basement '{}' states no {}, so HEMIE takes its defaults for a partly underground basement.", g.name, defaulted.join(" or "))));
    }
    // DESNZ-defined (TN-039): a heated basement's heat capacity comes from the floor above it
    // unless its construction states one; derived from the model, that floor is the lowest storey.
    let key = floor["construction"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let stated = ctx.constructions.by_name[&key]
        .get("areal_heat_capacity")
        .is_some();
    if basement == "heated basement" && !stated {
        let perimeter: f64 = edges(part.ring).map(|(a, b)| dist(a, b)).sum();
        floor["floor_above_basement_area"] = json!(signed_area(part.ring));
        floor["floor_above_basement_perimeter"] = json!(perimeter);
    }
    Some(floor)
}

/// Drawn floors that are no building part's floor fail naming the floor.
pub(super) fn unused_floors(ctx: &mut Ctx, els: &[El], used: &BTreeSet<&str>) {
    for e in els
        .iter()
        .filter(|e| is_raised_floor(e) && !used.contains(e.name))
    {
        ctx.errors.push(error(e.path(), format!("Floor '{}' on floor {} is under no building part's lowest storey. HEMIE gives each building part one floor, under its lowest storey; move it under the storey it carries or delete it.", e.name, e.level)));
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::*;
    use super::*;

    const NON_EXPOSED: &str =
        "Non-Exposed Elements\nName,Zone,Type,area,pitch,width,height,base_height,parent_element,coords,extra_json";

    fn coords(level: i64, pts: &[P]) -> String {
        pts.iter()
            .map(|p| format!("{},{},{level}", p[0], p[1]))
            .collect::<Vec<_>>()
            .join("|")
    }

    fn party_plane(name: &str, level: i64, pitch: f64, extra: &str) -> String {
        format!(
            "{name},Z,BuildingElementAdjacentConditionedSpace,48,{pitch},,,,,\"{}\",\"{{\"\"_vulcan_ui_party_element\"\":true{extra}}}\"",
            coords(level, &BOX)
        )
    }

    fn flat_model(storey: i64) -> Value {
        let mut model = full_input();
        model["InfiltrationVentilation"]
            .as_object_mut()
            .unwrap()
            .remove("ventilation_zone_base_height");
        model["General"] = json!({"build_type": "flat", "storey_of_dwelling": storey});
        model
    }

    fn shifted(by: P) -> Vec<P> {
        BOX.iter().map(|p| [p[0] + by[0], p[1] + by[1]]).collect()
    }

    #[test]
    fn a_floor_drawn_beside_the_floor_below_is_a_raised_part_over_outside_air() {
        let beside = shifted([20.0, 0.0]);
        let mut exposed = box_walls(&BOX, &[0]);
        exposed.extend(box_walls(&beside, &[1]));
        exposed.push(plane("Roof 0", 1, &BOX, 0.0, 0.0, false));
        exposed.push(plane("Roof 1", 2, &beside, 0.0, 0.0, false));
        // No air test, so the zone height is the dwelling height from the storeys.
        let settings = format!(
            "{SETTINGS}\nHEMIE_infiltration_properties,\"{{\"\"number_of_open_fireplaces\"\":0}}\""
        );
        let mut untested = full_input();
        untested["InfiltrationVentilation"]["Leaks"]
            .as_object_mut()
            .unwrap()
            .remove("test_result");
        let (model, errors, notices) = run_on(&csv(&settings, &exposed, &ground(&BOX)), untested);
        assert!(errors.is_empty(), "{errors:#?}");
        let parts = &model["Zone"]["building_parts"];
        assert_eq!(parts["Main"]["storeys"].as_array().unwrap().len(), 1);
        assert!(parts["Main"].get("base_height").is_none());
        let raised = &parts["Extension 1"];
        assert_eq!(raised["base_height"], 2.8);
        assert_eq!(
            raised["floor"]["floor_type"],
            "not next to ground (external)"
        );
        assert_eq!(raised["walls"][0]["storey_index"], 0);
        assert_eq!(raised["roof"]["roof_type"], "Unknown Flat");
        assert!(notices.iter().any(|n| n
            .message
            .contains("starts on floor 1 with no floor drawn under it")));
        // The zone height reaches the raised part's top: 2.8 + 2.55.
        let height = &model["InfiltrationVentilation"]["Leaks"]["ventilation_zone_height"];
        assert!((height.as_f64().unwrap() - 5.35).abs() < 1e-9, "{height}");
    }

    #[test]
    fn an_overhang_is_its_own_part_over_its_drawn_exposed_floor() {
        let upper: [P; 4] = [[0.0, 0.0], [8.0, 0.0], [8.0, 8.0], [0.0, 8.0]];
        let overhang: [P; 4] = [[0.0, 6.0], [8.0, 6.0], [8.0, 8.0], [0.0, 8.0]];
        let mut exposed = box_walls(&BOX, &[0]);
        exposed.extend(box_walls(&upper, &[1]));
        exposed.push(plane("Roof main", 2, &BOX, 0.0, 0.0, false));
        exposed.push(plane("Roof over", 2, &overhang, 0.0, 0.0, false));
        exposed.push(plane("Soffit", 1, &overhang, 180.0, 0.0, false));
        let (model, errors, notices) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert!(errors.is_empty(), "{errors:#?}");
        let parts = &model["Zone"]["building_parts"];
        assert_eq!(parts["Main"]["storeys"].as_array().unwrap().len(), 2);
        let over = &parts["Extension 1"];
        assert_eq!(over["base_height"], 2.8);
        assert_eq!(over["floor"]["floor_type"], "not next to ground (external)");
        // Three walls: the edge over the main part's storey has none.
        assert_eq!(over["walls"].as_array().unwrap().len(), 3);
        assert!(!notices.iter().any(|n| n.message.contains("no floor drawn")));
    }

    #[test]
    fn a_flat_takes_its_party_floor_and_party_ceiling() {
        let text = csv(
            SETTINGS,
            &box_walls(&BOX, &[0]),
            &format!(
                "{NON_EXPOSED}\n{}\n{}",
                party_plane("Party floor", 0, 180.0, ""),
                party_plane(
                    "Party ceiling",
                    1,
                    0.0,
                    ",\"\"construction_weight\"\":\"\"heavy (concrete)\"\""
                ),
            ),
        );
        let (model, errors, notices) = run_on(&text, flat_model(2));
        assert!(errors.is_empty(), "{errors:#?}");
        let zone = &model["Zone"];
        assert_eq!(zone["base_storey_of_dwelling"], 2);
        let main = &zone["building_parts"]["Main"];
        assert_eq!(main["floor"]["floor_type"], "party");
        assert_eq!(main["roof"]["roof_type"], "Party");
        let constructions = &zone["constructions"];
        assert_eq!(
            constructions[main["roof"]["construction"].as_str().unwrap()],
            json!({"construction_type": "party_ceiling", "construction_weight": "heavy (concrete)"})
        );
        assert_eq!(
            constructions[main["floor"]["construction"].as_str().unwrap()],
            json!({"construction_type": "party_floor"})
        );
        assert!(notices.iter().any(|n| n
            .message
            .contains("'Party floor' states no construction weight")));
    }

    #[test]
    fn a_ground_floor_under_a_flat_above_the_ground_fails_naming_it() {
        let text = csv(
            SETTINGS,
            &box_walls(&BOX, &[0]),
            &format!(
                "{}\n\n{NON_EXPOSED}\n{}",
                ground(&BOX),
                party_plane("Party ceiling", 1, 0.0, "")
            ),
        );
        let (_, errors, _) = run_on(&text, flat_model(2));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(errors[0].path.ends_with("/Floor"));
        assert!(errors[0].message.contains("base storey is 2"));
    }

    #[test]
    fn a_heated_basement_takes_its_depth_and_the_floor_above_it() {
        let mut exposed = box_walls(&BOX, &[0]);
        exposed.push(plane("Roof", 1, &BOX, 0.0, 0.0, false));
        let basement = ground(&BOX).replace(
            "floor_type,coords\nFloor,Z,BuildingElementGround,48,Slab_no_edge_insulation,",
            "floor_type,depth_basement_floor,coords\nFloor,Z,BuildingElementGround,48,Heated_basement,2.0,",
        );
        let (model, errors, _) = run(&csv(SETTINGS, &exposed, &basement));
        assert!(errors.is_empty(), "{errors:#?}");
        let floor = &model["Zone"]["building_parts"]["Main"]["floor"];
        assert_eq!(floor["floor_type"], "heated basement");
        assert_eq!(floor["depth_basement_floor"], 2.0);
        assert_eq!(floor["floor_above_basement_area"], 48.0);
        assert_eq!(floor["floor_above_basement_perimeter"], 28.0);
    }

    #[test]
    fn a_storey_with_no_floor_below_it_over_a_lower_one_fails_naming_the_gap() {
        let half: [P; 4] = [[0.0, 0.0], [4.0, 0.0], [4.0, 6.0], [0.0, 6.0]];
        let mut exposed = box_walls(&BOX, &[0, 2]);
        exposed.extend(box_walls(&half, &[1]));
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert!(
            errors
                .iter()
                .any(|e| e.message.contains("no floor 1 between them")),
            "{errors:#?}"
        );
    }

    #[test]
    fn walls_with_no_height_a_missing_door_and_roof_are_named_together() {
        let walls: Vec<String> = (0..4)
            .map(|i| wall(&format!("W{i}"), 0, BOX[i], BOX[(i + 1) % 4], 0.0))
            .collect();
        let text = format!(
            "Metadata,,\n{SETTINGS}\n\nZone,,\nName,Type\nZ,Zone\n\nExposed Elements\n{HEADER}\n{}\n\n{}\n",
            walls.join("\n"),
            ground(&BOX)
        );
        let (_, errors, _) = run(&text);
        let messages: Vec<&str> = errors.iter().map(|e| e.message.as_str()).collect();
        for wall in ["'W0'", "'W1'", "'W2'", "'W3'"] {
            assert!(
                messages
                    .iter()
                    .any(|m| m.contains(wall) && m.contains("height 0")),
                "{messages:#?}"
            );
        }
        assert!(messages.iter().any(|m| m.contains("The model has no door")));
        assert!(messages
            .iter()
            .any(|m| m.contains("has no roof or party ceiling drawn over it")));
    }
}
