// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useMemo } from 'react';
import { StandardInput } from './StandardInput';
import { StandardDropdown } from './StandardDropdown';
import { CompactSegmentedControl } from './WindowDetailControls';
import { GroupAccordion, renderFieldLabelWithTooltip } from './jsonformsRenderers';
import { ResolvedFieldLabel } from './ResolvedFieldLabel';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { targetSchemaMode } from '../../../geometry-editor-host/src/schemaPort';
import { fieldUnitForAdornment, resolveFieldPresentation } from '../lib/fieldPresentation';
import {
  edgeInsulationMethod,
  extraJsonEdgeInsulationToFormValues,
  formValuesToExtraJsonEdgeInsulation,
  switchEdgeInsulationMethod,
  type EdgeInsulationFormValues,
  type EdgeInsulationMethod,
  type EdgeInsulationSegmentValues,
} from '../lib/edgeInsulation';
import { readRecord } from '../lib/jsonTypes';
import { hemieFieldLabel, hemieValueLabel } from '../lib/hemieFabric';
import { useKeyedState } from '../hooks/useKeyedState';
import { useGeometryStore } from '../stores/geometryStore';
import { isExistingBuilding } from '../lib/windowOpenings';

export interface EdgeInsulationFieldsProps {
  value: unknown;
  onChange: (next: unknown) => void;
  elementType: string;
  /** The element the fields edit; the chosen method is held per element. */
  elementKey?: string;
  flat?: boolean;
}

/** Match JsonForms `NumberControl` row spacing in Advanced Fields (`jsonformsRenderers.tsx`). */
const ROW_MARGIN = (compact: boolean) => (compact ? '6px 0' : '10px 0');

const METHODS: { value: EdgeInsulationMethod; label: string }[] = [
  { value: 'resistance', label: 'Resistance' },
  { value: 'thickness', label: 'Thickness and material' },
];
/** HEMIE takes a material's conductivity from its own table, which has none for XPS: XPS needs one stated. */
const NEEDS_CONDUCTIVITY = new Set(['XPS']);

export const EdgeInsulationFields: React.FC<EdgeInsulationFieldsProps> = ({
  value,
  onChange,
  elementType,
  elementKey,
  flat = false,
}) => {
  const schemaPort = useGeometrySchemaPort();
  const schemaMode = targetSchemaMode(schemaPort);
  const existing = useGeometryStore(isExistingBuilding);
  // The existing-building materials, from the target schema.
  const materials = useMemo(() => {
    if (!existing || schemaPort.availability !== 'available') return [];
    const values = readRecord(readRecord(readRecord(schemaPort.getRootSchema(schemaMode)).$defs).WallInsulationMaterial).enum;
    return Array.isArray(values) ? values.map((value) => ({ value: String(value), label: hemieValueLabel('material', value) })) : [];
  }, [existing, schemaPort, schemaMode]);
  const valueKey = useMemo(() => JSON.stringify(value ?? null), [value]);
  const [form, setForm] = useKeyedState<EdgeInsulationFormValues>(
    valueKey,
    extraJsonEdgeInsulationToFormValues(value),
  );
  // The method holds per element while a field is cleared to retype it; it follows the method the
  // values state, and with neither stated an existing building defaults to thickness and material.
  const statedMethod = edgeInsulationMethod(form);
  const [chosenMethod, setChosenMethod] = useKeyedState<EdgeInsulationMethod>(String(elementKey), statedMethod ?? 'thickness');
  if (statedMethod && statedMethod !== chosenMethod) setChosenMethod(statedMethod);

  const apply = useCallback(
    (next: EdgeInsulationFormValues) => {
      setForm(next);
      const ser = formValuesToExtraJsonEdgeInsulation(next, existing);
      if (ser.ok) {
        onChange(ser.value);
      }
    },
    [onChange, setForm, existing],
  );

  const compact = Boolean(flat);
  // A new build states resistance; an existing building either method, one at a time.
  const method: EdgeInsulationMethod = existing ? statedMethod ?? chosenMethod : 'resistance';
  const switchMethod = (to: EdgeInsulationMethod) => {
    setChosenMethod(to);
    apply(switchEdgeInsulationMethod(form, to));
  };
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
    const set = (patch: Partial<EdgeInsulationSegmentValues>) => apply({ ...form, [type]: { ...form[type], ...patch } });
    const number = (key: 'edgeThermalResistance' | 'widthOrDepth' | 'thickness' | 'thermalConductivity', label: React.ReactNode, unit?: string, placeholder?: string) => (
      <div style={{ margin: ROW_MARGIN(compact) }}>
        <StandardInput
          label={label}
          type="number"
          unit={unit}
          step="any"
          size="md"
          variant="ghost"
          placeholder={placeholder}
          value={form[type][key]}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      </div>
    );
    const resistance = number('edgeThermalResistance', <ResolvedFieldLabel presentation={resistancePresentation} useFHSSchema={schemaMode === 'fhs'} />, fieldUnitForAdornment(resistancePresentation));
    // DESNZ-defined: vertical edge insulation 0.26 m deep, 0.025 m of mineral wool (HEMIE's
    // EdgeInsulationVertical defaults). A horizontal width has no default.
    const dimension = number('widthOrDepth', <ResolvedFieldLabel presentation={dimensionPresentation} useFHSSchema={schemaMode === 'fhs'} />,
      fieldUnitForAdornment(dimensionPresentation), existing && type === 'vertical' ? '0.26 m (default)' : undefined);
    const conductivity = number('thermalConductivity', hemieFieldLabel('thermal_conductivity'), 'W/m·K',
      NEEDS_CONDUCTIVITY.has(form[type].material) ? 'Required for XPS' : 'From the material');
    return (
      <div key={type}>
        <div style={{ margin: ROW_MARGIN(compact), fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
          {type === 'vertical' ? 'Vertical edge insulation' : 'Horizontal edge insulation'}
        </div>
        {method === 'resistance' ? <>{resistance}{dimension}</> : <>
          {dimension}
          {number('thickness', hemieFieldLabel('thickness'), 'm', '0.025 m (default)')}
          <div style={{ margin: ROW_MARGIN(compact) }}>
            <StandardDropdown label={hemieFieldLabel('material')} value={form[type].material} options={materials}
              onChange={(value) => set({ material: value })} placeholder="Mineral wool (default)" variant="ghost" size="md" />
          </div>
          {/* A conductivity XPS needs stays in view; otherwise it is detail. */}
          {NEEDS_CONDUCTIVITY.has(form[type].material) ? conductivity : (
            <GroupAccordion label="More" hint="thermal conductivity" openInitially={!!form[type].thermalConductivity}>
              {conductivity}
            </GroupAccordion>
          )}
        </>}
      </div>
    );
  };

  return (
    <div data-field-key="edge_insulation" style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', margin: ROW_MARGIN(compact) }}>
        {renderFieldLabelWithTooltip('Edge Insulation', elementType)}
      </div>
      {existing && (
        <p style={{ margin: ROW_MARGIN(compact), fontSize: 12, color: 'var(--text-secondary)' }}>
          Leave blank for the default: vertical, 0.26 m deep, 25 mm mineral wool. Horizontal edge insulation has no default width.
        </p>
      )}
      {existing && (
        <div style={{ display: 'grid', gap: 6, margin: ROW_MARGIN(compact) }}>
          <div className="element-label">Edge insulation from</div>
          <CompactSegmentedControl ariaLabel="Edge insulation from" value={method} options={METHODS} onChange={switchMethod} />
        </div>
      )}
      {segment('horizontal')}
      {segment('vertical')}
    </div>
  );
};
