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

/// A basement drawn as a floor of its own, under the lowest storey above the ground.
pub(super) struct Basement {
    /// The drawn floor: -1 as the editor numbers floors (canvas floor -1 is basement 1), or 0 in
    /// models drawn with the basement on the ground floor and its walls starting below the ground.
    pub level: i64,
    /// Depth of the basement floor below the ground, from its walls' base height.
    pub depth: Option<f64>,
}

/// The basement drawn as a floor of its own: walls on floor -1, or walls on floor 0 that start
/// below the ground, over a basement floor on that floor. DESNZ-defined: a basement is one floor
/// element under the lowest storey above it, never a storey, and HEMIE has no basement wall: it
/// takes the basement walls' U-value and thickness from that storey's external walls. So the
/// basement's walls are not storey walls, and the storeys start on the floor above (derived from
/// the model). `Err` when the drawing contradicts itself or cannot be entered.
pub(super) fn basement_storey(
    ctx: &mut Ctx,
    els: &[El],
    walls: &[(&El, Kind)],
) -> Result<Option<Basement>, ()> {
    let on = |level: i64| -> Vec<&El> {
        walls
            .iter()
            .filter(|(w, _)| w.level == level)
            .map(|(w, _)| *w)
            .collect()
    };
    let starts_below = |w: &&El| w.num("base_height").is_some_and(|b| b < 0.0);
    let level = if !on(-1).is_empty() {
        -1
    } else if on(0).iter().any(starts_below) {
        0
    } else {
        return Ok(None);
    };
    let floor = on(level);
    let names = |list: &[&El]| quoted(&list.iter().map(|w| w.name).collect::<Vec<_>>());
    let basement = els.iter().find(|e| {
        horizontal(e, "BuildingElementGround")
            && e.level == level
            && matches!(
                e.text("floor_type"),
                Some("Heated_basement" | "Unheated_basement")
            )
    });
    let Some(basement) = basement else {
        ctx.errors.push(error(floor[0].path(), format!("Walls {} on floor {level} are below the ground, but floor {level} has no basement floor. Give floor {level}'s ground floor a basement floor type, or draw the walls on the ground floor.", names(&floor))));
        return Err(());
    };
    let at_ground: Vec<&El> = floor.iter().copied().filter(|w| !starts_below(w)).collect();
    if level == 0 && !at_ground.is_empty() {
        let below: Vec<&El> = floor.iter().copied().filter(starts_below).collect();
        ctx.errors.push(error(at_ground[0].path(), format!("Floor 0 is basement '{}' (walls {} start below the ground), but walls {} start at or above it. Give every wall of the basement its base below the ground.", basement.name, names(&below), names(&at_ground))));
        return Err(());
    }
    if walls.iter().all(|(w, _)| w.level <= level) {
        ctx.errors.push(error(basement.path(), format!("Floor {level} is basement '{}' and the model has no storey above it. The existing-building EPC enters a basement as the floor of the lowest storey above the ground; draw that storey.", basement.name)));
        return Err(());
    }
    let openings: Vec<&El> = els
        .iter()
        .filter(|e| {
            (e.ty == "BuildingElementTransparent" || e.flag("is_external_door"))
                && floor.iter().any(|w| e.host() == Some(w.name))
        })
        .collect();
    if !openings.is_empty() {
        ctx.errors.push(error(openings[0].path(), format!("Windows or doors {} are in walls of basement '{}'. The existing-building EPC has no basement walls, so it cannot take openings in them; remove them, or draw the basement as a storey.", names(&openings), basement.name)));
        return Err(());
    }
    let depth = floor
        .iter()
        .filter_map(|w| w.num("base_height"))
        .filter(|b| *b < 0.0)
        .reduce(f64::min)
        .map(|b| -b);
    ctx.notices.push(notice(&basement.path(), format!("Floor {level} is basement '{}'. The existing-building EPC enters it as the floor of floor {}, its storey 0, and takes the basement walls' U-value and thickness from that storey's external walls, so the constructions of walls {} are not used.", basement.name, level + 1, names(&floor))));
    Ok(Some(Basement { level, depth }))
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
fn party_construction(ctx: &mut Ctx, construction_type: &str, elements: &[&El]) -> String {
    let mut c = ctx.settings.construction(construction_type);
    c.insert("construction_type".into(), json!(construction_type));
    if let Some(weight) = ctx
        .agreed(elements, "construction_weight")
        .and_then(Value::as_str)
    {
        c.insert("construction_weight".into(), json!(weight));
    }
    if !c.contains_key("construction_weight") {
        let e = elements[0];
        ctx.notices.push(notice(&e.path(), format!("'{}' states no construction weight, so the existing-building EPC takes a light (timber) party floor or ceiling.", e.name)));
    }
    ctx.constructions.add(c)
}

/// The roof of a part under a party ceiling (derived from the model). A part takes one roof, so
/// a party ceiling with roof planes fails naming both.
pub(super) fn party_ceiling_roof(ctx: &mut Ctx, ceilings: &[&El], planes: &[&El]) -> Option<Value> {
    let first = ceilings.first()?;
    if let Some(plane) = planes.first() {
        ctx.errors.push(error(first.path(), format!("Party ceiling '{}' and roof '{}' cover one building part. The existing-building EPC gives each building part one roof; draw them over separate parts or remove one.", first.name, plane.name)));
        return None;
    }
    let key = party_construction(ctx, "party_ceiling", ceilings);
    Some(ctx.with_age_band(ceilings, json!({"roof_type": "Party", "construction": key})))
}

pub(super) struct PartFloor<'p> {
    pub name: &'p str,
    pub bottom: usize,
    /// The drawn floor of the part's lowest storey.
    pub level: i64,
    pub point: P,
    pub ring: &'p [P],
    pub basement: Option<&'p Basement>,
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
            // A part on the dwelling's lowest storey also takes the basement floor under it.
            let basement = part.bottom == 0 && part.basement.is_some_and(|b| b.level == e.level);
            ((horizontal(e, "BuildingElementGround") && (e.level == part.level || basement))
                || (is_raised_floor(e) && e.level == part.level))
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
            ctx.notices.push(notice("/Zone", format!("Building part '{name}' starts on floor {} with no floor drawn under it, so its floor is over outside air.", part.level)));
            let key = setting_construction(ctx, "above_external_area_floor");
            return Some(
                json!({"floor_type": "not next to ground (external)", "construction": key}),
            );
        }
        many => {
            ctx.errors.push(error(many[0].path(), format!("Building part '{name}' has floors {} under it. The existing-building EPC gives each building part one floor; draw one floor under it.", quoted(&many.iter().map(|e| e.name).collect::<Vec<_>>()))));
            return None;
        }
    };
    match e.ty {
        "BuildingElementGround" => ground_floor(ctx, e, part, ground_total),
        "BuildingElementOpaque" => {
            let key = ctx.construction("above_external_area_floor", &[e], &[]);
            Some(ctx.with_age_band(
                &[e],
                json!({"floor_type": "not next to ground (external)", "construction": key}),
            ))
        }
        "BuildingElementAdjacentUnconditionedSpace_Simple" => {
            let Some(space) = e.text("adjacent_space_type") else {
                ctx.errors.push(error(e.path(), format!("Floor '{}' is over an unheated space but does not state which. Give it an adjacent_space_type: corridor, garage, roof void or stairwell.", e.name)));
                return None;
            };
            let key = ctx.construction("above_internal_unconditioned_area_floor", &[e], &[]);
            Some(ctx.with_age_band(
                &[e],
                json!({"floor_type": "not next to ground (unconditioned)", "adjacent_space": space, "construction": key}),
            ))
        }
        _ => {
            let key = party_construction(ctx, "party_floor", &[e]);
            Some(ctx.with_age_band(&[e], json!({"floor_type": "party", "construction": key})))
        }
    }
}

fn ground_floor(ctx: &mut Ctx, g: &El, part: &PartFloor, ground_total: f64) -> Option<Value> {
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
    if !basement.ends_with("basement") {
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
    let mut fields = vec!["depth_basement_floor"];
    if basement == "unheated basement" {
        fields.extend(["height_basement_walls", "basement_air_volume"]);
    }
    for key in fields {
        // A fully underground basement's walls are 0 m above the ground.
        let drawn = (key == "depth_basement_floor")
            .then(|| part.basement.and_then(|b| b.depth))
            .flatten();
        match g
            .num(key)
            .filter(|v| *v > 0.0 || (key == "height_basement_walls" && *v == 0.0))
            .or(drawn)
        {
            Some(v) => floor[key] = json!(v),
            None => defaulted.push(key),
        }
    }
    // DESNZ-defined: a heated basement's heat capacity comes from the floor above it unless its
    // construction states one; derived from the model, that floor is the lowest storey.
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
    if !defaulted.is_empty() {
        ctx.notices.push(notice(
            &g.path(),
            format!(
                "Basement '{}' states no {}, so it uses the defaults for a {} basement.",
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
        ctx.errors.push(error(e.path(), format!("Floor '{}' on floor {} is under no building part's lowest storey. The existing-building EPC gives each building part one floor, under its lowest storey; move it under the storey it carries or delete it.", e.name, e.level)));
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
        let (model, errors, notices) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
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
    fn party_ceilings_over_one_part_agree_on_their_construction_weight() {
        let text = csv(
            SETTINGS,
            &box_walls(&BOX, &[0]),
            &format!(
                "{NON_EXPOSED}\n{}\n{}\n{}",
                party_plane("Party floor", 0, 180.0, ""),
                party_plane(
                    "Ceiling A",
                    1,
                    0.0,
                    ",\"\"construction_weight\"\":\"\"heavy (concrete)\"\""
                ),
                party_plane("Ceiling B", 1, 0.0, ""),
            ),
        );
        let (_, errors, _) = run_on(&text, flat_model(2));
        assert!(
            errors.iter().any(|e| e.message.contains(
                "The existing-building EPC gives 'Ceiling A', 'Ceiling B' one construction weight"
            )),
            "{errors:#?}"
        );
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
            "states no height_basement_walls or basement_air_volume, so it uses the defaults for a fully underground basement"
        )));
    }

    #[test]
    fn a_heated_basement_takes_its_depth_and_the_floor_above_it() {
        let mut exposed = box_walls(&BOX, &[0]);
        exposed.push(plane("Roof", 1, &BOX, 0.0, 0.0, false));
        let (model, errors, _) = run(&csv(SETTINGS, &exposed, &basement("Heated_basement", "{}")));
        assert!(errors.is_empty(), "{errors:#?}");
        let floor = &model["Zone"]["building_parts"]["Main"]["floor"];
        assert_eq!(floor["floor_type"], "heated basement");
        assert_eq!(floor["depth_basement_floor"], 2.0);
        assert_eq!(floor["floor_above_basement_area"], 48.0);
        assert_eq!(floor["floor_above_basement_perimeter"], 28.0);
    }

    /// The editor draws a basement as floor 0 with its walls starting at minus the depth.
    fn editor_basement(floor_type: &str) -> String {
        let mut exposed: Vec<String> = box_walls(&BOX, &[0])
            .into_iter()
            .map(|w| w.replace(",90,1,2.8,0,0,", ",90,1,2.8,0,-2,"))
            .collect();
        exposed.extend(box_walls(&BOX, &[1]));
        exposed.push(plane("Roof", 2, &BOX, 0.0, 0.0, false));
        // The front door is in floor 1, the lowest storey above the ground.
        csv(SETTINGS, &exposed, &basement(floor_type, "{}"))
            .replace(",W00,\"3.5,0,0|4.5,0,0\"", ",W10,\"3.5,0,1|4.5,0,1\"")
    }

    #[test]
    fn the_editors_basement_drawing_is_the_floor_of_floor_1() {
        let (model, errors, notices) = run(&editor_basement("Heated_basement"));
        assert!(errors.is_empty(), "{errors:#?}");
        let main = &model["Zone"]["building_parts"]["Main"];
        assert_eq!(main["storeys"].as_array().unwrap().len(), 1);
        assert_eq!(main["walls"].as_array().unwrap().len(), 4);
        assert_eq!(main["walls"][0]["storey_index"], 0);
        let floor = &main["floor"];
        assert_eq!(floor["floor_type"], "heated basement");
        assert_eq!(floor["depth_basement_floor"], 2.0);
        assert_eq!(floor["floor_above_basement_area"], 48.0);
        assert!(notices
            .iter()
            .any(|n| n.message.contains("floor of floor 1, its storey 0")));
    }

    #[test]
    fn walls_below_the_ground_with_no_basement_floor_fail_naming_them() {
        let text = editor_basement("Heated_basement")
            .replace(",Heated_basement,", ",Slab_no_edge_insulation,");
        let (_, errors, _) = run(&text);
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0].message.contains("Walls 'W00', 'W01', 'W02', 'W03' on floor 0 are below the ground, but floor 0 has no basement floor"),
            "{}",
            errors[0].message
        );
    }

    /// A heated basement as the editor writes it (geometry editor `generateCSV`): floor F0
    /// "Basement 1" is canvas floor -1, and the walls take the base height the editor's reset
    /// gives walls on a basement floor (`basementExternalWallBaseHeightTargetM`, minus the depth).
    const EDITOR_BASEMENT_WALLS: &str = r#"B0,Z,BuildingElementOpaque,20,90,8,2.5,,-2.5,,FALSE,,"0.000,0.000,-1.000|8.000,0.000,-1.000","{""_name_auto_sync"":false}"
B1,Z,BuildingElementOpaque,15,90,6,2.5,,-2.5,,FALSE,,"8.000,0.000,-1.000|8.000,6.000,-1.000","{""_name_auto_sync"":false}"
B2,Z,BuildingElementOpaque,20,90,8,2.5,,-2.5,,FALSE,,"8.000,6.000,-1.000|0.000,6.000,-1.000","{""_name_auto_sync"":false}"
B3,Z,BuildingElementOpaque,15,90,6,2.5,,-2.5,,FALSE,,"0.000,6.000,-1.000|0.000,0.000,-1.000","{""_name_auto_sync"":false}""#;
    const EDITOR_BASEMENT_FLOOR: &str = r#"Ground Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,total_area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json
Basement floor,Z,BuildingElementGround,48,,,,,Heated_basement,2.5,,,,"0.000,0.000,-1.000|8.000,0.000,-1.000|8.000,6.000,-1.000|0.000,6.000,-1.000","{""_name_auto_sync"":false}""#;

    fn editor_basement_below(extra: &[String], floor: &str) -> String {
        let mut exposed = vec![EDITOR_BASEMENT_WALLS.to_string()];
        exposed.extend(box_walls(&BOX, &[0]));
        exposed.push(plane("Roof", 1, &BOX, 0.0, 0.0, false));
        exposed.extend_from_slice(extra);
        csv(SETTINGS, &exposed, floor)
    }

    #[test]
    fn the_editors_basement_on_floor_minus_1_is_the_floor_of_storey_0() {
        let (model, errors, notices) = run(&editor_basement_below(&[], EDITOR_BASEMENT_FLOOR));
        assert!(errors.is_empty(), "{errors:#?}");
        let main = &model["Zone"]["building_parts"]["Main"];
        assert_eq!(main["storeys"].as_array().unwrap().len(), 1);
        assert_eq!(main["walls"].as_array().unwrap().len(), 4);
        let floor = &main["floor"];
        assert_eq!(floor["floor_type"], "heated basement");
        assert_eq!(floor["depth_basement_floor"], 2.5);
        assert_eq!(floor["floor_above_basement_area"], 48.0);
        assert!(notices.iter().any(|n| n
            .message
            .contains("so the constructions of walls 'B0', 'B1', 'B2', 'B3' are not used")));
    }

    #[test]
    fn basement_depth_comes_from_the_walls_when_the_floor_states_none() {
        let floor = EDITOR_BASEMENT_FLOOR.replace(",Heated_basement,2.5,", ",Heated_basement,,");
        let (model, errors, _) = run(&editor_basement_below(&[], &floor));
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(
            model["Zone"]["building_parts"]["Main"]["floor"]["depth_basement_floor"],
            2.5
        );
    }

    #[test]
    fn a_window_in_a_basement_wall_fails_naming_it() {
        let window =
            "Light well,Z,BuildingElementTransparent,1,90,1,1,,-1.5,,FALSE,B0,\"2,0,-1|3,0,-1\","
                .to_string();
        let (_, errors, _) = run(&editor_basement_below(&[window], EDITOR_BASEMENT_FLOOR));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0].message.contains(
                "Windows or doors 'Light well' are in walls of basement 'Basement floor'"
            ),
            "{}",
            errors[0].message
        );
    }

    #[test]
    fn walls_on_floor_minus_1_with_no_basement_floor_fail_naming_them() {
        let floor = EDITOR_BASEMENT_FLOOR.replace(",Heated_basement,", ",Slab_no_edge_insulation,");
        let (_, errors, _) = run(&editor_basement_below(&[], &floor));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0].message.contains("Walls 'B0', 'B1', 'B2', 'B3' on floor -1 are below the ground, but floor -1 has no basement floor"),
            "{}",
            errors[0].message
        );
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
