// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEMIE bundles for existing buildings (EPC 04): bay windows, non-separated conservatories and
//! the box-in-roof check. Each is derived from the drawing wherever the drawing carries it; what
//! the drawing cannot show is an element value with no default:
//! - a bay's walls state `bay_window: true` (the drawing cannot tell a bay from a small
//!   extension);
//! - a conservatory's ground floor states `conservatory`: `non-separated` converts, while
//!   `separated` and `unheated` stop, as DESNZ excludes them (EPC 04 4.3.1).
//!
//! Each rule states its source as `hemie.rs` does.

use super::*;

const BAY_FLAG: &str = "bay_window";
/// DESNZ-defined: conservatory wall glazing opens closed, half opening (top) or third opening
/// (top) only (EPC 04 Table 4.3.2.1).
const CONSERVATORY_WALL_WINDOW_TYPES: [&str; 3] =
    ["closed", "half opening top", "top third opening"];

// ---------------------------------------------------------------------------------------------
// Bay windows (EPC 04 4.5)

/// A bay drawn as three walls in a storey outline: two sides and a front facet.
pub(super) struct Bay<'a> {
    level: i64,
    /// Side, front, side, from the opening's end `a` to its end `b`.
    facets: [&'a El<'a>; 3],
    a: P,
    b: P,
    parent: &'a str,
    /// The opening drawn with no wall across it: the parent wall continued across, so the
    /// storey outline closes and the parent wall's HEMIE edge spans the opening.
    pub(super) chord: Option<El<'a>>,
    poly: Vec<P>,
}

pub(super) fn is_bay_wall(e: &El) -> bool {
    e.flag(BAY_FLAG)
}

/// The bays drawn in the model. Derived from the model: facets joined end to end, measured from
/// the drawing; a shape HEMIE's bay cannot hold stops and names the walls.
pub(super) fn bays<'a>(ctx: &mut Ctx, els: &'a [El<'a>]) -> Vec<Bay<'a>> {
    let facets: Vec<&El> = els
        .iter()
        .filter(|e| is_bay_wall(e) && e.pts.len() == 2)
        .collect();
    let others: Vec<&El> = els
        .iter()
        .filter(|e| !is_bay_wall(e) && wall_kind(e).is_some())
        .collect();
    let mut groups: Vec<Vec<&El>> = Vec::new();
    for f in &facets {
        let touching: Vec<usize> = (0..groups.len())
            .filter(|&g| {
                groups[g].iter().any(|x| {
                    x.level == f.level
                        && x.pts
                            .iter()
                            .any(|p| f.pts.iter().any(|q| dist(*p, *q) <= TOL))
                })
            })
            .collect();
        let mut merged = vec![*f];
        for g in touching.into_iter().rev() {
            merged.extend(groups.remove(g));
        }
        groups.push(merged);
    }
    let mut out = Vec::new();
    for group in groups {
        let names = quoted(&group.iter().map(|f| f.name).collect::<Vec<_>>());
        let path = group[0].path();
        let shared = |f: &El, p: P| {
            group
                .iter()
                .any(|x| x.name != f.name && x.pts.iter().any(|q| dist(p, *q) <= TOL))
        };
        let fronts: Vec<&El> = group
            .iter()
            .copied()
            .filter(|f| f.pts.iter().all(|p| shared(f, *p)))
            .collect();
        let ([front], 3) = (fronts.as_slice(), group.len()) else {
            ctx.errors.push(error(path, format!("The bay walls {names} are not two sides and a front joined end to end. HEMIE takes a bay as a front facet between two side facets (EPC 04 4.5.3).")));
            continue;
        };
        let ends: Vec<P> = group
            .iter()
            .filter(|f| f.name != front.name)
            .map(|f| {
                *f.pts
                    .iter()
                    .find(|p| !shared(f, **p))
                    .expect("a side's free end")
            })
            .collect();
        let sides: Vec<&El> = group
            .iter()
            .copied()
            .filter(|f| f.name != front.name)
            .collect();
        let (a, b) = (ends[0], ends[1]);
        // Derived from the model: the wall the bay projects from runs through both ends of the
        // opening; drawn in two pieces, the longer piece is continued across the opening (ours).
        let on_line = |w: &El, p: P| {
            seg_dist(p, w.pts[0], w.pts[1]) <= TOL
                && cross(unit(sub(w.pts[1], w.pts[0])), unit(sub(b, a))).abs() < 0.05
        };
        let level_walls: Vec<&El> = others
            .iter()
            .copied()
            .filter(|w| w.level == front.level)
            .collect();
        let (parent, chord) = match level_walls.iter().find(|w| on_line(w, a) && on_line(w, b)) {
            Some(w) => (*w, None),
            None => {
                let at = |p: P| level_walls.iter().copied().find(|w| on_line(w, p));
                match (at(a), at(b)) {
                    (Some(x), Some(y)) => {
                        let w = if x.length() >= y.length() { x } else { y };
                        let chord = El {
                            row: w.row,
                            name: w.name,
                            zone: w.zone,
                            ty: w.ty,
                            pts: vec![a, b],
                            level: w.level,
                        };
                        (w, Some(chord))
                    }
                    _ => {
                        ctx.errors.push(error(path, format!("The bay walls {names} do not start and end on one straight wall line. A bay projects from one external wall (EPC 04 4.5.1).")));
                        continue;
                    }
                }
            }
        };
        if wall_kind(parent) != Some(Kind::External) {
            ctx.errors.push(error(path, format!("The bay walls {names} project from '{}', which is not an external wall. DESNZ covers bays on external walls only (EPC 04 4.5.1).", parent.name)));
            continue;
        }
        // DESNZ-defined: only bays that start at the base of the parent wall (EPC 04 4.5.1).
        if group.iter().any(|f| {
            (f.num("base_height").unwrap_or(0.0) - parent.num("base_height").unwrap_or(0.0)).abs()
                > TOL
        }) {
            ctx.errors.push(error(path, format!("The bay walls {names} start above the base of '{}'. DESNZ does not cover a projection that starts above the base of its wall, such as an oriel (EPC 04 4.5.1).", parent.name)));
            continue;
        }
        // HEMIE's bay is symmetric: a front parallel to the opening, sides tapering equally.
        let along = unit(sub(b, a));
        let (f0, f1) = if dot(sub(front.pts[0], a), along) <= dot(sub(front.pts[1], a), along) {
            (front.pts[0], front.pts[1])
        } else {
            (front.pts[1], front.pts[0])
        };
        let (taper_a, taper_b) = (dot(sub(f0, a), along), dist(a, b) - dot(sub(f1, a), along));
        if cross(unit(sub(f1, f0)), along).abs() >= 0.05
            || (taper_a - taper_b).abs() > TOL
            || taper_a < -TOL
        {
            ctx.errors.push(error(path, format!("The bay walls {names} are not symmetric about the bay's centre, with the front parallel to the wall and no wider than the opening (within {TOL} m). HEMIE takes a bay with two equal sides (EPC 04 4.5.3).")));
            continue;
        }
        out.push(Bay {
            level: front.level,
            facets: [sides[0], front, sides[1]],
            a,
            b,
            parent: parent.name,
            chord,
            poly: vec![a, f0, f1, b],
        });
    }
    out
}

/// A roof plane over a bay is the bay's roof, not a building part's.
pub(super) fn over_bay(bays: &[Bay], plane: &El) -> bool {
    bays.iter().any(|b| inside(centroid(&plane.pts), &b.poly))
}

/// Each bay on the HEMIE wall it projects from (`bay_window`).
#[allow(clippy::too_many_arguments)]
pub(super) fn attach_bays(
    ctx: &mut Ctx,
    bays: &[Bay],
    walls: &mut [HemieWall],
    parts: &[Part],
    planes: &[&El],
    windows: &[&El],
    doors: &[&El],
    placed: &mut BTreeSet<String>,
) {
    for bay in bays {
        let [side_a, front, side_b] = bay.facets;
        let names = quoted(&bay.facets.map(|f| f.name));
        let Some(wi) = walls.iter().position(|w| {
            w.source.name == bay.parent
                && w.storey as i64 == bay.level
                && seg_dist(bay.a, w.a, w.b) <= TOL
                && seg_dist(bay.b, w.a, w.b) <= TOL
        }) else {
            ctx.errors.push(error(
                front.path(),
                format!(
                    "The bay walls {names} are not on one edge of the storey outline of '{}'.",
                    bay.parent
                ),
            ));
            continue;
        };
        if inside(
            mid(front.pts[0], front.pts[1]),
            &parts[walls[wi].part].storeys[walls[wi].storey],
        ) {
            ctx.errors.push(error(front.path(), format!("The bay walls {names} point into the storey, not out of it. A bay projects outside its wall (EPC 04 4.5.1).")));
            continue;
        }
        if let Some(d) = doors
            .iter()
            .find(|d| bay.facets.iter().any(|f| d.host() == Some(f.name)))
        {
            ctx.errors.push(error(
                d.path(),
                format!(
                    "Door '{}' is in a bay wall. HEMIE's bay holds windows only (EPC 04 4.5.2).",
                    d.name
                ),
            ));
            continue;
        }
        let hosted = |f: &El| -> Vec<&El> {
            windows
                .iter()
                .copied()
                .filter(|w| w.host() == Some(f.name))
                .collect()
        };
        let [front_window] = hosted(front)[..] else {
            ctx.errors.push(error(front.path(), format!("Bay front '{}' has {} windows. HEMIE's bay has one front window (EPC 04 Table 4.5.2).", front.name, hosted(front).len())));
            continue;
        };
        let mut bay_value = Map::new();
        placed.insert(front_window.name.to_string());
        let Some(w) = window(ctx, front_window, true) else {
            continue;
        };
        bay_value.insert("front_window".into(), w);
        // DESNZ-defined: one side window serves both sides, or none (EPC 04 Table 4.5.2).
        match (&hosted(side_a)[..], &hosted(side_b)[..]) {
            ([], []) => {}
            ([x], [y]) => {
                placed.insert(x.name.to_string());
                placed.insert(y.name.to_string());
                let (wx, wy) = (window(ctx, x, true), window(ctx, y, true));
                if wx != wy {
                    ctx.errors.push(error(x.path(), format!("Bay side windows '{}' and '{}' differ. HEMIE gives both sides of a bay one window (EPC 04 Table 4.5.2); make them the same.", x.name, y.name)));
                    continue;
                }
                bay_value.insert("side_window".into(), wx.expect("checked"));
            }
            _ => {
                ctx.errors.push(error(side_a.path(), format!("The bay sides '{}' and '{}' do not each have one window, or both none. HEMIE gives both sides of a bay one window, or none (EPC 04 Table 4.5.2).", side_a.name, side_b.name)));
                continue;
            }
        }
        // Derived from the model: the measurements of EPC 04 Table 4.5.3.
        let along = unit(sub(bay.b, bay.a));
        let front_mid = mid(front.pts[0], front.pts[1]);
        bay_value.insert(
            "bay_depth".into(),
            json!(cross(along, sub(front_mid, bay.a)).abs()),
        );
        bay_value.insert("front_facet_width".into(), json!(front.length()));
        bay_value.insert("full_opening_width".into(), json!(dist(bay.a, bay.b)));
        let heights: Vec<Option<f64>> = bay.facets.iter().map(|f| ctx.need(f, "height")).collect();
        let Some(heights) = heights.into_iter().collect::<Option<Vec<f64>>>() else {
            continue;
        };
        if heights.iter().any(|h| (h - heights[1]).abs() > TOL) {
            ctx.errors.push(error(front.path(), format!("The bay walls {names} have different heights. HEMIE gives a bay one wall height (EPC 04 Table 4.5.3).")));
            continue;
        }
        // Derived from the model, as for storey walls: the drawn wall runs from floor to the
        // floor or roof above, and the ceiling is the storey gap below that.
        bay_value.insert("bay_height".into(), json!(heights[1] - STOREY_GAP));
        // DESNZ-defined: with no construction of their own, the bay walls take the parent
        // wall's (EPC 04 Table 4.5.2).
        if bay.facets.iter().any(|f| {
            [
                "u_value",
                "thermal_resistance_construction",
                "areal_heat_capacity",
            ]
            .iter()
            .any(|k| f.num(k).is_some())
        }) {
            let key = ctx.construction("external_wall", &bay.facets, &[]);
            bay_value.insert("wall_construction".into(), json!(key));
        }
        // Derived from the model: a roof drawn over the bay on its top storey; none where the
        // storey above covers it (EPC 04 4.5.3). Its type follows the drawn planes; HEMIE
        // simplifies a pitched bay roof to one 35° slope facing the wall (DESNZ-defined).
        let top = bays
            .iter()
            .filter(|o| o.poly == bay.poly || inside(centroid(&bay.poly), &o.poly))
            .map(|o| o.level)
            .max();
        if top == Some(bay.level) {
            let over: Vec<&El> = planes
                .iter()
                .copied()
                .filter(|p| inside(centroid(&p.pts), &bay.poly))
                .collect();
            let flat = over.iter().filter(|p| p.num("pitch") == Some(0.0)).count();
            let construction_type = match (flat, over.len()) {
                (_, 0) => None,
                (f, n) if f == n => Some("mini_flat_roof"),
                (0, _) => Some("mini_pitched_roof"),
                _ => {
                    ctx.errors.push(error(over[0].path(), format!("The bay roof {} is part flat and part pitched. HEMIE's bay roof is flat or pitched (EPC 04 4.5.3).", quoted(&over.iter().map(|p| p.name).collect::<Vec<_>>()))));
                    continue;
                }
            };
            if let Some(t) = construction_type {
                let key = ctx.construction(t, &over, &[]);
                bay_value.insert("roof_construction".into(), json!(key));
            }
        }
        walls[wi]
            .value
            .insert("bay_window".into(), Value::Object(bay_value));
    }
}

// ---------------------------------------------------------------------------------------------
// Conservatories (EPC 04 4.3)

/// Which building parts are non-separated conservatories: their ground floor says so.
pub(super) fn conservatories(
    ctx: &mut Ctx,
    els: &[El],
    parts: &[Part],
    names: &[String],
) -> Vec<bool> {
    parts
        .iter()
        .zip(names)
        .map(|(part, name)| {
            let interior = interior_point(&part.poly);
            let Some(g) = els.iter().find(|e| e.ty == "BuildingElementGround" && e.pts.len() >= 3 && inside(interior, &e.pts)) else {
                return false;
            };
            match g.text("conservatory") {
                None => false,
                Some("non-separated") => {
                    // DESNZ-defined: a conservatory is one storey on a slab or suspended floor
                    // (EPC 04 4.3.3).
                    if part.top > 0 {
                        ctx.errors.push(error(g.path(), format!("Conservatory '{name}' has {} storeys. HEMIE models a conservatory as a single storey (EPC 04 4.3.3).", part.top + 1)));
                    }
                    if !matches!(g.text("floor_type"), Some("Slab_no_edge_insulation" | "Slab_edge_insulation" | "Suspended_floor")) {
                        ctx.errors.push(error(g.path(), format!("Conservatory floor '{}' is not a slab or suspended floor. DESNZ allows only those for a conservatory (EPC 04 4.3.3).", g.name)));
                    }
                    true
                }
                Some("separated") => {
                    ctx.errors.push(error(g.path(), format!("'{}' is the floor of a separated conservatory. DESNZ leaves a separated conservatory out of the assessment (EPC 04 4.3.1): delete it from the model.", g.name)));
                    false
                }
                Some("unheated") => {
                    ctx.errors.push(error(g.path(), format!("'{}' is the floor of an unheated conservatory. DESNZ does not enter one as a building part (EPC 04 4.3.1): delete it, and make the wall it borders a sheltered wall.", g.name)));
                    false
                }
                Some(other) => {
                    ctx.errors.push(error(g.path(), format!("Floor '{}' states conservatory '{other}'. Use non-separated, separated or unheated.", g.name)));
                    false
                }
            }
        })
        .collect()
}

/// Opening type, security risk and glazed area of the glazing in a conservatory wall or roof.
/// Derived from the model; with no opening type stated, DESNZ's default, closed.
fn glazing(
    ctx: &mut Ctx,
    glazing: &[&El],
    allowed: Option<&[&str]>,
    defaulted: &mut Vec<String>,
    owner: &El,
) -> Option<(String, Option<bool>, f64)> {
    let types: BTreeSet<&str> = glazing
        .iter()
        .flat_map(|w| {
            w.get("window_sections")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|s| s.get("window_type")?.as_str())
        .collect();
    let names = quoted(&glazing.iter().map(|w| w.name).collect::<Vec<_>>());
    let window_type = match types.iter().collect::<Vec<_>>()[..] {
        [] => {
            defaulted.push(owner.name.to_string());
            "closed".to_string()
        }
        [t] if allowed.is_none_or(|a| a.contains(t)) => t.to_string(),
        _ => {
            ctx.errors.push(error(owner.path(), format!("The glazing {names} of conservatory element '{}' opens as {}. HEMIE gives a conservatory wall or roof one opening type{}.", owner.name, quoted(&types.into_iter().collect::<Vec<_>>()), allowed.map(|a| format!(": {}", quoted(a))).unwrap_or_default())));
            return None;
        }
    };
    let risks: BTreeSet<bool> = glazing
        .iter()
        .filter_map(|w| w.get("security_risk")?.as_bool())
        .collect();
    if risks.len() > 1 {
        ctx.errors.push(error(
            owner.path(),
            format!(
                "The glazing {names} of '{}' differs in security risk. HEMIE gives it one.",
                owner.name
            ),
        ));
        return None;
    }
    let area = glazing
        .iter()
        .map(|w| w.num("width").unwrap_or(0.0) * w.num("height").unwrap_or(0.0))
        .sum();
    Some((window_type, risks.into_iter().next(), area))
}

fn defaulted_notice(ctx: &mut Ctx, part: &str, defaulted: Vec<String>) {
    if !defaulted.is_empty() {
        ctx.notices.push(notice("/Zone", format!("{part}: the glazing of {} states no opening type, so it takes DESNZ's default, closed (EPC 04 Tables 4.3.2.1, 4.3.2.2).", quoted(&defaulted.iter().map(String::as_str).collect::<Vec<_>>()))));
    }
}

/// The walls of each conservatory part as HEMIE conservatory walls.
pub(super) fn conservatory_walls(
    ctx: &mut Ctx,
    conservatory: &[bool],
    kinds: &[(&El, Kind)],
    walls: &mut [HemieWall],
    windows: &[&El],
    doors: &[&El],
    placed: &mut BTreeSet<String>,
) {
    let mut defaulted = Vec::new();
    let mut solid_doors = Vec::new();
    for wi in 0..walls.len() {
        if !conservatory[walls[wi].part] {
            continue;
        }
        let source = walls[wi].source;
        let kind = kinds
            .iter()
            .find(|(x, _)| x.name == source.name)
            .map(|(_, k)| *k)
            .expect("wall");
        // The edge of the host wall nearest each opening, as for storey walls.
        let nearest = |o: &El| {
            let m = o.plan_mid();
            walls
                .iter()
                .enumerate()
                .filter(|(_, w)| w.source.name == source.name)
                .min_by(|(_, x), (_, y)| seg_dist(m, x.a, x.b).total_cmp(&seg_dist(m, y.a, y.b)))
                .map(|(i, _)| i)
        };
        let glazed: Vec<&El> = windows
            .iter()
            .copied()
            .filter(|w| w.host() == Some(source.name) && nearest(w) == Some(wi))
            .collect();
        // DESNZ-defined: solid doors are not entered in a conservatory wall (EPC 04 4.3.3).
        for d in doors
            .iter()
            .filter(|d| d.host() == Some(source.name) && nearest(d) == Some(wi))
        {
            placed.insert(d.name.to_string());
            solid_doors.push(d.name.to_string());
        }
        for w in &glazed {
            placed.insert(w.name.to_string());
        }
        let Some((window_type, risk, area)) = glazing(
            ctx,
            &glazed,
            Some(&CONSERVATORY_WALL_WINDOW_TYPES),
            &mut defaulted,
            source,
        ) else {
            continue;
        };
        let Some(height) = ctx.need(source, "height") else {
            continue;
        };
        // Derived from the model: the glazed share of the drawn wall (EPC 04 4.3.3).
        let fraction = area / (dist(walls[wi].a, walls[wi].b) * height);
        if fraction <= 0.0 || fraction > 1.0 + 1e-9 {
            ctx.errors.push(error(source.path(), format!("Conservatory wall '{}' is {:.0}% glazed. DESNZ makes each conservatory wall glazed, above 0 and up to 100% (EPC 04 Table 4.3.2.1).", source.name, fraction * 100.0)));
            continue;
        }
        let fraction = fraction.min(1.0);
        let value = &mut walls[wi].value;
        value.insert("wall_type".into(), json!("conservatory"));
        value.insert("wall_exposure_type".into(), json!(kind.wall_type()));
        value.insert("glazing_fraction".into(), json!(fraction));
        value.insert("window_type".into(), json!(window_type));
        if let Some(risk) = risk {
            value.insert("is_security_risk".into(), json!(risk));
        }
        if kind == Kind::Sheltered {
            match source.text("adjacent_space_type") {
                Some(space) => {
                    walls[wi].value.insert("adjacent_space_type".into(), json!(space));
                }
                None => ctx.errors.push(error(source.path(), format!("Sheltered conservatory wall '{}' does not state the unheated space it borders. Give it an adjacent_space_type.", source.name))),
            }
        }
        let extra = if kind == Kind::External {
            vec![("areal_heat_capacity", json!(UNUSED_WINDOW_HEAT_CAPACITY))]
        } else {
            Vec::new()
        };
        let key = ctx.construction("window", &glazed, &extra);
        walls[wi]
            .value
            .insert("glazing_construction".into(), json!(key));
        if fraction < 1.0 {
            let construction_type = match kind {
                Kind::External => "external_wall",
                Kind::Party => "party_wall",
                Kind::Sheltered => "sheltered_wall",
            };
            let key = ctx.construction(construction_type, &[source], &[]);
            walls[wi]
                .value
                .insert("opaque_construction".into(), json!(key));
        }
    }
    defaulted_notice(ctx, "Conservatory walls", defaulted);
    if !solid_doors.is_empty() {
        ctx.notices.push(notice("/Zone", format!("The doors {} are in conservatory walls. DESNZ does not enter solid doors there; draw a glazed door as a window (EPC 04 4.3.3).", quoted(&solid_doors.iter().map(String::as_str).collect::<Vec<_>>()))));
    }
}

/// A conservatory's roof (EPC 04 Tables 4.3.2.2). Derived from the model: type, slopes and
/// glazing from the drawn planes and their rooflights; length and width are left to HEMIE, from
/// the footprint (DESNZ default).
#[allow(clippy::too_many_arguments)]
pub(super) fn conservatory_roof(
    ctx: &mut Ctx,
    planes: &[&El],
    windows: &[&El],
    part: &str,
    top_ring: &[P],
    orient: &dyn Fn(P) -> f64,
    gables: &[(&El, Kind, P, P)],
    placed: &mut BTreeSet<String>,
) -> Option<Value> {
    let Some(first) = planes.first() else {
        ctx.errors.push(error(
            "/Zone".into(),
            format!("Conservatory '{part}' has no roof drawn over it. Draw its roof."),
        ));
        return None;
    };
    let flat = planes
        .iter()
        .filter(|p| p.num("pitch") == Some(0.0))
        .count();
    if flat != 0 && flat != planes.len() {
        ctx.errors.push(error(first.path(), format!("Conservatory '{part}' has flat and pitched roof planes. HEMIE gives a conservatory one flat or pitched roof (EPC 04 4.3.2.2).")));
        return None;
    }
    let lights: Vec<&El> = windows
        .iter()
        .copied()
        .filter(|w| planes.iter().any(|p| w.host() == Some(p.name)))
        .collect();
    for w in &lights {
        placed.insert(w.name.to_string());
    }
    let mut defaulted = Vec::new();
    let (window_type, _, glazed) = glazing(ctx, &lights, None, &mut defaulted, first)?;
    defaulted_notice(ctx, part, defaulted);
    let measured = sloped_measurements(ctx, planes)?;
    let area: f64 = measured.iter().map(|m| m.area).sum();
    // Derived from the model: the glazed share of the drawn roof.
    let fraction = glazed / area;
    if fraction <= 0.0 || fraction > 1.0 + 1e-9 {
        ctx.errors.push(error(first.path(), format!("The roof of conservatory '{part}' is {:.0}% glazed. DESNZ makes a conservatory roof glazed, above 0 and up to 100% (EPC 04 Table 4.3.2.2).", fraction * 100.0)));
        return None;
    }
    let fraction = fraction.min(1.0);
    let key = ctx.construction(
        "window",
        &lights,
        &[("areal_heat_capacity", json!(UNUSED_WINDOW_HEAT_CAPACITY))],
    );
    let mut roof = json!({"glazing_fraction": fraction, "window_type": window_type, "glazing_construction": key});
    let opaque_type = if flat > 0 {
        "flat_roof"
    } else {
        "heated_pitched_roof"
    };
    if fraction < 1.0 {
        roof["opaque_construction"] = json!(ctx.construction(opaque_type, planes, &[]));
    }
    if flat > 0 {
        roof["roof_type"] = json!("Conservatory Flat");
        return Some(roof);
    }
    // Sides from the planes' own orientations, as for a loft roof.
    let mut sides: Vec<f64> = Vec::new();
    for m in &measured {
        if !sides.iter().any(|s| bearing_gap(*s, m.orientation) < 45.0) {
            sides.push(m.orientation);
        }
    }
    let pitch_type = match sides.as_slice() {
        [_] => "mono",
        [a, b] if bearing_gap(*a, *b) > 135.0 => "dual",
        _ => {
            // DESNZ-defined: one, or two opposite, slopes (EPC 04 4.1.3, 4.3.2.2).
            ctx.errors.push(error(first.path(), format!("The roof of conservatory '{part}' has {} slopes that are not one slope or two opposite ones. HEMIE takes a mono or dual pitched conservatory roof (EPC 04 4.3.2.2).", sides.len())));
            return None;
        }
    };
    let main = &measured[largest(&measured)];
    let (slope_orientation, u) = slope(top_ring, main.orientation, orient);
    // ours, as for loft roofs (E15): the area-weighted mean pitch.
    let pitch = measured.iter().map(|m| m.area * m.pitch).sum::<f64>() / area;
    rectangularity_notice(ctx, part, top_ring);
    // Derived from the model: an exposed gable is a profiled external wall across the ridge at
    // that end; left and right face the slope orientation.
    let centre = centroid(top_ring);
    let left = [-u[1], u[0]];
    let gable_at = |toward: P| {
        gables.iter().any(|(w, kind, a, b)| {
            *kind == Kind::External
                && w.has_profile()
                && cross(unit(sub(*b, *a)), u).abs() < 0.5
                && dot(sub(mid(*a, *b), centre), toward) > 0.0
        })
    };
    roof["roof_type"] = json!("Conservatory Pitched");
    roof["pitch_type"] = json!(pitch_type);
    roof["slope_orientation"] = json!(slope_orientation);
    roof["pitch"] = json!(pitch);
    roof["is_external_left_gable_wall"] = json!(gable_at(left));
    roof["is_external_right_gable_wall"] = json!(gable_at(scale(left, -1.0)));
    Some(roof)
}

// ---------------------------------------------------------------------------------------------
// Box in the roof (EPC 04 4.4.1)

/// DESNZ-defined: a box-shaped room set within a pitched roof is not covered. Derived from the
/// model: the top floor stands clear of the outline below, under an unheated pitched roof.
pub(super) fn box_in_roof(
    ctx: &mut Ctx,
    rings: &[Vec<P>],
    top_walls: &[&El],
    planes: &[&El],
) -> bool {
    let [.., lower, top] = rings else {
        return false;
    };
    let clear = top
        .iter()
        .all(|p| inside(*p, lower) && boundary_dist(*p, lower) > TOL);
    let under_roof = planes.iter().any(|p| {
        p.num("pitch").is_some_and(|x| x > 0.0)
            && p.flag("is_unheated_pitched_roof")
            && inside_or_on(centroid(top), &p.pts)
    });
    if clear && under_roof {
        ctx.errors.push(error(top_walls[0].path(), format!("The top floor ({}) is a room set inside a pitched roof, clear of the walls below: a box in the roof. DESNZ does not cover box-in-roof rooms (EPC 04 4.4.1).", quoted(&top_walls.iter().map(|w| w.name).collect::<Vec<_>>()))));
    }
    clear && under_roof
}

#[cfg(test)]
mod tests {
    use super::super::tests::*;
    use super::*;

    const WINDOW: &str = r#"HEMIE_construction_window,"{""frame_material"":""wood"",""glazing_type"":""double"",""glazing_gap"":""16"",""areal_heat_capacity"":0}""#;

    fn settings() -> String {
        format!("{SETTINGS}\n{WINDOW}")
    }

    #[allow(clippy::too_many_arguments)]
    fn opening(
        name: &str,
        host: &str,
        level: i64,
        a: P,
        b: P,
        width: f64,
        height: f64,
        extra: &str,
    ) -> String {
        format!(
            "{name},Z,BuildingElementTransparent,1,90,{width},{height},0,1,FALSE,FALSE,{host},\"{},{},{level}|{},{},{level}\",\"{extra}\"",
            a[0], a[1], b[0], b[1]
        )
    }

    const SECTIONS: &str = r#"{""window_sections"":[{""window_type"":""full opening""}]}"#;
    const BAY: &str = r#""{""bay_window"":true}""#;

    /// A two-storey box with a ground-floor bay in its south wall, which is drawn in two pieces.
    fn bay_house(side_windows: &[String]) -> String {
        let mut exposed: Vec<String> = box_walls(&BOX, &[0, 1])
            .into_iter()
            .filter(|w| !w.starts_with("W00,"))
            .collect();
        exposed.push(wall("W00", 0, [0.0, 0.0], [5.0, 0.0], 2.8));
        exposed.push(wall("W00b", 0, [7.0, 0.0], [8.0, 0.0], 2.8));
        exposed.push(wall("Bay W", 0, [5.0, 0.0], [5.3, -0.6], 2.8) + BAY);
        exposed.push(wall("Bay S", 0, [5.3, -0.6], [6.7, -0.6], 2.8) + BAY);
        exposed.push(wall("Bay E", 0, [6.7, -0.6], [7.0, 0.0], 2.8) + BAY);
        exposed.push(opening(
            "Bay window",
            "Bay S",
            0,
            [5.4, -0.6],
            [6.6, -0.6],
            1.2,
            1.3,
            SECTIONS,
        ));
        exposed.extend(side_windows.iter().cloned());
        exposed.push(plane(
            "Bay roof",
            1,
            &[[5.0, 0.0], [5.3, -0.6], [6.7, -0.6], [7.0, 0.0]],
            0.0,
            0.0,
            false,
        ));
        exposed.extend(gable_roof());
        csv(&settings(), &exposed, &ground(&BOX))
    }

    #[test]
    fn a_drawn_bay_is_a_bay_window_on_its_wall_with_a_flat_bay_roof() {
        let (model, errors, _) = run(&bay_house(&[]));
        assert!(errors.is_empty(), "{errors:#?}");
        let main = &model["Zone"]["building_parts"]["Main"];
        assert_eq!(
            model["Zone"]["building_parts"].as_object().unwrap().len(),
            1
        );
        let walls = main["walls"].as_array().unwrap();
        let with_bay: Vec<&Value> = walls
            .iter()
            .filter(|w| w.get("bay_window").is_some())
            .collect();
        assert_eq!(with_bay.len(), 1, "{walls:#?}");
        let bay = &with_bay[0]["bay_window"];
        assert!(
            (bay["bay_depth"].as_f64().unwrap() - 0.6).abs() < 1e-9,
            "{bay}"
        );
        assert!((bay["front_facet_width"].as_f64().unwrap() - 1.4).abs() < 1e-9);
        assert!((bay["full_opening_width"].as_f64().unwrap() - 2.0).abs() < 1e-9);
        assert!((bay["bay_height"].as_f64().unwrap() - 2.55).abs() < 1e-9);
        assert_eq!(bay["roof_construction"], "mini_flat_roof");
        assert_eq!(bay["front_window"]["width"], 1.2);
        assert!(bay.get("side_window").is_none() && bay.get("wall_construction").is_none());
        // The parent wall spans the opening; the storey outline has no bay in it.
        let ring = main["storeys"][0]["floorplan"].as_str().unwrap();
        assert!(!ring.contains("-0.6"), "{ring}");
        // The bay roof is the bay's, so the main roof stays one pitched roof.
        assert_eq!(main["roof"]["roof_type"], "Unknown Pitched (Unheated)");
    }

    #[test]
    fn bay_side_windows_that_differ_stop_and_are_named() {
        let sides = [
            opening(
                "Side W",
                "Bay W",
                0,
                [5.1, -0.2],
                [5.2, -0.4],
                0.3,
                1.3,
                SECTIONS,
            ),
            opening(
                "Side E",
                "Bay E",
                0,
                [6.8, -0.4],
                [6.9, -0.2],
                0.3,
                1.0,
                SECTIONS,
            ),
        ];
        let (_, errors, _) = run(&bay_house(&sides));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0].message.contains("differ")
                && errors[0].message.contains("'Side W'")
                && errors[0].message.contains("'Side E'"),
            "{}",
            errors[0].message
        );
    }

    #[test]
    fn equal_bay_side_windows_are_the_side_window() {
        let sides = [
            opening(
                "Side W",
                "Bay W",
                0,
                [5.1, -0.2],
                [5.2, -0.4],
                0.3,
                1.3,
                SECTIONS,
            ),
            opening(
                "Side E",
                "Bay E",
                0,
                [6.8, -0.4],
                [6.9, -0.2],
                0.3,
                1.3,
                SECTIONS,
            ),
        ];
        let (model, errors, _) = run(&bay_house(&sides));
        assert!(errors.is_empty(), "{errors:#?}");
        let walls = model["Zone"]["building_parts"]["Main"]["walls"]
            .as_array()
            .unwrap()
            .clone();
        let bay = walls.iter().find_map(|w| w.get("bay_window")).unwrap();
        assert_eq!(bay["side_window"]["width"], 0.3);
    }

    /// A two-storey box with a lean-to conservatory on its north wall; its floor states
    /// `conservatory`.
    fn conservatory_house(status: &str) -> String {
        let mut exposed: Vec<String> = box_walls(&BOX, &[0, 1])
            .into_iter()
            .filter(|w| !w.starts_with("W02,"))
            .collect();
        exposed.push(wall("W02a", 0, [8.0, 6.0], [6.0, 6.0], 2.8));
        exposed.push(wall("W02b", 0, [2.0, 6.0], [0.0, 6.0], 2.8));
        exposed.push(wall("C E", 0, [6.0, 6.0], [6.0, 9.0], 2.4));
        exposed.push(wall("C N", 0, [6.0, 9.0], [2.0, 9.0], 2.4));
        exposed.push(
            wall("C W", 0, [2.0, 9.0], [2.0, 6.0], 2.4)
                + r#""{""geometry_face"":{""top_profile"":[{""h"":2.4},{""h"":3.2}]}}""#,
        );
        exposed.push(opening(
            "CW E",
            "C E",
            0,
            [6.0, 7.0],
            [6.0, 8.0],
            2.0,
            1.2,
            "",
        ));
        exposed.push(opening(
            "CW N",
            "C N",
            0,
            [5.0, 9.0],
            [3.0, 9.0],
            3.0,
            1.6,
            "",
        ));
        exposed.push(opening(
            "CW W",
            "C W",
            0,
            [2.0, 8.0],
            [2.0, 7.0],
            2.4,
            1.8,
            "",
        ));
        exposed.push(plane(
            "C roof",
            1,
            &[[2.0, 6.0], [6.0, 6.0], [6.0, 9.0], [2.0, 9.0]],
            15.0,
            0.0,
            false,
        ));
        exposed.push(opening(
            "Rooflight",
            "C roof",
            1,
            [3.0, 7.0],
            [5.0, 7.0],
            2.0,
            1.5,
            "",
        ));
        exposed.extend(gable_roof());
        let ground = format!(
            "{}\nC floor,Z,BuildingElementGround,12,Slab_no_edge_insulation,\"2,6,0|6,6,0|6,9,0|2,9,0\",\"{{\"\"conservatory\"\":\"\"{status}\"\"}}\"",
            ground(&BOX).replace("floor_type,coords", "floor_type,coords,extra_json")
        );
        csv(&settings(), &exposed, &ground)
    }

    #[test]
    fn a_non_separated_conservatory_is_a_conservatory_building_part() {
        let (model, errors, notices) = run(&conservatory_house("non-separated"));
        assert!(errors.is_empty(), "{errors:#?}");
        let parts = &model["Zone"]["building_parts"];
        let c = &parts["Extension 1"];
        assert_eq!(c["is_non_separated_conservatory"], true);
        // DESNZ: a conservatory's walls run to the eaves, with no storey gap.
        assert!((c["storeys"][0]["ceiling_height"].as_f64().unwrap() - 2.4).abs() < 1e-9);
        let fractions: Vec<f64> = c["walls"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| {
                assert_eq!(w["wall_type"], "conservatory", "{w}");
                assert_eq!(w["window_type"], "closed");
                assert!(w.get("windows").is_none());
                w["glazing_fraction"].as_f64().unwrap()
            })
            .collect();
        let mut sorted = fractions.clone();
        sorted.sort_by(f64::total_cmp);
        for (got, want) in sorted.iter().zip([1.0 / 3.0, 0.5, 0.6]) {
            assert!((got - want).abs() < 1e-9, "{fractions:?}");
        }
        let roof = &c["roof"];
        assert_eq!(roof["roof_type"], "Conservatory Pitched");
        assert_eq!(roof["pitch_type"], "mono");
        assert_eq!(roof["pitch"], 15.0);
        assert!((roof["glazing_fraction"].as_f64().unwrap() - 0.3).abs() < 1e-9);
        assert_eq!(roof["opaque_construction"], "heated_pitched_roof");
        // Facing north (the slope), the profiled west gable is on the left.
        assert_eq!(roof["is_external_left_gable_wall"], true);
        assert_eq!(roof["is_external_right_gable_wall"], false);
        assert!(notices
            .iter()
            .any(|n| n.message.contains("DESNZ's default, closed")));
        assert!(parts["Main"].get("is_non_separated_conservatory").is_none());
    }

    #[test]
    fn separated_and_unheated_conservatories_stop_and_are_named() {
        for (status, says) in [
            ("separated", "separated conservatory"),
            ("unheated", "unheated conservatory"),
        ] {
            let (_, errors, _) = run(&conservatory_house(status));
            assert!(
                errors
                    .iter()
                    .any(|e| e.message.contains(says) && e.message.contains("'C floor'")),
                "{status}: {errors:#?}"
            );
        }
    }

    #[test]
    fn a_box_room_inside_a_pitched_roof_stops_as_box_in_roof() {
        let inner: [P; 4] = [[2.0, 2.0], [6.0, 2.0], [6.0, 4.0], [2.0, 4.0]];
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed
            .extend((0..4).map(|i| wall(&format!("Box{i}"), 2, inner[i], inner[(i + 1) % 4], 2.2)));
        exposed.extend(gable_roof());
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0].message.contains("box in the roof"),
            "{}",
            errors[0].message
        );
    }

    fn room_in_roof(extra: Vec<String>) -> String {
        let mut exposed = extra;
        exposed.push(gable("G W", [0.0, 0.0], [0.0, 6.0]));
        exposed.push(gable("G E", [8.0, 0.0], [8.0, 6.0]));
        let mut all = box_walls(&BOX, &[0, 1]);
        all.extend(exposed);
        csv(&settings(), &all, &ground(&BOX))
    }

    #[test]
    fn a_flat_dormer_bundle_is_a_flat_dormer_with_no_pitch() {
        let mut exposed = heated_roof();
        exposed.push(r#"D front,Z,BuildingElementOpaque,2.4,90,2,1.2,180,6.0,FALSE,FALSE,,"3,1,2|5,1,2","{""dormer_bundle"":{""role"":""front-wall-anchor"",""host_element_name"":""Roof S"",""window_name"":""DW"",""parameters"":{""dormerType"":""flat"",""frontWallHeight"":1.2}}}""#.to_string());
        exposed.push(opening(
            "DW",
            "D front",
            2,
            [3.5, 1.0],
            [4.5, 1.0],
            1.0,
            1.0,
            SECTIONS,
        ));
        let (model, errors, _) = run(&room_in_roof(exposed));
        assert!(errors.is_empty(), "{errors:#?}");
        let room = &model["Zone"]["building_parts"]["Main"]["roof"];
        let dormers: Vec<&Value> = [
            "dormers_in_slope_orientation",
            "dormers_opposite_slope_orientation",
        ]
        .iter()
        .flat_map(|k| room[*k].as_array().unwrap())
        .collect();
        assert_eq!(dormers.len(), 1, "{room:#}");
        assert_eq!(dormers[0]["roof_pitch_type"], "flat");
        assert!(dormers[0].get("roof_pitch").is_none());
    }

    #[test]
    fn a_flat_ceiling_in_a_roof_room_is_its_ceiling_width() {
        let exposed = vec![
            plane(
                "Slope S",
                2,
                &[[0.0, 0.0], [8.0, 0.0], [8.0, 2.5], [0.0, 2.5]],
                40.0,
                180.0,
                false,
            ),
            plane(
                "Slope N",
                2,
                &[[0.0, 3.5], [8.0, 3.5], [8.0, 6.0], [0.0, 6.0]],
                40.0,
                0.0,
                false,
            ),
            plane(
                "Ceiling",
                2,
                &[[0.0, 2.5], [8.0, 2.5], [8.0, 3.5], [0.0, 3.5]],
                0.0,
                0.0,
                false,
            ),
        ];
        let (model, errors, _) = run(&room_in_roof(exposed));
        assert!(errors.is_empty(), "{errors:#?}");
        let room = &model["Zone"]["building_parts"]["Main"]["roof"];
        assert_eq!(room["roof_type"], "Room In Roof");
        assert!(
            (room["ceiling_width"].as_f64().unwrap() - 1.0).abs() < 1e-9,
            "{room:#}"
        );
        // DESNZ: the surfaces above a flat ceiling take the unheated pitched roof construction.
        assert_eq!(
            room["unheated_pitched_roof_construction"],
            "unheated_pitched_roof"
        );
    }
}
