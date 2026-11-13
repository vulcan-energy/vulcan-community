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

/// The floors a plan point is inside, as (lowest, highest), or every floor missing between
/// them. Ours: a building part is one column of storeys, so a floor missing between two others
/// fails. HEMIE itself also allows parts stacked on one another, 0.25 m apart.
pub(super) fn column(p: P, rings: &[Vec<P>]) -> Option<Result<(usize, usize), Vec<usize>>> {
    let levels: Vec<usize> = (0..rings.len()).filter(|&k| inside(p, &rings[k])).collect();
    let (&bottom, &top) = (levels.first()?, levels.last()?);
    let gaps: Vec<usize> = (bottom..=top).filter(|k| !levels.contains(k)).collect();
    Some(if gaps.is_empty() {
        Ok((bottom, top))
    } else {
        Err(gaps)
    })
}

/// Ours: a storey's ceiling height to the micrometre, so that equal drawn heights give equal
/// base heights.
pub(super) fn round_ceiling(height: f64) -> f64 {
    (height * 1e6).round() / 1e6
}

/// Each part's base height above the ground. A part on the lowest floor has the dwelling's base.
/// A part starting higher sits on the storeys of the nearest part that has storeys under its
/// lowest floor (ours: the part it adjoins, or for a floor drawn beside, the nearest). The sum
/// runs as HEMIE sums storey heights, so the raised part's base equals the base HEMIE gives that
/// part's storey, and HEMIE counts them as one storey. `Err` names the part with none below.
pub(super) fn base_heights(parts: &[Part], dwelling: f64) -> Result<Vec<f64>, usize> {
    let mut bases: Vec<Option<f64>> = vec![None; parts.len()];
    let mut order: Vec<usize> = (0..parts.len()).collect();
    order.sort_by_key(|&i| parts[i].bottom);
    for i in order {
        let part = &parts[i];
        if part.bottom == 0 {
            bases[i] = Some(dwelling);
            continue;
        }
        let at = centroid(&part.poly);
        let below = (0..parts.len())
            .filter(|&j| parts[j].bottom < part.bottom && parts[j].top + 1 >= part.bottom)
            .min_by(|&a, &b| {
                boundary_dist(at, &parts[a].poly).total_cmp(&boundary_dist(at, &parts[b].poly))
            })
            .ok_or(i)?;
        let lower = &parts[below];
        let storeys = lower.ceilings[..part.bottom - lower.bottom]
            .iter()
            .fold(0.0, |sum, c| sum + (c + STOREY_GAP));
        bases[i] = Some(bases[below].expect("lower parts first") + storeys);
    }
    Ok(bases.into_iter().map(|b| b.expect("every part")).collect())
}

/// The dwelling's base height above the ground: the stated ventilation zone base height, or
/// HEMIE's estimate from the base storey (DESNZ-defined).
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
/// stated, HEMIE takes light (timber), reported.
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
}

/// The floor under a building part's lowest storey, by what is drawn there (derived from the
/// model; DESNZ-defined: the floor type is what is under the floor). A part starting above the
/// lowest floor with no floor drawn under it is over outside air (ours).
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
        "BuildingElementGround" => ground_floor(ctx, e, ground_total),
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

fn ground_floor(ctx: &mut Ctx, g: &El, ground_total: f64) -> Option<Value> {
    // Ours: a dwelling whose base storey is above the ground has no floor on the ground.
    if let Some(storey) = ctx.model["General"]["storey_of_dwelling"]
        .as_i64()
        .filter(|s| *s > 0)
    {
        ctx.errors.push(error(g.path(), format!("Ground floor '{}' is on the ground, but the dwelling's base storey is {storey} (General_storey_of_dwelling). Draw the party floor, exposed floor or floor over an unheated space under the dwelling instead, or correct the base storey.", g.name)));
        return None;
    }
    let mut floor = floor(ctx, g, ground_total)?;
    let basement = floor["floor_type"].as_str().unwrap_or_default().to_string();
    if basement == "heated basement" {
        // DESNZ-defined: a basement is one floor element under the storey above it, never a
        // storey. Vulcan draws a heated basement as floor 0 with its walls, so converting it
        // would count the basement twice; it fails until the drawing can say which floor it is.
        ctx.errors.push(error(g.path(), format!("Ground floor '{}' is a heated basement, so floor 0 over it is the basement itself. HEMIE enters a basement as the floor of the storey above it, not as a storey, and the existing-building converter does not take a heated basement yet.", g.name)));
        return None;
    }
    if basement != "unheated basement" {
        return Some(floor);
    }
    // Derived from the model: the basement measurements the element or the model setting
    // states. Unstated ones take HEMIE's DESNZ defaults for the depth descriptor, reported.
    let descriptor = g
        .text("basement_depth_descriptor")
        .map(str::to_string)
        .or_else(|| {
            ctx.settings
                .raw(&format!("{SETTING}basement_depth_descriptor"))
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    if let Some(descriptor) = &descriptor {
        floor["basement_depth_descriptor"] = json!(descriptor);
    }
    let mut defaulted = Vec::new();
    for key in [
        "depth_basement_floor",
        "height_basement_walls",
        "basement_air_volume",
    ] {
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
        ctx.notices.push(notice(
            &g.path(),
            format!(
                "Basement '{}' states no {}, so HEMIE takes its defaults for a {} basement.",
                g.name,
                defaulted.join(" or "),
                descriptor.as_deref().unwrap_or("partially underground")
            ),
        ));
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

    fn basement(floor_type: &str, extra: &str) -> String {
        ground(&BOX).replace(
            "floor_type,coords\nFloor,Z,BuildingElementGround,48,Slab_no_edge_insulation,",
            &format!("floor_type,depth_basement_floor,extra_json,coords\nFloor,Z,BuildingElementGround,48,{floor_type},2.0,\"{extra}\","),
        )
    }

    #[test]
    fn an_unheated_basement_takes_what_the_assessor_states() {
        let mut exposed = box_walls(&BOX, &[0]);
        exposed.push(plane("Roof", 1, &BOX, 0.0, 0.0, false));
        let text = csv(
            SETTINGS,
            &exposed,
            &basement(
                "Unheated_basement",
                r#"{""basement_depth_descriptor"":""fully underground""}"#,
            ),
        );
        let (model, errors, notices) = run(&text);
        assert!(errors.is_empty(), "{errors:#?}");
        let floor = &model["Zone"]["building_parts"]["Main"]["floor"];
        assert_eq!(floor["floor_type"], "unheated basement");
        assert_eq!(floor["depth_basement_floor"], 2.0);
        assert_eq!(floor["basement_depth_descriptor"], "fully underground");
        assert!(floor.get("height_basement_walls").is_none());
        assert!(notices.iter().any(|n| n.message.contains(
            "states no height_basement_walls or basement_air_volume, so HEMIE takes its defaults for a fully underground basement"
        )));
    }

    #[test]
    fn a_heated_basement_drawn_as_floor_0_fails_rather_than_counting_twice() {
        let mut exposed = box_walls(&BOX, &[0]);
        exposed.push(plane("Roof", 1, &BOX, 0.0, 0.0, false));
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &basement("Heated_basement", "{}")));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(errors[0].path.ends_with("/Floor"));
        assert!(errors[0].message.contains("is a heated basement"));
    }

    #[test]
    fn a_column_with_floors_missing_names_every_one() {
        let half: [P; 4] = [[0.0, 0.0], [4.0, 0.0], [4.0, 6.0], [0.0, 6.0]];
        let mut exposed = box_walls(&BOX, &[0, 3]);
        exposed.extend(box_walls(&half, &[1, 2]));
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert!(
            errors.iter().any(|e| e.path.ends_with("/W30")
                && e.message
                    .contains("Floor 3 is over a lower floor with no floor 1 or 2")),
            "{errors:#?}"
        );
    }

    /// HEMIE counts each distinct storey base height as a storey, so a raised part's base must
    /// equal the base HEMIE gives the storey beside it, to the last bit.
    #[test]
    fn a_raised_part_sits_on_the_part_it_adjoins_not_a_mean_of_the_floor() {
        // Floor 0: the main box (walls 2.7 and 2.75 high) and an extension east (3.1 high).
        // Floor 1: over the main box and overhanging it to the north.
        let walls = [
            ("W00", [0.0, 0.0], [8.0, 0.0], 2.7),
            ("S2", [8.0, 0.0], [12.0, 0.0], 3.1),
            ("E", [12.0, 0.0], [12.0, 6.0], 3.1),
            ("N2", [12.0, 6.0], [8.0, 6.0], 3.1),
            ("N1", [8.0, 6.0], [0.0, 6.0], 2.7),
            ("W", [0.0, 6.0], [0.0, 0.0], 2.75),
        ];
        let mut exposed: Vec<String> = walls
            .iter()
            .map(|(name, a, b, h)| wall(name, 0, *a, *b, *h))
            .collect();
        let upper: [P; 4] = [[0.0, 0.0], [8.0, 0.0], [8.0, 9.0], [0.0, 9.0]];
        exposed.extend(box_walls(&upper, &[1]));
        let east: [P; 4] = [[8.0, 0.0], [12.0, 0.0], [12.0, 6.0], [8.0, 6.0]];
        let north: [P; 4] = [[0.0, 6.0], [8.0, 6.0], [8.0, 9.0], [0.0, 9.0]];
        exposed.push(plane("Roof main", 2, &BOX, 0.0, 0.0, false));
        exposed.push(plane("Roof east", 1, &east, 0.0, 0.0, false));
        exposed.push(plane("Roof north", 2, &north, 0.0, 0.0, false));
        let floor: [P; 4] = [[0.0, 0.0], [12.0, 0.0], [12.0, 6.0], [0.0, 6.0]];
        let (model, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&floor)));
        assert!(errors.is_empty(), "{errors:#?}");
        let parts = model["Zone"]["building_parts"].as_object().unwrap();
        let main = &parts["Main"];
        let raised = parts
            .values()
            .find(|p| p.get("base_height").is_some())
            .unwrap();
        // As HEMIE sums it: the dwelling base plus the main part's storey 0 and the gap.
        let ceiling = main["storeys"][0]["ceiling_height"].as_f64().unwrap();
        assert_eq!(
            raised["base_height"].as_f64().unwrap(),
            0.0 + (ceiling + 0.25)
        );
        // Not the floor's mean over every wall, which the 3.1 m extension would raise.
        assert!((raised["base_height"].as_f64().unwrap() - 2.7136).abs() < 1e-3);
        // HEMIE's storey count: distinct storey base heights over every part.
        let mut bases: Vec<u64> = Vec::new();
        for part in parts.values() {
            let base = part["base_height"].as_f64().unwrap_or(0.0);
            let mut below = 0.0;
            for storey in part["storeys"].as_array().unwrap() {
                let at = base + below;
                if !bases.contains(&at.to_bits()) {
                    bases.push(at.to_bits());
                }
                below += storey["ceiling_height"].as_f64().unwrap() + 0.25;
            }
        }
        assert_eq!(bases.len(), 2, "{bases:?}");
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
