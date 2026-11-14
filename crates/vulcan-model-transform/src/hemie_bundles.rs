// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEMIE bundles for existing buildings: bay windows, conservatories and the box-in-roof
//! check. A bay or a conservatory is an editor bundle: ordinary elements, each tagged
//! `hemie_bundle` with its kind, bundle id, role and host wall. The converter measures the
//! drawn members; what the drawing cannot show (a conservatory's type) is on the tag.
//!
//! Each rule states its source as `hemie.rs` does.

use super::*;

/// DESNZ-defined: conservatory wall glazing opens closed, half opening (top) or third opening
/// (top) only.
const CONSERVATORY_WALL_WINDOW_TYPES: [&str; 3] =
    ["closed", "half opening top", "top third opening"];

/// An element's editor bundle tag.
pub(super) struct Tag<'a> {
    kind: &'a str,
    id: &'a str,
    role: &'a str,
    host: &'a str,
    conservatory_type: Option<&'a str>,
    adjacent_space_type: Option<&'a str>,
}

pub(super) fn tag<'a>(e: &El<'a>) -> Option<Tag<'a>> {
    let t = e.get("hemie_bundle")?;
    let text = |k: &str| t.get(k).and_then(Value::as_str);
    Some(Tag {
        kind: text("kind")?,
        id: text("bundle_id")?,
        role: text("role")?,
        host: text("host_wall")?,
        conservatory_type: text("conservatory_type"),
        adjacent_space_type: text("adjacent_space_type"),
    })
}

fn is_member_wall(e: &El, kind: &str) -> bool {
    tag(e).is_some_and(|t| t.kind == kind && t.role.ends_with("-wall"))
}

/// The member of bundle `id` with `role`.
fn member<'s, 'e>(els: &'s [El<'e>], id: &str, role: &str) -> Option<&'s El<'e>> {
    els.iter()
        .find(|e| tag(e).is_some_and(|t| t.id == id && t.role == role))
}

/// The ends of a side wall: the one on the host wall line, then the other.
fn side_ends(side: &El, host: &El) -> Option<(P, P)> {
    let on = |p: P| seg_dist(p, host.pts[0], host.pts[1]) <= TOL;
    match (on(side.pts[0]), on(side.pts[1])) {
        (true, false) => Some((side.pts[0], side.pts[1])),
        (false, true) => Some((side.pts[1], side.pts[0])),
        _ => None,
    }
}

// ---------------------------------------------------------------------------------------------
// Conservatories: which are left out, and the host wall each adjoins

/// DESNZ-defined: a separated or an unheated conservatory is not entered. Every member of one,
/// and every opening in a member, is left out of the conversion, with a notice. The host wall
/// of a separated one stays as drawn; that of an unheated one is sheltered where it adjoins
/// (`conservatory_hosts`).
pub(super) fn left_out<'a>(ctx: &mut Ctx, els: &[El<'a>]) -> BTreeSet<&'a str> {
    let mut out: BTreeSet<&'a str> = BTreeSet::new();
    let mut said: BTreeSet<&str> = BTreeSet::new();
    for e in els {
        let Some(t) = tag(e).filter(|t| t.kind == "conservatory") else {
            continue;
        };
        let status = match t.conservatory_type {
            Some("non-separated") => continue,
            Some(s @ ("separated" | "unheated")) => s,
            other => {
                if said.insert(t.id) {
                    ctx.errors.push(error(e.path(), format!("Conservatory '{}' has type {}. Give it non-separated, separated or unheated.", t.id, other.map_or("none".into(), |o| format!("'{o}'")))));
                }
                continue;
            }
        };
        out.insert(e.name);
        if said.insert(t.id) {
            let host = if status == "unheated" {
                format!(
                    "'{}' is a sheltered wall where the conservatory adjoins it.",
                    t.host
                )
            } else {
                format!("'{}' stays an external wall.", t.host)
            };
            ctx.notices.push(notice("/Zone", format!("The {status} conservatory on '{}' is left out: only a heated conservatory open to the dwelling is entered. {host}", t.host)));
        }
    }
    let hosted: Vec<&'a str> = els
        .iter()
        .filter(|e| e.host().is_some_and(|h| out.contains(h)))
        .map(|e| e.name)
        .collect();
    out.extend(hosted);
    out
}

/// A conservatory's host wall, split where the conservatory adjoins it. Non-separated, that span
/// is internal, between two parts of the dwelling (DESNZ-defined: a conservatory wall is an
/// edge not shared with another building part), so it is left out. Unheated, the span is a
/// sheltered wall with the unheated space type the bundle states (DESNZ-defined).
/// Separated, the host wall stays as drawn. Reads the members of every conservatory, so it
/// takes the elements before `left_out`. Returns the host walls replaced, their pieces (each with
/// its unheated space type when sheltered), and the non-separated conservatory floors (each its
/// own building part).
#[allow(clippy::type_complexity)]
pub(super) fn conservatory_hosts<'a>(
    ctx: &mut Ctx,
    els: &[El<'a>],
) -> (
    BTreeSet<&'a str>,
    Vec<(El<'a>, Option<&'a str>)>,
    Vec<Vec<P>>,
) {
    let (mut hosts, mut pieces, mut floors) = (BTreeSet::new(), Vec::new(), Vec::new());
    let ids: BTreeMap<&str, Option<&str>> = els
        .iter()
        .filter_map(|e| {
            tag(e)
                .filter(|t| t.kind == "conservatory")
                .map(|t| (t.id, t.conservatory_type))
        })
        .collect();
    for (id, status) in ids {
        let unheated = match status {
            Some("non-separated") => false,
            Some("unheated") => true,
            _ => continue, // separated stays as drawn; any other type is a `left_out` error
        };
        let (Some(left), Some(right), Some(floor)) = (
            member(els, id, "left-wall"),
            member(els, id, "right-wall"),
            member(els, id, "floor"),
        ) else {
            ctx.errors.push(error("/Zone".into(), format!("Conservatory '{id}' has lost a side wall or its floor. Place the conservatory again from its host wall.")));
            continue;
        };
        let t = tag(left).expect("member");
        let host_name = t.host;
        let space = if unheated {
            let Some(space) = t.adjacent_space_type else {
                ctx.errors.push(error(left.path(), format!("Unheated conservatory '{id}' does not state what unheated space '{host_name}' borders. Choose corridor, garage, roof void or stairwell on the conservatory.")));
                continue;
            };
            Some(space)
        } else {
            None
        };
        let Some(host) = els
            .iter()
            .find(|e| e.name == host_name && wall_kind(e).is_some() && tag(e).is_none())
        else {
            ctx.errors.push(error(left.path(), format!("The host wall '{host_name}' of conservatory '{id}' is not a wall of the model. Place the conservatory again from a wall.")));
            continue;
        };
        let (Some((a, _)), Some((b, _))) = (side_ends(left, host), side_ends(right, host)) else {
            ctx.errors.push(error(left.path(), format!("The side walls '{}' and '{}' of conservatory '{id}' do not each start on its host wall '{host_name}'. Place the conservatory again from that wall.", left.name, right.name)));
            continue;
        };
        let (p, q) = (host.pts[0], host.pts[1]);
        let along = |x: P| dot(sub(x, p), unit(sub(q, p)));
        let (lo, hi) = if along(a) <= along(b) { (a, b) } else { (b, a) };
        if let Some(o) = covered_opening(els, host, lo, hi).filter(|_| !unheated) {
            ctx.errors.push(error(o.path(), format!("'{}' is in the part of '{}' that conservatory '{id}' adjoins, which is inside the dwelling. Delete it, or move it to a conservatory wall.", o.name, host.name)));
            continue;
        }
        hosts.insert(host.name);
        let mut spans = vec![(p, lo, None), (hi, q, None)];
        if unheated {
            spans.insert(1, (lo, hi, space));
        }
        for (from, to, space) in spans {
            if dist(from, to) > TOL {
                let ty = if space.is_some() {
                    "BuildingElementAdjacentUnconditionedSpace_Simple"
                } else {
                    host.ty
                };
                let piece = El {
                    row: host.row,
                    name: host.name,
                    zone: host.zone,
                    ty,
                    pts: vec![from, to],
                    level: host.level,
                };
                pieces.push((piece, space));
            }
        }
        if !unheated {
            floors.push(floor.pts.clone());
        }
    }
    (hosts, pieces, floors)
}

/// A window or door of `host` whose middle lies between `lo` and `hi` along it.
fn covered_opening<'s, 'e>(els: &'s [El<'e>], host: &El, lo: P, hi: P) -> Option<&'s El<'e>> {
    let (p, q) = (host.pts[0], host.pts[1]);
    let along = |x: P| dot(sub(x, p), unit(sub(q, p)));
    let (lo, hi) = if along(lo) <= along(hi) {
        (lo, hi)
    } else {
        (hi, lo)
    };
    els.iter().find(|o| {
        o.host() == Some(host.name)
            && (o.ty == "BuildingElementTransparent" || o.flag("is_external_door"))
            && o.pts.len() >= 2
            && (along(o.plan_mid()) - along(lo)) > TOL
            && (along(hi) - along(o.plan_mid())) > TOL
    })
}

// ---------------------------------------------------------------------------------------------
// Bay windows

/// A bay bundle: two sides and a front facet, projecting from its host wall.
pub(super) struct Bay<'a> {
    level: i64,
    /// Side, front, side, from the opening's end `a` to its end `b`.
    facets: [&'a El<'a>; 3],
    a: P,
    b: P,
    parent: &'a str,
    poly: Vec<P>,
}

pub(super) fn is_bay_wall(e: &El) -> bool {
    is_member_wall(e, "bay")
}

/// The bay bundles in the model. Derived from the model: measured from the drawn members; a
/// shape HEMIE's bay cannot hold stops and names the walls.
pub(super) fn bays<'a>(ctx: &mut Ctx, els: &'a [El<'a>]) -> Vec<Bay<'a>> {
    let ids: BTreeSet<&str> = els
        .iter()
        .filter(|e| is_bay_wall(e))
        .filter_map(|e| tag(e).map(|t| t.id))
        .collect();
    let mut out = Vec::new();
    for id in ids {
        let (Some(side_a), Some(front), Some(side_b)) = (
            member(els, id, "left-wall"),
            member(els, id, "front-wall"),
            member(els, id, "right-wall"),
        ) else {
            ctx.errors.push(error(
                "/Zone".into(),
                format!(
                    "Bay '{id}' has lost one of its walls. Place the bay again from its host wall."
                ),
            ));
            continue;
        };
        let group = [side_a, front, side_b];
        let names = quoted(&group.map(|f| f.name));
        let path = front.path();
        let host = tag(front).expect("member").host;
        let joined = |side: &El| {
            side.pts
                .iter()
                .filter(|p| front.pts.iter().any(|q| dist(**p, *q) <= TOL))
                .count()
                == 1
        };
        if group.iter().any(|f| f.pts.len() != 2) || !joined(side_a) || !joined(side_b) {
            ctx.errors.push(error(path, format!("The bay walls {names} are not two sides and a front joined end to end. Place the bay again from its host wall.")));
            continue;
        }
        let free = |side: &El| {
            *side
                .pts
                .iter()
                .find(|p| front.pts.iter().all(|q| dist(**p, *q) > TOL))
                .expect("a side's free end")
        };
        let (a, b) = (free(side_a), free(side_b));
        // Derived from the model: the host wall runs through both ends of the opening.
        let on_line = |w: &El, p: P| {
            seg_dist(p, w.pts[0], w.pts[1]) <= TOL
                && cross(unit(sub(w.pts[1], w.pts[0])), unit(sub(b, a))).abs() < 0.05
        };
        let Some(parent) = els.iter().find(|w| {
            w.name == host
                && w.level == front.level
                && wall_kind(w).is_some()
                && !is_bay_wall(w)
                && on_line(w, a)
                && on_line(w, b)
        }) else {
            ctx.errors.push(error(path, format!("The bay walls {names} do not start and end on their host wall '{host}'. Place the bay again on that wall.")));
            continue;
        };
        if wall_kind(parent) != Some(Kind::External) {
            ctx.errors.push(error(path, format!("The bay walls {names} project from '{}', which is not an external wall. Place the bay on an external wall.", parent.name)));
            continue;
        }
        // HEMIE builds the bay's glazing from the bay alone: an opening left in the covered
        // part of the parent wall would count twice.
        if let Some(o) = covered_opening(els, parent, a, b) {
            ctx.errors.push(error(o.path(), format!("'{}' is in the part of '{}' that bay {names} covers. Delete it, or move it to a bay wall.", o.name, parent.name)));
            continue;
        }
        // DESNZ-defined: only bays that start at the base of the parent wall.
        let bases: Option<Vec<f64>> = group
            .iter()
            .chain([&parent])
            .map(|w| ctx.need(w, "base_height"))
            .collect();
        let Some(bases) = bases else { continue };
        let parent_base = bases[bases.len() - 1];
        if bases.iter().any(|b| (b - parent_base).abs() > TOL) {
            ctx.errors.push(error(path, format!("The bay walls {names} start above the base of '{}'. A projection that starts above the base of its wall, such as an oriel, cannot be entered: give the bay walls the wall's base height.", parent.name)));
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
            ctx.errors.push(error(path, format!("The bay walls {names} are not symmetric. Give the bay two equal sides, with the front parallel to the wall and no wider than the opening (within {TOL} m).")));
            continue;
        }
        out.push(Bay {
            level: front.level,
            facets: [side_a, front, side_b],
            a,
            b,
            parent: parent.name,
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
            ctx.errors.push(error(
                front.path(),
                format!(
                    "The bay walls {names} point into the storey. Draw the bay outside its wall."
                ),
            ));
            continue;
        }
        if let Some(d) = doors
            .iter()
            .find(|d| bay.facets.iter().any(|f| d.host() == Some(f.name)))
        {
            ctx.errors.push(error(
                d.path(),
                format!(
                    "Door '{}' is in a bay wall, which holds windows only. Move the door to another wall.",
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
            ctx.errors.push(error(
                front.path(),
                format!(
                    "Bay front '{}' has {} windows. Give the bay front exactly one window.",
                    front.name,
                    hosted(front).len()
                ),
            ));
            continue;
        };
        let mut bay_value = Map::new();
        placed.insert(front_window.name.to_string());
        let Some(w) = window(ctx, front_window, true) else {
            continue;
        };
        bay_value.insert("front_window".into(), w);
        // DESNZ-defined: one side window serves both sides, or none.
        match (&hosted(side_a)[..], &hosted(side_b)[..]) {
            ([], []) => {}
            ([x], [y]) => {
                placed.insert(x.name.to_string());
                placed.insert(y.name.to_string());
                let (wx, wy) = (window(ctx, x, true), window(ctx, y, true));
                if wx != wy {
                    ctx.errors.push(error(x.path(), format!("Bay side windows '{}' and '{}' differ. Both sides of a bay share one window: make them the same.", x.name, y.name)));
                    continue;
                }
                bay_value.insert("side_window".into(), wx.expect("checked"));
            }
            _ => {
                ctx.errors.push(error(side_a.path(), format!("The bay sides '{}' and '{}' do not each have one window. Give both sides the same window, or neither a window.", side_a.name, side_b.name)));
                continue;
            }
        }
        // Derived from the model: the bay's depth, front width, opening width and height.
        let along = unit(sub(bay.b, bay.a));
        let front_mid = mid(front.pts[0], front.pts[1]);
        bay_value.insert(
            "bay_depth".into(),
            json!(cross(along, sub(front_mid, bay.a)).abs()),
        );
        bay_value.insert("front_facet_width".into(), json!(front.length()));
        bay_value.insert("full_opening_width".into(), json!(dist(bay.a, bay.b)));
        let heights: Vec<Option<f64>> = bay.facets.iter().map(|f| ctx.eaves(f)).collect();
        let Some(heights) = heights.into_iter().collect::<Option<Vec<f64>>>() else {
            continue;
        };
        if heights.iter().any(|h| (h - heights[1]).abs() > TOL) {
            ctx.errors.push(error(
                front.path(),
                format!(
                    "The bay walls {names} have different heights. Give the bay walls one height."
                ),
            ));
            continue;
        }
        // Derived from the model, as for storey walls: the drawn wall runs from floor to the
        // floor or roof above, and the ceiling is the storey gap below that.
        bay_value.insert("bay_height".into(), json!(heights[1] - STOREY_GAP));
        // DESNZ-defined: with no construction of their own, the bay walls take the parent
        // wall's.
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
        // storey above covers it. Its type follows the drawn planes; HEMIE
        // simplifies a pitched bay roof to one 35° slope facing the wall (DESNZ-defined).
        let top = bays
            .iter()
            .filter(|o| o.poly == bay.poly || inside(centroid(&bay.poly), &o.poly))
            .map(|o| o.level)
            .max();
        if top != Some(bay.level) {
            // A roof drawn over a lower bay of a stack, outside the top bay, is not entered.
            let higher: Vec<&Bay> = bays.iter().filter(|o| o.level > bay.level).collect();
            if let Some(p) = planes.iter().find(|p| {
                let c = centroid(&p.pts);
                inside(c, &bay.poly) && !higher.iter().any(|o| inside(c, &o.poly))
            }) {
                ctx.errors.push(error(p.path(), format!("Roof '{}' is over the bay {names}, which has a bay above it. Only the top bay of a stack has a roof: delete this roof or draw it over the top bay.", p.name)));
            }
        } else {
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
                    ctx.errors.push(error(over[0].path(), format!("The bay roof {} is part flat and part pitched. Draw the bay roof all flat or all pitched.", quoted(&over.iter().map(|p| p.name).collect::<Vec<_>>()))));
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
// Conservatories

/// Which building parts are conservatories: their ground floor is a conservatory bundle's.
/// Separated and unheated ones are already left out (`left_out`).
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
            let Some(g) = els.iter().find(|e| {
                e.ty == "BuildingElementGround"
                    && e.pts.len() >= 3
                    && inside(interior, &e.pts)
                    && tag(e).is_some_and(|t| t.kind == "conservatory")
            }) else {
                return false;
            };
            // DESNZ-defined: a conservatory is one storey on a slab or suspended floor.
            if part.top > 0 {
                ctx.errors.push(error(g.path(), format!("Conservatory '{name}' has {} storeys. A conservatory is a single storey: draw nothing over it.", part.top + 1)));
            }
            if !matches!(g.text("floor_type"), Some("Slab_no_edge_insulation" | "Slab_edge_insulation" | "Suspended_floor")) {
                ctx.errors.push(error(g.path(), format!("Conservatory floor '{}' is not a slab or suspended floor. Give it one of those floor types.", g.name)));
            }
            true
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
            ctx.errors.push(error(owner.path(), format!("The glazing {names} of conservatory element '{}' opens as {}. A conservatory wall or roof takes one opening type{}: give all its glazing the same one.", owner.name, quoted(&types.into_iter().collect::<Vec<_>>()), allowed.map(|a| format!(": {}", quoted(a))).unwrap_or_default())));
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
    let area = glazed_area(ctx, glazing)?;
    Some((window_type, risks.into_iter().next(), area))
}

/// The summed width × height of the glazing; a missing measurement is an error.
fn glazed_area(ctx: &mut Ctx, glazing: &[&El]) -> Option<f64> {
    let areas: Option<Vec<f64>> = glazing
        .iter()
        .map(|w| Some(ctx.need(w, "width")? * ctx.need(w, "height")?))
        .collect();
    Some(areas?.iter().sum())
}

fn defaulted_notice(ctx: &mut Ctx, part: &str, defaulted: Vec<String>) {
    if !defaulted.is_empty() {
        ctx.notices.push(notice("/Zone", format!("{part}: the glazing of {} states no opening type, so it opens as closed, the default.", quoted(&defaulted.iter().map(String::as_str).collect::<Vec<_>>()))));
    }
}

/// The walls of each conservatory part as HEMIE conservatory walls.
pub(super) fn conservatory_walls(
    ctx: &mut Ctx,
    conservatory: &[bool],
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
        let kind = wall_kind(source).expect("wall");
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
        // DESNZ-defined: solid doors are not entered in a conservatory wall. A Vulcan door
        // row carries no glazing; a glazed door is drawn as a window and counts as glazing.
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
        let Some((window_type, risk, _)) = glazing(
            ctx,
            &glazed,
            Some(&CONSERVATORY_WALL_WINDOW_TYPES),
            &mut defaulted,
            source,
        ) else {
            continue;
        };
        let Some(height) = ctx.eaves(source) else {
            continue;
        };
        let bases: Option<Vec<f64>> = std::iter::once(source)
            .chain(glazed.iter().copied())
            .map(|e| ctx.need(e, "base_height"))
            .collect();
        let Some(bases) = bases else { continue };
        // DESNZ-defined: the glazed share of the wall's height to its eaves; the opaque part is
        // the dwarf wall below the glazing, so the glazing runs from its lowest sill to the eaves
        // across the whole wall. HEMIE builds any gable above the eaves separately.
        let dwarf = bases[1..].iter().copied().fold(f64::INFINITY, f64::min) - bases[0];
        let fraction = ((height - dwarf) / height).max(0.0);
        if fraction <= 0.0 || fraction > 1.0 + 1e-9 {
            ctx.errors.push(error(source.path(), format!("Conservatory wall '{}' is {:.0}% glazed. A conservatory wall must be glazed, above 0% and up to 100%: add or resize its windows.", source.name, fraction * 100.0)));
            continue;
        }
        let fraction = fraction.min(1.0);
        // HEMIE takes the close shading of a conservatory wall's glazing on the wall, as one
        // glazed element: its windows take the same.
        let shades: Vec<Value> = glazed
            .iter()
            .map(|w| {
                let mut v = json!({});
                shading::close(ctx, w, &mut v);
                v
            })
            .collect();
        if shades.iter().any(|v| *v != shades[0]) {
            ctx.errors.push(error(source.path(), format!("The glazing {} of conservatory wall '{}' differs in close shading (overhang, side fins, obstacle). HEMIE glazes a conservatory wall as one element: give its glazing the same close shading.", quoted(&glazed.iter().map(|w| w.name).collect::<Vec<_>>()), source.name)));
            continue;
        }
        let value = &mut walls[wi].value;
        if let Some(Value::Object(shade)) = shades.into_iter().next() {
            value.extend(shade);
        }
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
        ctx.notices.push(notice("/Zone", format!("The doors {} are in conservatory walls and carry no glazing, so they are not entered. Draw a glazed door as a window.", quoted(&solid_doors.iter().map(String::as_str).collect::<Vec<_>>()))));
    }
}

/// A conservatory's roof. Derived from the model: type, slopes and
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
        ctx.errors.push(error(first.path(), format!("Conservatory '{part}' has flat and pitched roof planes. Draw its roof all flat or all pitched.")));
        return None;
    }
    let lights: Vec<&El> = windows
        .iter()
        .copied()
        .filter(|w| planes.iter().any(|p| w.host() == Some(p.name)))
        .collect();
    for w in &lights {
        placed.insert(w.name.to_string());
        let mut shade = json!({});
        shading::close(ctx, w, &mut shade);
        if shade.as_object().is_some_and(|o| !o.is_empty()) {
            ctx.errors.push(error(w.path(), format!("Rooflight '{}' of conservatory '{part}' states close shading. HEMIE's conservatory roof takes none: remove it.", w.name)));
        }
    }
    let mut defaulted = Vec::new();
    let (window_type, _, glazed) = glazing(ctx, &lights, None, &mut defaulted, first)?;
    defaulted_notice(ctx, part, defaulted);
    let mut measured = sloped_measurements(ctx, planes)?;
    // Derived from the model: a plane's area is exported net of its rooflights, so the drawn
    // plane is that area plus theirs.
    for (m, plane) in measured.iter_mut().zip(planes) {
        let hosted: Vec<&El> = lights
            .iter()
            .copied()
            .filter(|w| w.host() == Some(plane.name))
            .collect();
        m.area += glazed_area(ctx, &hosted)?;
    }
    let area: f64 = measured.iter().map(|m| m.area).sum();
    // Derived from the model: the glazed share of the drawn roof.
    let fraction = glazed / area;
    if fraction <= 0.0 || fraction > 1.0 + 1e-9 {
        ctx.errors.push(error(first.path(), format!("The roof of conservatory '{part}' is {:.0}% glazed. A conservatory roof must be glazed, above 0% and up to 100%: add or resize its rooflights.", fraction * 100.0)));
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
            // DESNZ-defined: one, or two opposite, slopes.
            ctx.errors.push(error(first.path(), format!("The roof of conservatory '{part}' has {} slopes. Draw it flat, as one slope, or as two opposite slopes.", sides.len())));
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
    let (left, right) = (gable_at(left), gable_at(scale(left, -1.0)));
    roof["is_external_left_gable_wall"] = json!(left);
    roof["is_external_right_gable_wall"] = json!(right);
    // HEMIE builds an exposed gable of a conservatory roof as wholly glazed, with no input for
    // its glazing; the drawing's gable glazing does not reach it.
    if left || right {
        ctx.notices.push(notice("/Zone", format!("Conservatory '{part}': HEMIE treats the triangle of each exposed gable above the eaves as fully glazed, whatever is drawn there.")));
    }
    Some(roof)
}

// ---------------------------------------------------------------------------------------------
// Box in the roof

/// DESNZ-defined: a box-shaped room set within a pitched roof is not covered. Ours (E29): how
/// a box room is recognised, a top floor standing clear of the outline below under an unheated
/// pitched roof.
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
        ctx.errors.push(error(top_walls[0].path(), format!("The top floor ({}) is a room set inside a pitched roof, clear of the walls below: a box in the roof, which cannot be entered. Draw it as a room in the roof with its slopes, gables and knee walls, or as a storey.", quoted(&top_walls.iter().map(|w| w.name).collect::<Vec<_>>()))));
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

    /// A member of an editor bundle: its `hemie_bundle` tag, CSV-escaped extra_json.
    fn member(kind: &str, role: &str, host: &str, extra: &str) -> String {
        format!(
            r#"{{""hemie_bundle"":{{""kind"":""{kind}"",""bundle_id"":""{kind}-1"",""role"":""{role}"",""host_wall"":""{host}""{extra}}}}}"#
        )
    }

    fn cell(extra: String) -> String {
        format!("\"{extra}\"")
    }

    fn bay(role: &str) -> String {
        cell(member("bay", role, "W00", ""))
    }

    /// A two-storey box with a ground-floor bay bundle on its south wall, W00.
    fn bay_house(side_windows: &[String]) -> String {
        let mut exposed: Vec<String> = box_walls(&BOX, &[0, 1]);
        exposed.push(wall("Bay W", 0, [5.0, 0.0], [5.3, -0.6], 2.8) + bay("left-wall").as_str());
        // The front wall is the bundle's anchor, a child of the host wall.
        exposed.push(
            wall("Bay S", 0, [5.3, -0.6], [6.7, -0.6], 2.8).replace(",,\"", ",W00,\"")
                + bay("front-wall").as_str(),
        );
        exposed.push(wall("Bay E", 0, [6.7, -0.6], [7.0, 0.0], 2.8) + bay("right-wall").as_str());
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
        exposed.push(
            plane(
                "Bay roof",
                1,
                &[[5.0, 0.0], [5.3, -0.6], [6.7, -0.6], [7.0, 0.0]],
                0.0,
                0.0,
                false,
            ) + bay("roof").as_str(),
        );
        exposed.extend(gable_roof());
        let ground = format!(
            "{}\nBay floor,Z,BuildingElementGround,1.02,Slab_no_edge_insulation,\"5,0,0|5.3,-0.6,0|6.7,-0.6,0|7,0,0\",{}",
            ground(&BOX).replace("floor_type,coords", "floor_type,coords,extra_json"),
            bay("floor")
        );
        csv(&settings(), &exposed, &ground)
    }

    #[test]
    fn a_bay_bundle_is_a_bay_window_on_its_host_wall_with_a_flat_bay_roof() {
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
        // The host wall spans the opening; the storey outline has no bay in it.
        let ring = main["storeys"][0]["floorplan"].as_str().unwrap();
        assert!(!ring.contains("-0.6"), "{ring}");
        // The bay roof is the bay's, so the main roof stays one pitched roof.
        assert_eq!(main["roof"]["roof_type"], "Unknown Pitched (Unheated)");
        // HEMIE adds the bay's footprint itself: the main floor stays the drawn outline, and the
        // dwelling's ground floor total includes the bay floor.
        assert_eq!(main["floor"]["total_area"], 49.02, "{}", main["floor"]);
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
    fn a_window_in_the_wall_a_bay_covers_stops_and_is_named() {
        let covered = [opening(
            "Hidden",
            "W00",
            0,
            [5.5, 0.0],
            [6.5, 0.0],
            1.0,
            1.2,
            SECTIONS,
        )];
        let (_, errors, _) = run(&bay_house(&covered));
        // The bay is not entered, so its roof is then a second roof of the part.
        assert!(
            errors.iter().any(|e| e.path.ends_with("/Hidden")
                && e.message.contains("'Hidden'")
                && e.message.contains("covers")),
            "{errors:#?}"
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

    fn conservatory(role: &str, status: &str) -> String {
        member(
            "conservatory",
            role,
            "W02",
            &format!(r##",""conservatory_type"":""{status}"""##),
        )
    }

    /// A box with a lean-to conservatory bundle on its north wall, W02, which stays one wall.
    /// `levels` are the box's storeys; its loft roof sits on the top one.
    fn conservatory_house(status: &str, levels: &[i64]) -> String {
        let c = |role: &str| cell(conservatory(role, status));
        let glazing = |role: &str| conservatory(role, status);
        let mut exposed: Vec<String> = box_walls(&BOX, levels);
        exposed.push(wall("C E", 0, [6.0, 6.0], [6.0, 9.0], 2.4) + c("right-wall").as_str());
        exposed.push(
            wall("C N", 0, [6.0, 9.0], [2.0, 9.0], 2.4).replace(",,\"", ",W02,\"")
                + c("front-wall").as_str(),
        );
        exposed.push(
            wall("C W", 0, [2.0, 9.0], [2.0, 6.0], 2.4)
                + c("left-wall").as_str().replace(
                    r#"{""hemie_bundle"""#,
                    r#"{""geometry_face"":{""top_profile"":[{""h"":2.4},{""h"":3.2}]},""hemie_bundle"""#,
                ).as_str(),
        );
        exposed.push(sill(
            0.6,
            opening(
                "CW E",
                "C E",
                0,
                [6.0, 7.0],
                [6.0, 8.0],
                2.0,
                1.2,
                &glazing("right-glazing"),
            ),
        ));
        exposed.push(sill(
            0.6,
            opening(
                "CW N",
                "C N",
                0,
                [5.0, 9.0],
                [3.0, 9.0],
                3.0,
                1.6,
                &glazing("front-glazing"),
            ),
        ));
        exposed.push(sill(
            1.2,
            opening(
                "CW W",
                "C W",
                0,
                [2.0, 8.0],
                [2.0, 7.0],
                2.4,
                1.8,
                &glazing("left-glazing"),
            ),
        ));
        // Its area is net of the 3 m² rooflight, as the editor exports it.
        exposed.push(
            plane(
                "C roof",
                1,
                &[[2.0, 6.0], [6.0, 6.0], [6.0, 9.0], [2.0, 9.0]],
                15.0,
                0.0,
                false,
            )
            .replacen(",10,", ",7,", 1)
                + c("roof").as_str(),
        );
        exposed.push(opening(
            "Rooflight",
            "C roof",
            1,
            [3.0, 7.0],
            [5.0, 7.0],
            2.0,
            1.5,
            &glazing("roof-glazing"),
        ));
        let top = *levels.last().unwrap() + 1;
        exposed.extend(gable_roof().into_iter().map(|r| {
            r.replace(",2|", &format!(",{top}|"))
                .replace(",2\",", &format!(",{top}\","))
        }));
        let ground = format!(
            "{}\nC floor,Z,BuildingElementGround,12,Slab_no_edge_insulation,\"2,6,0|6,6,0|6,9,0|2,9,0\",{}",
            ground(&BOX).replace("floor_type,coords", "floor_type,coords,extra_json"),
            c("floor")
        );
        csv(&settings(), &exposed, &ground)
    }

    /// An opening row with its base `height` above the floor in place of 1 m.
    fn sill(height: f64, row: String) -> String {
        row.replacen(",0,1,FALSE,", &format!(",0,{height},FALSE,"), 1)
    }

    fn conservatory_part(model: &Value) -> &Value {
        &model["Zone"]["building_parts"]["Extension 1"]
    }

    #[test]
    fn a_non_separated_conservatory_is_a_conservatory_building_part() {
        let (model, errors, notices) = run(&conservatory_house("non-separated", &[0, 1]));
        assert!(errors.is_empty(), "{errors:#?}");
        let parts = &model["Zone"]["building_parts"];
        let c = conservatory_part(&model);
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
        // DESNZ: the glazed share of the wall height, glazing from its sill to the eaves: a
        // 0.6 m dwarf wall in a 2.4 m wall is 0.75, whatever the glazing's width.
        for (got, want) in sorted.iter().zip([0.5, 0.75, 0.75]) {
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
        assert!(notices.iter().any(|n| n.message.contains("fully glazed")));
        assert!(notices
            .iter()
            .any(|n| n.message.contains("opens as closed, the default")));
        let main = &parts["Main"];
        assert!(main.get("is_non_separated_conservatory").is_none());
        // The host wall is internal where the conservatory adjoins it: the main part's ground
        // outline keeps W02 on either side only.
        let ground_walls = main["walls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|w| w["storey_index"] == 0)
            .count();
        assert_eq!(ground_walls, 5, "{main}");
    }

    #[test]
    fn a_fully_glazed_conservatory_roof_has_a_glazing_fraction_of_one() {
        // The rooflight is the whole plane, so the plane's exported net area is 0.
        let csv: String = conservatory_house("non-separated", &[0, 1])
            .lines()
            .map(|l| {
                if l.starts_with("C roof,") {
                    l.replacen(",7,", ",0,", 1)
                } else {
                    l.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let (model, errors, _) = run(&csv);
        assert!(errors.is_empty(), "{errors:#?}");
        let roof = &conservatory_part(&model)["roof"];
        assert_eq!(roof["glazing_fraction"], 1.0);
        assert!(roof.get("opaque_construction").is_none());
    }

    #[test]
    fn conservatory_glazing_close_shading_is_on_its_wall() {
        let with_overhang = |l: &str| {
            l.replacen(
                r#"{""hemie_bundle"""#,
                r#"{""overhang"":""roof eaves overhang"",""hemie_bundle"""#,
                1,
            )
        };
        let csv: String = conservatory_house("non-separated", &[0, 1])
            .lines()
            .map(|l| {
                if l.starts_with("CW N,") {
                    with_overhang(l)
                } else {
                    l.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let (model, errors, _) = run(&csv);
        assert!(errors.is_empty(), "{errors:#?}");
        let shaded: Vec<&Value> = conservatory_part(&model)["walls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|w| w.get("overhang").is_some())
            .collect();
        assert_eq!(shaded.len(), 1);
        assert_eq!(shaded[0]["overhang"], "roof eaves overhang");
    }

    #[test]
    fn a_dual_pitch_conservatory_roof_has_its_front_gable() {
        let roof_cell = cell(conservatory("roof", "non-separated"));
        let lean_to = plane(
            "C roof",
            1,
            &[[2.0, 6.0], [6.0, 6.0], [6.0, 9.0], [2.0, 9.0]],
            15.0,
            0.0,
            false,
        )
        .replacen(",10,", ",7,", 1)
            + roof_cell.as_str();
        let dual = [
            plane(
                "C roof W",
                1,
                &[[2.0, 9.0], [2.0, 6.0], [4.0, 6.0], [4.0, 9.0]],
                20.0,
                270.0,
                false,
            ),
            plane(
                "C roof E",
                1,
                &[[6.0, 6.0], [6.0, 9.0], [4.0, 9.0], [4.0, 6.0]],
                20.0,
                90.0,
                false,
            ),
        ]
        .map(|p| p.replacen(",10,", ",7,", 1) + roof_cell.as_str())
        .join("\n");
        let glazing = conservatory("roof-glazing", "non-separated");
        let house = conservatory_house("non-separated", &[0, 1])
            .replace(&lean_to, &dual)
            .replace(
                &opening("Rooflight", "C roof", 1, [3.0, 7.0], [5.0, 7.0], 2.0, 1.5, &glazing),
                &[
                    opening("RL W", "C roof W", 1, [2.5, 7.0], [3.5, 7.0], 2.0, 1.5, &glazing),
                    opening("RL E", "C roof E", 1, [4.5, 7.0], [5.5, 7.0], 2.0, 1.5, &glazing),
                ]
                .join("\n"),
            )
            .replace(r#"{""geometry_face"":{""top_profile"":[{""h"":2.4},{""h"":3.2}]},"#, "{")
            .replace(
                r#"{""hemie_bundle"":{""kind"":""conservatory"",""bundle_id"":""conservatory-1"",""role"":""front-wall"""#,
                r#"{""geometry_face"":{""top_profile"":[{""h"":2.4},{""h"":3.1},{""h"":2.4}]},""hemie_bundle"":{""kind"":""conservatory"",""bundle_id"":""conservatory-1"",""role"":""front-wall"""#,
            );
        let (model, errors, notices) = run(&house);
        assert!(errors.is_empty(), "{errors:#?}");
        let roof = &conservatory_part(&model)["roof"];
        assert_eq!(roof["pitch_type"], "dual", "{roof}");
        assert!((roof["glazing_fraction"].as_f64().unwrap() - 0.3).abs() < 1e-9);
        // The front (north) wall is the one exposed gable, on one side of the slope it faces.
        assert_ne!(
            roof["is_external_left_gable_wall"], roof["is_external_right_gable_wall"],
            "{roof}"
        );
        assert!(notices.iter().any(|n| n.message.contains("fully glazed")));
    }

    #[test]
    fn a_conservatory_on_a_bungalow_is_its_own_building_part() {
        let (model, errors, _) = run(&conservatory_house("non-separated", &[0]));
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(
            conservatory_part(&model)["is_non_separated_conservatory"],
            true
        );
        assert_eq!(
            model["Zone"]["building_parts"].as_object().unwrap().len(),
            2
        );
    }

    #[test]
    fn separated_and_unheated_conservatories_are_left_out_with_a_notice() {
        let sheltered =
            r#"HEMIE_construction_sheltered_wall,"{""wall_construction_type"":""cavity""}""#;
        for status in ["separated", "unheated"] {
            let house = conservatory_house(status, &[0, 1])
                .replace(
                    r#""conservatory_type"":""unheated"""#,
                    r#""conservatory_type"":""unheated"",""adjacent_space_type"":""garage"""#,
                )
                .replacen("Postcode,", &format!("{sheltered}\nPostcode,"), 1);
            let (model, errors, notices) = run(&house);
            assert!(errors.is_empty(), "{status}: {errors:#?}");
            let parts = model["Zone"]["building_parts"].as_object().unwrap();
            assert_eq!(parts.len(), 1, "{status}");
            let ground: Vec<&Value> = parts["Main"]["walls"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|w| w["storey_index"] == 0)
                .collect();
            if status == "separated" {
                // The host wall stays one external wall.
                assert_eq!(ground.len(), 4, "{ground:#?}");
            } else {
                // DESNZ-defined: the host wall is sheltered where the unheated
                // conservatory adjoins it, with the space type the bundle states.
                assert_eq!(ground.len(), 6, "{ground:#?}");
                let shelt: Vec<&&Value> = ground
                    .iter()
                    .filter(|w| w["wall_type"] == "sheltered")
                    .collect();
                assert_eq!(shelt.len(), 1, "{ground:#?}");
                assert_eq!(shelt[0]["adjacent_space_type"], "garage");
                assert_eq!(shelt[0]["construction"], "sheltered_wall");
            }
            assert!(
                notices
                    .iter()
                    .any(|n| n.message.contains(&format!("{status} conservatory"))
                        && n.message.contains("left out")),
                "{status}: {notices:#?}"
            );
        }
        // No space type: the converter cannot choose one.
        let (_, errors, _) = run(&conservatory_house("unheated", &[0, 1]));
        assert!(
            errors
                .iter()
                .any(|e| e.message.contains("does not state what unheated space")),
            "{errors:#?}"
        );
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

    /// A roof room with heated slopes south and north (y extents) and a flat plane, drawn with
    /// truncated gables on a floor at 5.6 m, under a flat plane at 7.9 m.
    fn flat_roof_room(slope_s: f64, flat: (f64, f64), slope_n: (f64, f64)) -> String {
        let truncated = |name: &str, x: f64| {
            format!(
                "{name},Z,BuildingElementOpaque,1,90,1,0,0,5.6,FALSE,FALSE,,\"{x},0,2|{x},6,2\",\"{{\"\"geometry_face\"\":{{\"\"top_profile\"\":[{{\"\"h\"\":0}},{{\"\"h\"\":2.3}},{{\"\"h\"\":2.3}},{{\"\"h\"\":0}}]}}}}\""
            )
        };
        let mut all = box_walls(&BOX, &[0, 1]);
        all.extend([
            truncated("G W", 0.0),
            truncated("G E", 8.0),
            plane(
                "Slope S",
                2,
                &[[0.0, 0.0], [8.0, 0.0], [8.0, slope_s], [0.0, slope_s]],
                40.0,
                180.0,
                false,
            ),
            plane(
                "Slope N",
                2,
                &[
                    [0.0, slope_n.0],
                    [8.0, slope_n.0],
                    [8.0, slope_n.1],
                    [0.0, slope_n.1],
                ],
                40.0,
                0.0,
                false,
            ),
            plane(
                "Ceiling",
                2,
                &[[0.0, flat.0], [8.0, flat.0], [8.0, flat.1], [0.0, flat.1]],
                0.0,
                0.0,
                false,
            )
            .replace(",5.6,FALSE,", ",7.9,FALSE,"),
        ]);
        csv(&settings(), &all, &ground(&BOX))
    }

    #[test]
    fn a_flat_ceiling_in_a_roof_room_is_its_ceiling_width_and_height() {
        let (model, errors, _) = run(&flat_roof_room(2.5, (2.5, 3.5), (3.5, 6.0)));
        assert!(errors.is_empty(), "{errors:#?}");
        let room = &model["Zone"]["building_parts"]["Main"]["roof"];
        assert_eq!(room["roof_type"], "Room In Roof");
        assert!(
            (room["ceiling_width"].as_f64().unwrap() - 1.0).abs() < 1e-9,
            "{room:#}"
        );
        // The highest point is the flat ceiling: 7.9 m over a floor at 5.6 m.
        assert!(
            (room["maximum_ceiling_height"].as_f64().unwrap() - 2.3).abs() < 1e-9,
            "{room:#}"
        );
        // The surfaces above a flat ceiling take the unheated pitched roof construction.
        assert_eq!(
            room["unheated_pitched_roof_construction"],
            "unheated_pitched_roof"
        );
    }

    #[test]
    fn a_mono_roof_room_takes_a_flat_ceiling_between_its_slope_and_high_wall() {
        // One slope from the south knee wall up to y 4, then a flat ceiling to the north wall.
        let csv = flat_roof_room(4.0, (4.0, 6.0), (6.0, 6.0))
            .lines()
            .filter(|l| !l.starts_with("Slope N,"))
            .collect::<Vec<_>>()
            .join("\n")
            .replace(
                "\nCeiling,",
                &format!(
                    "\n{}\n{}\nCeiling,",
                    wall("Knee S", 2, [0.0, 0.0], [8.0, 0.0], 1.0),
                    wall("High N", 2, [8.0, 6.0], [0.0, 6.0], 2.3)
                ),
            );
        let (model, errors, _) = run(&csv);
        assert!(errors.is_empty(), "{errors:#?}");
        let room = &model["Zone"]["building_parts"]["Main"]["roof"];
        assert_eq!(room["pitch_type"], "mono");
        assert!(
            (room["ceiling_width"].as_f64().unwrap() - 2.0).abs() < 1e-9,
            "{room:#}"
        );
        // The high north wall is the back wall, not a knee wall: only the south knee counts.
        assert_eq!(room["average_knee_wall_height"], 1.0);
        assert!(room.get("back_wall").is_some() && room.get("front_knee_wall").is_some());
    }

    #[test]
    fn a_flat_section_beside_the_slopes_stops_and_is_named() {
        // Slopes meet at y 3 to 5; the flat plane is beyond the north slope, not under the ridge.
        let (_, errors, _) = run(&flat_roof_room(3.0, (5.0, 6.0), (3.0, 5.0)));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0].message.contains("Flat roof 'Ceiling'"),
            "{}",
            errors[0].message
        );
    }
}
