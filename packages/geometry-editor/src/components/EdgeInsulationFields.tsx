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
  extraJsonEdgeInsulationToFormValues,
  formValuesToExtraJsonEdgeInsulation,
  type EdgeInsulationFormValues,
} from '../lib/edgeInsulation';
import { useKeyedState } from '../hooks/useKeyedState';

export interface EdgeInsulationFieldsProps {
  value: unknown;
  onChange: (next: unknown) => void;
  elementType: string;
  flat?: boolean;
}

/** Match JsonForms `NumberControl` row spacing in Advanced Fields (`jsonformsRenderers.tsx`). */
const ROW_MARGIN = (compact: boolean) => (compact ? '6px 0' : '10px 0');

export const EdgeInsulationFields: React.FC<EdgeInsulationFieldsProps> = ({
  value,
  onChange,
  elementType,
  flat = false,
}) => {
  const schemaPort = useGeometrySchemaPort();
  const useFHSSchema = useGeometryStore((state) => !!state.complianceSettings?.complianceValidationEnabled);
  const valueKey = useMemo(() => JSON.stringify(value ?? null), [value]);
  const [form, setForm] = useKeyedState<EdgeInsulationFormValues>(
    valueKey,
    extraJsonEdgeInsulationToFormValues(value),
  );

  const apply = useCallback(
    (next: EdgeInsulationFormValues) => {
      setForm(next);
      const ser = formValuesToExtraJsonEdgeInsulation(next);
      if (ser.ok) {
        onChange(ser.value);
      }
    },
    [onChange, setForm],
  );

  const dimLabel =
    form.orientation === 'vertical'
      ? 'Depth (m)'
      : form.orientation === 'horizontal'
        ? 'Width (m)'
        : 'Width / depth (m)';

  const compact = Boolean(flat);
  const resistancePresentation = resolveFieldPresentation({
    mode: useFHSSchema ? 'fhs' : 'core',
    propertyKey: 'edge_thermal_resistance',
    elementType,
    subtype: 'Slab_edge_insulation',
    label: 'Edge thermal resistance (m²·K/W)',
  }, schemaPort);
  const dimensionPropertyKey = form.orientation === 'vertical' ? 'depth' : 'width';
  const dimensionPresentation = resolveFieldPresentation({
    mode: useFHSSchema ? 'fhs' : 'core',
    propertyKey: dimensionPropertyKey,
    elementType,
    subtype: 'Slab_edge_insulation',
    label: dimLabel,
  }, schemaPort);

  return (
    <div data-field-key="edge_insulation" style={{ width: '100%' }}>
      <div style={{ margin: ROW_MARGIN(compact) }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
          {renderFieldLabelWithTooltip('Edge Insulation', elementType)}
        </div>
        <StandardDropdown
          label={
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
              Orientation
            </span>
          }
          value={form.orientation}
          onChange={(v) => {
            const orientation = v === 'horizontal' || v === 'vertical' ? v : '';
            apply({
              ...form,
              orientation,
              ...(orientation === '' ? { edgeThermalResistance: '', widthOrDepth: '' } : {}),
            });
          }}
          options={[
            { value: '', label: '—' },
            { value: 'horizontal', label: 'Horizontal' },
            { value: 'vertical', label: 'Vertical' },
          ]}
          placeholder=""
          size="md"
          variant="ghost"
        />
      </div>

      <div style={{ margin: ROW_MARGIN(compact) }}>
        <StandardInput
          label={<ResolvedFieldLabel presentation={resistancePresentation} useFHSSchema={useFHSSchema} />}
          type="number"
          unit={fieldUnitForAdornment(resistancePresentation)}
          step="any"
          size="md"
          variant="ghost"
          disabled={!form.orientation}
          value={form.edgeThermalResistance}
          onChange={(e) => apply({ ...form, edgeThermalResistance: e.target.value })}
        />
      </div>

      <div style={{ margin: ROW_MARGIN(compact) }}>
        <StandardInput
          label={<ResolvedFieldLabel presentation={dimensionPresentation} useFHSSchema={useFHSSchema} />}
          type="number"
          unit={fieldUnitForAdornment(dimensionPresentation)}
          step="any"
          size="md"
          variant="ghost"
          disabled={!form.orientation}
          value={form.widthOrDepth}
          onChange={(e) => apply({ ...form, widthOrDepth: e.target.value })}
        />
      </div>
    </div>
  );
};
