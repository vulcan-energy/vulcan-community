// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEM:EPC existing-building input. When the model states `IsExistingBuilding`, its zone becomes
//! a HEMIE Geometry input and `InfiltrationVentilation` the HEMIE input that Geometry needs, both
//! derived from the drawn model. Each interpretation rule states its source in one comment:
//! "DESNZ-defined" (the HEM:EPC method), "derived from the model" (measured from the drawing or
//! read from the element), or "ours" (a Vulcan choice awaiting confirmation). A shape or value
//! the converter cannot express fails and names the element; nothing is approximated silently.
//!
//! EPC model settings are Metadata rows: `HEMIE_age_band`, `HEMIE_region`, and per HEMIE
//! construction type `HEMIE_construction_<construction_type>`, a JSON object of that
//! construction's fields (for example `{"wall_construction_type":"cavity"}`). A value on the
//! element wins over the setting.

use crate::finalization::SchemaOmission;
use crate::target_mappings::TARGET_INPUT_WARNING;
use crate::{json_pointer, ValidationError};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

type Row = BTreeMap<String, Value>;
type Rows = BTreeMap<String, Vec<Row>>;
type P = [f64; 2];

/// ours: plan tolerance (m) for joining wall ends, matching walls to outline edges and stacking
/// one floor's outline on the floor below.
const TOL: f64 = 0.1;
/// DESNZ-defined: the height between storeys, and between a storey and a roof room, that is in
/// no storey's ceiling height (m).
const STOREY_GAP: f64 = 0.25;
/// ours: how far a roof plane may overhang the building part it covers (m).
const EAVES: f64 = 0.6;
/// DESNZ-defined: heated pitched roof areal heat capacity when the element states none (J/m².K).
const HEATED_PITCHED_ROOF_HEAT_CAPACITY: f64 = 50_000.0;
/// ours: HEMIE reads a window's areal heat capacity only for windows in party or sheltered
/// walls; a window elsewhere carries this placeholder unless the glazing setting states one.
const UNUSED_WINDOW_HEAT_CAPACITY: f64 = 0.0;
const SETTING: &str = "HEMIE_";

fn error(path: String, message: String) -> ValidationError {
    ValidationError {
        code: "E_EPC_HEMIE".into(),
        path,
        message,
        schema_path: None,
        keyword: None,
    }
}

fn notice(path: &str, message: String) -> SchemaOmission {
    SchemaOmission {
        code: TARGET_INPUT_WARNING.into(),
        path: path.into(),
        message,
    }
}

// ---------------------------------------------------------------------------------------------
// Plan geometry. Coordinates are metres in the drawing's plan; +y is north.

fn sub(a: P, b: P) -> P {
    [a[0] - b[0], a[1] - b[1]]
}
fn add(a: P, b: P) -> P {
    [a[0] + b[0], a[1] + b[1]]
}
fn scale(a: P, k: f64) -> P {
    [a[0] * k, a[1] * k]
}
fn dot(a: P, b: P) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn cross(a: P, b: P) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn norm(a: P) -> f64 {
    a[0].hypot(a[1])
}
fn unit(a: P) -> P {
    scale(a, 1.0 / norm(a))
}
fn dist(a: P, b: P) -> f64 {
    norm(sub(a, b))
}
fn mid(a: P, b: P) -> P {
    scale(add(a, b), 0.5)
}
fn project(p: P, a: P, b: P) -> P {
    let d = sub(b, a);
    let t = (dot(sub(p, a), d) / dot(d, d)).clamp(0.0, 1.0);
    add(a, scale(d, t))
}
fn seg_dist(p: P, a: P, b: P) -> f64 {
    dist(p, project(p, a, b))
}
fn edges(ring: &[P]) -> impl Iterator<Item = (P, P)> + '_ {
    (0..ring.len()).map(move |i| (ring[i], ring[(i + 1) % ring.len()]))
}
fn signed_area(ring: &[P]) -> f64 {
    edges(ring).map(|(a, b)| cross(a, b)).sum::<f64>() / 2.0
}
fn inside(p: P, ring: &[P]) -> bool {
    let mut odd = false;
    for (a, b) in edges(ring) {
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0])
        {
            odd = !odd;
        }
    }
    odd
}
fn boundary_dist(p: P, ring: &[P]) -> f64 {
    edges(ring)
        .map(|(a, b)| seg_dist(p, a, b))
        .fold(f64::INFINITY, f64::min)
}
fn inside_or_on(p: P, ring: &[P]) -> bool {
    inside(p, ring) || boundary_dist(p, ring) <= TOL
}
fn centroid(points: &[P]) -> P {
    scale(
        points.iter().fold([0.0, 0.0], |c, p| add(c, *p)),
        1.0 / points.len() as f64,
    )
}
/// A point just inside a counter-clockwise ring, left of its first long-enough edge.
fn interior_point(ring: &[P]) -> P {
    edges(ring)
        .filter(|(a, b)| dist(*a, *b) > 1e-3)
        .map(|(a, b)| {
            let d = unit(sub(b, a));
            add(mid(a, b), scale([-d[1], d[0]], 1e-3))
        })
        .find(|p| inside(*p, ring))
        .unwrap_or_else(|| centroid(ring))
}
/// Outward compass bearing of edge a→b of a counter-clockwise ring, in the drawing's frame.
fn outward_bearing(a: P, b: P) -> f64 {
    let d = sub(b, a);
    d[1].atan2(-d[0]).to_degrees().rem_euclid(360.0)
}
fn bearing_gap(a: f64, b: f64) -> f64 {
    ((a - b + 180.0).rem_euclid(360.0) - 180.0).abs()
}
/// HEMIE's edge orientation: the reference orientation turned by the angle from the reference
/// edge to this edge (DESNZ-defined, so orientations agree with HEMIE to rounding).
fn edge_orientation(reference_orientation: f64, reference_edge: P, edge: P) -> f64 {
    let angle = cross(reference_edge, edge)
        .atan2(dot(reference_edge, edge))
        .to_degrees();
    (reference_orientation - angle).rem_euclid(360.0)
}

fn convex_hull(points: &[P]) -> Vec<P> {
    let mut pts = points.to_vec();
    pts.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    pts.dedup();
    if pts.len() < 3 {
        return pts;
    }
    let mut hull: Vec<P> = Vec::new();
    for pass in [false, true] {
        let start = hull.len();
        let iter: Box<dyn Iterator<Item = &P>> = if pass {
            Box::new(pts.iter().rev())
        } else {
            Box::new(pts.iter())
        };
        for &p in iter {
            while hull.len() >= start + 2
                && cross(
                    sub(hull[hull.len() - 1], hull[hull.len() - 2]),
                    sub(p, hull[hull.len() - 1]),
                ) <= 0.0
            {
                hull.pop();
            }
            hull.push(p);
        }
        hull.pop();
    }
    hull
}

/// Minimum-area rectangle around a ring, counter-clockwise. HEMIE sizes and orients pitched
/// roofs from this rectangle of the top storey (DESNZ-defined).
fn min_rectangle(ring: &[P]) -> [P; 4] {
    let hull = convex_hull(ring);
    let mut best: Option<(f64, [P; 4])> = None;
    for (a, b) in edges(&hull) {
        if dist(a, b) < 1e-9 {
            continue;
        }
        let u = unit(sub(b, a));
        let v = [-u[1], u[0]];
        let (mut u0, mut u1, mut v0, mut v1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in &hull {
            let (pu, pv) = (dot(*p, u), dot(*p, v));
            (u0, u1, v0, v1) = (u0.min(pu), u1.max(pu), v0.min(pv), v1.max(pv));
        }
        let area = (u1 - u0) * (v1 - v0);
        if best
            .as_ref()
            .is_none_or(|(best_area, _)| area < *best_area - 1e-9)
        {
            let at = |s: f64, t: f64| add(scale(u, s), scale(v, t));
            best = Some((area, [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]));
        }
    }
    best.map(|(_, rect)| rect).unwrap_or([ring[0]; 4])
}

fn node_at(nodes: &mut Vec<P>, p: P, tol: f64) -> usize {
    match nodes.iter().position(|n| dist(*n, p) <= tol) {
        Some(i) => i,
        None => {
            nodes.push(p);
            nodes.len() - 1
        }
    }
}

/// One closed, counter-clockwise outline from a floor's wall lines (derived from the model). Each
/// wall stays one edge, so an edge never spans two constructions.
fn ring_of_walls(walls: &[&El]) -> Result<Vec<P>, String> {
    let mut nodes = Vec::new();
    let mut links = Vec::new();
    for wall in walls {
        let (a, b) = (
            node_at(&mut nodes, wall.pts[0], TOL),
            node_at(&mut nodes, wall.pts[1], TOL),
        );
        if a == b {
            return Err(format!(
                "'{}' is shorter than the {TOL} m drawing tolerance.",
                wall.name
            ));
        }
        links.push((a, b));
    }
    let degree = |n: usize| links.iter().filter(|(a, b)| *a == n || *b == n).count();
    let open: Vec<&str> = walls
        .iter()
        .zip(&links)
        .filter(|(_, (a, b))| degree(*a) != 2 || degree(*b) != 2)
        .map(|(wall, _)| wall.name)
        .collect();
    if !open.is_empty() {
        return Err(format!(
            "The walls {} do not join end to end into one closed outline. Join the wall ends so each corner has exactly two walls.",
            quoted(&open)
        ));
    }
    let mut order = vec![links[0].0];
    let (mut previous, mut at) = (0, links[0].1);
    while at != links[0].0 {
        order.push(at);
        let next = (0..links.len())
            .find(|&i| i != previous && (links[i].0 == at || links[i].1 == at))
            .expect("degree two");
        at = if links[next].0 == at {
            links[next].1
        } else {
            links[next].0
        };
        previous = next;
    }
    if order.len() != links.len() {
        return Err(format!(
            "The walls form more than one closed outline ({} of {} walls in the first). Each storey must be one outline.",
            order.len(),
            links.len()
        ));
    }
    let mut ring: Vec<P> = order.into_iter().map(|i| nodes[i]).collect();
    if signed_area(&ring) < 0.0 {
        ring.reverse();
    }
    Ok(ring)
}

/// The bounded faces of the plan arrangement of several outlines, each counter-clockwise.
fn faces(rings: &[Vec<P>]) -> Result<Vec<Vec<P>>, String> {
    const EPS: f64 = 1e-6;
    let mut nodes = Vec::new();
    for p in rings.iter().flatten() {
        node_at(&mut nodes, *p, EPS);
    }
    let mut links = BTreeSet::new();
    for ring in rings {
        for (a, b) in edges(ring) {
            let mut on: Vec<usize> = (0..nodes.len())
                .filter(|&k| seg_dist(nodes[k], a, b) < EPS)
                .collect();
            on.sort_by(|&i, &j| {
                dot(sub(nodes[i], a), sub(b, a)).total_cmp(&dot(sub(nodes[j], a), sub(b, a)))
            });
            for pair in on.windows(2) {
                if pair[0] != pair[1] {
                    links.insert((pair[0].min(pair[1]), pair[0].max(pair[1])));
                }
            }
        }
    }
    let mut around: Vec<Vec<usize>> = vec![Vec::new(); nodes.len()];
    for &(a, b) in &links {
        around[a].push(b);
        around[b].push(a);
    }
    for (n, list) in around.iter_mut().enumerate() {
        list.sort_by(|&i, &j| {
            let (di, dj) = (sub(nodes[i], nodes[n]), sub(nodes[j], nodes[n]));
            di[1].atan2(di[0]).total_cmp(&dj[1].atan2(dj[0]))
        });
    }
    let mut reached = vec![false; nodes.len()];
    let mut stack = vec![0];
    while let Some(n) = stack.pop() {
        if !std::mem::replace(&mut reached[n], true) {
            stack.extend(&around[n]);
        }
    }
    if reached.iter().any(|r| !r) {
        return Err("An upper floor's outline touches no outline below it, so the building part under it would have a hole.".into());
    }
    let mut seen = BTreeSet::new();
    let mut found = Vec::new();
    for &(u, v) in &links {
        for (a0, b0) in [(u, v), (v, u)] {
            if seen.contains(&(a0, b0)) {
                continue;
            }
            let (mut a, mut b) = (a0, b0);
            let mut face = Vec::new();
            loop {
                seen.insert((a, b));
                face.push(nodes[a]);
                let list = &around[b];
                let back = list.iter().position(|&n| n == a).expect("linked");
                let next = list[(back + list.len() - 1) % list.len()];
                (a, b) = (b, next);
                if (a, b) == (a0, b0) {
                    break;
                }
            }
            if signed_area(&face) > EPS {
                found.push(face);
            }
        }
    }
    Ok(found)
}

// ---------------------------------------------------------------------------------------------
// Model elements

struct El<'a> {
    row: &'a Row,
    name: &'a str,
    zone: &'a str,
    ty: &'a str,
    pts: Vec<P>,
    level: i64,
}

impl<'a> El<'a> {
    fn get(&self, key: &str) -> Option<&'a Value> {
        let row: &'a Row = self.row;
        row.get(key).filter(|v| !v.is_null()).or_else(|| {
            row.get("extra_json")
                .and_then(|extra| extra.get(key))
                .filter(|v| !v.is_null())
        })
    }
    fn num(&self, key: &str) -> Option<f64> {
        self.get(key)?.as_f64()
    }
    fn flag(&self, key: &str) -> bool {
        self.get(key).and_then(Value::as_bool) == Some(true)
    }
    fn text(&self, key: &str) -> Option<&'a str> {
        self.get(key)?.as_str()
    }
    fn path(&self) -> String {
        json_pointer(&["Zone", self.zone, "BuildingElement", self.name])
    }
    fn bundle(&self) -> Option<&'a Value> {
        let row: &'a Row = self.row;
        row.get("extra_json")?.get("dormer_bundle")
    }
    fn host(&self) -> Option<&'a str> {
        self.text("linked_wall")
            .or_else(|| self.text("parent_element"))
    }
    fn plan_mid(&self) -> P {
        centroid(&self.pts)
    }
    fn length(&self) -> f64 {
        dist(self.pts[0], self.pts[1])
    }
    /// A pitched plane's own orientation; used only to pick a side, never as the value.
    fn orientation(&self) -> f64 {
        self.num("orientation360").unwrap_or(0.0)
    }
    /// Highest point of a gable drawn with a profiled top, else the wall height.
    fn top_height(&self) -> Option<f64> {
        let profile = self
            .get("geometry_face")
            .and_then(|face| face.get("top_profile"))
            .and_then(Value::as_array);
        profile
            .and_then(|points| {
                points
                    .iter()
                    .filter_map(|p| p.get("h")?.as_f64())
                    .reduce(f64::max)
            })
            .or_else(|| self.num("height"))
    }
    fn has_profile(&self) -> bool {
        self.get("geometry_face")
            .and_then(|face| face.get("top_profile"))
            .is_some()
    }
}

fn quoted(names: &[&str]) -> String {
    names
        .iter()
        .map(|n| format!("'{n}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn parse_coords(row: &Row) -> (Vec<P>, i64) {
    let mut pts = Vec::new();
    let mut level = 0;
    for (i, point) in row
        .get("coords")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .split('|')
        .enumerate()
    {
        let v: Vec<f64> = point
            .split(',')
            .filter_map(|v| v.trim().parse().ok())
            .collect();
        if v.len() >= 2 {
            pts.push([v[0], v[1]]);
        }
        if i == 0 && v.len() >= 3 {
            level = v[2].round() as i64;
        }
    }
    (pts, level)
}

const ELEMENT_SECTIONS: [&str; 4] = [
    "Exposed Elements",
    "Non-Exposed Elements",
    "Window Elements",
    "Ground Elements",
];

fn elements(csv: &Rows) -> Vec<El<'_>> {
    ELEMENT_SECTIONS
        .iter()
        .flat_map(|section| csv.get(*section).into_iter().flatten())
        .filter_map(|row| {
            let (pts, level) = parse_coords(row);
            Some(El {
                row,
                name: row.get("Name")?.as_str()?,
                zone: row.get("Zone").and_then(Value::as_str).unwrap_or_default(),
                ty: row.get("Type")?.as_str()?,
                pts,
                level,
            })
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    External,
    Party,
    Sheltered,
}

impl Kind {
    fn wall_type(self) -> &'static str {
        match self {
            Kind::External => "external",
            Kind::Party => "party",
            Kind::Sheltered => "sheltered",
        }
    }
}

/// A vertical wall line on the thermal envelope (derived from the model). Internal walls are not
/// HEMIE inputs: HEMIE derives internal walls from the floor area (DESNZ-defined).
fn wall_kind(e: &El) -> Option<Kind> {
    if e.pts.len() != 2 || e.flag("is_external_door") || e.bundle().is_some() {
        return None;
    }
    match e.ty {
        "BuildingElementOpaque" => Some(Kind::External),
        "BuildingElementPartyWall" => Some(Kind::Party),
        "BuildingElementAdjacentUnconditionedSpace_Simple" => Some(Kind::Sheltered),
        _ => None,
    }
}

fn is_plane(e: &El) -> bool {
    e.ty == "BuildingElementOpaque"
        && e.pts.len() >= 3
        && e.bundle().is_none()
        && e.num("pitch").is_some_and(|p| p < 90.0)
}

// ---------------------------------------------------------------------------------------------
// Settings and constructions

struct Settings<'a> {
    csv: &'a Rows,
    missing: BTreeSet<String>,
}

impl<'a> Settings<'a> {
    fn raw(&self, field: &str) -> Option<&'a Value> {
        let csv: &'a Rows = self.csv;
        csv.get("Metadata")
            .into_iter()
            .flatten()
            .find(|row| row.get("Field").and_then(Value::as_str) == Some(field))
            .and_then(|row| row.get("Value"))
            .filter(|v| !v.is_null() && v.as_str() != Some(""))
    }
    fn text(&mut self, name: &str, what: &str) -> Option<String> {
        let field = format!("{SETTING}{name}");
        match self.raw(&field) {
            Some(Value::String(s)) => Some(s.clone()),
            Some(other) => Some(other.to_string()),
            None => {
                self.missing.insert(format!("{field} ({what})"));
                None
            }
        }
    }
    /// The model's default construction for a HEMIE construction type, as a JSON object.
    fn construction(&mut self, construction_type: &str) -> Map<String, Value> {
        let field = format!("{SETTING}construction_{construction_type}");
        let parsed = match self.raw(&field) {
            Some(Value::String(s)) => serde_json::from_str::<Map<String, Value>>(s).ok(),
            Some(Value::Object(map)) => Some(map.clone()),
            Some(_) => None,
            None => Some(Map::new()),
        };
        parsed.unwrap_or_else(|| {
            self.missing
                .insert(format!("{field} (a JSON object of construction fields)"));
            Map::new()
        })
    }
}

#[derive(Default)]
struct Constructions {
    by_name: Map<String, Value>,
    documented: BTreeSet<String>,
}

impl Constructions {
    /// Register a construction under its construction type, numbered when several differ;
    /// identical constructions share one key (ours: names that do not depend on element names).
    fn add(&mut self, construction: Map<String, Value>) -> String {
        let name = construction["construction_type"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let value = Value::Object(construction);
        if let Some((key, _)) = self.by_name.iter().find(|(_, v)| **v == value) {
            return key.clone();
        }
        let mut key = name.clone();
        let mut n = 1;
        while self.by_name.contains_key(&key) {
            n += 1;
            key = format!("{name} {n}");
        }
        self.by_name.insert(key.clone(), value);
        key
    }
}

struct Ctx<'a> {
    settings: Settings<'a>,
    constructions: Constructions,
    errors: Vec<ValidationError>,
    notices: Vec<SchemaOmission>,
    model: &'a Value,
}

impl Ctx<'_> {
    /// The model setting for a construction type, overlaid with what the elements state. A
    /// U-value on the element is a documented U-value (derived from the model).
    fn construction(
        &mut self,
        construction_type: &str,
        elements: &[&El],
        extra: &[(&str, Value)],
    ) -> String {
        let mut c = self.settings.construction(construction_type);
        c.insert("construction_type".into(), json!(construction_type));
        let first = elements[0];
        let u_values: BTreeSet<String> = elements
            .iter()
            .filter_map(|e| e.num("u_value"))
            .map(|u| u.to_string())
            .collect();
        if construction_type == "party_wall" {
            // DESNZ-defined: a party wall's resistance is fixed; only its cavity and lining count.
        } else if u_values.len() > 1 {
            self.errors.push(error(first.path(), format!("HEMIE gives {} one construction, but their U-values differ ({}). Give them one U-value, or draw them as separate elements.", quoted(&elements.iter().map(|e| e.name).collect::<Vec<_>>()), u_values.into_iter().collect::<Vec<_>>().join(", "))));
        } else if let Some(u) = first.num("u_value") {
            c.insert("u_value".into(), json!(u));
            self.constructions
                .documented
                .insert(format!("{} (U {u})", first.name));
        } else if let Some(r) = first.num("thermal_resistance_construction") {
            // Derived from the model: U from the element's construction resistance and HEM's
            // surface resistances (BS EN ISO 13789 coefficients: radiative 5.13, convective 2.5
            // sideways, 5.0 upwards, 0.7 downwards; outside 20 + 4.14).
            let h_ci = match construction_type {
                "flat_roof" | "unheated_pitched_roof" | "heated_pitched_roof" => 5.0,
                t if t.ends_with("_floor") => 0.7,
                _ => 2.5,
            };
            let inside = 1.0 / (5.13 + h_ci);
            let u = 1.0 / (r + inside + 1.0 / (20.0 + 4.14));
            c.insert("u_value".into(), json!(u));
            self.constructions
                .documented
                .insert(format!("{} (U {u:.3} from R {r})", first.name));
        }
        if construction_type == "window" {
            for key in ["g_value", "frame_area_fraction"] {
                if let Some(v) = first.num(key) {
                    c.insert(key.into(), json!(v));
                }
            }
        }
        if construction_type == "party_wall" {
            // Derived from the model: the party wall's cavity and lining as Vulcan holds them.
            match first.text("party_wall_cavity_type") {
                Some("solid") => {
                    c.insert("party_wall_type".into(), json!("solid"));
                }
                Some(cavity) => {
                    let (filled, seal) = match cavity {
                        "filled_sealed" => ("filled_cavity", "sealed"),
                        "filled_unsealed" => ("filled_cavity", "unsealed"),
                        "unfilled_sealed" => ("unfilled_cavity", "sealed"),
                        "unfilled_unsealed" => ("unfilled_cavity", "unsealed"),
                        other => {
                            self.errors.push(error(first.path(), format!("Party wall '{}' has cavity type '{other}', which HEMIE does not take. Use solid, or a filled or unfilled cavity that is sealed or unsealed.", first.name)));
                            ("", "")
                        }
                    };
                    if !filled.is_empty() {
                        c.insert("party_wall_type".into(), json!(filled));
                        c.insert("cavity_seal_type".into(), json!(seal));
                    }
                }
                None => {}
            }
            if let Some(lining) = first.text("party_wall_lining_type") {
                c.insert("party_wall_lining_type".into(), json!(lining));
            }
        }
        if let Some(capacity) = first.num("areal_heat_capacity") {
            if construction_type != "window" {
                c.insert("areal_heat_capacity".into(), json!(capacity));
            }
        }
        for (key, value) in extra {
            c.entry(*key).or_insert_with(|| value.clone());
        }
        self.require(construction_type, &mut c);
        self.constructions.add(c)
    }

    /// Fields HEMIE needs that have no DESNZ default; each one missing is listed in the
    /// settings error.
    fn require(&mut self, construction_type: &str, c: &mut Map<String, Value>) {
        let has = |c: &Map<String, Value>, key: &str| c.get(key).is_some_and(|v| !v.is_null());
        let setting = format!("{SETTING}construction_{construction_type}");
        let mut need = |what: &str| {
            self.settings
                .missing
                .insert(format!("{setting} with {what}"));
        };
        match construction_type {
            // DESNZ-defined: a wall construction type is required when no layers are known.
            "external_wall" | "sheltered_wall"
                if !has(c, "wall_construction_type") && !has(c, "layers") =>
            {
                need("wall_construction_type")
            }
            "party_wall" if !has(c, "party_wall_type") => need("party_wall_type"),
            "window" => {
                // DESNZ-defined: frame material without a documented U- and g-value, glazing
                // type without a documented U-value.
                if !(has(c, "frame_material") || has(c, "u_value") && has(c, "g_value")) {
                    need("frame_material");
                }
                if !has(c, "u_value") && !has(c, "glazing_type") {
                    need("glazing_type");
                }
                if !has(c, "areal_heat_capacity") {
                    need("areal_heat_capacity (a window in a party or sheltered wall)");
                }
            }
            "heated_pitched_roof" if !has(c, "areal_heat_capacity") => {
                c.insert(
                    "areal_heat_capacity".into(),
                    json!(HEATED_PITCHED_ROOF_HEAT_CAPACITY),
                );
            }
            // DESNZ gives no default for a door's areal heat capacity, and the full input holds
            // only a category, so the door setting states it.
            "external_door" | "party_or_sheltered_door" if !has(c, "areal_heat_capacity") => {
                need("areal_heat_capacity")
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Building parts

struct HemieWall<'a> {
    part: usize,
    storey: usize,
    a: P,
    b: P,
    source: &'a El<'a>,
    value: Map<String, Value>,
}

struct Part {
    poly: Vec<P>,
    top: usize,
    storeys: Vec<Vec<P>>,
    ceilings: Vec<f64>,
}

/// Snap an upper outline onto the one below: vertices within the tolerance move onto the lower
/// outline's vertex, else onto its edge (ours: drawings differ by a few centimetres per floor).
fn snap_onto(ring: &mut [P], lower: &[P]) {
    for v in ring.iter_mut() {
        if let Some(near) = lower.iter().find(|l| dist(**l, *v) <= TOL) {
            *v = *near;
        } else if let Some((a, b)) = edges(lower).find(|(a, b)| seg_dist(*v, *a, *b) <= TOL) {
            *v = project(*v, a, b);
        }
    }
}

/// Insert the ends of a storey's walls that lie on the outline, so each wall maps to whole edges.
fn with_wall_ends(poly: &[P], walls: &[&El]) -> Vec<P> {
    let mut ring = poly.to_vec();
    for p in walls.iter().flat_map(|w| w.pts.iter()) {
        if ring.iter().any(|v| dist(*v, *p) <= TOL) {
            continue;
        }
        if let Some(i) =
            (0..ring.len()).find(|&i| seg_dist(*p, ring[i], ring[(i + 1) % ring.len()]) <= TOL)
        {
            let q = project(*p, ring[i], ring[(i + 1) % ring.len()]);
            ring.insert(i + 1, q);
        }
    }
    ring
}

/// The wall drawn along an outline edge: parallel and within the tolerance (derived from the model).
fn wall_on_edge<'e>(a: P, b: P, walls: &[&'e El<'e>]) -> Option<&'e El<'e>> {
    let d = unit(sub(b, a));
    let m = mid(a, b);
    walls
        .iter()
        .filter(|w| {
            cross(d, unit(sub(w.pts[1], w.pts[0]))).abs() < 0.05
                && seg_dist(m, w.pts[0], w.pts[1]) <= TOL
        })
        .min_by(|x, y| seg_dist(m, x.pts[0], x.pts[1]).total_cmp(&seg_dist(m, y.pts[0], y.pts[1])))
        .copied()
}

/// Merge consecutive collinear edges that carry the same wall (or none).
fn merge_edges<'e>(ring: Vec<P>, walls: &[&'e El<'e>]) -> (Vec<P>, Vec<Option<&'e El<'e>>>) {
    let mut ring = ring;
    loop {
        let n = ring.len();
        let carried: Vec<Option<&El>> = edges(&ring)
            .map(|(a, b)| wall_on_edge(a, b, walls))
            .collect();
        let merge = (0..n).find(|&i| {
            let prev = (i + n - 1) % n;
            let same = match (carried[prev], carried[i]) {
                (Some(x), Some(y)) => x.name == y.name,
                (None, None) => true,
                _ => false,
            };
            let (a, v, b) = (ring[prev], ring[i], ring[(i + 1) % n]);
            same && n > 3 && cross(unit(sub(v, a)), unit(sub(b, v))).abs() < 1e-3
        });
        match merge {
            Some(i) => {
                ring.remove(i);
            }
            None => {
                let carried = edges(&ring)
                    .map(|(a, b)| wall_on_edge(a, b, walls))
                    .collect();
                return (ring, carried);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Conversion

/// Replace the full-input zone and ventilation with HEMIE inputs. Errors name the element.
pub(crate) fn map_existing_building(
    model: &mut Value,
    csv: &Rows,
    schema: &Value,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    let snapshot = model.clone();
    let mut ctx = Ctx {
        settings: Settings {
            csv,
            missing: BTreeSet::new(),
        },
        constructions: Constructions::default(),
        errors: Vec::new(),
        notices: Vec::new(),
        model: &snapshot,
    };
    let converted = convert(&mut ctx, csv);
    if !ctx.settings.missing.is_empty() {
        ctx.errors.push(error("/Metadata".into(), format!("An existing-building EPC needs these model settings, which the Metadata section does not state: {}.", ctx.settings.missing.iter().cloned().collect::<Vec<_>>().join("; "))));
    }
    notices.append(&mut ctx.notices);
    if !ctx.errors.is_empty() || converted.is_none() {
        errors.append(&mut ctx.errors);
        return;
    }
    let (geometry, ventilation) = converted.expect("checked");
    let documented: Vec<String> = std::mem::take(&mut ctx.constructions.documented)
        .into_iter()
        .collect();
    if !documented.is_empty() {
        notices.push(notice("/Zone/constructions", format!("These elements state their own U-value, so HEMIE takes it as a documented U-value from the element: {}. Lodgement needs evidence for each.", documented.join(", "))));
    }
    notices.push(notice("/Zone", "The existing-building EPC takes its geometry from the storey outlines. HEMIE derives thermal bridges (from the age band), internal walls and floors, lighting and window shading itself, so the model's own are not used.".into()));
    model["Zone"] = geometry;
    model["InfiltrationVentilation"] = ventilation;
    // DESNZ-defined: with HEMIE Geometry, the heating systems that name their zone take the one
    // zone Geometry makes, so they are given in their HEMIE form, which has no zone. Fields the
    // HEMIE form does not take are reported as schema omissions.
    if let Some(systems) = model
        .get_mut("SpaceHeatSystem")
        .and_then(Value::as_object_mut)
    {
        for (name, system) in systems.iter_mut() {
            let definition = match system.get("type").and_then(Value::as_str) {
                Some("WetDistribution") => "SpaceHeatSystemWetDistribution",
                Some("ElecStorageHeater") => "SpaceHeatSystemElectricStorageHeaterProduct",
                _ => continue,
            };
            let mut hemie = system.clone();
            hemie.as_object_mut().expect("system").remove("Zone");
            hemie["model_type"] = json!("hemie");
            let branch = json!({
                "$ref": format!("#/$defs/hem_epc_orchestrator__models__hemie__{definition}"),
                "$defs": schema["$defs"],
            });
            if let Ok((projected, omitted)) = crate::finalization::project_model(&hemie, &branch) {
                *system = projected;
                notices.extend(omitted.into_iter().map(|mut o| {
                    o.path = format!("{}{}", json_pointer(&["SpaceHeatSystem", name]), o.path);
                    o
                }));
            }
        }
    }
}

fn convert(ctx: &mut Ctx, csv: &Rows) -> Option<(Value, Value)> {
    let els = elements(csv);
    let model = ctx.model;
    let zone_name = model["Zone"]
        .as_object()
        .and_then(|zones| zones.keys().next().cloned())
        .unwrap_or_default();
    let zone = &model["Zone"][&zone_name];
    let age_band = ctx.settings.text("age_band", "A to M");
    let region = ctx.settings.text(
        "region",
        "England, Wales, Scotland, Northern Ireland or Isle of Man",
    );

    // Line walls and the elements HEMIE geometry cannot hold yet.
    let mut walls: Vec<(&El, Kind)> = Vec::new();
    for e in &els {
        if let Some(kind) = wall_kind(e) {
            if e.num("pitch").is_some_and(|p| (p - 90.0).abs() > 1e-6) {
                ctx.errors.push(error(e.path(), format!("'{}' is a leaning wall (pitch {}). The existing-building converter takes vertical walls only.", e.name, e.num("pitch").unwrap_or_default())));
            } else if e.text("parent_element").is_some() {
                ctx.errors.push(error(e.path(), format!("'{}' is a wall inside another element, which the existing-building converter does not take. Draw it as a wall of the storey outline.", e.name)));
            } else {
                walls.push((e, kind));
            }
        } else if e.ty == "BuildingElementOpaque"
            && e.num("pitch").is_some_and(|p| p > 90.0)
            && e.level != 0
        {
            ctx.errors.push(error(e.path(), format!("'{}' is an exposed floor. The existing-building converter does not take floors above outside air yet.", e.name)));
        }
    }
    if walls.is_empty() {
        ctx.errors.push(error(
            "/Zone".into(),
            "The model has no wall lines, so it has no storey outline for HEMIE.".into(),
        ));
        return None;
    }
    let planes: Vec<&El> = els.iter().filter(|e| is_plane(e)).collect();
    let heated =
        |p: &&El| p.num("pitch").unwrap_or(0.0) > 0.0 && !p.flag("is_unheated_pitched_roof");
    let levels: BTreeSet<i64> = walls.iter().map(|(w, _)| w.level).collect();
    let top_level = *levels.iter().next_back().expect("walls");

    // Rule: gables and knee walls on a floor under heated slopes are a room in the roof, not a
    // storey; a gable has a sloped top, a knee wall does not (derived from the model). ours: with
    // gables only (slopes down to the floor) it is a vaulted ceiling, which HEMIE does not take.
    let heated_above = top_level > 0
        && planes
            .iter()
            .any(|p| heated(p) && (p.level == top_level || p.level == top_level + 1));
    let top_walls: Vec<&El> = walls
        .iter()
        .filter(|(w, _)| w.level == top_level)
        .map(|(w, _)| *w)
        .collect();
    let has_gables = top_walls.iter().any(|w| w.has_profile());
    let has_knee_walls = top_walls.iter().any(|w| !w.has_profile());
    let roof_room = (heated_above && has_gables && has_knee_walls).then_some(top_level);
    if heated_above && has_gables && !has_knee_walls {
        let roof = planes.iter().find(|p| heated(p)).expect("heated");
        ctx.errors.push(error(roof.path(), format!("Roof '{}' is a heated pitched roof whose floor has gables but no knee walls (a vaulted ceiling). HEMIE has no vaulted roof type; draw the room's knee walls, or mark the roof as unheated if a loft is above.", roof.name)));
        return None;
    }
    let storey_levels: Vec<i64> = levels
        .iter()
        .copied()
        .filter(|l| Some(*l) != roof_room)
        .collect();
    if storey_levels
        .iter()
        .enumerate()
        .any(|(i, l)| *l != i as i64)
    {
        ctx.errors.push(error("/Zone".into(), format!("The floors with walls are {storey_levels:?}. HEMIE storeys start at floor 0 and follow one another.")));
        return None;
    }
    let on_level = |level: i64| -> Vec<&El> {
        walls
            .iter()
            .filter(|(w, _)| w.level == level)
            .map(|(w, _)| *w)
            .collect()
    };

    // One outline per storey; each sits over the one below (rule: floors drawn side by side stop).
    let mut rings: Vec<Vec<P>> = Vec::new();
    for &level in &storey_levels {
        let mut ring = match ring_of_walls(&on_level(level)) {
            Ok(ring) => ring,
            Err(message) => {
                ctx.errors
                    .push(error("/Zone".into(), format!("Floor {level}: {message}")));
                return None;
            }
        };
        if let Some(lower) = rings.last() {
            snap_onto(&mut ring, lower);
            if !inside_or_on(centroid(&ring), lower) {
                ctx.errors.push(error(on_level(level)[0].path(), format!("Floor {level} is drawn beside floor {}, not over it. Move floor {level} over the floor below; HEMIE stacks storeys in one plan.", level - 1)));
                return None;
            }
            if let Some(p) = ring.iter().find(|p| !inside_or_on(**p, lower)) {
                ctx.errors.push(error(on_level(level)[0].path(), format!("Floor {level} overhangs floor {} at ({:.2}, {:.2}). The existing-building converter does not take overhanging storeys yet.", level - 1, p[0], p[1])));
                return None;
            }
        }
        rings.push(ring);
    }
    let room_walls: Vec<&El> = roof_room.map(on_level).unwrap_or_default();
    if let (Some(level), Some(top)) = (roof_room, rings.last()) {
        if let Some(w) = room_walls
            .iter()
            .find(|w| !w.pts.iter().all(|p| inside_or_on(*p, top)))
        {
            ctx.errors.push(error(w.path(), format!("Floor {level} (the room in the roof) is not over floor {}: '{}' lies outside it. Move floor {level} over the floor below.", level - 1, w.name)));
            return None;
        }
    }

    // Building parts: one per column of storeys, so each has one roof (derived from the model).
    let cells = match faces(&rings) {
        Ok(cells) => cells,
        Err(message) => {
            ctx.errors.push(error("/Zone".into(), message));
            return None;
        }
    };
    let mut parts: Vec<Part> = cells
        .into_iter()
        .map(|poly| {
            let p = interior_point(&poly);
            let top = (0..rings.len())
                .rev()
                .find(|&k| inside(p, &rings[k]))
                .unwrap_or(0);
            Part {
                poly,
                top,
                storeys: Vec::new(),
                ceilings: Vec::new(),
            }
        })
        .collect();
    // ours: the reference part is the one with the most storeys, then the largest footprint.
    parts.sort_by(|a, b| {
        b.top
            .cmp(&a.top)
            .then(signed_area(&b.poly).total_cmp(&signed_area(&a.poly)))
    });

    // Storey outlines and their walls.
    let mut hemie_walls: Vec<HemieWall> = Vec::new();
    let mut used: BTreeSet<&str> = BTreeSet::new();
    for pi in 0..parts.len() {
        for s in 0..=parts[pi].top {
            let level_walls = on_level(s as i64);
            let (ring, carried) =
                merge_edges(with_wall_ends(&parts[pi].poly, &level_walls), &level_walls);
            let mut lengths = 0.0;
            let mut height_sum = 0.0;
            let mut heights = BTreeSet::new();
            for (i, ((a, b), wall)) in edges(&ring).zip(&carried).enumerate() {
                match wall {
                    Some(w) => {
                        used.insert(w.name);
                        let h = w.num("height").unwrap_or(0.0);
                        lengths += dist(a, b);
                        height_sum += h * dist(a, b);
                        heights.insert(format!("{h}"));
                        let kind = walls
                            .iter()
                            .find(|(x, _)| x.name == w.name)
                            .map(|(_, k)| *k)
                            .expect("wall");
                        let mut value = Map::new();
                        value.insert("wall_type".into(), json!(kind.wall_type()));
                        value.insert("storey_index".into(), json!(s));
                        value.insert("floorplan_index".into(), json!(i));
                        hemie_walls.push(HemieWall {
                            part: pi,
                            storey: s,
                            a,
                            b,
                            source: w,
                            value,
                        });
                    }
                    None => {
                        let shared = parts.iter().enumerate().any(|(pj, other)| {
                            pj != pi && boundary_dist(mid(a, b), &other.poly) <= TOL
                        });
                        if !shared {
                            ctx.errors.push(error("/Zone".into(), format!("Floor {s} has no wall between ({:.2}, {:.2}) and ({:.2}, {:.2}) of its outline. Draw the wall there.", a[0], a[1], b[0], b[1])));
                        }
                    }
                }
            }
            // ours: one ceiling height per storey, the length-weighted mean of its walls.
            let storey_height = if lengths > 0.0 {
                height_sum / lengths
            } else {
                0.0
            };
            if heights.len() > 1 {
                ctx.notices.push(notice("/Zone", format!("The walls of floor {s} have heights {}. HEMIE takes one ceiling height per storey of a building part, so it uses their length-weighted mean, {storey_height:.3} m.", heights.into_iter().collect::<Vec<_>>().join(", "))));
            }
            // DESNZ-defined: a storey's ceiling height leaves out the gap to the storey or roof
            // room above. ours: Vulcan wall heights run floor to floor, so the gap is taken from
            // every storey with something above it (see the open question on the floor zone).
            let above = s < parts[pi].top || (roof_room.is_some() && s == rings.len() - 1);
            parts[pi]
                .ceilings
                .push(storey_height - if above { STOREY_GAP } else { 0.0 });
            parts[pi].storeys.push(ring);
        }
    }
    for (w, _) in &walls {
        if Some(w.level) != roof_room && !used.contains(w.name) {
            ctx.errors.push(error(w.path(), format!("'{}' is not on the outline of floor {}. HEMIE walls are edges of the storey outline; delete it or join it to the outline.", w.name, w.level)));
        }
    }
    if !ctx.errors.is_empty() {
        return None;
    }

    // Reference: the first edge of the reference part's lowest storey (derived from the model).
    let offset = csv
        .get("Metadata")
        .into_iter()
        .flatten()
        .find(|row| row.get("Field").and_then(Value::as_str) == Some("GlobalOrientationOffset"))
        .and_then(|row| row.get("Value")?.as_f64())
        .unwrap_or(0.0);
    let base = &parts[0].storeys[0];
    let reference_edge = sub(base[1], base[0]);
    let reference_orientation = (outward_bearing(base[0], base[1]) - offset).rem_euclid(360.0);
    let orient = |edge: P| edge_orientation(reference_orientation, reference_edge, edge);

    // Openings, vents and constructions on storey walls.
    let windows: Vec<&El> = els
        .iter()
        .filter(|e| e.ty == "BuildingElementTransparent")
        .collect();
    let doors: Vec<&El> = els
        .iter()
        .filter(|e| e.ty == "BuildingElementOpaque" && e.flag("is_external_door"))
        .collect();
    let mut placed: BTreeSet<String> = BTreeSet::new();
    for wi in 0..hemie_walls.len() {
        let source = hemie_walls[wi].source;
        let kind = walls
            .iter()
            .find(|(x, _)| x.name == source.name)
            .map(|(_, k)| *k)
            .expect("wall");
        let construction_type = match kind {
            Kind::External => "external_wall",
            Kind::Party => "party_wall",
            Kind::Sheltered => "sheltered_wall",
        };
        let key = ctx.construction(construction_type, &[source], &[]);
        hemie_walls[wi]
            .value
            .insert("construction".into(), json!(key));
        if kind == Kind::Sheltered {
            match source.text("adjacent_space_type") {
                Some(space) => {
                    hemie_walls[wi].value.insert("adjacent_space_type".into(), json!(space));
                }
                None => ctx.errors.push(error(source.path(), format!("Sheltered wall '{}' does not state the unheated space it borders. Give it an adjacent_space_type: corridor, garage, roof void or stairwell.", source.name))),
            }
        }
        let (mut win, mut door) = (Vec::new(), Vec::new());
        for opening in windows.iter().chain(&doors) {
            if opening.host() != Some(source.name) || opening.pts.len() < 2 {
                continue;
            }
            // The edge of its host wall nearest the opening (derived from the model).
            let m = opening.plan_mid();
            let nearest = hemie_walls
                .iter()
                .enumerate()
                .filter(|(_, w)| w.source.name == source.name)
                .min_by(|(_, x), (_, y)| seg_dist(m, x.a, x.b).total_cmp(&seg_dist(m, y.a, y.b)))
                .map(|(i, _)| i);
            if nearest != Some(wi) {
                continue;
            }
            placed.insert(opening.name.to_string());
            if opening.ty == "BuildingElementTransparent" {
                if let Some(w) = window(ctx, opening, kind == Kind::External) {
                    win.push(w);
                }
            } else {
                let door_type = if kind == Kind::External {
                    "external_door"
                } else {
                    "party_or_sheltered_door"
                };
                let key = ctx.construction(door_type, &[opening], &[]);
                door.push(json!({"width": opening.num("width"), "height": opening.num("height"), "construction": key}));
            }
        }
        if kind == Kind::External || !win.is_empty() || !door.is_empty() {
            hemie_walls[wi]
                .value
                .insert("windows".into(), Value::Array(win));
            hemie_walls[wi]
                .value
                .insert("doors".into(), Value::Array(door));
        }
    }
    passive_vents(ctx, csv, &mut hemie_walls);

    // Roofs and floors per part.
    let room_walls_refs: Vec<&El> = room_walls.clone();
    let dormers: Vec<&El> = els.iter().filter(|e| e.bundle().is_some()).collect();
    let mut roofs: Vec<Vec<&El>> = vec![Vec::new(); parts.len()];
    for plane in &planes {
        let c = centroid(&plane.pts);
        let part = (0..parts.len())
            .find(|&i| inside(c, &parts[i].poly))
            .or_else(|| {
                (0..parts.len())
                    .filter(|&i| boundary_dist(c, &parts[i].poly) <= EAVES)
                    .min_by(|&i, &j| {
                        boundary_dist(c, &parts[i].poly)
                            .total_cmp(&boundary_dist(c, &parts[j].poly))
                    })
            });
        match part {
            Some(i) => roofs[i].push(plane),
            None => ctx.errors.push(error(
                plane.path(),
                format!(
                    "Roof '{}' covers no storey. Move it over the storeys it covers.",
                    plane.name
                ),
            )),
        }
    }
    let room_part = roof_room.and_then(|_| {
        let c = centroid(
            &room_walls_refs
                .iter()
                .flat_map(|w| w.pts.clone())
                .collect::<Vec<_>>(),
        );
        (0..parts.len()).find(|&i| parts[i].top == rings.len() - 1 && inside(c, &parts[i].poly))
    });
    let grounds: Vec<&El> = els
        .iter()
        .filter(|e| e.ty == "BuildingElementGround")
        .collect();
    // Derived from the model: HEMIE's floor total_area is the ground floor area of the whole dwelling.
    let ground_total: f64 = grounds.iter().filter_map(|g| g.num("area")).sum();
    let mut building_parts = Map::new();
    // ours: part names; the reference part is "Main".
    let names: Vec<String> = (0..parts.len())
        .map(|i| {
            if i == 0 {
                "Main".to_string()
            } else {
                format!("Extension {i}")
            }
        })
        .collect();
    for (pi, part) in parts.iter().enumerate() {
        let storeys: Vec<Value> = part
            .storeys
            .iter()
            .zip(&part.ceilings)
            .map(|(ring, ceiling)| {
                let points: Vec<String> = ring.iter().chain(std::iter::once(&ring[0])).map(|p| format!("{} {}", p[0], p[1])).collect();
                json!({"ceiling_height": ceiling, "floorplan": format!("LINEARRING ({})", points.join(", "))})
            })
            .collect();
        let part_walls: Vec<Value> = hemie_walls
            .iter()
            .filter(|w| w.part == pi)
            .map(|w| Value::Object(w.value.clone()))
            .collect();
        let mut bp = Map::new();
        bp.insert("storeys".into(), Value::Array(storeys));
        bp.insert("walls".into(), Value::Array(part_walls));
        let interior = interior_point(&part.poly);
        let ground = grounds
            .iter()
            .find(|g| g.pts.len() >= 3 && inside(interior, &g.pts))
            .or(if grounds.len() == 1 {
                grounds.first()
            } else {
                None
            });
        // Derived from the model: a floor drawn over outside air on floor 0.
        let exposed = els.iter().find(|e| {
            e.ty == "BuildingElementOpaque"
                && e.level == 0
                && e.num("pitch").is_some_and(|p| p > 90.0)
                && e.pts.len() >= 3
                && inside(interior, &e.pts)
        });
        match (ground, exposed) {
            (Some(g), _) => {
                if let Some(floor) = floor(ctx, g, ground_total) {
                    bp.insert("floor".into(), floor);
                }
            }
            (None, Some(e)) => {
                let key = ctx.construction("above_external_area_floor", &[e], &[]);
                bp.insert(
                    "floor".into(),
                    json!({"floor_type": "not next to ground (external)", "construction": key}),
                );
            }
            (None, None) => ctx.errors.push(error(
                "/Zone".into(),
                format!(
                    "Building part '{}' has no ground floor drawn under it. Draw its ground floor.",
                    names[pi]
                ),
            )),
        }
        let top_ring = part.storeys.last().expect("storey").clone();
        let roof = if Some(pi) == room_part {
            room_in_roof(
                ctx,
                &roofs[pi],
                &room_walls_refs,
                &dormers,
                &windows,
                &top_ring,
                &orient,
                &mut placed,
            )
        } else {
            roof(
                ctx,
                &roofs[pi],
                &windows,
                &names[pi],
                &top_ring,
                &orient,
                &mut placed,
            )
        };
        if let Some(roof) = roof {
            bp.insert("roof".into(), roof);
        }
        building_parts.insert(names[pi].clone(), Value::Object(bp));
    }
    // Only once everything else converted: an earlier failure leaves openings unplaced.
    for opening in windows.iter().chain(&doors) {
        if ctx.errors.is_empty() && !placed.contains(opening.name) {
            ctx.errors.push(error(opening.path(), format!("'{}' is not in a storey wall, roof room or roof the converter places. Link it to the wall or roof it sits in.", opening.name)));
        }
    }

    let mut geometry = Map::new();
    geometry.insert("model_type".into(), json!("hemie"));
    geometry.insert("age_band".into(), json!(age_band));
    geometry.insert("region".into(), json!(region));
    geometry.insert("build_type".into(), model["General"]["build_type"].clone());
    geometry.insert("livingroom_area".into(), zone["livingroom_area"].clone());
    geometry.insert(
        "restofdwelling_area".into(),
        zone["restofdwelling_area"].clone(),
    );
    geometry.insert(
        "NumberOfHabitableRooms".into(),
        model["NumberOfHabitableRooms"].clone(),
    );
    geometry.insert("reference_building_part".into(), json!(names[0]));
    geometry.insert("reference_orientation".into(), json!(reference_orientation));
    let full_ventilation = &model["InfiltrationVentilation"];
    geometry.insert(
        "ventilation_zone_base_height".into(),
        full_ventilation["ventilation_zone_base_height"].clone(),
    );
    geometry.insert("building_parts".into(), Value::Object(building_parts));
    geometry.insert(
        "constructions".into(),
        Value::Object(std::mem::take(&mut ctx.constructions.by_name)),
    );

    let ventilation = infiltration(ctx, full_ventilation);
    if !ctx.errors.is_empty() {
        return None;
    }
    Some((Value::Object(geometry), ventilation?))
}

fn window(ctx: &mut Ctx, e: &El, in_external_element: bool) -> Option<Value> {
    let Some(sections) = e.get("window_sections") else {
        // DESNZ-defined: the opening type has no default, so the window must state it.
        ctx.errors.push(error(e.path(), format!("Window '{}' does not state its opening type. Give it window_sections, for example [{{\"window_type\": \"full opening\"}}].", e.name)));
        return None;
    };
    // ours: see UNUSED_WINDOW_HEAT_CAPACITY.
    let extra = if in_external_element {
        vec![("areal_heat_capacity", json!(UNUSED_WINDOW_HEAT_CAPACITY))]
    } else {
        Vec::new()
    };
    let key = ctx.construction("window", &[e], &extra);
    let mut w = json!({"width": e.num("width"), "height": e.num("height"), "window_sections": sections, "construction": key});
    // Derived from the model: background vents drawn in this window.
    let vents: Vec<Value> = window_vents(ctx.settings.csv, e.name)
        .filter_map(|row| row.get("area_cm2")?.as_f64())
        .map(|area| json!({"area": area}))
        .collect();
    if !vents.is_empty() {
        w["passive_vents"] = Value::Array(vents);
    }
    // Derived from the model: Vulcan's security_risk flag.
    if let Some(risk) = e.get("security_risk").and_then(Value::as_bool) {
        w["is_security_risk"] = json!(risk);
    }
    Some(w)
}

/// Derived from the model: the Vulcan ground floor type and the element's documented U-value.
fn floor(ctx: &mut Ctx, g: &El, total_area: f64) -> Option<Value> {
    let (floor_type, construction_type) = match g.text("floor_type") {
        Some("Slab_no_edge_insulation") => (
            "slab no edge insulation",
            "not_edge_insulated_ground_attached_floor",
        ),
        Some("Slab_edge_insulation") => (
            "slab with edge insulation",
            "edge_insulated_ground_attached_floor",
        ),
        Some("Suspended_floor") => ("suspended", "suspended_floor"),
        Some("Heated_basement") => ("heated basement", "heated_basement_floor"),
        Some("Unheated_basement") => ("unheated basement", "unheated_basement_floor"),
        other => {
            ctx.errors.push(error(g.path(), format!("Ground floor '{}' has floor type {other:?}, which the existing-building converter does not map yet.", g.name)));
            return None;
        }
    };
    let key = ctx.construction(construction_type, &[g], &[]);
    Some(json!({"floor_type": floor_type, "construction": key, "total_area": total_area}))
}

/// The pitched roof's slope orientation: an edge orientation of the top storey's minimum
/// rectangle, as HEMIE requires (DESNZ-defined). The plane's own orientation only picks which
/// side (rule: slope orientation comes from the ring).
fn slope(top_ring: &[P], toward: f64, orient: &dyn Fn(P) -> f64) -> (f64, P) {
    let rect = min_rectangle(top_ring);
    (0..4)
        .map(|i| {
            let (a, b) = (rect[i], rect[(i + 1) % 4]);
            let d = unit(sub(b, a));
            (orient(sub(b, a)), [d[1], -d[0]])
        })
        .min_by(|x, y| bearing_gap(x.0, toward).total_cmp(&bearing_gap(y.0, toward)))
        .expect("four edges")
}

fn roof_windows(
    ctx: &mut Ctx,
    windows: &[&El],
    hosts: &[&El],
    placed: &mut BTreeSet<String>,
) -> Vec<Value> {
    windows
        .iter()
        .filter(|w| hosts.iter().any(|h| w.host() == Some(h.name)))
        .filter_map(|w| {
            placed.insert(w.name.to_string());
            window(ctx, w, true)
        })
        .collect()
}

fn roof(
    ctx: &mut Ctx,
    planes: &[&El],
    windows: &[&El],
    part: &str,
    top_ring: &[P],
    orient: &dyn Fn(P) -> f64,
    placed: &mut BTreeSet<String>,
) -> Option<Value> {
    let (flat, pitched): (Vec<&El>, Vec<&El>) = planes
        .iter()
        .partition(|p| p.num("pitch").unwrap_or(0.0) == 0.0);
    let heated: Vec<&El> = pitched
        .iter()
        .copied()
        .filter(|p| !p.flag("is_unheated_pitched_roof"))
        .collect();
    if let Some(p) = heated.first() {
        // Rule: a heated pitched roof with no roof room (a vaulted ceiling) has no HEMIE form.
        ctx.errors.push(error(p.path(), format!("Roof '{}' is a heated pitched roof over a storey (a vaulted ceiling). HEMIE has no vaulted roof type; draw the room in the roof with its knee walls or gables, or mark the roof as unheated if a loft is above.", p.name)));
        return None;
    }
    let result = if !flat.is_empty() && !pitched.is_empty() {
        ctx.errors.push(error(flat[0].path(), format!("Building part '{part}' has flat roof '{}' and pitched roof '{}'. HEMIE gives each building part one roof.", flat[0].name, pitched[0].name)));
        None
    } else if !flat.is_empty() {
        let key = ctx.construction("flat_roof", &flat, &[]);
        let lights = roof_windows(ctx, windows, &flat, placed);
        // ours: Vulcan does not record whether a flat roof is cold or warm, so it is Unknown.
        Some(json!({"roof_type": "Unknown Flat", "construction": key, "windows": lights}))
    } else if !pitched.is_empty() {
        if windows
            .iter()
            .any(|w| pitched.iter().any(|p| w.host() == Some(p.name)))
        {
            ctx.errors.push(error(pitched[0].path(), format!("Roof '{}' is unheated (a loft) and has a roof window. HEMIE takes roof windows only in flat roofs, heated slopes and rooms in the roof.", pitched[0].name)));
            return None;
        }
        // Sides from the planes' own orientations: one is mono, two opposite are dual.
        let mut sides: Vec<f64> = Vec::new();
        for p in &pitched {
            if !sides
                .iter()
                .any(|s| bearing_gap(*s, p.orientation()) < 45.0)
            {
                sides.push(p.orientation());
            }
        }
        let pitch_type = match sides.as_slice() {
            [_] => "mono",
            [a, b] if bearing_gap(*a, *b) > 135.0 => "dual",
            [_, _] => {
                ctx.errors.push(error(pitched[0].path(), format!("The pitched roof of building part '{part}' slopes two ways that are not opposite. HEMIE takes mono or dual pitched roofs.")));
                return None;
            }
            _ => {
                // ours (interim): HEMIE has no hipped roof, so a hipped roof is dual pitch.
                ctx.notices.push(notice("/Zone", format!("The roof of building part '{part}' is hipped ({} slopes). HEMIE has no hipped roof, so it is entered as dual pitch at its measured pitch.", sides.len())));
                "dual"
            }
        };
        let main = pitched
            .iter()
            .max_by(|a, b| {
                a.num("area")
                    .unwrap_or(0.0)
                    .total_cmp(&b.num("area").unwrap_or(0.0))
            })
            .expect("pitched");
        let (slope_orientation, _) = slope(top_ring, main.orientation(), orient);
        // ours: one pitch per roof, the area-weighted mean of its planes.
        let (area, weighted) = pitched.iter().fold((0.0, 0.0), |(a, w), p| {
            let area = p.num("area").unwrap_or(1.0);
            (a + area, w + area * p.num("pitch").unwrap_or(0.0))
        });
        rectangularity_notice(ctx, part, top_ring);
        let key = ctx.construction("unheated_pitched_roof", &pitched, &[]);
        // ours: Vulcan does not record cold or warm, so it is Unknown.
        Some(
            json!({"roof_type": "Unknown Pitched (Unheated)", "construction": key, "pitch_type": pitch_type,
            "slope_orientation": slope_orientation, "pitch": "Custom", "custom_pitch": weighted / area}),
        )
    } else {
        ctx.errors.push(error(
            "/Zone".into(),
            format!("Building part '{part}' has no roof drawn over it. Draw its roof."),
        ));
        None
    };
    result
}

/// Rule: HEMIE sizes a pitched roof from the top storey's minimum rectangle (DESNZ-defined), so
/// a non-rectangular part gets a notice.
fn rectangularity_notice(ctx: &mut Ctx, part: &str, ring: &[P]) {
    let rect = min_rectangle(ring);
    let fill = signed_area(ring) / signed_area(&rect);
    if fill < 0.99 {
        ctx.notices.push(notice("/Zone", format!("Building part '{part}' is not rectangular ({:.0}% of its minimum rectangle). HEMIE sizes its pitched roof from that rectangle.", fill * 100.0)));
    }
}

#[allow(clippy::too_many_arguments)]
fn room_in_roof(
    ctx: &mut Ctx,
    planes: &[&El],
    walls: &[&El],
    dormers: &[&El],
    windows: &[&El],
    top_ring: &[P],
    orient: &dyn Fn(P) -> f64,
    placed: &mut BTreeSet<String>,
) -> Option<Value> {
    let heated: Vec<&El> = planes
        .iter()
        .copied()
        .filter(|p| p.num("pitch").unwrap_or(0.0) > 0.0 && !p.flag("is_unheated_pitched_roof"))
        .collect();
    let unheated: Vec<&El> = planes
        .iter()
        .copied()
        .filter(|p| p.num("pitch").unwrap_or(0.0) > 0.0 && p.flag("is_unheated_pitched_roof"))
        .collect();
    if let Some(flat) = planes.iter().find(|p| p.num("pitch").unwrap_or(0.0) == 0.0) {
        ctx.errors.push(error(flat.path(), format!("Flat roof '{}' is part of a room in the roof. The converter does not take a roof room's flat ceiling yet.", flat.name)));
        return None;
    }
    let main = heated.iter().max_by(|a, b| {
        a.num("area")
            .unwrap_or(0.0)
            .total_cmp(&b.num("area").unwrap_or(0.0))
    })?;
    let (slope_orientation, u) = slope(top_ring, main.orientation(), orient);
    let v = [-u[1], u[0]];
    let room_centre = centroid(&walls.iter().flat_map(|w| w.pts.clone()).collect::<Vec<_>>());
    let side = |p: P| dot(sub(p, room_centre), u);
    // Rule: gables and knee walls on the roof-level floor are room-in-roof elements. A wall
    // across the ridge is a gable; a wall along it is a knee wall (derived from the model).
    let (gables, knees): (Vec<&El>, Vec<&El>) = walls
        .iter()
        .partition(|w| cross(unit(sub(w.pts[1], w.pts[0])), u).abs() < 0.5);
    let along = |points: &mut dyn Iterator<Item = P>, axis: P| {
        let values: Vec<f64> = points.map(|p| dot(p, axis)).collect();
        values.iter().copied().fold(f64::MIN, f64::max)
            - values.iter().copied().fold(f64::MAX, f64::min)
    };
    // Derived from the model: floor-space width across the ridge and length along it.
    let width = along(&mut walls.iter().flat_map(|w| w.pts.clone()), u);
    let length = along(&mut walls.iter().flat_map(|w| w.pts.clone()), v);
    let full_width = along(&mut top_ring.iter().copied(), u);
    let Some(max_height) = gables
        .iter()
        .filter_map(|g| g.top_height())
        .reduce(f64::max)
    else {
        ctx.errors.push(error(
            main.path(),
            "The room in the roof has no gable wall, so its height is not known. Draw its gables."
                .into(),
        ));
        return None;
    };
    // DESNZ-defined: the mean knee wall height, zero with no knee walls.
    let knee_height = if knees.is_empty() {
        0.0
    } else {
        knees.iter().filter_map(|k| k.num("height")).sum::<f64>() / knees.len() as f64
    };
    let room_wall = |ctx: &mut Ctx, w: &El, placed: &mut BTreeSet<String>| -> Value {
        let kind = wall_kind(w).unwrap_or(Kind::External);
        let construction_type = match kind {
            Kind::External => "external_wall",
            Kind::Party => "party_wall",
            Kind::Sheltered => "sheltered_wall",
        };
        let key = ctx.construction(construction_type, &[w], &[]);
        let mut value = json!({"wall_type": kind.wall_type(), "construction": key});
        if kind == Kind::Sheltered {
            // Derived from the model: behind a roof room's sheltered wall is the roof void.
            value["adjacent_space_type"] = json!("roof void");
        }
        let lights: Vec<Value> = windows
            .iter()
            .filter(|x| x.host() == Some(w.name))
            .filter_map(|x| {
                placed.insert(x.name.to_string());
                window(ctx, x, kind == Kind::External)
            })
            .collect();
        if kind == Kind::External || !lights.is_empty() {
            value["windows"] = Value::Array(lights);
            value["doors"] = json!([]);
        }
        value
    };
    let left = [-u[1], u[0]];
    let gable = |toward: P| {
        gables
            .iter()
            .copied()
            .filter(|g| dot(sub(g.plan_mid(), room_centre), toward) > 0.0)
            .max_by(|a, b| a.length().total_cmp(&b.length()))
    };
    let (Some(left_gable), Some(right_gable)) = (gable(left), gable(scale(left, -1.0))) else {
        ctx.errors.push(error(
            main.path(),
            "The room in the roof needs a gable wall at each end of the ridge. Draw both gables."
                .into(),
        ));
        return None;
    };
    let mut roof = Map::new();
    roof.insert("roof_type".into(), json!("Room In Roof"));
    let both_sides = heated.iter().any(|p| side(centroid(&p.pts)) < 0.0)
        && heated.iter().any(|p| side(centroid(&p.pts)) >= 0.0);
    roof.insert(
        "pitch_type".into(),
        json!(if both_sides { "dual" } else { "mono" }),
    );
    roof.insert("slope_orientation".into(), json!(slope_orientation));
    roof.insert("width".into(), json!(width));
    roof.insert("length".into(), json!(length));
    roof.insert("full_width".into(), json!(full_width.max(width)));
    roof.insert("maximum_ceiling_height".into(), json!(max_height));
    roof.insert("average_knee_wall_height".into(), json!(knee_height));
    roof.insert("left_gable_wall".into(), room_wall(ctx, left_gable, placed));
    roof.insert(
        "right_gable_wall".into(),
        room_wall(ctx, right_gable, placed),
    );
    for knee in &knees {
        let key = if side(knee.plan_mid()) >= 0.0 {
            "front_knee_wall"
        } else {
            "back_wall"
        };
        if roof.contains_key(key) {
            ctx.errors.push(error(knee.path(), format!("The room in the roof has more than one knee wall on one side ('{}'). HEMIE takes one per side; draw it as one wall.", knee.name)));
            return None;
        }
        roof.insert(key.into(), room_wall(ctx, knee, placed));
    }
    let key = ctx.construction("heated_pitched_roof", &heated, &[]);
    roof.insert("heated_pitched_roof_construction".into(), json!(key));
    if !unheated.is_empty() {
        let key = ctx.construction("unheated_pitched_roof", &unheated, &[]);
        roof.insert("unheated_pitched_roof_construction".into(), json!(key));
    }
    for (slope_side, in_slope) in [
        ("in_slope_orientation", true),
        ("opposite_slope_orientation", false),
    ] {
        let hosts: Vec<&El> = heated
            .iter()
            .copied()
            .filter(|p| (side(centroid(&p.pts)) >= 0.0) == in_slope)
            .collect();
        let lights = roof_windows(ctx, windows, &hosts, placed);
        roof.insert(format!("windows_{slope_side}"), Value::Array(lights));
        let mut dormer_values = Vec::new();
        for anchor in dormers.iter().filter(|d| {
            d.bundle()
                .and_then(|b| b.get("role"))
                .and_then(Value::as_str)
                == Some("front-wall-anchor")
        }) {
            let bundle = anchor.bundle().expect("bundle");
            let Some(host) = hosts
                .iter()
                .find(|h| bundle.get("host_element_name").and_then(Value::as_str) == Some(h.name))
            else {
                continue;
            };
            if let Some(d) = dormer(ctx, anchor, bundle, host, windows, placed) {
                dormer_values.push(d);
            }
        }
        roof.insert(format!("dormers_{slope_side}"), Value::Array(dormer_values));
    }
    Some(Value::Object(roof))
}

/// A dormer bundle as a HEMIE dormer (derived from the bundle's own parameters).
fn dormer<'e>(
    ctx: &mut Ctx,
    anchor: &El,
    bundle: &Value,
    host: &El,
    windows: &[&'e El<'e>],
    placed: &mut BTreeSet<String>,
) -> Option<Value> {
    let parameters = &bundle["parameters"];
    let (pitch_type, pitch) = match parameters["dormerType"].as_str() {
        Some("mono-pitch") => ("mono", parameters["dormerRoofPitch"].as_f64()),
        // Derived from the model: a gable-fronted dormer has two slopes either side of a ridge.
        Some("gable-front") => ("dual", parameters["gableRoofPitch"].as_f64()),
        // ours (interim): HEMIE has no hipped dormer, so a hip dormer is dual pitch.
        Some("hip") => ("dual", parameters["gableRoofPitch"].as_f64()),
        other => {
            ctx.errors.push(error(
                anchor.path(),
                format!(
                    "Dormer '{}' has type {other:?}, which the converter does not map.",
                    anchor.name
                ),
            ));
            return None;
        }
    };
    let front_name = bundle["window_name"].as_str();
    let Some(front) = windows.iter().find(|w| Some(w.name) == front_name) else {
        ctx.errors.push(error(
            anchor.path(),
            format!(
                "Dormer '{}' has no front window. HEMIE requires one.",
                anchor.name
            ),
        ));
        return None;
    };
    placed.insert(front.name.to_string());
    let front_window = window(ctx, front, true)?;
    let key = ctx.construction("external_wall", &[anchor], &[]);
    // Derived from the model: HEMIE's dormer face is its rectangle; the gable above it comes from the roof.
    let height = parameters["frontWallHeight"]
        .as_f64()
        .or_else(|| anchor.num("height"));
    let base = (anchor.num("base_height").unwrap_or(0.0) - host.num("base_height").unwrap_or(0.0))
        .max(0.0);
    Some(
        json!({"dormer_width": anchor.num("width"), "dormer_height": height, "dormer_base_height": base,
        "wall_construction": key, "roof_pitch_type": pitch_type, "roof_pitch": pitch, "front_window": front_window}),
    )
}

fn window_vents<'r>(csv: &'r Rows, window: &'r str) -> impl Iterator<Item = &'r Row> {
    csv.get("Ventilation Systems")
        .into_iter()
        .flatten()
        .filter(move |row| row.get("parent_element").and_then(Value::as_str) == Some(window))
}

/// Background vents become passive vents in the wall they sit in (derived from the model); a
/// vent drawn in a window goes with that window.
fn passive_vents(ctx: &mut Ctx, csv: &Rows, walls: &mut [HemieWall]) {
    let windows: BTreeSet<&str> = elements(csv)
        .iter()
        .filter(|e| e.ty == "BuildingElementTransparent")
        .map(|e| e.name)
        .collect();
    for row in csv.get("Ventilation Systems").into_iter().flatten() {
        if row
            .get("parent_element")
            .and_then(Value::as_str)
            .is_some_and(|host| windows.contains(host))
        {
            continue;
        }
        let name = row.get("Name").and_then(Value::as_str).unwrap_or_default();
        let path = json_pointer(&["InfiltrationVentilation", name]);
        match row.get("Type").and_then(Value::as_str) {
            Some("Vents") => {
                let (pts, level) = parse_coords(row);
                let area = row.get("area_cm2").and_then(Value::as_f64);
                let host = pts.first().and_then(|p| {
                    walls
                        .iter_mut()
                        .filter(|w| w.storey as i64 == level && seg_dist(*p, w.a, w.b) <= TOL)
                        .min_by(|x, y| seg_dist(*p, x.a, x.b).total_cmp(&seg_dist(*p, y.a, y.b)))
                });
                match (host, area) {
                    (Some(w), Some(area)) => {
                        let list = w.value.entry("passive_vents").or_insert_with(|| json!([]));
                        list.as_array_mut().expect("array").push(json!({"area": area}));
                    }
                    _ => ctx.errors.push(error(path, format!("Vent '{name}' is not on a storey wall or has no area. HEMIE places each passive vent in a wall."))),
                }
            }
            other => ctx.errors.push(error(path, format!("Ventilation '{name}' ({}) is not converted for an existing-building EPC yet. Remove it to run this model.", other.unwrap_or("no type")))),
        }
    }
}

/// The HEMIE InfiltrationVentilation Geometry needs: the model's ventilation inputs, and its air
/// test or, without one, the leakage-estimate inputs from the settings.
fn infiltration(ctx: &mut Ctx, full: &Value) -> Option<Value> {
    let mut iv = Map::new();
    iv.insert("model_type".into(), json!("hemie"));
    // Derived from the model (Metadata or the target defaults, reported by the full input).
    for key in [
        "cross_vent_possible",
        "shield_class",
        "terrain_class",
        "altitude",
        "noise_nuisance",
    ] {
        if let Some(v) = full.get(key).filter(|v| !v.is_null()) {
            iv.insert(key.into(), v.clone());
        }
    }
    let leaks = &full["Leaks"];
    let mut out = Map::new();
    if let Some(result) = leaks.get("test_result").filter(|v| !v.is_null()) {
        // Derived from the model: the measured air test.
        out.insert("test_result".into(), result.clone());
        out.insert("test_pressure".into(), leaks["test_pressure"].clone());
    } else {
        let field = format!("{SETTING}infiltration_properties");
        match ctx.settings.raw(&field).and_then(|v| {
            v.as_str()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .or_else(|| v.is_object().then(|| v.clone()))
        }) {
            Some(properties) => {
                out.insert("infiltration_properties".into(), properties);
            }
            None => {
                ctx.settings.missing.insert(format!("{field} (no air test: a JSON object with number_of_open_fireplaces and the other leakage-estimate inputs)"));
            }
        }
    }
    // Derived from the model: the envelope area and zone height the air test refers to. The
    // schema requires them although HEMIE Geometry can give them (open question).
    for key in ["env_area", "ventilation_zone_height"] {
        match leaks.get(key).filter(|v| !v.is_null()) {
            Some(v) => {
                out.insert(key.into(), v.clone());
            }
            None => {
                ctx.errors.push(error(format!("/InfiltrationVentilation/Leaks/{key}"), format!("The model states no air-test {key}, which the existing-building input requires. State it in the Metadata section.")));
            }
        }
    }
    iv.insert("Leaks".into(), Value::Object(out));
    Some(Value::Object(iv))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json";
    const SETTINGS: &str = r#"IsExistingBuilding,TRUE
HEMIE_age_band,D
HEMIE_region,England
HEMIE_construction_external_wall,"{""wall_construction_type"":""cavity""}""#;

    fn wall(name: &str, level: i64, a: P, b: P, height: f64) -> String {
        format!(
            "{name},Z,BuildingElementOpaque,1,90,1,{height},0,0,FALSE,FALSE,,\"{},{},{level}|{},{},{level}\",",
            a[0], a[1], b[0], b[1]
        )
    }

    fn plane(
        name: &str,
        level: i64,
        pts: &[P],
        pitch: f64,
        orientation: f64,
        unheated: bool,
    ) -> String {
        let coords: Vec<String> = pts
            .iter()
            .map(|p| format!("{},{},{level}", p[0], p[1]))
            .collect();
        let flag = if unheated { "TRUE" } else { "FALSE" };
        format!(
            "{name},Z,BuildingElementOpaque,10,{pitch},1,1,{orientation},5.6,{flag},FALSE,,\"{}\",",
            coords.join("|")
        )
    }

    /// The walls of a box from `corners`, one per edge, on each listed floor.
    fn box_walls(corners: &[P], levels: &[i64]) -> Vec<String> {
        levels
            .iter()
            .flat_map(|&level| {
                (0..corners.len()).map(move |i| {
                    wall(
                        &format!("W{level}{i}"),
                        level,
                        corners[i],
                        corners[(i + 1) % corners.len()],
                        2.8,
                    )
                })
            })
            .collect()
    }

    const BOX: [P; 4] = [[0.0, 0.0], [8.0, 0.0], [8.0, 6.0], [0.0, 6.0]];

    fn ground(corners: &[P]) -> String {
        let coords: Vec<String> = corners
            .iter()
            .map(|p| format!("{},{},0", p[0], p[1]))
            .collect();
        format!("Ground Elements\nName,Zone,Type,area,floor_type,coords\nFloor,Z,BuildingElementGround,48,Slab_no_edge_insulation,\"{}\"", coords.join("|"))
    }

    fn gable_roof() -> Vec<String> {
        vec![
            plane(
                "Roof S",
                2,
                &[[0.0, 0.0], [8.0, 0.0], [8.0, 3.0], [0.0, 3.0]],
                40.0,
                180.0,
                true,
            ),
            plane(
                "Roof N",
                2,
                &[[0.0, 3.0], [8.0, 3.0], [8.0, 6.0], [0.0, 6.0]],
                40.0,
                0.0,
                true,
            ),
        ]
    }

    fn csv(settings: &str, exposed: &[String], extra: &str) -> String {
        format!(
            "Metadata,,\n{settings}\n\nZone,,\nName,Type\nZ,Zone\n\nExposed Elements\n{HEADER}\n{}\n\n{extra}\n",
            exposed.join("\n")
        )
    }

    fn run(text: &str) -> (Value, Vec<ValidationError>, Vec<SchemaOmission>) {
        let rows = crate::parser::CSVParser::new()
            .parse_csv(text)
            .expect("csv");
        let mut model = json!({
            "Zone": {"Z": {"livingroom_area": 20.0, "restofdwelling_area": 76.0}},
            "General": {"build_type": "detached"},
            "NumberOfHabitableRooms": 3,
            "InfiltrationVentilation": {"cross_vent_possible": false, "terrain_class": "Suburban", "altitude": 0, "ventilation_zone_base_height": 0,
                "Leaks": {"test_pressure": "Standard", "test_result": 5, "env_area": 200, "ventilation_zone_height": 5.6}}
        });
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        map_existing_building(&mut model, &rows, &json!({}), &mut errors, &mut notices);
        (model, errors, notices)
    }

    fn house(exposed_extra: Vec<String>) -> String {
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed.extend(exposed_extra);
        csv(SETTINGS, &exposed, &ground(&BOX))
    }

    #[test]
    fn a_two_storey_box_is_one_part_with_anticlockwise_storeys() {
        let (model, errors, _) = run(&house(gable_roof()));
        assert!(errors.is_empty(), "{errors:#?}");
        let main = &model["Zone"]["building_parts"]["Main"];
        assert_eq!(
            model["Zone"]["building_parts"].as_object().unwrap().len(),
            1
        );
        assert_eq!(
            main["storeys"][0]["floorplan"],
            "LINEARRING (0 0, 8 0, 8 6, 0 6, 0 0)"
        );
        // The first edge faces south.
        assert_eq!(model["Zone"]["reference_orientation"], 180.0);
        // The storey gap is left out below a storey, not at the top.
        assert!((main["storeys"][0]["ceiling_height"].as_f64().unwrap() - 2.55).abs() < 1e-9);
        assert_eq!(main["storeys"][1]["ceiling_height"], 2.8);
        assert_eq!(main["walls"].as_array().unwrap().len(), 8);
        assert_eq!(main["roof"]["pitch_type"], "dual");
        assert_eq!(main["floor"]["total_area"], 48.0);
        assert_eq!(model["InfiltrationVentilation"]["Leaks"]["test_result"], 5);
    }

    #[test]
    fn walls_drawn_clockwise_still_give_an_anticlockwise_ring() {
        let corners: Vec<P> = BOX.iter().rev().copied().collect();
        let walls = box_walls(&corners, &[0]);
        let rows = crate::parser::CSVParser::new()
            .parse_csv(&csv(SETTINGS, &walls, ""))
            .unwrap();
        let els = elements(&rows);
        let refs: Vec<&El> = els.iter().collect();
        let ring = ring_of_walls(&refs).unwrap();
        assert!(signed_area(&ring) > 0.0);
        // An open outline names the walls at its open ends.
        let open = ring_of_walls(&refs[..3]).unwrap_err();
        assert!(open.contains("'W00'") && open.contains("'W02'"), "{open}");
    }

    #[test]
    fn a_floor_drawn_beside_the_floor_below_stops_and_is_named() {
        let mut exposed = box_walls(&BOX, &[0]);
        let beside: Vec<P> = BOX.iter().map(|p| [p[0] + 20.0, p[1]]).collect();
        exposed.extend(box_walls(&beside, &[1]));
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0]
                .message
                .contains("Floor 1 is drawn beside floor 0"),
            "{}",
            errors[0].message
        );
        assert!(errors[0].path.ends_with("/W10"));
    }

    #[test]
    fn a_lower_storey_larger_than_the_one_above_is_its_own_part() {
        // An L-shaped ground floor under a box: the column split gives the box part with two
        // storeys and a one-storey extension sharing an edge with no wall.
        let l: [P; 6] = [
            [0.0, 0.0],
            [8.0, 0.0],
            [8.0, 9.0],
            [5.0, 9.0],
            [5.0, 6.0],
            [0.0, 6.0],
        ];
        let mut exposed = box_walls(&l, &[0]);
        exposed.extend(box_walls(&BOX, &[1]));
        exposed.extend(gable_roof());
        exposed.push(plane(
            "Flat",
            1,
            &[[5.0, 6.0], [8.0, 6.0], [8.0, 9.0], [5.0, 9.0]],
            0.0,
            0.0,
            false,
        ));
        let (model, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&l)));
        assert!(errors.is_empty(), "{errors:#?}");
        let parts = &model["Zone"]["building_parts"];
        assert_eq!(parts["Main"]["storeys"].as_array().unwrap().len(), 2);
        let extension = &parts["Extension 1"];
        assert_eq!(
            extension["storeys"][0]["floorplan"],
            "LINEARRING (8 9, 5 9, 5 6, 8 6, 8 9)"
        );
        // Three walls; the edge shared with the main part has none.
        assert_eq!(extension["walls"].as_array().unwrap().len(), 3);
        assert_eq!(extension["roof"]["roof_type"], "Unknown Flat");
        // The main part's ground storey keeps the vertex where the extension starts.
        let ring = parts["Main"]["storeys"][0]["floorplan"].as_str().unwrap();
        assert!(ring.contains("5 6"), "{ring}");
    }

    #[test]
    fn slope_orientation_comes_from_the_ring_not_the_plane() {
        // The planes' own orientations are 7 degrees off the drawing; the slope takes the ring's.
        let roof = vec![
            plane(
                "Roof S",
                2,
                &[[0.0, 0.0], [8.0, 0.0], [8.0, 3.0], [0.0, 3.0]],
                40.0,
                173.0,
                true,
            ),
            plane(
                "Roof N",
                2,
                &[[0.0, 3.0], [8.0, 3.0], [8.0, 6.0], [0.0, 6.0]],
                40.0,
                353.0,
                true,
            ),
        ];
        let (model, errors, _) = run(&house(roof));
        assert!(errors.is_empty(), "{errors:#?}");
        let slope = model["Zone"]["building_parts"]["Main"]["roof"]["slope_orientation"]
            .as_f64()
            .unwrap();
        assert!(slope == 180.0 || slope == 0.0, "{slope}");
    }

    #[test]
    fn a_hipped_roof_is_dual_pitch_with_a_notice() {
        let roof = vec![
            plane(
                "Hip S",
                2,
                &[[0.0, 0.0], [8.0, 0.0], [5.0, 3.0], [3.0, 3.0]],
                40.0,
                180.0,
                true,
            ),
            plane(
                "Hip E",
                2,
                &[[8.0, 0.0], [8.0, 6.0], [5.0, 3.0]],
                40.0,
                90.0,
                true,
            ),
            plane(
                "Hip N",
                2,
                &[[8.0, 6.0], [0.0, 6.0], [3.0, 3.0], [5.0, 3.0]],
                40.0,
                0.0,
                true,
            ),
            plane(
                "Hip W",
                2,
                &[[0.0, 6.0], [0.0, 0.0], [3.0, 3.0]],
                40.0,
                270.0,
                true,
            ),
        ];
        let (model, errors, notices) = run(&house(roof));
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(
            model["Zone"]["building_parts"]["Main"]["roof"]["pitch_type"],
            "dual"
        );
        assert!(notices
            .iter()
            .any(|n| n.message.contains("hipped (4 slopes)")));
    }

    #[test]
    fn a_vaulted_ceiling_fails_naming_the_roof() {
        let roof = vec![
            plane(
                "Vault S",
                2,
                &[[0.0, 0.0], [8.0, 0.0], [8.0, 3.0], [0.0, 3.0]],
                40.0,
                180.0,
                false,
            ),
            plane(
                "Vault N",
                2,
                &[[0.0, 3.0], [8.0, 3.0], [8.0, 6.0], [0.0, 6.0]],
                40.0,
                0.0,
                false,
            ),
        ];
        let (_, errors, _) = run(&house(roof));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(errors[0].message.contains("vaulted ceiling"));
        assert!(errors[0].path.ends_with("/Vault S"));
    }

    #[test]
    fn a_pitched_roof_over_a_non_rectangular_part_gets_a_notice() {
        let l: [P; 6] = [
            [0.0, 0.0],
            [8.0, 0.0],
            [8.0, 9.0],
            [5.0, 9.0],
            [5.0, 6.0],
            [0.0, 6.0],
        ];
        let mut exposed = box_walls(&l, &[0]);
        exposed.push(plane("Roof", 1, &l, 30.0, 180.0, true));
        let (_, errors, notices) = run(&csv(SETTINGS, &exposed, &ground(&l)));
        assert!(errors.is_empty(), "{errors:#?}");
        assert!(
            notices
                .iter()
                .any(|n| n.message.contains("is not rectangular")),
            "{notices:#?}"
        );
    }

    #[test]
    fn missing_settings_are_listed_in_one_error() {
        let text = house(gable_roof())
            .replace("HEMIE_age_band,D\n", "")
            .replace(
                r#"HEMIE_construction_external_wall,"{""wall_construction_type"":""cavity""}""#,
                "",
            );
        let (_, errors, _) = run(&text);
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert_eq!(errors[0].path, "/Metadata");
        assert!(errors[0].message.contains("HEMIE_age_band"));
        assert!(errors[0]
            .message
            .contains("HEMIE_construction_external_wall with wall_construction_type"));
    }

    #[test]
    fn element_values_overlay_the_construction_setting() {
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed[0] = exposed[0].replace("\",", "\",\"{\"\"u_value\"\":0.45}\"");
        exposed.push(
            "PW,Z,BuildingElementPartyWall,1,90,1,2.8,0,0,FALSE,FALSE,,\"8,0,0|8,6,0\",\"{\"\"party_wall_cavity_type\"\":\"\"unfilled_unsealed\"\",\"\"party_wall_lining_type\"\":\"\"wet_plaster\"\"}\"".into(),
        );
        exposed.retain(|w| !w.starts_with("W01,"));
        exposed.extend(gable_roof());
        let (model, errors, notices) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert!(errors.is_empty(), "{errors:#?}");
        let constructions = &model["Zone"]["constructions"];
        assert_eq!(
            constructions["external_wall"]["wall_construction_type"],
            "cavity"
        );
        assert_eq!(constructions["external_wall"]["u_value"], 0.45);
        assert!(constructions["external_wall 2"].get("u_value").is_none());
        assert_eq!(
            constructions["party_wall"],
            json!({"construction_type": "party_wall", "party_wall_type": "unfilled_cavity", "cavity_seal_type": "unsealed", "party_wall_lining_type": "wet_plaster"})
        );
        assert!(notices.iter().any(|n| n.message.contains("W00 (U 0.45)")));
    }

    #[test]
    fn min_rectangle_and_edge_orientation_follow_hemie() {
        // A box turned 30 degrees: the rectangle's edges keep the ring's bearings.
        let (s, c) = 30f64.to_radians().sin_cos();
        let ring: Vec<P> = BOX
            .iter()
            .map(|p| [p[0] * c - p[1] * s, p[0] * s + p[1] * c])
            .collect();
        let rect = min_rectangle(&ring);
        assert!((signed_area(&rect) - 48.0).abs() < 1e-9);
        let reference = sub(ring[1], ring[0]);
        let reference_orientation = outward_bearing(ring[0], ring[1]);
        for i in 0..4 {
            let edge = sub(ring[(i + 1) % 4], ring[i]);
            let expected = outward_bearing(ring[i], ring[(i + 1) % 4]);
            assert!(
                bearing_gap(
                    edge_orientation(reference_orientation, reference, edge),
                    expected
                ) < 1e-9
            );
        }
    }
}
