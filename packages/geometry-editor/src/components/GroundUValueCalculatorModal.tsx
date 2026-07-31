// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { ModalHeader } from './ModalHeader';
import { DraftSafeNumberInput } from './DraftSafeNumberInput';
import {
  AIR_HEAT_CAPACITY_WH_PER_M3K,
  computeGroundUValueFromElementModel,
  DEFAULT_BASEMENT_VENTILATION_RATE_ACH,
  DEFAULT_WIND_SPEED_MPS_GROUND_U,
  parseWindShieldLocation,
} from '../lib/groundUValueCalculator';
import { useKeyedState } from '../hooks/useKeyedState';

export interface GroundUValueCalculatorApplyPatch {
  u_value: number;
  /** BS EN ISO 13370 ventilation term — stored in extra_json for suspended floors (default 5 m/s, BR 497 section 4.7.2 alignment). */
  wind_speed_mps?: number;
  /** Optional; this modal does not write R_g — edit `thermal_resist_insul` in Advanced Fields (kept for callers that merge patches manually). */
  thermal_resist_insul?: number;
}

interface GroundUValueCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentData: any;
  advancedFieldsData: Record<string, unknown>;
  subtype?: string;
  onApply: (patch: GroundUValueCalculatorApplyPatch) => void;
}

const readFinite = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

export const GroundUValueCalculatorModal: React.FC<GroundUValueCalculatorModalProps> = ({
  isOpen,
  onClose,
  currentData,
  advancedFieldsData,
  subtype,
  onApply,
}) => {
  const initialWindInput = String(
    readFinite(advancedFieldsData?.wind_speed_mps) ?? DEFAULT_WIND_SPEED_MPS_GROUND_U,
  );
  const [windInput, setWindInput] = useKeyedState(
    `${isOpen ? 'open' : 'closed'}\0${initialWindInput}`,
    initialWindInput,
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const model = useMemo(() => {
    const totalArea = readFinite(currentData?.total_area);
    const perimeter = readFinite(currentData?.perimeter);
    const thicknessWalls = readFinite(currentData?.thickness_walls);
    const rFloor = readFinite(advancedFieldsData?.thermal_resistance_floor_construction);
    const depthBasementFloorM = readFinite(currentData?.depth_basement_floor);
    const readGroundField = (key: string): number | null =>
      readFinite(advancedFieldsData?.[key]) ?? readFinite(currentData?.[key]);
    const thermalTransmittanceFloorAboveBasement = readGroundField('thermal_transm_envi_base');
    const thermalTransmBasementWalls = readGroundField('thermal_transm_walls');
    const heightBasementWalls = readGroundField('height_basement_walls');
    const thermalResistanceBasementWalls = readGroundField('thermal_resist_walls_base');
    const floorType = (currentData?.floor_type ?? subtype ?? 'Slab_no_edge_insulation') as
      | 'Heated_basement'
      | 'Slab_no_edge_insulation'
      | 'Slab_edge_insulation'
      | 'Suspended_floor'
      | 'Unheated_basement';
    const windParsed = readFinite(windInput);
    const rgParsed = Math.max(0, readFinite(advancedFieldsData?.thermal_resist_insul) ?? 0);

    const suspendedInputs =
      floorType === 'Suspended_floor'
        ? {
            heightUpperSurface: readFinite(advancedFieldsData?.height_upper_surface) ?? 0,
            thermalTransmWalls: readFinite(advancedFieldsData?.thermal_transm_walls) ?? 0,
            areaPerPerimeterVent: readFinite(advancedFieldsData?.area_per_perimeter_vent) ?? 0,
            shieldFactLocation: parseWindShieldLocation(advancedFieldsData?.shield_fact_location),
            thermalResistanceGroundInsulation: Math.max(0, rgParsed),
            windSpeedMps: windParsed ?? DEFAULT_WIND_SPEED_MPS_GROUND_U,
          }
        : undefined;

    const isBasementFloor =
      floorType === 'Heated_basement' || floorType === 'Unheated_basement';
    const isUnheatedBasementFloor = floorType === 'Unheated_basement';
    const basementAirVolume =
      isUnheatedBasementFloor
      && totalArea != null
      && depthBasementFloorM != null
      && heightBasementWalls != null
        ? totalArea * (depthBasementFloorM + heightBasementWalls)
        : null;

    const required = [
      { key: 'thermal_resistance_floor_construction', label: 'Floor construction R', ok: rFloor != null && rFloor > 0 },
      { key: 'total_area', label: 'Total area (auto)', ok: totalArea != null && totalArea > 0 },
      { key: 'perimeter', label: 'Perimeter (auto)', ok: perimeter != null && perimeter > 0 },
      { key: 'thickness_walls', label: 'Wall thickness', ok: thicknessWalls != null && thicknessWalls > 0 },
      ...(isBasementFloor
        ? [
            {
              key: 'depth_basement_floor',
              label: 'Basement floor depth below ground',
              ok: depthBasementFloorM != null && depthBasementFloorM > 0,
            },
          ]
        : []),
      ...(isUnheatedBasementFloor
        ? [
            {
              key: 'thermal_transm_envi_base',
              label: 'Floor above basement U',
              ok: thermalTransmittanceFloorAboveBasement != null && thermalTransmittanceFloorAboveBasement > 0,
            },
            {
              key: 'thermal_transm_walls',
              label: 'Basement wall U above ground',
              ok: thermalTransmBasementWalls != null && thermalTransmBasementWalls > 0,
            },
            {
              key: 'height_basement_walls',
              label: 'Basement wall height above ground',
              ok: heightBasementWalls != null && heightBasementWalls > 0,
            },
            {
              key: 'thermal_resist_walls_base',
              label: 'Basement wall R below ground',
              ok: thermalResistanceBasementWalls != null && thermalResistanceBasementWalls > 0,
            },
          ]
        : []),
      ...(floorType === 'Suspended_floor'
        ? [
            { key: 'height_upper_surface', label: 'Height upper surface', ok: (suspendedInputs?.heightUpperSurface ?? 0) > 0 },
            { key: 'thermal_transm_walls', label: 'U-value adjacent walls', ok: (suspendedInputs?.thermalTransmWalls ?? 0) > 0 },
            { key: 'area_per_perimeter_vent', label: 'Vent area per perimeter', ok: (suspendedInputs?.areaPerPerimeterVent ?? -1) >= 0 },
            {
              key: 'wind_speed_mps',
              label: 'Wind speed (m/s)',
              ok: windParsed != null && windParsed >= 0,
            },
          ]
        : []),
    ];

    const canCalculate = required.every((item) => item.ok);
    const computedU = computeGroundUValueFromElementModel(currentData, advancedFieldsData, subtype, {
      windInput,
    });

    const fmt = (n: number | null | undefined, decimals: number, suffix: string): string =>
      n != null && Number.isFinite(n) ? `${n.toFixed(decimals)}${suffix}` : '—';

    const floorTypeDisplay = String(floorType).replace(/_/g, ' ');

    const detailRows: Array<{ key: string; label: string; ok: boolean; value: string }> = [
      { key: 'floor_type', label: 'Floor type', ok: true, value: floorTypeDisplay },
    ];

    for (const r of required) {
      let value = '—';
      switch (r.key) {
        case 'thermal_resistance_floor_construction':
          value = fmt(rFloor, 3, ' m²K/W');
          break;
        case 'total_area':
          value = fmt(totalArea, 2, ' m²');
          break;
        case 'perimeter':
          value = fmt(perimeter, 2, ' m');
          break;
        case 'thickness_walls':
          value = fmt(thicknessWalls, 3, ' m');
          break;
        case 'depth_basement_floor':
          value = fmt(depthBasementFloorM, 3, ' m');
          break;
        case 'thermal_transm_envi_base':
          value = fmt(thermalTransmittanceFloorAboveBasement, 4, ' W/m²K');
          break;
        case 'height_basement_walls':
          value = fmt(heightBasementWalls, 3, ' m');
          break;
        case 'thermal_resist_walls_base':
          value = fmt(thermalResistanceBasementWalls, 3, ' m²K/W');
          break;
        case 'height_upper_surface':
          value = fmt(suspendedInputs?.heightUpperSurface, 3, ' m');
          break;
        case 'thermal_transm_walls':
          value =
            floorType === 'Unheated_basement'
              ? fmt(thermalTransmBasementWalls, 4, ' W/m²K')
              : fmt(suspendedInputs?.thermalTransmWalls, 4, ' W/m²K');
          break;
        case 'area_per_perimeter_vent':
          if (
            suspendedInputs &&
            typeof suspendedInputs.areaPerPerimeterVent === 'number' &&
            Number.isFinite(suspendedInputs.areaPerPerimeterVent) &&
            suspendedInputs.areaPerPerimeterVent >= 0
          ) {
            value = `${suspendedInputs.areaPerPerimeterVent.toFixed(4)} m²/m`;
          }
          break;
        case 'wind_speed_mps':
          value = fmt(windParsed, 2, ' m/s');
          break;
        default:
          break;
      }
      detailRows.push({ key: r.key, label: r.label, ok: r.ok, value });
    }

    if (floorType === 'Suspended_floor') {
      detailRows.push({
        key: 'thermal_resist_insul',
        label: 'Thermal resistance insulation',
        ok: rgParsed > 0,
        value: rgParsed > 0 ? `${rgParsed.toFixed(3)} m²K/W` : '—',
      });
    }

    if (floorType === 'Unheated_basement') {
      detailRows.push(
        {
          key: 'basement_ventilation_rate',
          label: 'Basement ventilation rate n',
          ok: true,
          value: `${DEFAULT_BASEMENT_VENTILATION_RATE_ACH.toFixed(3)} ach`,
        },
        {
          key: 'basement_air_volume',
          label: 'Basement air volume V (auto)',
          ok: basementAirVolume != null && basementAirVolume > 0,
          value: fmt(basementAirVolume, 2, ' m³'),
        },
        {
          key: 'air_heat_capacity',
          label: 'Air heat capacity cρ',
          ok: true,
          value: `${AIR_HEAT_CAPACITY_WH_PER_M3K.toFixed(2)} Wh/m³K`,
        },
      );
    }

    detailRows.push({
      key: 'computed_u',
      label: 'Calculated U-value',
      ok: !!(canCalculate && computedU != null && computedU > 0),
      value: computedU != null && computedU > 0 ? `${computedU.toFixed(4)} W/m²K` : '—',
    });

    return {
      totalArea,
      perimeter,
      thicknessWalls,
      rFloor,
      depthBasementFloorM,
      floorType,
      suspendedInputs,
      basementAirVolume,
      required,
      detailRows,
      canCalculate,
      computedU,
      windParsed,
      rgParsed,
    };
  }, [currentData, advancedFieldsData, subtype, windInput]);

  if (!isOpen || typeof document === 'undefined') return null;

  const missing = model.required.filter((item) => !item.ok);

  return ReactDOM.createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal-container"
        style={{ maxWidth: 560, width: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ModalHeader title="Ground floor U-value calculator" onClose={onClose} />
        <div style={{ overflow: 'auto', padding: '0 16px 16px', flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
            Fill required fields, then calculate and write to <code style={{ fontSize: 11 }}>u_value</code>
            {model.floorType === 'Suspended_floor' ? (
              <>
                {' '}
                (and <code style={{ fontSize: 11 }}>wind_speed_mps</code> below). Thermal resistance insulation (under
                void) is read from Advanced Fields — including when set by the assembly calculator.
              </>
            ) : model.floorType === 'Heated_basement' ? (
              <>
                {' '}
                Basement floors use BS EN ISO 13370 §9.1-style equivalent thickness including{' '}
                <code style={{ fontSize: 11 }}>depth_basement_floor</code> (BR 443 §10.1).
              </>
            ) : model.floorType === 'Unheated_basement' ? (
              <>
                {' '}
                Unheated basements use BS EN ISO 13370 §7.4 overall <code style={{ fontSize: 11 }}>U_ub</code>;
                ventilation defaults to {DEFAULT_BASEMENT_VENTILATION_RATE_ACH} ach where no specific value is available.
              </>
            ) : null}
          </div>

          {model.floorType === 'Suspended_floor' && (
            <div
              style={{
                display: 'grid',
                gap: 10,
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary, rgba(255,255,255,0.04))',
              }}
            >
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Wind speed v (m/s) for ISO 13370 ventilation term — default {DEFAULT_WIND_SPEED_MPS_GROUND_U} m/s (BR 497
                2nd ed. section 4.7.2 / underfloor void assumptions)
                <DraftSafeNumberInput
                  min={0}
                  step={0.1}
                  value={windInput}
                  onChange={(e) => setWindInput(e.target.value)}
                  style={{
                    display: 'block',
                    marginTop: 6,
                    padding: '6px 8px',
                    height: 'var(--form-input-height)',
                    borderRadius: 'var(--form-input-radius)',
                    width: '100%',
                    maxWidth: 200,
                    background: 'var(--bg-primary)',
                    color: 'inherit',
                    border: '1px solid var(--border-subtle)',
                  }}
                />
              </label>
            </div>
          )}

          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            {model.detailRows.map((row) => (
              <div
                key={row.key}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  fontSize: 12,
                  color: row.ok ? 'var(--text-primary)' : 'var(--text-secondary)',
                  lineHeight: 1.45,
                }}
              >
                <span style={{ flexShrink: 0, width: 14, textAlign: 'center' }}>{row.ok ? '✓' : '○'}</span>
                <span style={{ flex: '1 1 auto', minWidth: 0 }}>{row.label}</span>
                <span style={{ flexShrink: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {missing.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
              Still needed: {missing.map((item) => item.label).join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-nav btn-small"
              disabled={!(model.canCalculate && model.computedU && model.computedU > 0)}
              onClick={() => {
                if (!model.computedU || !(model.computedU > 0)) return;
                const uVal = Number(model.computedU.toFixed(4));
                if (model.floorType === 'Suspended_floor') {
                  const w = model.windParsed ?? DEFAULT_WIND_SPEED_MPS_GROUND_U;
                  onApply({
                    u_value: uVal,
                    wind_speed_mps: Number(w.toFixed(3)),
                  });
                } else {
                  onApply({ u_value: uVal });
                }
                onClose();
              }}
            >
              Auto-calculate
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
