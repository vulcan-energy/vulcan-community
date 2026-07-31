// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useMemo, useCallback } from 'react';
import { StandardDropdown } from './StandardDropdown';
import { StandardInput } from './StandardInput';
import { renderFieldLabelWithTooltip } from './jsonformsRenderers';
import { ResolvedFieldLabel } from './ResolvedFieldLabel';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { useGeometryStore } from '../stores/geometryStore';
import { fieldUnitForAdornment, resolveFieldPresentation } from '../lib/fieldPresentation';
import { useKeyedState } from '../hooks/useKeyedState';
import {
  collectHeatSourceWetNameLabelsFromProject,
  collectHeatSourceWetNamesFromProject,
} from '../lib/heatSourceWetNamesFromProject';
import type { Element, System } from '../geometry/types';

const HW_CYL = 'hw cylinder';

const IMMERSION_VALUE = '__dhw_immersion__';

function defaultImmersionHeater(powerKw: number): Record<string, unknown> {
  return {
    type: 'ImmersionHeater',
    power: powerKw,
    EnergySupply: 'mains elec',
    heater_position: 0.1,
    thermostat_position: 0.33,
  };
}

function defaultWetHeaterSource(name: string): Record<string, unknown> {
  return {
    type: 'HeatSourceWet',
    name,
    temp_flow_limit_upper: 65,
    heater_position: 0.1,
    thermostat_position: 0.33,
  };
}

function readHwCylinder(ex: unknown): Record<string, unknown> | null {
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return null;
  const hwc = (ex as Record<string, unknown>).HotWaterSource;
  if (!hwc || typeof hwc !== 'object' || Array.isArray(hwc)) return null;
  const inner = (hwc as Record<string, unknown>)[HW_CYL];
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null;
  return inner as Record<string, unknown>;
}

function detectSelectionFromHeatSource(heatSource: unknown, wetNames: string[]): string {
  if (!heatSource || typeof heatSource !== 'object' || Array.isArray(heatSource)) {
    return '';
  }
  const m = heatSource as Record<string, unknown>;
  const entries = Object.entries(m);
  if (entries.length !== 1) return '';
  const [k, v] = entries[0];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  const t = (v as Record<string, unknown>).type;
  if (t === 'ImmersionHeater' && k === 'immersion') {
    return IMMERSION_VALUE;
  }
  if (t === 'HeatSourceWet') {
    const nm = (v as Record<string, unknown>).name;
    if (typeof nm === 'string' && wetNames.includes(nm)) {
      return `wet:${nm}`;
    }
  }
  return '';
}

function readImmersionPowerKw(inner: Record<string, unknown> | null): number | null {
  if (!inner) return null;
  const hs = inner.HeatSource;
  if (!hs || typeof hs !== 'object' || Array.isArray(hs)) return null;
  const imm = (hs as Record<string, unknown>).immersion;
  if (!imm || typeof imm !== 'object' || Array.isArray(imm)) return null;
  const p = (imm as Record<string, unknown>).power;
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
}

export const DhwStorageHeatSourcePicker: React.FC<{
  elementsById: Record<string, Element>;
  systemElement: System;
  onPatchExtraJson: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  flat?: boolean;
}> = ({ elementsById, systemElement, onPatchExtraJson, flat }) => {
  const schemaPort = useGeometrySchemaPort();
  const useFHSSchema = useGeometryStore((state) => !!state.complianceSettings?.complianceValidationEnabled);
  const powerPresentation = resolveFieldPresentation({
    mode: useFHSSchema ? 'fhs' : 'core',
    propertyKey: 'power',
    elementType: 'System',
    subtype: 'HotWaterSource',
    label: 'Power (kW)',
  }, schemaPort);
  const wetNames = useMemo(
    () => collectHeatSourceWetNamesFromProject(elementsById),
    [elementsById],
  );
  const wetNameLabels = useMemo(
    () => collectHeatSourceWetNameLabelsFromProject(elementsById),
    [elementsById],
  );

  const { show, selection, immersionPowerKw, hasImmersion } = useMemo(() => {
    const ex = systemElement?.extra_json;
    const inner0 = readHwCylinder(ex);
    if (!inner0 || inner0.type !== 'StorageTank') {
      return {
        show: false,
        selection: '',
        immersionPowerKw: null as number | null,
        hasImmersion: false,
      };
    }
    const heatSource = inner0.HeatSource;
    const imm =
      heatSource && typeof heatSource === 'object' && !Array.isArray(heatSource)
        ? (heatSource as Record<string, unknown>).immersion
        : undefined;
    return {
      show: true,
      selection: detectSelectionFromHeatSource(heatSource, wetNames),
      immersionPowerKw: readImmersionPowerKw(inner0),
      hasImmersion: !!(imm && typeof imm === 'object' && !Array.isArray(imm)),
    };
  }, [systemElement?.extra_json, wetNames]);

  const options = useMemo(() => {
    const o: { value: string; label: string }[] = [
      { value: '', label: 'Manual (Advanced below)' },
      { value: IMMERSION_VALUE, label: 'Immersion' },
    ];
    for (const w of wetNames) {
      o.push({ value: `wet:${w}`, label: `Wet: ${wetNameLabels[w] ?? w}` });
    }
    return o;
  }, [wetNameLabels, wetNames]);

  const applySelection = useCallback(
    (value: string, powerKw?: number) => {
      onPatchExtraJson((prev) => {
        const next = { ...prev };
        const hws0 = (next as Record<string, unknown>).HotWaterSource;
        const hws = hws0 && typeof hws0 === 'object' && !Array.isArray(hws0) ? { ...(hws0 as Record<string, unknown>) } : {};
        const cyl0 = hws[HW_CYL];
        const cyl =
          cyl0 && typeof cyl0 === 'object' && !Array.isArray(cyl0)
            ? { ...(cyl0 as Record<string, unknown>) }
            : { type: 'StorageTank' };
        if (cyl.type !== 'StorageTank') return prev;
        if (value === '' || !value) {
          return prev;
        }
        const p = typeof powerKw === 'number' && Number.isFinite(powerKw) ? powerKw : 3;
        if (value === IMMERSION_VALUE) {
          (hws as Record<string, unknown>)[HW_CYL] = {
            ...cyl,
            HeatSource: { immersion: defaultImmersionHeater(p) },
          };
        } else if (value.startsWith('wet:')) {
          const n = value.slice(4);
          (hws as Record<string, unknown>)[HW_CYL] = {
            ...cyl,
            HeatSource: { [n]: defaultWetHeaterSource(n) },
          };
        }
        (next as Record<string, unknown>).HotWaterSource = hws;
        return next;
      });
    },
    [onPatchExtraJson],
  );

  const patchImmersionPower = useCallback(
    (raw: string) => {
      const n = Number(String(raw).trim());
      if (!Number.isFinite(n) || n <= 0) return;
      onPatchExtraJson((prev) => {
        const next = { ...prev };
        const hws0 = (next as Record<string, unknown>).HotWaterSource;
        const hws = hws0 && typeof hws0 === 'object' && !Array.isArray(hws0) ? { ...(hws0 as Record<string, unknown>) } : {};
        const cyl0 = hws[HW_CYL];
        const cyl: Record<string, unknown> =
          cyl0 && typeof cyl0 === 'object' && !Array.isArray(cyl0)
            ? { ...(cyl0 as Record<string, unknown>) }
            : { type: 'StorageTank' };
        if (cyl.type !== 'StorageTank') return prev;
        const hs0 = cyl.HeatSource;
        if (!hs0 || typeof hs0 !== 'object' || Array.isArray(hs0)) return prev;
        const hs = { ...(hs0 as Record<string, unknown>) };
        const imm0 = hs.immersion;
        if (!imm0 || typeof imm0 !== 'object' || Array.isArray(imm0)) return prev;
        hs.immersion = { ...(imm0 as Record<string, unknown>), power: n };
        (hws as Record<string, unknown>)[HW_CYL] = { ...cyl, HeatSource: hs };
        (next as Record<string, unknown>).HotWaterSource = hws;
        return next;
      });
    },
    [onPatchExtraJson],
  );

  const showImmersionPowerEditor = selection === IMMERSION_VALUE || hasImmersion;

  const initialImmersionPowerText = String(immersionPowerKw ?? 3);
  const [immersionPowerText, setImmersionPowerText] = useKeyedState(
    `${selection}\0${initialImmersionPowerText}`,
    initialImmersionPowerText,
  );

  if (!show) {
    return null;
  }

  return (
    <div style={{ marginBottom: flat ? '10px' : 'var(--spacing-md)' }}>
      <div style={{ marginBottom: '4px' }}>{renderFieldLabelWithTooltip('Heat Source', 'System')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.4 }}>
        Add an immersion heater, or link to an existing heat source.
      </div>
      <StandardDropdown
        value={selection}
        onChange={(v) => applySelection(v || '', immersionPowerKw ?? 3)}
        options={options}
        placeholder="Choose…"
        size="md"
        variant="ghost"
      />
      {showImmersionPowerEditor && (
        <div style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>
            <strong>Required</strong> for immersion:{' '}
            <ResolvedFieldLabel presentation={powerPresentation} useFHSSchema={useFHSSchema} />
          </div>
          <StandardInput
            label={undefined}
            value={immersionPowerText}
            unit={fieldUnitForAdornment(powerPresentation)}
            onChange={(e) => setImmersionPowerText(e.currentTarget.value)}
            onBlur={() => patchImmersionPower(immersionPowerText)}
            size="md"
            variant="ghost"
          />
        </div>
      )}
    </div>
  );
};
