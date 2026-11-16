// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! A wall's applied build-up (`vulcan_assembly_v1`) as existing-building wall layers, in place of
//! a U-value. HEMIE takes a layer by its thickness and either its material or its thermal
//! properties, and the layers it is given replace the ones it would build from the wall type and
//! age band.
//!
//! The build-up goes as one layer: its total thickness, its construction resistance and its
//! areal heat capacity, all as the build-up states them. One layer keeps the build-up's own
//! result: its resistance already holds the parallel paths of any studs or battens and its
//! corrections, which a sum of single-layer resistances would lose.
//!
//! When the build-up holds an insulation that HEM:EPC lists as a material, the layer names that
//! material. HEM:EPC reads a wall as insulated from its layers' materials (the leakage estimate
//! without an air test uses this), and a layer's stated resistance and heat capacity win over its
//! material's own values, so the material changes nothing else. An insulation HEM:EPC does not
//! list (for example phenolic foam or cellulose), or a custom material, gives no material, as it
//! would when entered directly.

use serde_json::{json, Value};

/// The wall layer for an applied build-up, or what the build-up lacks to give one. A build-up
/// with no heat capacity of its own takes `stated_heat_capacity`, the wall's own value, which the
/// wall's construction carries and HEMIE uses in place of the layers' sum.
pub(super) fn wall_layer(
    envelope: &Value,
    stated_heat_capacity: Option<f64>,
) -> Result<Value, &'static str> {
    let resistance = envelope
        .get("thermalResistanceConstruction_m2K_W")
        .and_then(Value::as_f64)
        .filter(|r| *r > 0.0)
        .ok_or("construction resistance")?;
    let layers = envelope
        .pointer("/assemblySnapshot/layers")
        .and_then(Value::as_array)
        .filter(|layers| !layers.is_empty())
        .ok_or("layers")?;
    let thickness_m = layers
        .iter()
        .map(|layer| {
            let key = match layer.get("kind").and_then(Value::as_str) {
                Some("cavity") => "gap_thickness_m",
                _ => "thickness_m",
            };
            layer.get(key).and_then(Value::as_f64).filter(|t| *t > 0.0)
        })
        .sum::<Option<f64>>()
        .ok_or("thickness for every layer")?;
    let heat_capacity = envelope
        .get("arealHeatCapacity_J_m2K")
        .and_then(Value::as_f64)
        .or(stated_heat_capacity)
        .ok_or("areal heat capacity")?;
    let mut layer = json!({
        // HEMIE takes millimetres; rounded to 0.1 mm so float sums stay readable.
        "thickness_mm": (thickness_m * 10_000.0).round() / 10.0,
        "thermal_resistance_construction": resistance,
        "areal_heat_capacity": heat_capacity,
    });
    let insulation = layers.iter().find_map(|l| {
        insulation_material(
            l.get("materialId")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )
    });
    if let Some(material) = insulation {
        layer["material"] = json!(material);
    }
    Ok(layer)
}

/// The HEM:EPC insulation material for an assembly-library material id, by the library's own name.
fn insulation_material(material_id: &str) -> Option<&'static str> {
    Some(match material_id.strip_prefix("mat.iso.")? {
        "mineral_fibre_slab"
        | "mineral_wool_fibre_batt_in01"
        | "mineral_wool_fibre_fill_in11"
        | "mineral_wool_fibre_fill_in12" => "Mineral wool",
        "glass_fibre_organic_bonded" | "glass_fibre_quilt" | "glass_fibre_slab" | "glasswool" => {
            "Fibreglass"
        }
        "eps_slab" | "expanded_polystyrene_in31" | "dense_eps_slab_insulation_styrofoam" => "EPS",
        "cellular_polyisocyanurate" => "PIR",
        "cellular_polyurethane" | "expanded_polyurethane_in41" | "polyurethane_board" => "PUR",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope() -> Value {
        json!({
            "schemaVersion": 1,
            "assemblyId": "calculator:layered",
            "appliedAt": "2026-11-16T00:00:00Z",
            "assemblySnapshot": {"elementMode": "BuildingElementOpaque", "pitchDegrees": 90, "layers": [
                {"kind": "solid", "materialId": "plaster", "thickness_m": 0.013},
                {"kind": "solid", "materialId": "brick", "thickness_m": 0.1025},
                {"kind": "cavity", "ventilation": "unventilated", "gap_thickness_m": 0.05},
                {"kind": "solid", "materialId": "pir", "thickness_m": 0.1,
                 "repeatingBridges": [{"id": "s", "bridgeMaterialId": "timber", "definition": {"mode": "framing_fraction", "framingFraction": 0.1}}]}
            ]},
            "correctedU_W_m2K": 0.21,
            "thermalResistanceConstruction_m2K_W": 4.59,
            "arealHeatCapacity_J_m2K": 190_000.0
        })
    }

    #[test]
    fn a_build_up_is_one_layer_of_its_own_totals() {
        assert_eq!(
            wall_layer(&envelope(), Some(450_000.0)),
            Ok(
                json!({"thickness_mm": 265.5, "thermal_resistance_construction": 4.59, "areal_heat_capacity": 190_000.0})
            )
        );
    }

    /// A cavity wall from the assembly library: brick, mineral wool batts, block, plasterboard.
    fn library_wall(fill: &str) -> Value {
        json!({
            "assemblySnapshot": {"elementMode": "BuildingElementOpaque", "pitchDegrees": 90, "layers": [
                {"kind": "solid", "materialId": "mat.br443.brick_outer", "thickness_m": 0.1025},
                {"kind": "solid", "materialId": fill, "thickness_m": 0.1},
                {"kind": "solid", "materialId": "mat.iso.aerated_concrete_block", "thickness_m": 0.1},
                {"kind": "solid", "materialId": "mat.br443.gypsum_std", "thickness_m": 0.0125}
            ]},
            "thermalResistanceConstruction_m2K_W": 3.10,
            "arealHeatCapacity_J_m2K": 358_090.0
        })
    }

    /// U from the layers as HEM:EPC sums them, with HEM's surface resistances for a wall.
    fn u_of(layers: &[Value]) -> f64 {
        let r: f64 = layers
            .iter()
            .map(|l| l["thermal_resistance_construction"].as_f64().unwrap())
            .sum();
        1.0 / (r + 1.0 / 7.63 + 1.0 / 24.14)
    }

    #[test]
    fn insulation_in_a_build_up_gives_the_layer_its_material() {
        let layer =
            wall_layer(&library_wall("mat.iso.mineral_wool_fibre_batt_in01"), None).unwrap();
        // An insulating material marks the wall as insulated for the no-air-test leakage estimate.
        assert_eq!(layer["material"], "Mineral wool");
        // The stated resistance and heat capacity win over the material's own, so U is the build-up's.
        assert_eq!(layer["thermal_resistance_construction"], 3.10);
        assert_eq!(layer["areal_heat_capacity"], 358_090.0);
        assert_eq!(u_of(&[layer]), 1.0 / (3.10 + 1.0 / 7.63 + 1.0 / 24.14));
    }

    #[test]
    fn a_build_up_with_no_insulation_names_no_material() {
        let mut e = library_wall("mat.iso.aerated_concrete_block");
        e["thermalResistanceConstruction_m2K_W"] = json!(0.79);
        let layer = wall_layer(&e, None).unwrap();
        assert!(layer.get("material").is_none());
        assert_eq!(u_of(&[layer]), 1.0 / (0.79 + 1.0 / 7.63 + 1.0 / 24.14));
    }

    #[test]
    fn each_library_insulation_maps_to_its_material() {
        for (id, material) in [
            ("mat.iso.glass_fibre_quilt", "Fibreglass"),
            ("mat.iso.eps_slab", "EPS"),
            ("mat.iso.cellular_polyisocyanurate", "PIR"),
            ("mat.iso.polyurethane_board", "PUR"),
        ] {
            assert_eq!(
                wall_layer(&library_wall(id), None).unwrap()["material"],
                material
            );
        }
    }

    #[test]
    fn a_build_up_with_no_heat_capacity_takes_the_walls_own() {
        let mut e = envelope();
        e.as_object_mut().unwrap().remove("arealHeatCapacity_J_m2K");
        assert_eq!(
            wall_layer(&e, Some(450_000.0)).unwrap()["areal_heat_capacity"],
            450_000.0
        );
        assert_eq!(wall_layer(&e, None), Err("areal heat capacity"));
    }

    #[test]
    fn a_layer_with_no_thickness_names_what_is_missing() {
        let mut e = envelope();
        // An older cavity states only its resistance.
        e["assemblySnapshot"]["layers"][2] =
            json!({"kind": "cavity", "cavityType": "unventilated", "fixedResistance_m2K_W": 0.18});
        assert_eq!(wall_layer(&e, None), Err("thickness for every layer"));
        e["assemblySnapshot"]["layers"] = json!([]);
        assert_eq!(wall_layer(&e, None), Err("layers"));
        e["thermalResistanceConstruction_m2K_W"] = json!(0.0);
        assert_eq!(wall_layer(&e, None), Err("construction resistance"));
    }
}
