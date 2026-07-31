// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useMemo } from 'react';
import { StandardDropdown } from './StandardDropdown';
import { StandardInput } from './StandardInput';
import { renderFieldLabelWithTooltip } from './jsonformsRenderers';
import { ResolvedFieldLabel } from './ResolvedFieldLabel';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { useGeometryStore } from '../stores/geometryStore';
import { fieldUnitForAdornment, resolveFieldPresentation } from '../lib/fieldPresentation';
import {
  CompactSegmentedControl,
  CompactSwitch,
  WindowDetailSection,
  WINDOW_DETAIL_ROW_MARGIN,
} from './WindowDetailControls';
import {
  extraJsonToWindowTreatmentForm,
  mountingOutsideAllowed,
  TREATMENT_UI_KEY,
  windowTreatmentFormToExtraJson,
  type TreatmentCategory,
  type WindowTreatmentControl,
  type WindowTreatmentFormValues,
} from '../lib/windowTreatment';
import { useKeyedState } from '../hooks/useKeyedState';

export interface WindowTreatmentFieldsProps {
  treatment: unknown;
  treatmentUi: unknown;
  onPatch: (patch: Record<string, unknown>) => void;
  elementType: string;
  flat?: boolean;
}

const ROW = WINDOW_DETAIL_ROW_MARGIN;

const CATEGORY_OPTIONS: { value: TreatmentCategory; label: string }[] = [
  { value: 'white_venetian', label: 'Venetian' },
  { value: 'white_curtains', label: 'Curtains' },
  { value: 'coloured', label: 'Coloured' },
  { value: 'aluminium', label: 'Aluminium' },
];

/** One dropdown: maps to HEM `controls` enum (no duplicate “Control” rows). */
const CONTROL_OPTIONS: { value: WindowTreatmentControl; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'manual_motorised', label: 'Motorised (manual)' },
  { value: 'auto_motorised', label: 'Automatic' },
  { value: 'combined_light_blind_HVAC', label: 'Linked lights / HVAC' },
];

/** Secondary clause on the same line as the field title (units, range, hints). */
const labelInlineSuffix: React.CSSProperties = {
  fontWeight: 400,
  color: 'var(--text-secondary)',
  fontSize: '12px',
};

function inlineLabelRow(primary: React.ReactNode, suffix: string): React.ReactNode {
  return (
    <span
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        columnGap: '10px',
        rowGap: '2px',
      }}
    >
      <span>{primary}</span>
      <span style={labelInlineSuffix}>{suffix}</span>
    </span>
  );
}

/** Table 3.6.b row index → concise solar-blocking band (Low/Medium/High). */
function solarBlockageLabel(tier: 0 | 1 | 2): string {
  return tier === 0 ? 'Low' : tier === 1 ? 'Medium' : 'High';
}

export const WindowTreatmentFields: React.FC<WindowTreatmentFieldsProps> = ({
  treatment,
  treatmentUi,
  onPatch,
  elementType,
  flat = false,
}) => {
  const schemaPort = useGeometrySchemaPort();
  const useFHSSchema = useGeometryStore((state) => !!state.complianceSettings?.complianceValidationEnabled);
  const key = useMemo(() => JSON.stringify({ treatment, treatmentUi }), [treatment, treatmentUi]);
  const [form, setForm] = useKeyedState<WindowTreatmentFormValues>(
    key,
    extraJsonToWindowTreatmentForm(treatment, treatmentUi),
  );

  const apply = useCallback(
    (next: WindowTreatmentFormValues) => {
      setForm(next);
      const ser = windowTreatmentFormToExtraJson(next);
      if (!ser.ok) return;
      const patch: Record<string, unknown> = {
        treatment: ser.treatment,
      };
      if (ser.treatmentUi) patch[TREATMENT_UI_KEY] = ser.treatmentUi;
      else patch[TREATMENT_UI_KEY] = null;
      onPatch(patch);
    },
    [onPatch, setForm],
  );

  const compact = Boolean(flat);
  const cat = form.category || 'white_venetian';
  const showColoured = cat === 'coloured';
  const outsideOk = mountingOutsideAllowed(cat, form.colouredKind);
  const tableMode = form.source !== 'custom';
  const transmittancePresentation = resolveFieldPresentation({
    mode: useFHSSchema ? 'fhs' : 'core',
    propertyKey: 'trans_red',
    elementType,
    label: 'Solar entering the room when closed',
  }, schemaPort);
  const deltaRPresentation = resolveFieldPresentation({
    mode: useFHSSchema ? 'fhs' : 'core',
    propertyKey: 'delta_r',
    elementType,
    label: 'Thermal resistivity increase (m²·K/W)',
  }, schemaPort);

  const goCustom = () =>
    apply({
      ...form,
      source: 'custom',
      custom_type: form.custom_type || 'blinds',
      custom_trans_red: form.custom_trans_red || '',
    });

  const goTable = () => apply({ ...form, source: 'table' });

  return (
    <WindowDetailSection
      fieldKey="treatment"
      compact={compact}
      label={renderFieldLabelWithTooltip('Blinds / curtains', elementType)}
      actions={
        <>
          {form.enabled ? (
            <CompactSegmentedControl
              ariaLabel="Blinds or curtains source"
              value={tableMode ? 'table' : 'custom'}
              onChange={(value) => (value === 'custom' ? goCustom() : goTable())}
              options={[
                { value: 'table', label: 'Table' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          ) : null}
          <CompactSwitch
            checked={form.enabled}
            onChange={(checked) => apply({ ...form, enabled: checked })}
            label="On"
          />
        </>
      }
    >
      {form.enabled && (
        <div
          style={{
            border: 'var(--border-width-thin) solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: compact ? '6px 10px' : '8px 12px',
            boxSizing: 'border-box',
          }}
        >
          {tableMode && (
            <>
              <div style={{ margin: ROW(compact) }}>
                <StandardDropdown
                  label={<span style={{ fontSize: '12px', fontWeight: 500 }}>Preset</span>}
                  value={cat}
                  onChange={(v) => {
                    const next = v as TreatmentCategory;
                    apply({
                      ...form,
                      category: next,
                      tier: next === 'aluminium' ? 0 : form.tier,
                      mounting:
                        next === 'white_curtains' || (next === 'coloured' && form.colouredKind === 'curtains')
                          ? 'inside'
                          : form.mounting,
                    });
                  }}
                  options={CATEGORY_OPTIONS}
                  placeholder=""
                  size="md"
                  variant="ghost"
                />
              </div>

              {showColoured && (
                <div style={{ margin: ROW(compact) }}>
                  <StandardDropdown
                    label={<span style={{ fontSize: '12px', fontWeight: 500 }}>Fabric</span>}
                    value={form.colouredKind}
                    onChange={(v) => {
                      const ck = v === 'curtains' ? 'curtains' : 'blinds';
                      apply({
                        ...form,
                        colouredKind: ck,
                        mounting: ck === 'curtains' ? 'inside' : form.mounting,
                      });
                    }}
                    options={[
                      { value: 'blinds', label: 'Blinds' },
                      { value: 'curtains', label: 'Curtains' },
                    ]}
                    placeholder=""
                    size="md"
                    variant="ghost"
                  />
                </div>
              )}

              {cat !== 'aluminium' && (
                <div style={{ margin: ROW(compact) }}>
                  <StandardDropdown
                    label={<span style={{ fontSize: '12px', fontWeight: 500 }}>Solar blockage</span>}
                    value={String(form.tier)}
                    onChange={(v) => apply({ ...form, tier: Number(v) as 0 | 1 | 2 })}
                    options={[
                      { value: '0', label: solarBlockageLabel(0) },
                      { value: '1', label: solarBlockageLabel(1) },
                      { value: '2', label: solarBlockageLabel(2) },
                    ]}
                    placeholder=""
                    size="md"
                    variant="ghost"
                  />
                </div>
              )}

              <div style={{ margin: ROW(compact) }}>
                <StandardDropdown
                  label={<span style={{ fontSize: '12px', fontWeight: 500 }}>Placement</span>}
                  value={form.mounting}
                  onChange={(v) => apply({ ...form, mounting: v === 'outside' ? 'outside' : 'inside' })}
                  options={[
                    { value: 'inside', label: 'Inside' },
                    ...(outsideOk ? [{ value: 'outside', label: 'Outside' }] : []),
                  ]}
                  placeholder=""
                  size="md"
                  variant="ghost"
                />
              </div>
            </>
          )}

          {!tableMode && (
            <>
              <div style={{ margin: ROW(compact) }}>
                <StandardDropdown
                  label={<span style={{ fontSize: '12px', fontWeight: 500 }}>Kind</span>}
                  value={form.custom_type || 'blinds'}
                  onChange={(v) =>
                    apply({ ...form, custom_type: v === 'curtains' ? 'curtains' : 'blinds' })
                  }
                  options={[
                    { value: 'blinds', label: 'Blinds' },
                    { value: 'curtains', label: 'Curtains' },
                  ]}
                  placeholder=""
                  size="md"
                  variant="ghost"
                />
              </div>
              <div style={{ margin: ROW(compact) }}>
                <StandardInput
                  label={inlineLabelRow(
                    <ResolvedFieldLabel presentation={transmittancePresentation} useFHSSchema={useFHSSchema} />,
                    '0–1. Higher = more sun gets in.',
                  )}
                  title="Fraction of solar heat that still enters the zone when closed (0–1). HEM trans_red."
                  type="number"
                  unit={fieldUnitForAdornment(transmittancePresentation)}
                  step="any"
                  size="md"
                  variant="ghost"
                  value={form.custom_trans_red}
                  onChange={(e) => apply({ ...form, custom_trans_red: e.target.value })}
                />
              </div>
            </>
          )}

          <div style={{ margin: ROW(compact) }}>
            <StandardInput
              label={<ResolvedFieldLabel presentation={deltaRPresentation} useFHSSchema={useFHSSchema} />}
              title="HEM delta_r: added thermal resistance (fabric and air gap), in m²·K/W."
              type="number"
              unit={fieldUnitForAdornment(deltaRPresentation)}
              step="any"
              size="md"
              variant="ghost"
              value={form.delta_r}
              onChange={(e) => apply({ ...form, delta_r: e.target.value })}
            />
          </div>

          <div style={{ margin: ROW(compact) }}>
            <StandardDropdown
              label={<span style={{ fontSize: '12px', fontWeight: 500 }}>Control</span>}
              value={form.controls}
              onChange={(v) =>
                apply({
                  ...form,
                  controls: v as WindowTreatmentControl,
                })
              }
              options={CONTROL_OPTIONS}
              placeholder=""
              size="md"
              variant="ghost"
            />
          </div>
        </div>
      )}
    </WindowDetailSection>
  );
};
