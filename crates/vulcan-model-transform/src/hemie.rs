// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEM:EPC existing-building input. When the model states `IsExistingBuilding`, its zone becomes
//! a HEMIE Geometry input and `InfiltrationVentilation` the HEMIE input that Geometry needs, both
//! derived from the drawn model. Each interpretation rule states its source in one comment:
//! "DESNZ-defined" (the HEM:EPC method), "derived from the model" (measured from the drawing or
//! read from the element), or "ours" (a Vulcan choice awaiting confirmation). A shape or value
//! the converter cannot express fails and names the element; nothing is approximated silently.
//!
//! EPC model settings are Metadata rows: `HEMIE_age_band`, and per HEMIE
//! construction type `HEMIE_construction_<construction_type>`, a JSON object of that
//! construction's fields (for example `{"wall_construction_type":"cavity"}`). A value on the
//! element wins over the setting, and an element may state its own `age_band`. A door marked
//! `is_front_door` is the front door. The region comes from the model's postcode.

use crate::finalization::SchemaOmission;
use crate::target_mappings::TARGET_INPUT_WARNING;
use crate::{json_pointer, ValidationError};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

#[path = "hemie_parts.rs"]
mod parts;
#[path = "hemie_shading.rs"]
mod shading;
pub use shading::{HemieQuadrant, HemieShading};
#[path = "hemie_bundles.rs"]
mod bundles;

type Row = BTreeMap<String, Value>;
type Rows = BTreeMap<String, Vec<Row>>;
type P = [f64; 2];

/// ours: plan tolerance (m) for joining wall ends, matching walls to outline edges and stacking
/// one floor's outline on the floor below.
const TOL: f64 = 0.1;
/// DESNZ-defined: the height between storeys, and between a storey and a roof room, that is in
/// no storey's ceiling height (m).
const STOREY_GAP: f64 = 0.25;
/// DESNZ-defined: a room in the roof's common walls are under this height (m) for at least half
/// their length; otherwise the floor is a storey.
const COMMON_WALL_HEIGHT: f64 = 1.8;
/// ours: how far a roof plane may overhang the building part it covers (m).
const EAVES: f64 = 0.6;
/// DESNZ-defined: heated pitched roof areal heat capacity when the element states none (J/m².K).
const HEATED_PITCHED_ROOF_HEAT_CAPACITY: f64 = 50_000.0;
/// ours: HEMIE reads a window's areal heat capacity only for windows in party or sheltered
/// walls; a window elsewhere carries this placeholder unless the glazing setting states one.
const UNUSED_WINDOW_HEAT_CAPACITY: f64 = 0.0;
const SETTING: &str = "HEMIE_";
/// Metadata rows older saved files carry that the converter no longer reads, with the fix.
const RETIRED_SETTINGS: [(&str, &str); 3] = [
    ("HEMIE_region", "The region comes from the postcode. Remove the row. For a postcode area that spans two nations, choose the Nation under the Postcode in Dwelling Details."),
    ("HEMIE_front_door", "Remove the row and mark the front door on the door itself."),
    ("HEMIE_infiltration_properties", "An existing building needs an air test. Remove the row and enter the air test result in Global Settings."),
];
/// Construction fields an element may state for itself, over the model's construction setting
/// (derived from the model).
const ELEMENT_OVERRIDE_KEYS: [&str; 5] = [
    "wall_construction_type",
    "glazing_type",
    "frame_material",
    "glazing_gap",
    "insulation_location",
];
/// Fields only this converter reads from an element row; no HEM input takes them, so the
/// full-input build leaves them out of the HEM element.
pub(crate) const ELEMENT_ONLY_KEYS: [&str; 8] = [
    "age_band",
    "is_front_door",
    "wall_construction_type",
    "glazing_type",
    "frame_material",
    "glazing_gap",
    "insulation_location",
    "construction_weight",
];

#[path = "hemie_systems.rs"]
mod systems;

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
            "The walls {} do not join end to end into one closed outline (ends more than {TOL} m apart). Join the wall ends so each corner has exactly two walls.",
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
    // Outlines that touch no other are separate building parts, unless one lies inside
    // another's: the part around it would have a hole, which a HEMIE floorplan cannot.
    for (i, outer) in found.iter().enumerate() {
        if found
            .iter()
            .enumerate()
            .any(|(j, face)| i != j && inside(interior_point(face), outer))
        {
            return Err("A floor's outline lies inside another floor's outline without touching it, so the building part around it would have a hole.".into());
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
    fn length(&self) -> f64 {
        dist(self.pts[0], self.pts[1])
    }
    fn plan_mid(&self) -> P {
        centroid(&self.pts)
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
    /// Model settings the conversion needs that the model does not state: each row, with the
    /// fields it lacks (none: the row itself is absent or unreadable).
    missing: BTreeMap<String, BTreeSet<String>>,
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
                self.missing.entry(field).or_default().insert(what.into());
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
            self.missing.entry(field).or_default();
            Map::new()
        })
    }
}

#[derive(Default)]
struct Constructions {
    by_name: Map<String, Value>,
    documented: BTreeSet<String>,
    /// Windows that state their own g-value or frame area fraction.
    stated_glazing: BTreeSet<String>,
    /// Party walls that state no cavity type: HEMIE takes it from the age band (DESNZ-defined).
    party_walls_by_age_band: BTreeSet<String>,
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
    /// A number the element must state; a missing one is an error naming the element and field.
    fn need(&mut self, e: &El, key: &str) -> Option<f64> {
        let value = e.num(key);
        let missing = error(
            e.path(),
            format!(
                "'{}' does not state its {key}, which the existing-building converter needs.",
                e.name
            ),
        );
        // Once per element and field, though a wall can be several outline edges.
        if value.is_none()
            && !self
                .errors
                .iter()
                .any(|x| x.path == missing.path && x.message == missing.message)
        {
            self.errors.push(missing);
        }
        value
    }

    /// A wall's height to its eaves: the lowest point of a profiled top, else its height.
    /// Derived from the model: the exported height of a profiled wall is its mean height, and
    /// the gable above the eaves is not part of the storey.
    fn eaves(&mut self, e: &El) -> Option<f64> {
        let height = self.need(e, "height")?;
        let profile_low = e
            .get("geometry_face")
            .and_then(|face| face.get("top_profile"))
            .and_then(Value::as_array)
            .and_then(|points| {
                points
                    .iter()
                    .filter_map(|p| p.get("h")?.as_f64())
                    .reduce(f64::min)
            });
        Some(profile_low.unwrap_or(height))
    }

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
        for key in ELEMENT_OVERRIDE_KEYS {
            if let Some(value) = self.agreed(elements, key) {
                c.insert(key.into(), value.clone());
            }
        }
        // Every construction this builds takes a mass distribution class (HEMIE's own default
        // otherwise); only those with an outside surface take a colour or solar absorption, and
        // HEMIE rejects a field its construction type does not take.
        if let Some(class) = self.agreed(elements, "mass_distribution_class") {
            match class
                .as_str()
                .and_then(crate::builder::coerce_mass_distribution_class_for_fhs)
            {
                Some(full) => {
                    c.insert("mass_distribution_class".into(), json!(full));
                }
                None => self.errors.push(error(
                    first.path(),
                    format!(
                        "'{}' has mass distribution class {class}. Use I, E, IE, D or M.",
                        first.name
                    ),
                )),
            }
        }
        if takes_outside_surface(construction_type) {
            match self.agreed(elements, "colour") {
                Some(colour)
                    if ["Light", "Intermediate", "Dark"]
                        .contains(&colour.as_str().unwrap_or_default()) =>
                {
                    c.insert("colour".into(), colour.clone());
                }
                Some(colour) => self.errors.push(error(
                    first.path(),
                    format!(
                        "'{}' has colour {colour}. Use Light, Intermediate or Dark.",
                        first.name
                    ),
                )),
                None => {}
            }
            if let Some(coeff) = self.agreed(elements, "solar_absorption_coeff") {
                c.insert("solar_absorption_coefficient".into(), coeff.clone());
            }
        }
        let u_values: BTreeSet<String> = elements
            .iter()
            .filter_map(|e| e.num("u_value"))
            .map(|u| u.to_string())
            .collect();
        if construction_type == "party_wall" {
            // DESNZ-defined: a party wall's resistance is fixed; only its cavity and lining count.
        } else if u_values.len() > 1 {
            self.errors.push(error(first.path(), format!("The existing-building EPC gives {} one construction, but their U-values differ ({}). Give them one U-value, or draw them as separate elements.", quoted(&elements.iter().map(|e| e.name).collect::<Vec<_>>()), u_values.into_iter().collect::<Vec<_>>().join(", "))));
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
                t if t.ends_with("_roof") => 5.0,
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
            // DESNZ-defined: HEMIE takes the g-value and frame area fraction from the glazing
            // type and frame material unless the window states its own.
            let mut stated = Vec::new();
            for (key, label) in [
                ("g_value", "g-value"),
                ("frame_area_fraction", "frame area fraction"),
            ] {
                if let Some(v) = first.num(key) {
                    c.insert(key.into(), json!(v));
                    stated.push(format!("{label} {v}"));
                }
            }
            if !stated.is_empty() {
                self.constructions.stated_glazing.insert(format!(
                    "{} ({})",
                    first.name,
                    stated.join(", ")
                ));
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
                            self.errors.push(error(first.path(), format!("Party wall '{}' has cavity type '{other}', which the existing-building EPC does not take. Use solid, or a filled or unfilled cavity that is sealed or unsealed.", first.name)));
                            ("", "")
                        }
                    };
                    if !filled.is_empty() {
                        c.insert("party_wall_type".into(), json!(filled));
                        c.insert("cavity_seal_type".into(), json!(seal));
                    }
                }
                None => {
                    self.constructions
                        .party_walls_by_age_band
                        .insert(first.name.to_string());
                }
            }
            if let Some(lining) = first.text("party_wall_lining_type") {
                c.insert("party_wall_lining_type".into(), json!(lining));
            }
        }
        if let Some(capacity) = self.heat_capacity(elements) {
            c.insert("areal_heat_capacity".into(), json!(capacity));
        }
        for (key, value) in extra {
            c.entry(*key).or_insert_with(|| value.clone());
        }
        let stated = |key: &str| c.get(key).is_some_and(|v| !v.is_null());
        let names = quoted(&elements.iter().map(|e| e.name).collect::<Vec<_>>());
        let verb = if elements.len() > 1 {
            "state"
        } else {
            "states"
        };
        let mini = matches!(construction_type, "mini_flat_roof" | "mini_pitched_roof");
        if mini && !stated("u_value") && !stated("insulation_thickness") {
            // DESNZ-defined (HEMIE): a bay roof with no insulation thickness has no insulation,
            // whatever its location.
            self.notices.push(notice(&first.path(), format!("Bay roof {names} {verb} no insulation thickness, so the existing-building EPC models no insulation. If it is insulated, give the thickness and the location.")));
        } else if (mini || matches!(construction_type, "flat_roof" | "unheated_pitched_roof"))
            && !stated("insulation_location")
            && !stated("u_value")
        {
            // DESNZ-defined (HEMIE): a roof with no insulation location has no insulation, and
            // a stated thickness is then not used; `unknown` takes the age-band thickness.
            if stated("insulation_thickness") {
                self.errors.push(error(first.path(), format!("{names} {verb} an insulation thickness but no insulation location, so the thickness would not be used. Give the insulation location, or 'unknown' if it is not known.")));
            } else {
                self.notices.push(notice(&first.path(), format!("{names} {verb} no insulation location, so the existing-building EPC models no roof insulation. If the roof is insulated, give the location, or 'unknown' to take the age-band thickness.")));
            }
        }
        self.require(construction_type, &mut c);
        self.constructions.add(c)
    }

    /// The value the elements state for a field, alike on each; HEMIE gives the group one
    /// value, so elements that differ (or that state it and leave it to the model) fail.
    fn agreed<'e>(&mut self, elements: &[&El<'e>], key: &str) -> Option<&'e Value> {
        let values: BTreeSet<String> = elements
            .iter()
            .map(|e| e.get(key).map_or("the model's".into(), Value::to_string))
            .collect();
        if values.len() > 1 {
            let field = key.replace('_', " ");
            self.errors.push(error(elements[0].path(), format!("The existing-building EPC gives {} one {field}, but they state different values ({}). Give them one {field}, or draw them as separate elements.", quoted(&elements.iter().map(|e| e.name).collect::<Vec<_>>()), values.into_iter().collect::<Vec<_>>().join(", "))));
        }
        elements[0].get(key)
    }

    /// The elements' areal heat capacity, alike on each (see `agreed`): a number in J/m2.K, or
    /// a band at HEM:EPC's band values (DESNZ-defined). Anything else fails, naming the element.
    fn heat_capacity(&mut self, elements: &[&El]) -> Option<f64> {
        let value = self.agreed(elements, "areal_heat_capacity")?;
        let capacity = value.as_f64().or_else(|| match value.as_str()? {
            "Very light" => Some(240_000.0),
            "Light" => Some(450_000.0),
            "Medium" => Some(650_000.0),
            "Heavy" => Some(850_000.0),
            "Very heavy" => Some(1_350_000.0),
            _ => None,
        });
        if capacity.is_none() {
            self.errors.push(error(elements[0].path(), format!("'{}' has areal heat capacity {value}. Give a number in J/m²·K, or Very light, Light, Medium, Heavy or Very heavy.", elements[0].name)));
        }
        capacity
    }

    /// The value with the elements' own age band, which HEMIE takes over its building part's
    /// (derived from the model).
    fn with_age_band(&mut self, elements: &[&El], mut value: Value) -> Value {
        if let Some(band) = self.agreed(elements, "age_band") {
            value["age_band"] = band.clone();
        }
        value
    }

    /// Fields HEMIE needs that have no DESNZ default; each one missing is listed in the
    /// settings error.
    fn require(&mut self, construction_type: &str, c: &mut Map<String, Value>) {
        let has = |c: &Map<String, Value>, key: &str| c.get(key).is_some_and(|v| !v.is_null());
        let setting = format!("{SETTING}construction_{construction_type}");
        let mut need = |what: &str| {
            self.settings
                .missing
                .entry(setting.clone())
                .or_default()
                .insert(what.into());
        };
        match construction_type {
            // DESNZ-defined: a wall construction type is required when no layers are known.
            "external_wall" | "sheltered_wall"
                if !has(c, "wall_construction_type") && !has(c, "layers") =>
            {
                need("wall_construction_type")
            }
            "window" => {
                // DESNZ-defined, as HEMIE's window construction checks them: frame material and
                // glazing type without a documented U- and g-value, glazing gap without a
                // documented U-value unless the glazing is single.
                let documented = has(c, "u_value") && has(c, "g_value");
                if !documented && !has(c, "frame_material") {
                    need("frame_material");
                }
                if !documented && !has(c, "glazing_type") {
                    need("glazing_type");
                }
                if !has(c, "u_value")
                    && c.get("glazing_type").and_then(Value::as_str) != Some("single")
                    && !has(c, "glazing_gap")
                {
                    need("glazing_gap");
                }
                if !has(c, "areal_heat_capacity") {
                    need("areal_heat_capacity");
                }
            }
            "heated_pitched_roof" if !has(c, "areal_heat_capacity") => {
                c.insert(
                    "areal_heat_capacity".into(),
                    json!(HEATED_PITCHED_ROOF_HEAT_CAPACITY),
                );
            }
            // The pinned HEM:EPC schema requires a door's areal heat capacity (later HEMIE
            // releases default it; plan question E34), so the door setting states it.
            "external_door" | "party_or_sheltered_door" if !has(c, "areal_heat_capacity") => {
                need("areal_heat_capacity")
            }
            _ => {}
        }
    }
}

/// HEMIE construction types with an outside surface: they take a colour and a solar absorption
/// coefficient.
fn takes_outside_surface(construction_type: &str) -> bool {
    matches!(
        construction_type,
        "external_wall"
            | "park_home_wall"
            | "external_door"
            | "above_external_area_floor"
            | "park_home_floor"
    ) || construction_type.ends_with("_roof")
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
    /// The lowest and highest floors over this plan cell.
    bottom: usize,
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
                (Some(x), Some(y)) => std::ptr::eq(x, y),
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
) -> Option<shading::HemieShading> {
    let snapshot = model.clone();
    let mut ctx = Ctx {
        settings: Settings {
            csv,
            missing: BTreeMap::new(),
        },
        constructions: Constructions::default(),
        errors: Vec::new(),
        notices: Vec::new(),
        model: &snapshot,
    };
    systems::check_vents(&mut ctx);
    let converted = convert(&mut ctx, csv);
    for (row, fields) in &ctx.settings.missing {
        ctx.errors.push(error(
            format!("/Metadata/{row}"),
            missing_setting_message(row, fields),
        ));
    }
    notices.append(&mut ctx.notices);
    if !ctx.errors.is_empty() || converted.is_none() {
        errors.append(&mut ctx.errors);
        return None;
    }
    let (mut geometry, ventilation) = converted.expect("checked");
    systems::mechanical_ventilation(&snapshot, csv, schema, &mut geometry, errors, notices);
    let (segments, shading) = shading::distant(&ctx.settings, &geometry, errors, notices)?;
    model["ExternalConditions"]["shading_segments"] = segments;
    let documented: Vec<String> = std::mem::take(&mut ctx.constructions.documented)
        .into_iter()
        .collect();
    if !documented.is_empty() {
        notices.push(notice("/Zone/constructions", format!("These elements state their own U-value, so the existing-building EPC takes it as a documented U-value from the element: {}. Lodgement needs evidence for each.", documented.join(", "))));
    }
    let stated_glazing: Vec<String> = std::mem::take(&mut ctx.constructions.stated_glazing)
        .into_iter()
        .collect();
    if !stated_glazing.is_empty() {
        notices.push(notice("/Zone/constructions", format!("These windows state their own values, which the existing-building EPC uses in place of those for their glazing type and frame material: {}.", stated_glazing.join(", "))));
    }
    let by_age_band = std::mem::take(&mut ctx.constructions.party_walls_by_age_band);
    if !by_age_band.is_empty() {
        notices.push(notice(
            "/Zone/constructions",
            format!(
                "These party walls state no cavity type, so the existing-building EPC takes it from the age band: {}.",
                quoted(&by_age_band.iter().map(String::as_str).collect::<Vec<_>>())
            ),
        ));
    }
    notices.push(notice("/Zone", "The existing-building EPC takes its geometry from the storey outlines. It derives thermal bridges (from the age band), internal walls and floors and lighting itself, so the model's own are not used.".into()));
    model["Zone"] = geometry;
    model["InfiltrationVentilation"] = ventilation;
    // DESNZ-defined: with HEMIE Geometry, systems take their HEMIE form, which has no zone.
    systems::map_systems(model, schema, errors, notices);
    Some(shading)
}

fn convert(ctx: &mut Ctx, csv: &Rows) -> Option<(Value, Value)> {
    let els = elements(csv);
    let left_out = bundles::left_out(ctx, &els);
    let (hosts, pieces, conservatory_floors) = bundles::conservatory_hosts(ctx, &els);
    let els: Vec<El> = els
        .into_iter()
        .filter(|e| !left_out.contains(e.name))
        .collect();
    let model = ctx.model;
    let zone_name = model["Zone"]
        .as_object()
        .and_then(|zones| zones.keys().next().cloned())
        .unwrap_or_default();
    let zone = &model["Zone"][&zone_name];
    for (field, fix) in RETIRED_SETTINGS {
        if ctx.settings.raw(field).is_some() {
            ctx.errors.push(error(
                format!("/Metadata/{field}"),
                format!("{field} is no longer read. {fix}"),
            ));
        }
    }
    let age_band = ctx.settings.text("age_band", "A to M");
    let region = region(ctx);

    // Line walls and the elements HEMIE geometry cannot hold yet.
    let bays = bundles::bays(ctx, &els);
    let mut walls: Vec<(&El, Kind)> = pieces
        .iter()
        .map(|(p, _)| (p, wall_kind(p).expect("host wall")))
        .collect();
    for e in &els {
        if bundles::is_bay_wall(e) || hosts.contains(e.name) {
            continue;
        }
        if let Some(kind) = wall_kind(e) {
            if e.num("pitch").is_some_and(|p| (p - 90.0).abs() > 1e-6) {
                ctx.errors.push(error(e.path(), format!("'{}' is a leaning wall (pitch {}). The existing-building converter takes vertical walls only.", e.name, e.num("pitch").unwrap_or_default())));
            } else if e.text("parent_element").is_some() && bundles::tag(e).is_none() {
                ctx.errors.push(error(e.path(), format!("'{}' is a wall inside another element, which the existing-building converter does not take. Draw it as a wall of the storey outline.", e.name)));
            } else {
                walls.push((e, kind));
            }
        }
    }
    if walls.is_empty() {
        ctx.errors.push(error(
            "/Zone".into(),
            "The model has no wall lines, so it has no storey outline for the existing-building EPC.".into(),
        ));
        return None;
    }
    // A basement drawn as a floor: its walls are not storey walls; the floor above is storey 0.
    let Ok(basement) = parts::basement_storey(ctx, &els, &walls) else {
        return None;
    };
    let first = basement.as_ref().map_or(0, |b| b.level + 1);
    if let Some(b) = &basement {
        walls.retain(|(w, _)| w.level != b.level);
    }
    let planes: Vec<&El> = els.iter().filter(|e| is_plane(e)).collect();
    let heated =
        |p: &&El| p.num("pitch").is_some_and(|x| x > 0.0) && !p.flag("is_unheated_pitched_roof");
    let levels: BTreeSet<i64> = walls.iter().map(|(w, _)| w.level).collect();
    let top_level = *levels.iter().next_back().expect("walls");

    // Rule: a floor under heated slopes with gables is a room in the roof, not a storey; a gable
    // has a sloped top, a knee wall does not (derived from the model). With gables only, the
    // slopes run down to the floor: a room in the roof with knee height 0 (DESNZ-defined).
    // DESNZ-defined: where external walls continue up from the storey below (common walls),
    // the floor is a room in the roof only when under 1.8 m for at least half their length;
    // otherwise it is a storey, and heated slopes over it are a vaulted ceiling.
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
    let (mut common, mut low) = (0.0, 0.0);
    for (w, kind) in &walls {
        if w.level == top_level && *kind == Kind::External && !w.has_profile() {
            let h = ctx.need(w, "height")?;
            common += w.length();
            if h < COMMON_WALL_HEIGHT {
                low += w.length();
            }
        }
    }
    let roof_room = (heated_above && has_gables && low >= common / 2.0).then_some(top_level);
    let storey_levels: Vec<i64> = levels
        .iter()
        .copied()
        .filter(|l| Some(*l) != roof_room)
        .collect();
    if storey_levels
        .iter()
        .enumerate()
        .any(|(i, l)| *l != i as i64 + first)
    {
        ctx.errors.push(error("/Zone".into(), format!("The floors with walls are {storey_levels:?}. Existing-building storeys start at floor {first} and follow one another.")));
        return None;
    }
    let on_level = |level: i64| -> Vec<&El> {
        walls
            .iter()
            .filter(|(w, _)| w.level == level)
            .map(|(w, _)| *w)
            .collect()
    };

    // One outline per storey. Ours, following DESNZ's model: where a floor is not over the floor
    // below (overhanging or drawn beside it), that area is its own building part, with its own
    // base height and an exposed floor.
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
        }
        rings.push(ring);
    }
    let room_walls: Vec<&El> = roof_room.map(on_level).unwrap_or_default();
    if let (Some(level), Some(top)) = (roof_room, rings.last()) {
        if let Some(w) = room_walls
            .iter()
            .find(|w| !w.pts.iter().all(|p| inside_or_on(*p, top)))
        {
            ctx.errors.push(error(w.path(), format!("Floor {level} (the room in the roof) is not over floor {}: '{}' lies more than {TOL} m outside it. Move floor {level} over the floor below.", level - 1, w.name)));
            return None;
        }
    }

    if bundles::box_in_roof(
        ctx,
        &rings,
        &on_level(*storey_levels.last().expect("storeys")),
        &planes,
    ) {
        return None;
    }

    // Building parts: one per column of storeys, so each has one roof (ours; HEMIE also allows
    // parts stacked on one another, 0.25 m apart). Derived from the model: a conservatory is its
    // own building part, even on a bungalow.
    let arrangement: Vec<Vec<P>> = rings.iter().chain(&conservatory_floors).cloned().collect();
    let cells = match faces(&arrangement) {
        Ok(cells) => cells,
        Err(message) => {
            ctx.errors.push(error("/Zone".into(), message));
            return None;
        }
    };
    let mut parts: Vec<Part> = Vec::new();
    for poly in cells {
        let p = interior_point(&poly);
        match parts::column(p, &rings) {
            None => {} // a courtyard: inside no floor
            Some(Ok((bottom, top))) => parts.push(Part {
                poly,
                bottom,
                top,
                storeys: Vec::new(),
                ceilings: Vec::new(),
            }),
            Some(Err(gaps)) => {
                let above = *gaps.last().expect("a gap") as i64 + 1 + first;
                let missing: Vec<String> = gaps
                    .iter()
                    .map(|g| (*g as i64 + first).to_string())
                    .collect();
                ctx.errors.push(error(on_level(above)[0].path(), format!("Floor {above} is over a lower floor with no floor {} between them, around ({:.2}, {:.2}). A building part's storeys stack one on another; draw the missing floors there, or move the floor above.", missing.join(" or "), p[0], p[1])));
            }
        }
    }
    if parts.is_empty() {
        return None;
    }
    // ours: parts in order of storeys, then footprint. DESNZ-defined: the part with the front
    // door is the reference part, and its ground storey's footprint starts with the front-door
    // wall.
    parts.sort_by(|a, b| {
        b.top
            .cmp(&a.top)
            .then(signed_area(&b.poly).total_cmp(&signed_area(&a.poly)))
    });
    let doors: Vec<&El> = els
        .iter()
        .filter(|e| e.ty == "BuildingElementOpaque" && e.flag("is_external_door"))
        .collect();
    // A missing front door is an error, but the conversion continues so that one pass names
    // everything the model lacks.
    let front = front_door(ctx, &doors);
    let front_wall = front.and_then(|front| {
        let wall = walls
            .iter()
            .map(|(w, _)| *w)
            .find(|w| front.host() == Some(w.name) && w.level == first);
        if wall.is_none() {
            ctx.errors.push(error(front.path(), format!("Front door '{}' is not in a wall of floor {first}. The reference building part's ground storey starts with the front-door wall; link the door to its wall.", front.name)));
        }
        wall
    });
    // The reference part is on the lowest floor: its lowest storey holds the front door.
    if let Some(front) = front {
        let reference = (0..parts.len())
            .filter(|&i| parts[i].bottom == 0)
            .min_by(|&i, &j| {
                boundary_dist(front.plan_mid(), &parts[i].poly)
                    .total_cmp(&boundary_dist(front.plan_mid(), &parts[j].poly))
            })
            .expect("parts");
        let reference = parts.remove(reference);
        parts.insert(0, reference);
    }

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

    let conservatory = bundles::conservatories(ctx, &els, &parts, &names);

    // Storey outlines and their walls.
    let mut hemie_walls: Vec<HemieWall> = Vec::new();
    let mut used: BTreeSet<&str> = BTreeSet::new();
    let mut low: Vec<&El> = Vec::new();
    for pi in 0..parts.len() {
        let bottom = parts[pi].bottom;
        for s in bottom..=parts[pi].top {
            let level = s as i64 + first;
            let level_walls = on_level(level);
            let (mut ring, mut carried) =
                merge_edges(with_wall_ends(&parts[pi].poly, &level_walls), &level_walls);
            if let (0, true, Some(front), Some(front_wall)) = (pi, s == bottom, front, front_wall) {
                let m = front.plan_mid();
                let Some(first) = (0..ring.len())
                    .filter(|&i| carried[i].is_some_and(|w| w.name == front_wall.name))
                    .min_by(|&i, &j| {
                        seg_dist(m, ring[i], ring[(i + 1) % ring.len()]).total_cmp(&seg_dist(
                            m,
                            ring[j],
                            ring[(j + 1) % ring.len()],
                        ))
                    })
                else {
                    ctx.errors.push(error(front.path(), format!("Front door '{}' is not on the ground outline of its building part. Link it to an outside wall of floor 0.", front.name)));
                    return None;
                };
                ring.rotate_left(first);
                carried.rotate_left(first);
            }
            let mut lengths = 0.0;
            let mut height_sum = 0.0;
            let mut heights = BTreeSet::new();
            for (i, ((a, b), wall)) in edges(&ring).zip(&carried).enumerate() {
                match wall {
                    Some(w) => {
                        used.insert(w.name);
                        // A conservatory wall runs to its eaves; a gable above them is the
                        // roof's. Other walls keep their stated height.
                        let h = if bundles::tag(w).is_some() {
                            ctx.eaves(w)
                        } else {
                            ctx.need(w, "height")
                        };
                        let Some(h) = h else {
                            continue;
                        };
                        if h <= STOREY_GAP && !low.iter().any(|x: &&El| x.name == w.name) {
                            low.push(w);
                        }
                        lengths += dist(a, b);
                        height_sum += h * dist(a, b);
                        heights.insert(format!("{h}"));
                        let kind = wall_kind(w).expect("wall");
                        let mut value = Map::new();
                        value.insert("wall_type".into(), json!(kind.wall_type()));
                        value.insert("storey_index".into(), json!(s - bottom));
                        value.insert("floorplan_index".into(), json!(i));
                        hemie_walls.push(HemieWall {
                            part: pi,
                            storey: level as usize,
                            a,
                            b,
                            source: w,
                            value,
                        });
                    }
                    None => {
                        // An edge with no wall is shared with a part that has a storey there.
                        let shared = parts.iter().enumerate().any(|(pj, other)| {
                            pj != pi
                                && (other.bottom..=other.top).contains(&s)
                                && boundary_dist(mid(a, b), &other.poly) <= TOL
                        });
                        if !shared {
                            ctx.errors.push(error("/Zone".into(), format!("Floor {level} has no wall within {TOL} m of its outline between ({:.2}, {:.2}) and ({:.2}, {:.2}). Draw the wall there.", a[0], a[1], b[0], b[1])));
                        }
                    }
                }
            }
            if carried.iter().all(Option::is_none) {
                ctx.errors.push(error("/Zone".into(), format!("Building part '{}' has no walls on floor {level}: floor {} does not sit on the floor below. The existing-building EPC needs each storey stacked on the one below.", names[pi], level + 1)));
                continue;
            }
            if lengths == 0.0 {
                continue; // each wall's missing height is already an error
            }
            // ours: one ceiling height per storey, the length-weighted mean of its walls.
            let storey_height = height_sum / lengths;
            if heights.len() > 1 {
                ctx.notices.push(notice("/Zone", format!("The walls of floor {level} have heights {}. The existing-building EPC takes one ceiling height per storey of a building part, so it uses their length-weighted mean, {storey_height:.3} m.", heights.into_iter().collect::<Vec<_>>().join(", "))));
            }
            // DESNZ-defined: HEMIE puts the storey gap above every storey's ceiling, the top one
            // included (the roof sits a gap above it). Derived from the model: a Vulcan wall runs
            // from its floor to the next floor or to the roof, so the ceiling height is the wall
            // height less the gap on every storey.
            // DESNZ-defined: a conservatory has no separating ceiling, so its walls run to the
            // eaves (HEMIE conservatory roofs take no gap).
            let gap = if conservatory[pi] { 0.0 } else { STOREY_GAP };
            parts[pi]
                .ceilings
                .push(parts::round_ceiling(storey_height - gap));
            parts[pi].storeys.push(ring);
        }
    }
    for w in low {
        ctx.errors.push(error(w.path(), format!("'{}' has height {} m. The existing-building EPC takes a storey's ceiling height from its walls, which run from the floor to the floor or roof above; give the wall its height, more than the {STOREY_GAP} m storey gap.", w.name, w.num("height").unwrap_or_default())));
    }
    for (w, _) in &walls {
        if Some(w.level) != roof_room && !used.contains(w.name) {
            ctx.errors.push(error(w.path(), format!("'{}' is more than {TOL} m from the outline of floor {}. Existing-building walls are edges of the storey outline; delete it or join it to the outline.", w.name, w.level)));
        }
    }
    // Stop only where a part lacks a storey; other errors so far leave the parts whole, so the
    // floors and roofs are still checked and one pass names everything the model lacks.
    if parts
        .iter()
        .any(|p| p.storeys.len() != p.top - p.bottom + 1)
    {
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
    let mut placed: BTreeSet<String> = BTreeSet::new();
    for wi in 0..hemie_walls.len() {
        if conservatory[hemie_walls[wi].part] {
            continue;
        }
        let source = hemie_walls[wi].source;
        let kind = wall_kind(source).expect("wall");
        let construction_type = match kind {
            Kind::External => "external_wall",
            Kind::Party => "party_wall",
            Kind::Sheltered => "sheltered_wall",
        };
        let key = ctx.construction(construction_type, &[source], &[]);
        hemie_walls[wi]
            .value
            .insert("construction".into(), json!(key));
        if let Some(band) = source.get("age_band") {
            hemie_walls[wi]
                .value
                .insert("age_band".into(), band.clone());
        }
        if kind == Kind::Sheltered {
            // A sheltered piece of an unheated conservatory's host wall takes the bundle's space.
            let piece = pieces.iter().find(|(p, _)| std::ptr::eq(p, source));
            match piece.map_or(source.text("adjacent_space_type"), |(_, space)| *space) {
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
                let mut d = ctx.with_age_band(
                    &[opening],
                    json!({"width": opening.num("width"), "height": opening.num("height"), "construction": key}),
                );
                if let Some(vents) = systems::host_vents(ctx, opening.name) {
                    d["mechanical_vents"] = vents;
                }
                door.push(d);
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
    bundles::conservatory_walls(
        ctx,
        &conservatory,
        &mut hemie_walls,
        &windows,
        &doors,
        &mut placed,
    );
    passive_vents(ctx, csv, &mut hemie_walls);
    systems::wall_vents(ctx, &mut hemie_walls);

    // Roofs and floors per part.
    let room_walls_refs: Vec<&El> = room_walls.clone();
    let dormers: Vec<&El> = els.iter().filter(|e| e.bundle().is_some()).collect();
    let mut roofs: Vec<Vec<&El>> = vec![Vec::new(); parts.len()];
    let party_ceilings: Vec<&El> = els.iter().filter(|e| parts::is_party_ceiling(e)).collect();
    for plane in planes.iter().chain(&party_ceilings) {
        if bundles::over_bay(&bays, plane) {
            continue;
        }
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
                    "Roof '{}' covers no storey and is more than {EAVES} m from every storey outline. Move it over the storeys it covers.",
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
    bundles::attach_bays(
        ctx,
        &bays,
        &mut hemie_walls,
        &parts,
        &planes,
        &windows,
        &doors,
        &mut placed,
    );
    let grounds: Vec<&El> = els
        .iter()
        .filter(|e| e.ty == "BuildingElementGround")
        .collect();
    // Derived from the model: HEMIE's floor total_area is the ground floor area of the whole dwelling.
    let ground_total: f64 = grounds.iter().filter_map(|g| g.num("area")).sum();
    let mut floors_used = BTreeSet::new();
    let mut building_parts = Map::new();
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
        if conservatory[pi] {
            bp.insert("is_non_separated_conservatory".into(), json!(true));
        }
        bp.insert("storeys".into(), Value::Array(storeys));
        bp.insert("walls".into(), Value::Array(part_walls));
        let floor_of = parts::PartFloor {
            name: &names[pi],
            bottom: part.bottom,
            level: part.bottom as i64 + first,
            point: interior_point(&part.poly),
            ring: &part.storeys[0],
            basement: basement.as_ref(),
        };
        if let Some(floor) = parts::part_floor(ctx, &els, &floor_of, ground_total, &mut floors_used)
        {
            bp.insert("floor".into(), floor);
        }
        let top_ring = part.storeys.last().expect("storey").clone();
        let (ceilings, planes): (Vec<&El>, Vec<&El>) =
            roofs[pi].iter().partition(|e| parts::is_party_ceiling(e));
        let roof = if !ceilings.is_empty() {
            parts::party_ceiling_roof(ctx, &ceilings, &planes)
        } else if Some(pi) == room_part {
            room_in_roof(
                ctx,
                &planes,
                &room_walls_refs,
                &dormers,
                &windows,
                &top_ring,
                &orient,
                &mut placed,
            )
        } else if conservatory[pi] {
            let gables: Vec<(&El, Kind, P, P)> = hemie_walls
                .iter()
                .filter(|w| w.part == pi)
                .map(|w| (w.source, wall_kind(w.source).expect("wall"), w.a, w.b))
                .collect();
            bundles::conservatory_roof(
                ctx,
                &roofs[pi],
                &windows,
                &names[pi],
                &top_ring,
                &orient,
                &gables,
                &mut placed,
            )
        } else {
            roof(
                ctx,
                &planes,
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
    parts::unused_floors(ctx, &els, &floors_used);
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
    // DESNZ-defined: the base height, or else the base storey, from which HEMIE
    // estimates it.
    match (
        full_ventilation
            .get("ventilation_zone_base_height")
            .filter(|v| !v.is_null()),
        model["General"]["storey_of_dwelling"].as_i64(),
    ) {
        (Some(height), _) => {
            geometry.insert("ventilation_zone_base_height".into(), height.clone());
        }
        (None, Some(storey)) => {
            geometry.insert("base_storey_of_dwelling".into(), json!(storey));
        }
        (None, None) => ctx.errors.push(error("/InfiltrationVentilation/ventilation_zone_base_height".into(), "The model states no ventilation zone base height or base storey, which the existing-building EPC needs. Add the Metadata row Ventilation_ventilation_zone_base_height or General_storey_of_dwelling.".into())),
    }
    // DESNZ-defined: a part's base height defaults to the dwelling's; a part that starts higher
    // states its own. With no dwelling base the error is already reported, so 0 stands in.
    let dwelling = parts::dwelling_base(&geometry);
    let bases = match parts::base_heights(&parts, dwelling.unwrap_or(0.0)) {
        Ok(bases) => bases,
        Err(i) => {
            ctx.errors.push(error("/Zone".into(), format!("Building part '{}' starts on floor {}, but no building part has a storey on floor {} to carry it. Draw the floor below it.", names[i], parts[i].bottom as i64 + first, parts[i].bottom as i64 + first - 1)));
            return None;
        }
    };
    for (pi, part) in parts.iter().enumerate() {
        if part.bottom > 0 {
            building_parts[&names[pi]]["base_height"] = json!(bases[pi]);
        }
    }
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

// The nation by postcode area: area level, because district boundaries cross national borders
// and no district table is pinned here. Border areas ask the model's stated nation.
const SCOTLAND_AREAS: [&str; 15] = [
    "AB", "DD", "DG", "EH", "FK", "G", "HS", "IV", "KA", "KW", "KY", "ML", "PA", "PH", "ZE",
];
const WALES_AREAS: [&str; 2] = ["CF", "SA"];
const BORDER_AREAS: [&str; 8] = ["CA", "CH", "HR", "LD", "LL", "NP", "SY", "TD"];
const ENGLAND_AREAS: [&str; 95] = [
    "AL", "B", "BA", "BB", "BD", "BH", "BL", "BN", "BR", "BS", "CB", "CM", "CO", "CR", "CT", "CV",
    "CW", "DA", "DE", "DH", "DL", "DN", "DT", "DY", "E", "EC", "EN", "EX", "FY", "GL", "GU", "HA",
    "HD", "HG", "HP", "HU", "HX", "IG", "IP", "KT", "L", "LA", "LE", "LN", "LS", "LU", "M", "ME",
    "MK", "N", "NE", "NG", "NN", "NR", "NW", "OL", "OX", "PE", "PL", "PO", "PR", "RG", "RH", "RM",
    "S", "SE", "SG", "SK", "SL", "SM", "SN", "SO", "SP", "SR", "SS", "ST", "SW", "TA", "TF", "TN",
    "TQ", "TR", "TS", "TW", "UB", "W", "WA", "WC", "WD", "WF", "WN", "WR", "WS", "WV", "YO",
];
/// The Isle of Man and the Channel Islands, outside the UK EPC schemes.
const OUTSIDE_AREAS: [&str; 3] = ["IM", "GY", "JE"];
const NATIONS: [&str; 4] = ["England", "Wales", "Scotland", "Northern Ireland"];

enum PostcodeNation {
    Derived(&'static str),
    Border,
    Outside,
}

/// A postcode's area and what it gives the nation; None for a malformed postcode or an unknown area.
fn postcode_region(postcode: &str) -> Option<(String, PostcodeNation)> {
    let code: String = postcode
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();
    if !code.is_ascii() {
        return None;
    }
    let (outward, inward) = code.split_at(code.len().checked_sub(3)?);
    let area: String = outward
        .chars()
        .take_while(char::is_ascii_alphabetic)
        .collect();
    let district = &outward[area.len()..];
    let well_formed = (1..=2).contains(&area.len())
        && (1..=2).contains(&district.len())
        && district.starts_with(|c: char| c.is_ascii_digit())
        && district.chars().all(|c| c.is_ascii_alphanumeric())
        && inward.starts_with(|c: char| c.is_ascii_digit())
        && inward[1..].chars().all(|c| c.is_ascii_alphabetic());
    if !well_formed {
        return None;
    }
    let region = match area.as_str() {
        "BT" => PostcodeNation::Derived("Northern Ireland"),
        a if SCOTLAND_AREAS.contains(&a) => PostcodeNation::Derived("Scotland"),
        a if WALES_AREAS.contains(&a) => PostcodeNation::Derived("Wales"),
        a if ENGLAND_AREAS.contains(&a) => PostcodeNation::Derived("England"),
        a if BORDER_AREAS.contains(&a) => PostcodeNation::Border,
        a if OUTSIDE_AREAS.contains(&a) => PostcodeNation::Outside,
        _ => return None,
    };
    Some((area, region))
}

/// The region from the model's postcode, or in a border area the nation the model states,
/// reported; a missing or unknown postcode, or a border area with no nation, fails naming the field.
fn region(ctx: &mut Ctx) -> Option<String> {
    let postcode = ctx
        .settings
        .raw("Postcode")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let path = "/Metadata/Postcode".to_string();
    let Some((area, derived)) = postcode_region(postcode) else {
        ctx.errors.push(error(path, if postcode.trim().is_empty() {
            "The model has no postcode. The existing-building converter takes the region from it; give the Postcode in Dwelling Details.".into()
        } else {
            format!("Postcode '{postcode}' is not a postcode in England, Wales, Scotland or Northern Ireland, so the region is not known. Check the Postcode in Dwelling Details.")
        }));
        return None;
    };
    match derived {
        PostcodeNation::Derived(region) => {
            ctx.notices.push(notice(
                &path,
                format!("Region {region}, from the postcode {postcode}."),
            ));
            return Some(region.into());
        }
        PostcodeNation::Outside => {
            ctx.errors.push(error(path, format!("Postcode {area} is outside England, Wales, Scotland and Northern Ireland; HEM:EPC does not cover it.")));
            return None;
        }
        PostcodeNation::Border => {}
    }
    let field = format!("{SETTING}nation");
    match ctx.settings.raw(&field).and_then(Value::as_str) {
        Some(nation) if NATIONS.contains(&nation) => {
            ctx.notices.push(notice(
                &format!("/Metadata/{field}"),
                format!("Region {nation}, as stated for postcode area {area}."),
            ));
            Some(nation.into())
        }
        stated => {
            ctx.errors.push(error(format!("/Metadata/{field}"), format!("Postcode area {area} spans two nations{}. State the nation under the Postcode in Dwelling Details.", stated.map_or(String::new(), |s| format!(", and '{s}' is not England, Wales, Scotland or Northern Ireland")))));
            None
        }
    }
}

/// One missing model setting in the words of the editor's fabric defaults (Global Settings,
/// Defaults, Fabric); a row with no editor field yet is named.
fn missing_setting_message(row: &str, fields: &BTreeSet<String>) -> String {
    const WHERE: &str = "Global Settings > Defaults > Fabric";
    let words = |s: &str| s.replace('_', " ");
    if row == format!("{SETTING}age_band") {
        return format!("The fabric defaults state no age band. Choose it in {WHERE}.");
    }
    if let Some(t) = row.strip_prefix(&format!("{SETTING}construction_")) {
        let t = words(t);
        return if fields.is_empty() {
            format!("The {t} fabric default cannot be read. Set it again in {WHERE}.")
        } else {
            // HEMIE reads a window's heat capacity only in a party or sheltered wall.
            let list: Vec<String> = fields
                .iter()
                .map(|f| match (t.as_str(), f.as_str()) {
                    ("window", "areal_heat_capacity") => {
                        "areal heat capacity (for a window in a party or sheltered wall)".into()
                    }
                    _ => words(f),
                })
                .collect();
            format!("The {t} fabric default states no {}. Choose it in {WHERE}, or on each {t} element.", list.join(" or "))
        };
    }
    format!("The model does not state the Metadata row {row}. Add it.")
}

/// The front door: the door marked `is_front_door`, or the model's only door.
fn front_door<'e>(ctx: &mut Ctx, doors: &[&'e El<'e>]) -> Option<&'e El<'e>> {
    let marked: Vec<&El> = doors
        .iter()
        .copied()
        .filter(|d| d.flag("is_front_door"))
        .collect();
    let names = |doors: &[&El]| quoted(&doors.iter().map(|d| d.name).collect::<Vec<_>>());
    match (marked.as_slice(), doors) {
        ([front], _) => Some(front),
        ([], [only]) => {
            ctx.notices.push(notice(&only.path(), format!("'{}' is the model's only door, so it is the front door: its building part is the reference part, and its wall is the first wall of that part's ground storey.", only.name)));
            Some(only)
        }
        ([], []) => {
            ctx.errors.push(error("/Zone".into(), "The model has no door. The reference building part is the one with the front door; draw the front door.".into()));
            None
        }
        ([], many) => {
            ctx.errors.push(error(many[0].path(), format!("The model has doors {}, and none is marked as the front door. Mark the front door.", names(many))));
            None
        }
        (many, _) => {
            ctx.errors.push(error(
                many[0].path(),
                format!(
                    "Doors {} are each marked as the front door. Mark one door only.",
                    names(many)
                ),
            ));
            None
        }
    }
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
    let mut w = ctx.with_age_band(
        &[e],
        json!({"width": e.num("width"), "height": e.num("height"), "window_sections": sections, "construction": key}),
    );
    // Derived from the model: background vents drawn in this window.
    let mut vents = Vec::new();
    for row in window_vents(ctx.settings.csv, e.name) {
        match row.get("area_cm2").and_then(Value::as_f64) {
            Some(area) => vents.push(json!({"area": area})),
            None => {
                let name = row.get("Name").and_then(Value::as_str).unwrap_or_default();
                ctx.errors.push(error(json_pointer(&["InfiltrationVentilation", name]), format!("Vent '{name}' in window '{}' has no area. The existing-building EPC gives each passive vent an area.", e.name)));
            }
        }
    }
    if !vents.is_empty() {
        w["passive_vents"] = Value::Array(vents);
    }
    if let Some(vents) = systems::host_vents(ctx, e.name) {
        w["mechanical_vents"] = vents;
    }
    // Derived from the model: Vulcan's security_risk flag.
    if let Some(risk) = e.get("security_risk").and_then(Value::as_bool) {
        w["is_security_risk"] = json!(risk);
    }
    shading::close(ctx, e, &mut w);
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
    // HEMIE gives a solid or basement floor of bands A to H no insulation by default, so its
    // construction resistance is 0, which the Core input rejects (DESNZ question E12). Stop
    // here, naming the floor, instead of failing in the run.
    let band = g.text("age_band").map(str::to_string).or_else(|| {
        ctx.settings
            .raw(&format!("{SETTING}age_band"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let insulated = ctx.constructions.by_name[&key]
        .get("insulation_thickness")
        .is_some_and(|v| !v.is_null());
    if floor_type != "suspended"
        && !insulated
        && band.as_deref().is_some_and(|b| ("A"..="H").contains(&b))
    {
        ctx.errors.push(error(g.path(), format!("Ground floor '{}' (age band {}) states no insulation thickness. HEM:EPC cannot yet run a solid or basement floor of age band A to H with no insulation. If the floor has insulation, state its thickness.", g.name, band.unwrap_or_default())));
    }
    Some(ctx.with_age_band(
        &[g],
        json!({"floor_type": floor_type, "construction": key, "total_area": total_area}),
    ))
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
            let mut value = window(ctx, w, true)?;
            systems::no_roof_window_vents(ctx, w.name, &mut value);
            Some(value)
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
    let (flat, pitched): (Vec<&El>, Vec<&El>) =
        planes.iter().partition(|p| p.num("pitch") == Some(0.0));
    let heated: Vec<&El> = pitched
        .iter()
        .copied()
        .filter(|p| !p.flag("is_unheated_pitched_roof"))
        .collect();
    if let Some(p) = heated.first() {
        // Rule: a heated pitched roof with no roof room (a vaulted ceiling) has no HEMIE form.
        ctx.errors.push(error(p.path(), format!("Roof '{}' is a heated pitched roof over a storey (a vaulted ceiling). The existing-building EPC has no vaulted roof type; draw the room in the roof with its knee walls or gables, or mark the roof as unheated if a loft is above.", p.name)));
        return None;
    }
    let result = if !flat.is_empty() && !pitched.is_empty() {
        ctx.errors.push(error(flat[0].path(), format!("Building part '{part}' has flat roof '{}' and pitched roof '{}'. The existing-building EPC gives each building part one roof.", flat[0].name, pitched[0].name)));
        None
    } else if !flat.is_empty() {
        let key = ctx.construction("flat_roof", &flat, &[]);
        let lights = roof_windows(ctx, windows, &flat, placed);
        // ours: Vulcan does not record whether a flat roof is cold or warm, so it is Unknown.
        Some(ctx.with_age_band(
            &flat,
            json!({"roof_type": "Unknown Flat", "construction": key, "windows": lights}),
        ))
    } else if !pitched.is_empty() {
        if windows
            .iter()
            .any(|w| pitched.iter().any(|p| w.host() == Some(p.name)))
        {
            ctx.errors.push(error(pitched[0].path(), format!("Roof '{}' is unheated (a loft) and has a roof window. The existing-building EPC takes roof windows only in flat roofs, heated slopes and rooms in the roof.", pitched[0].name)));
            return None;
        }
        let measured = sloped_measurements(ctx, &pitched)?;
        // Sides from the planes' own orientations: one is mono, two opposite are dual.
        let mut sides: Vec<f64> = Vec::new();
        for m in &measured {
            if !sides.iter().any(|s| bearing_gap(*s, m.orientation) < 45.0) {
                sides.push(m.orientation);
            }
        }
        let pitch_type = match sides.as_slice() {
            [_] => "mono",
            [a, b] if bearing_gap(*a, *b) > 135.0 => "dual",
            [_, _] => {
                ctx.errors.push(error(pitched[0].path(), format!("The pitched roof of building part '{part}' slopes two ways that are not opposite. The existing-building EPC takes mono or dual pitched roofs.")));
                return None;
            }
            _ => {
                // ours: HEMIE has no hipped roof, so a hipped roof
                // is dual pitch, reported.
                ctx.notices.push(notice(
                    "/Zone",
                    format!(
                        "{part}: hipped roof converted to dual pitch (approximation; {} slopes).",
                        sides.len()
                    ),
                ));
                "dual"
            }
        };
        let main = &measured[largest(&measured)];
        let (slope_orientation, _) = slope(top_ring, main.orientation, orient);
        // ours: one pitch per roof, the area-weighted mean of its
        // planes, reported.
        let (area, weighted) = measured
            .iter()
            .fold((0.0, 0.0), |(a, w), m| (a + m.area, w + m.area * m.pitch));
        if measured.len() > 1 {
            let planes: Vec<String> = pitched
                .iter()
                .zip(&measured)
                .map(|(p, m)| format!("'{}' {}° over {} m²", p.name, m.pitch, m.area))
                .collect();
            ctx.notices.push(notice(
                "/Zone",
                format!(
                    "{part}: roof pitch {:.1}°, the area-weighted mean of {}.",
                    weighted / area,
                    planes.join(", ")
                ),
            ));
        }
        rectangularity_notice(ctx, part, top_ring);
        let key = ctx.construction("unheated_pitched_roof", &pitched, &[]);
        // ours: Vulcan does not record cold or warm, so it is Unknown.
        Some(ctx.with_age_band(
            &pitched,
            json!({"roof_type": "Unknown Pitched (Unheated)", "construction": key, "pitch_type": pitch_type,
            "slope_orientation": slope_orientation, "pitch": "Custom", "custom_pitch": weighted / area}),
        ))
    } else {
        ctx.errors.push(error(
            "/Zone".into(),
            format!("Building part '{part}' has no roof or party ceiling drawn over it. Draw its roof, or the party ceiling of a flat with a dwelling above."),
        ));
        None
    };
    result
}

struct Sloped {
    area: f64,
    pitch: f64,
    orientation: f64,
}

/// Each pitched plane's area, pitch and own orientation; a missing one is an error per plane.
fn sloped_measurements(ctx: &mut Ctx, planes: &[&El]) -> Option<Vec<Sloped>> {
    let measured: Vec<Option<Sloped>> = planes
        .iter()
        .map(|p| {
            let area = ctx.need(p, "area");
            let orientation = ctx.need(p, "orientation360");
            Some(Sloped {
                area: area?,
                pitch: p.num("pitch").expect("a roof plane states its pitch"),
                orientation: orientation?,
            })
        })
        .collect();
    measured.into_iter().collect()
}

/// The index of the largest plane.
fn largest(planes: &[Sloped]) -> usize {
    (0..planes.len())
        .max_by(|&a, &b| planes[a].area.total_cmp(&planes[b].area))
        .expect("one plane or more")
}

/// Rule: HEMIE sizes a pitched roof from the top storey's minimum rectangle (DESNZ-defined), so
/// a non-rectangular part gets a notice.
fn rectangularity_notice(ctx: &mut Ctx, part: &str, ring: &[P]) {
    let rect = min_rectangle(ring);
    let fill = signed_area(ring) / signed_area(&rect);
    if fill < 0.99 {
        ctx.notices.push(notice("/Zone", format!("Building part '{part}' is not rectangular ({:.0}% of its minimum rectangle). The existing-building EPC sizes its pitched roof from that rectangle.", fill * 100.0)));
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
    let (unheated, heated): (Vec<&El>, Vec<&El>) = planes
        .iter()
        .filter(|p| p.num("pitch") != Some(0.0))
        .partition(|p| p.flag("is_unheated_pitched_roof"));
    // Flat planes in a roof room: the flat ceiling under the ridge (checked below).
    let ceilings: Vec<&El> = planes
        .iter()
        .copied()
        .filter(|p| p.num("pitch") == Some(0.0))
        .collect();
    if heated.is_empty() {
        ctx.errors.push(error("/Zone".into(), "The room in the roof has no heated slope over it. Draw its heated roof slopes over the room.".into()));
        return None;
    }
    let measured = sloped_measurements(ctx, &heated)?;
    let i = largest(&measured);
    let main = heated[i];
    let (slope_orientation, u) = slope(top_ring, measured[i].orientation, orient);
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
    // Derived from the model: a flat plane lying between the heated slopes, under the ridge, or
    // in a mono room between the slope and its high wall, is the room's flat ceiling. DESNZ-defined: a roof with a flat section anywhere else is not
    // covered.
    let across = |e: &El| {
        let values: Vec<f64> = e.pts.iter().map(|p| dot(*p, u)).collect();
        (
            values.iter().copied().fold(f64::MAX, f64::min),
            values.iter().copied().fold(f64::MIN, f64::max),
        )
    };
    for c in &ceilings {
        let (lo, hi) = across(c);
        let slope_below = heated.iter().any(|h| across(h).1 <= lo + TOL);
        let slope_above = heated.iter().any(|h| across(h).0 >= hi - TOL);
        // Mono (HEMIE's single-slope form): the ceiling runs from the slope to the high wall.
        let wall_at = |x: f64| knees.iter().any(|k| (across(k).0 - x).abs() <= TOL);
        let between = (slope_below && (slope_above || wall_at(hi))) || (slope_above && wall_at(lo));
        if !between {
            ctx.errors.push(error(c.path(), format!("Flat roof '{}' is part of the room in the roof but is not a flat ceiling between its two slopes, or between its one slope and its high wall. A roof room with a flat section elsewhere cannot be entered: make the flat part the roof of its own building part, or draw it as slopes.", c.name)));
            return None;
        }
    }
    let ceiling_width = if ceilings.is_empty() {
        0.0
    } else {
        along(&mut ceilings.iter().flat_map(|c| c.pts.clone()), u)
    };
    let Some(gable_top) = gables
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
    // Derived from the model: the room's highest point is its flat ceiling, measured from the
    // room's floor, else the top of its gables (the ridge).
    let max_height = if ceilings.is_empty() {
        gable_top
    } else {
        let floor = ctx.need(gables[0], "base_height");
        let tops: Option<Vec<f64>> = ceilings
            .iter()
            .map(|c| ctx.need(c, "base_height"))
            .collect();
        tops?.into_iter().fold(f64::MIN, f64::max) - floor?
    };
    // DESNZ-defined: the mean knee wall height, zero with no knee walls.
    let both_sides = heated.iter().any(|p| side(centroid(&p.pts)) < 0.0)
        && heated.iter().any(|p| side(centroid(&p.pts)) >= 0.0);
    // DESNZ-defined, as HEMIE's mono form: a mono room's back wall is its full-height wall
    // (HEMIE gives it the maximum ceiling height), so only the walls under the slope count.
    let under_slope: Vec<&El> = knees
        .iter()
        .copied()
        .filter(|k| both_sides || side(k.plan_mid()) >= 0.0)
        .collect();
    let knee_heights: Vec<Option<f64>> =
        under_slope.iter().map(|k| ctx.need(k, "height")).collect();
    let knee_height = if under_slope.is_empty() {
        0.0
    } else {
        knee_heights.into_iter().sum::<Option<f64>>()? / under_slope.len() as f64
    };
    let room_wall = |ctx: &mut Ctx, w: &El, placed: &mut BTreeSet<String>| -> Value {
        let kind = wall_kind(w).expect("roof-room walls are wall lines");
        let construction_type = match kind {
            Kind::External => "external_wall",
            Kind::Party => "party_wall",
            Kind::Sheltered => "sheltered_wall",
        };
        let key = ctx.construction(construction_type, &[w], &[]);
        let mut value = ctx.with_age_band(
            &[w],
            json!({"wall_type": kind.wall_type(), "construction": key}),
        );
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
    let gable = |toward: P| -> Vec<&El> {
        gables
            .iter()
            .copied()
            .filter(|g| dot(sub(g.plan_mid(), room_centre), toward) > 0.0)
            .collect()
    };
    // HEMIE takes one gable wall per end, with one construction and its own windows.
    let (left_gable, right_gable) = match (
        gable(left).as_slice(),
        gable(scale(left, -1.0)).as_slice(),
    ) {
        ([l], [r]) => (*l, *r),
        ([], _) | (_, []) => {
            ctx.errors.push(error(main.path(), "The room in the roof needs a gable wall at each end of the ridge. Draw both gables.".into()));
            return None;
        }
        (l, r) => {
            let end = if l.len() > 1 { l } else { r };
            ctx.errors.push(error(end[0].path(), format!("The room in the roof has gables {} at one end of the ridge. The existing-building EPC takes one gable wall per end; draw it as one wall.", quoted(&end.iter().map(|g| g.name).collect::<Vec<_>>()))));
            return None;
        }
    };
    let mut roof = Map::new();
    roof.insert("roof_type".into(), json!("Room In Roof"));
    if let Some(band) = ctx.agreed(&heated, "age_band") {
        roof.insert("age_band".into(), band.clone());
    }
    if knees.is_empty() && !both_sides {
        // HEMIE requires a mono-pitched room's back wall, which would be a knee wall here.
        ctx.errors.push(error(main.path(), "The room in the roof slopes one way and has no wall under its high side. Draw that wall.".into()));
        return None;
    }
    roof.insert(
        "pitch_type".into(),
        json!(if both_sides { "dual" } else { "mono" }),
    );
    roof.insert("slope_orientation".into(), json!(slope_orientation));
    roof.insert("width".into(), json!(width));
    roof.insert("length".into(), json!(length));
    // Derived from the model: the roof room's walls lie within the drawing tolerance of the
    // top storey, so the roof space is at least as wide as the room (HEMIE requires it).
    roof.insert("full_width".into(), json!(full_width.max(width)));
    roof.insert("maximum_ceiling_height".into(), json!(max_height));
    if ceiling_width > 0.0 {
        roof.insert("ceiling_width".into(), json!(ceiling_width));
    }
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
            ctx.errors.push(error(knee.path(), format!("The room in the roof has more than one knee wall on one side ('{}'). The existing-building EPC takes one per side; draw it as one wall.", knee.name)));
            return None;
        }
        roof.insert(key.into(), room_wall(ctx, knee, placed));
    }
    let key = ctx.construction("heated_pitched_roof", &heated, &[]);
    roof.insert("heated_pitched_roof_construction".into(), json!(key));
    // DESNZ-defined: the surfaces above a flat ceiling or behind a void take the unheated
    // pitched roof construction.
    let unheated: Vec<&El> = unheated.into_iter().chain(ceilings).collect();
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
    let (pitch_type, pitch_key) = match parameters["dormerType"].as_str() {
        // Derived from the model: HEMIE takes no pitch for a flat dormer roof.
        Some("flat") => ("flat", ""),
        Some("mono-pitch") => ("mono", "dormerRoofPitch"),
        // Derived from the model: a gable-fronted dormer has two slopes either side of a ridge.
        Some("gable-front") => ("dual", "gableRoofPitch"),
        // ours: HEMIE has no hipped dormer, so a hip dormer is
        // dual pitch, reported.
        Some("hip") => {
            ctx.notices.push(notice(
                &anchor.path(),
                format!(
                    "{}: hip dormer converted to dual pitch (approximation).",
                    anchor.name
                ),
            ));
            ("dual", "gableRoofPitch")
        }
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
    // Derived from the model: the bundle's own measurements; the dormer face is its front wall
    // rectangle (the gable above it comes from the roof).
    let measured = |key: &str| parameters[key].as_f64();
    let pitch = if pitch_type == "flat" {
        Some(Value::Null)
    } else {
        measured(pitch_key).map(|p| json!(p))
    };
    let (Some(pitch), Some(height)) = (pitch, measured("frontWallHeight")) else {
        let mut missing = Vec::new();
        if pitch_type != "flat" && measured(pitch_key).is_none() {
            missing.push(format!("roof pitch ({pitch_key})"));
        }
        if measured("frontWallHeight").is_none() {
            missing.push("front wall height (frontWallHeight)".to_string());
        }
        ctx.errors.push(error(
            anchor.path(),
            format!(
                "Dormer '{}' does not state its {}. Open the dormer and set it.",
                anchor.name,
                missing.join(" or ")
            ),
        ));
        return None;
    };
    let width = ctx.need(anchor, "width");
    let (anchor_base, host_base) = (
        ctx.need(anchor, "base_height"),
        ctx.need(host, "base_height"),
    );
    let (width, base) = (width?, anchor_base? - host_base?);
    if base < 0.0 {
        ctx.errors.push(error(anchor.path(), format!("Dormer '{}' starts {:.2} m below the base of roof '{}'. The existing-building EPC measures a dormer up from the base of its roof slope; move the dormer up the roof.", anchor.name, -base, host.name)));
        return None;
    }
    let front_name = bundle["window_name"].as_str();
    let Some(front) = windows.iter().find(|w| Some(w.name) == front_name) else {
        ctx.errors.push(error(
            anchor.path(),
            format!(
                "Dormer '{}' has no front window. The existing-building EPC requires one.",
                anchor.name
            ),
        ));
        return None;
    };
    placed.insert(front.name.to_string());
    let front_window = window(ctx, front, true)?;
    let key = ctx.construction("external_wall", &[anchor], &[]);
    let mut value = json!({"dormer_width": width, "dormer_height": height, "dormer_base_height": base,
        "wall_construction": key, "roof_pitch_type": pitch_type, "front_window": front_window});
    if !pitch.is_null() {
        value["roof_pitch"] = pitch;
    }
    Some(ctx.with_age_band(&[anchor], value))
}

/// The passive vents whose parent element is `window`; a fan there is a mechanical vent
/// (`systems::host_vents`).
fn window_vents<'r>(csv: &'r Rows, window: &'r str) -> impl Iterator<Item = &'r Row> {
    csv.get("Ventilation Systems")
        .into_iter()
        .flatten()
        .filter(move |row| {
            row.get("Type").and_then(Value::as_str) == Some("Vents")
                && row.get("parent_element").and_then(Value::as_str) == Some(window)
        })
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
        if row.get("Type").and_then(Value::as_str) == Some("Vents")
            && row
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
                    _ => ctx.errors.push(error(path, format!("Vent '{name}' is more than {TOL} m from every storey wall or has no area. The existing-building EPC places each passive vent in a wall."))),
                }
            }
            // Mechanical ventilation and its vents: `systems`.
            Some("MechanicalVentilation" | "MechanicalVentilationTerminal" | "MechanicalVentilationDuctwork") => {}
            other => ctx.errors.push(error(path, format!("Ventilation '{name}' ({}) is not converted for an existing-building EPC yet. Remove it to run this model.", other.unwrap_or("no type")))),
        }
    }
}

/// The HEMIE InfiltrationVentilation Geometry needs: the model's ventilation inputs and its air
/// test. Without an air test the conversion stops (DESNZ question E17).
fn infiltration(ctx: &mut Ctx, full: &Value) -> Option<Value> {
    let mut iv = Map::new();
    iv.insert("model_type".into(), json!("hemie"));
    // The assessor's values: an existing building's absent shield class, noise nuisance and air
    // test rows leave no template value in the model (`existing_building_optional_rows`).
    // DESNZ-defined: HEMIE takes shield class from the terrain
    // class and noise nuisance as No; the other three are required Metadata rows, whose absence
    // the required-row check already names.
    for (key, required) in [
        ("cross_vent_possible", true),
        ("terrain_class", true),
        ("altitude", true),
        ("shield_class", false),
        ("noise_nuisance", false),
    ] {
        match full.get(key).filter(|v| !v.is_null()) {
            Some(v) => {
                iv.insert(key.into(), v.clone());
            }
            None if required => {}
            None => ctx.notices.push(notice(
                &format!("/InfiltrationVentilation/{key}"),
                format!(
                    "No Metadata row states Ventilation_{key}, so it uses the default: {}.",
                    if key == "shield_class" {
                        "from the terrain class"
                    } else {
                        "No"
                    }
                ),
            )),
        }
    }
    // Derived from the model: passive ducts (chimneys, flues) in their full form, which the
    // HEMIE form accepts.
    if let Some(ducts) = full.get("PassiveDucts").filter(|v| !v.is_null()) {
        iv.insert("PassiveDucts".into(), ducts.clone());
    }
    let leaks = &full["Leaks"];
    let stated = |key: &str| leaks.get(key).filter(|v| !v.is_null());
    let mut out = Map::new();
    let tested = stated("test_result").is_some();
    if tested {
        // Derived from the model: the measured air test the assessor stated.
        for key in ["test_result", "test_pressure", "ventilation_zone_height"] {
            match stated(key) {
                Some(v) => {
                    out.insert(key.into(), v.clone());
                }
                None => ctx.errors.push(error(
                    format!("/InfiltrationVentilation/Leaks/{key}"),
                    format!(
                        "The air test states no {key}. Add the Metadata row AirPermeability_{key}."
                    ),
                )),
            }
        }
    } else {
        // DESNZ-defined: with no air test HEMIE estimates the leakage, but the Orchestrator
        // rejects every form of its inputs (DESNZ question E17): stop here instead of failing
        // in the run.
        ctx.errors.push(error("/InfiltrationVentilation/Leaks".into(), "No air test is stated. HEM:EPC cannot yet run an existing building without one. Enter the air test result in Global Settings.".into()));
    }
    // Derived from the model: the envelope area of the drawn elements. The schema requires it
    // although HEMIE Geometry can give it (E9).
    match stated("env_area") {
        Some(v) => {
            out.insert("env_area".into(), v.clone());
        }
        None => ctx.errors.push(error(
            "/InfiltrationVentilation/Leaks/env_area".into(),
            "The model has no envelope area, which the existing-building input requires.".into(),
        )),
    }
    iv.insert("Leaks".into(), Value::Object(out));
    Some(Value::Object(iv))
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) const HEADER: &str = "Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json";
    pub(super) const SETTINGS: &str = r#"IsExistingBuilding,TRUE
HEMIE_age_band,I
Postcode,MK40 1AA
HEMIE_construction_external_wall,"{""wall_construction_type"":""cavity""}"
HEMIE_construction_external_door,"{""areal_heat_capacity"":20000}""#;

    pub(super) fn wall(name: &str, level: i64, a: P, b: P, height: f64) -> String {
        format!(
            "{name},Z,BuildingElementOpaque,1,90,1,{height},0,0,FALSE,FALSE,,\"{},{},{level}|{},{},{level}\",",
            a[0], a[1], b[0], b[1]
        )
    }

    pub(super) fn plane(
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
    pub(super) fn box_walls(corners: &[P], levels: &[i64]) -> Vec<String> {
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

    pub(super) const BOX: [P; 4] = [[0.0, 0.0], [8.0, 0.0], [8.0, 6.0], [0.0, 6.0]];

    pub(super) fn ground(corners: &[P]) -> String {
        let coords: Vec<String> = corners
            .iter()
            .map(|p| format!("{},{},0", p[0], p[1]))
            .collect();
        format!("Ground Elements\nName,Zone,Type,area,floor_type,coords\nFloor,Z,BuildingElementGround,48,Slab_no_edge_insulation,\"{}\"", coords.join("|"))
    }

    pub(super) fn gable_roof() -> Vec<String> {
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

    /// The model with its front door in the middle of W00, the south wall of floor 0.
    pub(super) fn csv(settings: &str, exposed: &[String], extra: &str) -> String {
        format!(
            "Metadata,,\n{settings}\n\nZone,,\nName,Type\nZ,Zone\n\nExposed Elements\n{HEADER}\n{}\n{}\n\n{extra}\n",
            exposed.join("\n"),
            door("Front", "W00", [3.5, 0.0], [4.5, 0.0]),
        )
    }

    /// A door row's extra_json marking it as the front door.
    const FRONT_DOOR: &str = r#""{""is_front_door"":true}""#;

    pub(super) fn door(name: &str, host: &str, a: P, b: P) -> String {
        format!(
            "{name},Z,BuildingElementOpaque,2,90,1,2,0,0,FALSE,TRUE,{host},\"{},{},0|{},{},0\",",
            a[0], a[1], b[0], b[1]
        )
    }

    pub(super) fn full_input() -> Value {
        json!({
            "Zone": {"Z": {"livingroom_area": 20.0, "restofdwelling_area": 76.0}},
            "General": {"build_type": "detached"},
            "NumberOfHabitableRooms": 3,
            "InfiltrationVentilation": {"cross_vent_possible": false, "terrain_class": "Suburban", "altitude": 0, "ventilation_zone_base_height": 0,
                "Leaks": {"test_pressure": "Standard", "test_result": 5, "env_area": 200, "ventilation_zone_height": 5.6}}
        })
    }

    pub(super) fn run(text: &str) -> (Value, Vec<ValidationError>, Vec<SchemaOmission>) {
        run_on(text, full_input())
    }

    pub(super) fn run_on(
        text: &str,
        mut model: Value,
    ) -> (Value, Vec<ValidationError>, Vec<SchemaOmission>) {
        let rows = crate::parser::CSVParser::new()
            .parse_csv(text)
            .expect("csv");
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        map_existing_building(&mut model, &rows, &json!({}), &mut errors, &mut notices);
        (model, errors, notices)
    }

    pub(super) fn house(exposed_extra: Vec<String>) -> String {
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
        // Every storey's ceiling leaves out the storey gap, the top one included.
        for storey in 0..2 {
            let ceiling = main["storeys"][storey]["ceiling_height"].as_f64().unwrap();
            assert!((ceiling - 2.55).abs() < 1e-9, "{ceiling}");
        }
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
        let refs: Vec<&El> = els.iter().filter(|e| wall_kind(e).is_some()).collect();
        let ring = ring_of_walls(&refs).unwrap();
        assert!(signed_area(&ring) > 0.0);
        // An open outline names the walls at its open ends.
        let open = ring_of_walls(&refs[..3]).unwrap_err();
        assert!(open.contains("'W00'") && open.contains("'W02'"), "{open}");
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
            .any(|n| n.message
                == "Main: hipped roof converted to dual pitch (approximation; 4 slopes)."));
        assert!(notices.iter().any(|n| n.message.starts_with(
            "Main: roof pitch 40.0°, the area-weighted mean of 'Hip S' 40° over 10 m²"
        )));
    }

    /// A gable wall on the roof room's floor: a wall with a sloped top profile.
    pub(super) fn gable(name: &str, a: P, b: P) -> String {
        wall(name, 2, a, b, 0.0)
            + r#""{""geometry_face"":{""top_profile"":[{""h"":0},{""h"":2.5},{""h"":0}]}}""#
    }

    pub(super) fn heated_roof() -> Vec<String> {
        gable_roof()
            .into_iter()
            .map(|p| p.replace(",TRUE,FALSE,,", ",FALSE,FALSE,,"))
            .collect()
    }

    #[test]
    fn gables_without_knee_walls_are_a_room_in_the_roof_with_knee_height_zero() {
        let mut exposed = heated_roof();
        exposed.push(gable("G W", [0.0, 0.0], [0.0, 6.0]));
        exposed.push(gable("G E", [8.0, 0.0], [8.0, 6.0]));
        let (model, errors, _) = run(&house(exposed));
        assert!(errors.is_empty(), "{errors:#?}");
        let main = &model["Zone"]["building_parts"]["Main"];
        let room = &main["roof"];
        assert_eq!(room["roof_type"], "Room In Roof");
        assert_eq!(room["pitch_type"], "dual");
        assert_eq!(room["average_knee_wall_height"], 0.0);
        assert_eq!(room["maximum_ceiling_height"], 2.5);
        assert!(room.get("front_knee_wall").is_none() && room.get("back_wall").is_none());
        assert_eq!(main["storeys"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn a_vaulted_first_floor_with_gables_and_full_height_eaves_walls_fails_as_vaulted() {
        let profile =
            r#""{""geometry_face"":{""top_profile"":[{""h"":2.8},{""h"":5},{""h"":2.8}]}}""#;
        let mut exposed = box_walls(&BOX, &[0]);
        exposed.push(wall("E S", 1, [0.0, 0.0], [8.0, 0.0], 2.8));
        exposed.push(wall("G E", 1, [8.0, 0.0], [8.0, 6.0], 2.8) + profile);
        exposed.push(wall("E N", 1, [8.0, 6.0], [0.0, 6.0], 2.8));
        exposed.push(wall("G W", 1, [0.0, 6.0], [0.0, 0.0], 2.8) + profile);
        exposed.extend(heated_roof());
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0].message.contains("vaulted ceiling"),
            "{}",
            errors[0].message
        );
    }

    #[test]
    fn several_gables_at_one_end_of_a_roof_room_stop_and_are_named() {
        let mut exposed = heated_roof();
        exposed.push(gable("G W1", [0.0, 0.0], [0.0, 3.0]));
        exposed.push(gable("G W2", [0.0, 3.0], [0.0, 6.0]));
        exposed.push(gable("G E", [8.0, 0.0], [8.0, 6.0]));
        let (_, errors, _) = run(&house(exposed));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0]
                .message
                .contains("gables 'G W1', 'G W2' at one end"),
            "{}",
            errors[0].message
        );
    }

    #[test]
    fn a_wall_with_no_height_stops_and_is_named_once() {
        // W01 runs along the main part and the extension: two outline edges, one error.
        let l: [P; 6] = [
            [0.0, 0.0],
            [8.0, 0.0],
            [8.0, 9.0],
            [5.0, 9.0],
            [5.0, 6.0],
            [0.0, 6.0],
        ];
        let mut exposed = box_walls(&l, &[0]);
        exposed[1] = exposed[1].replace(",90,1,2.8,", ",90,1,,");
        exposed.extend(box_walls(&BOX, &[1]));
        exposed.extend(gable_roof());
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&l)));
        let w01: Vec<_> = errors.iter().filter(|e| e.path.ends_with("/W01")).collect();
        assert_eq!(w01.len(), 1, "{errors:#?}");
        assert!(w01[0].message.contains("does not state its height"));
        // The conversion goes on, naming the extension's missing roof in the same pass.
        assert!(errors
            .iter()
            .any(|e| e.message.contains("'Extension 1' has no roof")));
    }

    #[test]
    fn a_party_wall_with_no_cavity_type_takes_hemies_age_band_default() {
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed.retain(|w| !w.starts_with("W01,"));
        exposed.push(
            "PW,Z,BuildingElementPartyWall,1,90,1,2.8,0,0,FALSE,FALSE,,\"8,0,0|8,6,0\",".into(),
        );
        exposed.extend(gable_roof());
        let (model, errors, notices) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(
            model["Zone"]["constructions"]["party_wall"],
            json!({"construction_type": "party_wall"})
        );
        assert!(notices.iter().any(|n| n
            .message
            .contains("the existing-building EPC takes it from the age band: 'PW'")));
    }

    #[test]
    fn an_extension_takes_its_own_ground_floor_or_exposed_floor() {
        // The L-shaped ground floor's drawn ground covers only the box under the upper storey.
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
        let extension: [P; 4] = [[5.0, 6.0], [8.0, 6.0], [8.0, 9.0], [5.0, 9.0]];
        exposed.push(plane("Flat", 1, &extension, 0.0, 0.0, false));
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(errors[0]
            .message
            .contains("'Extension 1' has no ground floor drawn"));
        // A floor over outside air under the extension is its exposed floor.
        exposed.push(plane("Over air", 0, &extension, 180.0, 0.0, false));
        let (model, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert!(errors.is_empty(), "{errors:#?}");
        let parts = &model["Zone"]["building_parts"];
        assert_eq!(
            parts["Extension 1"]["floor"]["floor_type"],
            "not next to ground (external)"
        );
        assert_eq!(
            parts["Main"]["floor"]["floor_type"],
            "slab no edge insulation"
        );
    }

    #[test]
    fn an_upper_floor_touching_the_floor_below_at_a_corner_only_stops() {
        let mut exposed = box_walls(&BOX, &[0]);
        exposed.extend(box_walls(&[[0.0, 0.0], [3.0, 1.0], [2.0, 3.0]], &[1]));
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(
            errors[0].message.contains("has no walls on floor 0"),
            "{}",
            errors[0].message
        );
    }

    #[test]
    fn the_front_door_sets_the_reference_part_and_its_first_wall() {
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed.extend(gable_roof());
        exposed.push(door("Back", "W01", [8.0, 2.5], [8.0, 3.5]));
        let text = csv(SETTINGS, &exposed, &ground(&BOX));
        let (_, errors, _) = run(&text);
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(errors[0]
            .message
            .contains("doors 'Back', 'Front', and none is marked as the front door"));
        let marked = text.replace(
            &door("Back", "W01", [8.0, 2.5], [8.0, 3.5]),
            &(door("Back", "W01", [8.0, 2.5], [8.0, 3.5]) + FRONT_DOOR),
        );
        let (model, errors, _) = run(&marked);
        assert!(errors.is_empty(), "{errors:#?}");
        let zone = &model["Zone"];
        assert_eq!(
            zone["building_parts"]["Main"]["storeys"][0]["floorplan"],
            "LINEARRING (8 0, 8 6, 0 6, 0 0, 8 0)"
        );
        assert_eq!(zone["reference_orientation"], 90.0);
        let both = marked.replace(
            &door("Front", "W00", [3.5, 0.0], [4.5, 0.0]),
            &(door("Front", "W00", [3.5, 0.0], [4.5, 0.0]) + FRONT_DOOR),
        );
        let (_, errors, _) = run(&both);
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(errors[0]
            .message
            .contains("Doors 'Back', 'Front' are each marked as the front door"));
    }

    #[test]
    fn roof_planes_that_differ_in_age_band_or_construction_stop() {
        let mut roof = gable_roof();
        roof[0] += r#""{""age_band"":""K""}""#;
        let (_, errors, _) = run(&house(roof.clone()));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(errors[0]
            .message
            .contains("The existing-building EPC gives 'Roof S', 'Roof N' one age band"));
        roof[1] += r#""{""age_band"":""K"",""insulation_location"":""rafters""}""#;
        let (_, errors, _) = run(&house(roof.clone()));
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert!(errors[0].message.contains("one insulation location"));
        roof[0] = roof[0].replace(
            r#""age_band"":""K""}"#,
            r#""age_band"":""K"",""insulation_location"":""rafters""}"#,
        );
        let (model, errors, _) = run(&house(roof));
        assert!(errors.is_empty(), "{errors:#?}");
        let main_roof = &model["Zone"]["building_parts"]["Main"]["roof"];
        assert_eq!(main_roof["age_band"], "K");
        let key = main_roof["construction"].as_str().unwrap();
        assert_eq!(
            model["Zone"]["constructions"][key]["insulation_location"],
            "rafters"
        );
    }

    #[test]
    fn a_roof_rooms_slopes_and_walls_take_their_own_age_band() {
        let mut exposed: Vec<String> = heated_roof()
            .into_iter()
            .map(|p| p + r#""{""age_band"":""K""}""#)
            .collect();
        exposed.push(gable("G W", [0.0, 0.0], [0.0, 6.0]).replace(
            r#""{""geometry_face"#,
            r#""{""age_band"":""J"",""geometry_face"#,
        ));
        exposed.push(gable("G E", [8.0, 0.0], [8.0, 6.0]));
        let (model, errors, _) = run(&house(exposed));
        assert!(errors.is_empty(), "{errors:#?}");
        let room = &model["Zone"]["building_parts"]["Main"]["roof"];
        assert_eq!(room["age_band"], "K");
        let bands: Vec<&Value> = ["left_gable_wall", "right_gable_wall"]
            .iter()
            .filter_map(|side| room[side].get("age_band"))
            .collect();
        assert_eq!(bands, [&json!("J")]);
    }

    #[test]
    fn with_no_air_test_preparation_stops_and_desnz_defaults_are_reported() {
        let mut model = full_input();
        model["InfiltrationVentilation"]
            .as_object_mut()
            .unwrap()
            .remove("ventilation_zone_base_height");
        model["General"]["storey_of_dwelling"] = json!(0);
        // With an air test, the base storey stands for the base height.
        let (tested, errors, notices) = run_on(&house(gable_roof()), model.clone());
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(tested["Zone"]["base_storey_of_dwelling"], 0);
        assert!(tested["InfiltrationVentilation"]
            .get("shield_class")
            .is_none());
        for key in ["shield_class", "noise_nuisance"] {
            assert!(notices.iter().any(|n| n.path.ends_with(key)), "{key}");
        }
        // No air test does not run yet (a DESNZ issue): one error says so, and nothing asks
        // for the leakage-estimate inputs.
        model["InfiltrationVentilation"]["Leaks"] = json!({"env_area": 200});
        let (_, errors, _) = run_on(&house(gable_roof()), model);
        assert!(
            errors.len() == 1
                && errors[0].path == "/InfiltrationVentilation/Leaks"
                && errors[0].message.starts_with("No air test is stated."),
            "{errors:#?}"
        );
    }

    #[test]
    fn an_uninsulated_slab_of_band_a_to_h_stops_naming_the_floor() {
        let band_d = house(gable_roof()).replace("HEMIE_age_band,I", "HEMIE_age_band,D");
        let (_, errors, _) = run(&band_d);
        assert!(
            errors.iter().any(|e| e.path.ends_with("/Floor")
                && e.message
                    .contains("Ground floor 'Floor' (age band D) states no insulation thickness")),
            "{errors:#?}"
        );
        // A stated insulation thickness gives the floor a resistance, so it runs.
        let insulated = band_d.replace(
            "HEMIE_age_band,D",
            "HEMIE_age_band,D\nHEMIE_construction_not_edge_insulated_ground_attached_floor,\"{\"\"insulation_thickness\"\":50}\"",
        );
        let (_, errors, _) = run(&insulated);
        assert!(errors.is_empty(), "{errors:#?}");
    }

    #[test]
    fn passive_ducts_stay_in_the_ventilation() {
        let mut model = full_input();
        let duct = json!({"Chimney": {"length": 6.0, "duct_speed_ref": 1.0}});
        model["InfiltrationVentilation"]["PassiveDucts"] = duct.clone();
        let (model, errors, _) = run_on(&house(gable_roof()), model);
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(model["InfiltrationVentilation"]["PassiveDucts"], duct);
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
    fn the_region_comes_from_the_postcode() {
        for (postcode, region) in [
            ("MK40 1AA", "England"),
            ("cf10 1aa", "Wales"),
            ("EH1 1AA", "Scotland"),
            ("BT1 1AA", "Northern Ireland"),
        ] {
            let text = house(gable_roof()).replace("MK40 1AA", postcode);
            let (model, errors, notices) = run(&text);
            assert!(errors.is_empty(), "{postcode}: {errors:#?}");
            assert_eq!(model["Zone"]["region"], region, "{postcode}");
            assert!(
                notices.iter().any(|n| n
                    .message
                    .contains(&format!("Region {region}, from the postcode"))),
                "{postcode}: {notices:#?}"
            );
        }
        // A border area takes the nation the model states, and fails without one.
        let border = house(gable_roof()).replace("MK40", "CH5");
        let (_, errors, _) = run(&border);
        assert_eq!(errors.len(), 1, "{errors:#?}");
        assert_eq!(errors[0].path, "/Metadata/HEMIE_nation");
        assert!(errors[0].message.contains("CH spans two nations"));
        let stated = border.replace("Postcode,", "HEMIE_nation,Wales\nPostcode,");
        let (model, errors, notices) = run(&stated);
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(model["Zone"]["region"], "Wales");
        assert!(notices.iter().any(|n| n
            .message
            .contains("Region Wales, as stated for postcode area CH")));
        // A retired row fails loudly, naming the row and the fix.
        for (field, fix) in [
            ("HEMIE_region", "postcode"),
            ("HEMIE_front_door", "front door"),
            ("HEMIE_infiltration_properties", "air test"),
        ] {
            let (_, errors, _) =
                run(&house(gable_roof()).replace("Postcode,", &format!("{field},x\nPostcode,")));
            assert_eq!(errors.len(), 1, "{field}: {errors:#?}");
            assert_eq!(errors[0].path, format!("/Metadata/{field}"));
            assert!(errors[0].message.contains(fix), "{errors:#?}");
        }
        // Elsewhere the nation comes from the postcode, whatever a stale stated nation says.
        let stale = house(gable_roof()).replace("Postcode,", "HEMIE_nation,Wales\nPostcode,");
        assert_eq!(run(&stale).0["Zone"]["region"], "England");
        for area in ["IM", "GY", "JE"] {
            let (_, errors, _) = run(&house(gable_roof()).replace("MK40", &format!("{area}1")));
            assert_eq!(errors.len(), 1, "{area}: {errors:#?}");
            assert_eq!(errors[0].path, "/Metadata/Postcode");
            assert_eq!(errors[0].message, format!("Postcode {area} is outside England, Wales, Scotland and Northern Ireland; HEM:EPC does not cover it."));
        }
        for postcode in ["", "MK40", "XX1 1AA", "M1X 1AA1"] {
            let (_, errors, _) = run(&house(gable_roof()).replace("MK40 1AA", postcode));
            assert_eq!(errors.len(), 1, "{postcode}: {errors:#?}");
            assert_eq!(errors[0].path, "/Metadata/Postcode");
        }
    }

    #[test]
    fn every_uk_postcode_area_is_known() {
        // The 121 UK postcode areas (BT included) and the three Crown dependency areas.
        let uk = "AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH \
            DL DN DT DY E EC EH EN EX FK FY G GL GU HA HD HG HP HR HS HU HX IG IP IV KA KT KW KY L \
            LA LD LE LL LN LS LU M ME MK ML N NE NG NN NP NR NW OL OX PA PE PH PL PO PR RG RH RM S \
            SA SE SG SK SL SM SN SO SP SR SS ST SW SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR \
            WS WV YO ZE";
        let areas: Vec<&str> = uk.split_whitespace().chain(["GY", "IM", "JE"]).collect();
        assert_eq!(areas.len(), 124);
        for area in areas {
            assert!(postcode_region(&format!("{area}1 1AA")).is_some(), "{area}");
        }
    }

    #[test]
    fn each_missing_setting_is_one_error_in_plain_words() {
        let text = house(gable_roof())
            .replace("HEMIE_age_band,I\n", "")
            .replace(
                r#"HEMIE_construction_external_wall,"{""wall_construction_type"":""cavity""}""#,
                "",
            );
        let (_, errors, _) = run(&text);
        assert_eq!(errors.len(), 2, "{errors:#?}");
        assert_eq!(errors[0].path, "/Metadata/HEMIE_age_band");
        assert!(errors[0].message.contains("state no age band"));
        assert_eq!(errors[1].path, "/Metadata/HEMIE_construction_external_wall");
        assert!(
            errors[1]
                .message
                .contains("external wall fabric default states no wall construction type"),
            "{errors:#?}"
        );
        assert!(
            !errors.iter().any(|e| e.message.contains("HEMIE_")),
            "{errors:#?}"
        );
    }

    #[test]
    fn a_missing_window_heat_capacity_names_where_it_is_read() {
        let fields = BTreeSet::from(["areal_heat_capacity".to_string()]);
        assert_eq!(
            missing_setting_message("HEMIE_construction_window", &fields),
            "The window fabric default states no areal heat capacity (for a window in a party or sheltered wall). Choose it in Global Settings > Defaults > Fabric, or on each window element."
        );
    }

    #[test]
    fn a_heat_capacity_band_takes_its_value_and_unknown_values_stop() {
        let text = house(gable_roof()).replace(
            "\"3.5,0,0|4.5,0,0\",",
            "\"3.5,0,0|4.5,0,0\",\"{\"\"areal_heat_capacity\"\":\"\"Heavy\"\"}\"",
        );
        let (model, errors, _) = run(&text);
        assert!(errors.is_empty(), "{errors:#?}");
        let constructions = model["Zone"]["constructions"].as_object().unwrap();
        assert!(
            constructions
                .values()
                .any(|c| c["construction_type"] == "external_door"
                    && c["areal_heat_capacity"] == 850_000.0),
            "{constructions:#?}"
        );
        let (_, errors, _) = run(&text.replace("Heavy", "Blue"));
        assert!(
            errors.iter().any(|e| e
                .message
                .contains("'Front' has areal heat capacity \"Blue\"")),
            "{errors:#?}"
        );
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed[0] = exposed[0].replace("\",", "\",\"{\"\"colour\"\":\"\"Blue\"\"}\"");
        exposed.extend(gable_roof());
        let (_, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert!(
            errors
                .iter()
                .any(|e| e.message == "'W00' has colour \"Blue\". Use Light, Intermediate or Dark."),
            "{errors:#?}"
        );
    }

    #[test]
    fn element_values_overlay_the_construction_setting() {
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed[0] = exposed[0].replace("\",", "\",\"{\"\"u_value\"\":0.45,\"\"mass_distribution_class\"\":\"\"IE\"\",\"\"solar_absorption_coeff\"\":0.4,\"\"colour\"\":\"\"Dark\"\"}\"");
        exposed.push(
            "PW,Z,BuildingElementPartyWall,1,90,1,2.8,0,0,FALSE,FALSE,,\"8,0,0|8,6,0\",\"{\"\"party_wall_cavity_type\"\":\"\"unfilled_unsealed\"\",\"\"party_wall_lining_type\"\":\"\"wet_plaster\"\",\"\"mass_distribution_class\"\":\"\"D\"\",\"\"colour\"\":\"\"Dark\"\"}\"".into(),
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
        assert_eq!(
            constructions["external_wall"]["mass_distribution_class"],
            "IE: Mass divided over internal and external side"
        );
        assert_eq!(
            constructions["external_wall"]["solar_absorption_coefficient"],
            0.4
        );
        assert_eq!(constructions["external_wall"]["colour"], "Dark");
        assert!(constructions["external_wall 2"].get("u_value").is_none());
        assert_eq!(
            constructions["party_wall"],
            json!({"construction_type": "party_wall", "party_wall_type": "unfilled_cavity", "cavity_seal_type": "unsealed", "party_wall_lining_type": "wet_plaster", "mass_distribution_class": "D: Mass equally distributed"})
        );
        assert!(notices.iter().any(|n| n.message.contains("W00 (U 0.45)")));
    }

    /// The house with window W1 in the south wall W00; `extra` is the window's extra_json.
    fn window_house(extra: &str, sections: &str) -> String {
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed.extend(gable_roof());
        exposed.push(format!(
            "W1,Z,BuildingElementTransparent,2,90,1,1.2,180,1,FALSE,FALSE,W00,\"1,0,0|2,0,0\",\"{{\"\"window_sections\"\":[{{\"\"window_type\"\":\"\"full opening\"\"}}]{}}}\"",
            extra.replace('"', "\"\"")
        ));
        let settings = format!("{SETTINGS}\nHEMIE_construction_window,\"{{\"\"frame_material\"\":\"\"wood or PVC\"\",\"\"glazing_type\"\":\"\"single\"\",\"\"areal_heat_capacity\"\":0}}\"");
        csv(
            &settings,
            &exposed,
            &format!("{}\n\n{sections}", ground(&BOX)),
        )
    }

    fn window_construction(model: &Value) -> Value {
        let window = model["Zone"]["building_parts"]["Main"]["walls"]
            .as_array()
            .unwrap()
            .iter()
            .find_map(|w| w["windows"].get(0).cloned())
            .expect("window");
        model["Zone"]["constructions"][window["construction"].as_str().unwrap()].clone()
    }

    #[test]
    fn a_window_takes_hemies_glazing_and_frame_values_unless_it_states_them() {
        let (model, errors, notices) = run(&window_house("", ""));
        assert!(errors.is_empty(), "{errors:#?}");
        let c = window_construction(&model);
        assert!(c.get("g_value").is_none() && c.get("frame_area_fraction").is_none());
        assert!(!notices.iter().any(|n| n.message.contains("g-value")));
        let (model, errors, notices) = run(&window_house(
            r#","g_value":0.63,"frame_area_fraction":0.2"#,
            "",
        ));
        assert!(errors.is_empty(), "{errors:#?}");
        let c = window_construction(&model);
        assert_eq!(
            (&c["g_value"], &c["frame_area_fraction"]),
            (&json!(0.63), &json!(0.2))
        );
        assert!(
            notices.iter().any(|n| n
                .message
                .contains("W1 (g-value 0.63, frame area fraction 0.2)")),
            "{notices:#?}"
        );
    }

    #[test]
    fn a_roof_with_no_insulation_location_is_uninsulated_and_says_so() {
        let (_, errors, notices) = run(&house(gable_roof()));
        assert!(errors.is_empty(), "{errors:#?}");
        assert!(
            notices.iter().any(|n| n.message.contains("'Roof S', 'Roof N' state no insulation location, so the existing-building EPC models no roof insulation")),
            "{notices:#?}"
        );
        // A thickness with no location would be ignored, so it fails.
        let text = house(gable_roof()).replace(
            "IsExistingBuilding,TRUE",
            "IsExistingBuilding,TRUE\nHEMIE_construction_unheated_pitched_roof,\"{\"\"insulation_thickness\"\":270}\"",
        );
        let (_, errors, _) = run(&text);
        assert!(
            errors.iter().any(|e| e.path.ends_with("/Roof S")
                && e.message
                    .contains("state an insulation thickness but no insulation location")),
            "{errors:#?}"
        );
    }

    #[test]
    fn a_fan_whose_parent_element_is_a_window_is_a_mechanical_vent_in_it() {
        let rows = "Ventilation Systems\nName,Type,parent_element,host_element,area_cm2,vent_type,coords,extra_json\nFan,MechanicalVentilation,W1,,,Intermittent MEV,,\nTrickle,Vents,W1,,40,,,";
        let (model, errors, _) = run(&window_house("", rows));
        assert!(errors.is_empty(), "{errors:#?}");
        let window = model["Zone"]["building_parts"]["Main"]["walls"]
            .as_array()
            .unwrap()
            .iter()
            .find_map(|w| w["windows"].get(0).cloned())
            .expect("window");
        assert_eq!(window["passive_vents"], json!([{"area": 40.0}]));
        assert_eq!(
            window["mechanical_vents"]["Fan"]["vent_system"],
            "Intermittent MEV"
        );
    }

    #[test]
    fn an_element_states_its_own_age_band_and_construction() {
        let mut exposed = box_walls(&BOX, &[0, 1]);
        exposed[2] = exposed[2].replace(
            "\",",
            "\",\"{\"\"age_band\"\":\"\"K\"\",\"\"wall_construction_type\"\":\"\"timber frame\"\"}\"",
        );
        exposed.extend(gable_roof());
        let (model, errors, _) = run(&csv(SETTINGS, &exposed, &ground(&BOX)));
        assert!(errors.is_empty(), "{errors:#?}");
        let walls = model["Zone"]["building_parts"]["Main"]["walls"]
            .as_array()
            .unwrap();
        let own: Vec<&Value> = walls.iter().filter(|w| w["age_band"] == "K").collect();
        assert_eq!(own.len(), 1, "{walls:#?}");
        let key = own[0]["construction"].as_str().unwrap();
        assert_eq!(
            model["Zone"]["constructions"][key]["wall_construction_type"],
            "timber frame"
        );
        // The other walls keep the model's band and construction.
        let other = walls.iter().find(|w| w.get("age_band").is_none()).unwrap();
        let key = other["construction"].as_str().unwrap();
        assert_eq!(
            model["Zone"]["constructions"][key]["wall_construction_type"],
            "cavity"
        );
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
