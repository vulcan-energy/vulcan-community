// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useMemo } from 'react';
import { StandardInput } from './StandardInput';
import { renderFieldLabelWithTooltip } from './jsonformsRenderers';
import { ResolvedFieldLabel } from './ResolvedFieldLabel';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { targetSchemaMode } from '../../../geometry-editor-host/src/schemaPort';
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
  const schemaMode = targetSchemaMode(schemaPort);
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

  const compact = Boolean(flat);
  const segment = (type: 'horizontal' | 'vertical') => {
    const dimLabel = type === 'vertical' ? 'Depth (m)' : 'Width (m)';
    const resistancePresentation = resolveFieldPresentation({
      mode: schemaMode,
      propertyKey: 'edge_thermal_resistance',
      elementType,
      subtype: 'Slab_edge_insulation',
      label: 'Edge thermal resistance (m²·K/W)',
    }, schemaPort);
    const dimensionPresentation = resolveFieldPresentation({
      mode: schemaMode,
      propertyKey: type === 'vertical' ? 'depth' : 'width',
      elementType,
      subtype: 'Slab_edge_insulation',
      label: dimLabel,
    }, schemaPort);
    return (
      <div key={type}>
        <div style={{ margin: ROW_MARGIN(compact), fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
          {type === 'vertical' ? 'Vertical edge insulation' : 'Horizontal edge insulation'}
        </div>
        <div style={{ margin: ROW_MARGIN(compact) }}>
          <StandardInput
            label={<ResolvedFieldLabel presentation={resistancePresentation} useFHSSchema={schemaMode === 'fhs'} />}
            type="number"
            unit={fieldUnitForAdornment(resistancePresentation)}
            step="any"
            size="md"
            variant="ghost"
            value={form[type].edgeThermalResistance}
            onChange={(e) => apply({ ...form, [type]: { ...form[type], edgeThermalResistance: e.target.value } })}
          />
        </div>
        <div style={{ margin: ROW_MARGIN(compact) }}>
          <StandardInput
            label={<ResolvedFieldLabel presentation={dimensionPresentation} useFHSSchema={schemaMode === 'fhs'} />}
            type="number"
            unit={fieldUnitForAdornment(dimensionPresentation)}
            step="any"
            size="md"
            variant="ghost"
            value={form[type].widthOrDepth}
            onChange={(e) => apply({ ...form, [type]: { ...form[type], widthOrDepth: e.target.value } })}
          />
        </div>
      </div>
    );
  };

  return (
    <div data-field-key="edge_insulation" style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', margin: ROW_MARGIN(compact) }}>
        {renderFieldLabelWithTooltip('Edge Insulation', elementType)}
      </div>
      {segment('horizontal')}
      {segment('vertical')}
    </div>
  );
};
