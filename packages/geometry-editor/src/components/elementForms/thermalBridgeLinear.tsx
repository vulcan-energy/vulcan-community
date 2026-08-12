// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// ThermalBridgeLinear (TBL) form family, moved verbatim from ElementCreator's five
// inline structures. TBL only ever hydrated from the element-selection chain (there
// is no ThermalBridgeLinear case in the global-selection chain), so this module's
// single hydrate covers it.
//
// TBL's length/Z0/Z1 fields belong to the service-line group shared with
// MechanicalVentilationDuctwork and WaterPipework (elementForms/serviceLine.tsx) —
// a single instance created by the orchestrator via useServiceLineFormState and
// captured here from ctx.serviceLine at useFormState time (same precedent as
// OnSiteGeneration's getCurrentOrientation), so hydrate/reset/buildElementData/
// renderPanel (which the module contract doesn't hand ctx.serviceLine directly) can
// still reach it. linearThermalTransmittanceInput, by contrast, is TBL-only and is
// fully owned by this module, including its own share of the legacy combined
// canvas-sync effect (same dep shape and ref idiom as serviceLine.tsx's own effect
// for the fields it owns).
//
// junctionPsiDefaultsPath/Map/Loading are pulled directly from the geometry store
// inside useFormState (contextShading precedent) rather than threaded through ctx,
// since TBL is their only reader in ElementCreator.
//
// formatPsiButtonLabel is TBL-only in the legacy component (used solely by its ψ
// shortcut buttons below) and moves here with its only caller.

import { useEffect, useRef } from 'react';
import { useGeometryStore, type Element } from '../../stores/geometryStore';
import { isServiceLineElementType } from '../../lib/serviceLineDrawModes';
import { writeTbLineMode } from '../../lib/thermalBridgeLineMode';
import { baseLinearPsiForJunction, getPApportionedLinearPsiForEditor } from '../../geometry/thermalBridge/linearTbPsi';
import { StandardInput } from '../StandardInput';
import { decimalInputProps, useDecimalInput, type NumericDraftInputBinding } from './formPrimitives';
import {
  hydrateServiceLineFromElement,
  renderServiceLineCoreFields,
  resetServiceLine,
  type ServiceLineFormGroup,
} from './serviceLine';
import type { ElementFormModule, ElementFormStateCtx } from './types';

/** Compact ψ for button labels (e.g. 0.05, 1, −0.09). TBL-only — moved from
 * ElementCreator.tsx with its only caller below. */
function formatPsiButtonLabel(v: number): string {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export interface ThermalBridgeLinearFormState {
  linearThermalTransmittanceInput: NumericDraftInputBinding;
  /** Shared with MVD/WP — see module header comment. */
  serviceLine: ServiceLineFormGroup;
  junctionPsiDefaultsPath: string | undefined;
  junctionPsiDefaultsMap: Record<string, number>;
  junctionPsiDefaultsLoading: boolean;
}

function useFormState(ctx: ElementFormStateCtx): ThermalBridgeLinearFormState {
  const linearThermalTransmittanceInput = useDecimalInput(
    '',
    ctx.commitElementNumericField('linear_thermal_transmittance'),
    { commitOnChange: false, formatOnBlur: 'preserve' },
  );
  const linearThermalTransmittanceInputSetValueRef = useRef(linearThermalTransmittanceInput.syncValue);
  useEffect(() => {
    linearThermalTransmittanceInputSetValueRef.current = linearThermalTransmittanceInput.syncValue;
  }, [linearThermalTransmittanceInput.syncValue]);

  const junctionPsiDefaultsPath = useGeometryStore((s) => s.junctionPsiDefaultsPath);
  const junctionPsiDefaultsMap = useGeometryStore((s) => s.junctionPsiDefaultsMap);
  const junctionPsiDefaultsLoading = useGeometryStore((s) => s.junctionPsiDefaultsLoading);

  // TBL's transmittance-sync share of the old combined canvas-sync effect. The
  // length/Z0/Z1 lines moved verbatim into useServiceLineFormState
  // (elementForms/serviceLine.tsx); this is what's left behind. Same dep shape and
  // ref idiom as that hook's own effect.
  useEffect(() => {
    void ctx.selectedElementV;
    if (ctx.selection?.type !== 'element' && ctx.selection?.type !== 'global') return;
    const el = ctx.getElementById(ctx.selection.id);
    if (!el || !isServiceLineElementType(el.type)) return;
    if (el.type === 'ThermalBridgeLinear') {
      linearThermalTransmittanceInputSetValueRef.current(
        'linear_thermal_transmittance' in el ? el.linear_thermal_transmittance ?? 0 : 0,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only when selection or element version changes
  }, [ctx.selection?.type, ctx.selection?.id, ctx.selectedElementV, ctx.getElementById]);

  return {
    linearThermalTransmittanceInput,
    serviceLine: ctx.serviceLine,
    junctionPsiDefaultsPath,
    junctionPsiDefaultsMap,
    junctionPsiDefaultsLoading,
  };
}

export const thermalBridgeLinearFormModule: ElementFormModule<ThermalBridgeLinearFormState> = {
  type: 'ThermalBridgeLinear',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'ThermalBridgeLinear') return;
    hydrateServiceLineFromElement(state.serviceLine, element);
    state.linearThermalTransmittanceInput.setValue(
      'linear_thermal_transmittance' in element ? element.linear_thermal_transmittance ?? '' : '',
    );
  },

  reset(state) {
    state.linearThermalTransmittanceInput.setValue('');
    resetServiceLine(state.serviceLine);
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      length: state.serviceLine.lengthInput.value,
      linear_thermal_transmittance:
        state.linearThermalTransmittanceInput.value === '' ? undefined : state.linearThermalTransmittanceInput.value,
      extra_json: writeTbLineMode(undefined, 'plan'),
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      linearThermalTransmittanceInput,
      serviceLine,
      junctionPsiDefaultsPath,
      junctionPsiDefaultsMap,
      junctionPsiDefaultsLoading,
    } = state;
    const {
      elementType,
      fieldUnit,
      renderFieldLabel,
      selection,
      getElementById,
      updateElement,
      elementsById,
      thermalBridgeJunction,
    } = ctx;
    const { DetailedJunctionControl, onHostReadinessAction } = thermalBridgeJunction;

    const getCurrentElementData = (): Element | Record<string, never> => {
      if (selection && (selection.type === 'element' || selection.type === 'global')) {
        const element = getElementById(selection.id);
        return element || {};
      }
      return {};
    };

    return (
      <>
        {renderServiceLineCoreFields(serviceLine, ctx, {
          lengthLabel: (mode) =>
            mode === 'vertical'
              ? 'Vertical Length (m):'
              : mode === 'slope'
                ? 'Actual Slope Length (m):'
                : 'Plan Length (m):',
          lengthReadOnlyWhenVertical: false,
          zRefKeys: ['tb_z0', 'tb_z1'],
          showActualLengthWhenSlope: false,
        })}
        {renderFieldLabel('Linear Thermal Transmittance (W/m·K):', elementType)}
        <div className="element-input" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <StandardInput
              {...decimalInputProps(linearThermalTransmittanceInput)}
              unit={fieldUnit('linear_thermal_transmittance')}
              step="any"
              variant="ghost"
              size="md"
              style={{ flex: 1 }}
            />
          </div>
          {(() => {
                const element = getCurrentElementData() as Element;
                const rawJunctionType = element?.extra_json?.junction_type;
                const junctionType = typeof rawJunctionType === 'string' ? rawJunctionType : undefined;
                const currentPsi = linearThermalTransmittanceInput.value;
                const currentPsiNumber = typeof currentPsi === 'number' ? currentPsi : Number(currentPsi);

                const defaultTablePsi =
                  junctionType &&
                  currentPsi !== '' &&
                  currentPsi !== undefined &&
                  currentPsi !== null
                    ? baseLinearPsiForJunction(junctionType, null)
                    : undefined;
                const workspacePsi =
                  junctionType &&
                  currentPsi !== '' &&
                  currentPsi !== undefined &&
                  currentPsi !== null &&
                  (junctionPsiDefaultsPath || '').trim() !== '' &&
                  !junctionPsiDefaultsLoading
                    ? baseLinearPsiForJunction(junctionType, junctionPsiDefaultsMap)
                    : undefined;
                const pApportionedPsi =
                  element.type === 'ThermalBridgeLinear' &&
                  junctionType &&
                  currentPsi !== '' &&
                  currentPsi !== undefined &&
                  currentPsi !== null &&
                  !junctionPsiDefaultsLoading
                    ? getPApportionedLinearPsiForEditor(
                        junctionType,
                        junctionPsiDefaultsMap,
                        elementsById,
                        (element as { extra_json?: unknown }).extra_json,
                      )
                    : undefined;

                const applyPsi = (psi: number) => {
                  linearThermalTransmittanceInput.setValue(psi);
                  /**
                   * Re-read the element **at apply time**, not as this render captured it. `element`
                   * above is a render snapshot, and spreading it re-sends that whole snapshot —
                   * including `extra_json` — so any write landed since the render is silently
                   * reverted. The detailed-junction solver adopts ψ and writes its
                   * `thermal_bridge_solver` provenance while this panel is on screen, and a ψ
                   * shortcut clicked afterwards would have thrown that provenance away. Same
                   * apply-time-read rule as `applyThermalBridgeUpdate` in the junction contribution.
                   */
                  const current = selection ? getElementById(selection.id) : undefined;
                  if (current && current.type === 'ThermalBridgeLinear' && selection) {
                    updateElement(selection.id, {
                      ...current,
                      linear_thermal_transmittance: psi,
                    } as Partial<Element>);
                  }
                };

                const tableShortcuts =
                  junctionType &&
                  currentPsi !== '' &&
                  currentPsi !== undefined &&
                  currentPsi !== null &&
                  (defaultTablePsi !== undefined ||
                    workspacePsi !== undefined ||
                    pApportionedPsi !== undefined) ? (
                    <>
                      {defaultTablePsi !== undefined && currentPsiNumber !== defaultTablePsi && (
                        <button
                          type="button"
                          onClick={() => applyPsi(defaultTablePsi)}
                          className="btn btn-ghost"
                          style={{
                            padding: '0 6px',
                            fontSize: '11px',
                            height: '24px',
                            minHeight: '24px',
                            lineHeight: '1',
                          }}
                          title={`Default Table 3.7 value for ${junctionType}`}
                        >
                          Use default ({formatPsiButtonLabel(defaultTablePsi)})
                        </button>
                        )}
                      {workspacePsi !== undefined &&
                        (junctionPsiDefaultsPath || '').trim() !== '' &&
                        !junctionPsiDefaultsLoading &&
                        Math.abs(currentPsiNumber - workspacePsi) > 1e-9 && (
                          <button
                            type="button"
                            onClick={() => applyPsi(workspacePsi)}
                            className="btn btn-ghost"
                            style={{
                              padding: '0 6px',
                              fontSize: '11px',
                              height: '24px',
                              minHeight: '24px',
                              lineHeight: '1',
                            }}
                            title={`Workspace table for ${junctionType}`}
                          >
                            Use workspace ({formatPsiButtonLabel(workspacePsi)})
                          </button>
                        )}
                      {pApportionedPsi !== undefined &&
                        Math.abs(currentPsiNumber - pApportionedPsi) > 1e-9 && (
                          <button
                            type="button"
                            onClick={() => applyPsi(pApportionedPsi)}
                            className="btn btn-ghost"
                            style={{
                              padding: '0 6px',
                              fontSize: '11px',
                              height: '24px',
                              minHeight: '24px',
                              lineHeight: '1',
                            }}
                            title="P1–P3: half the tabulated ψ for party wall or adjacent conditioned (party UI), using the linked line from the suggest tool"
                          >
                            Use P-line (½ party) ({formatPsiButtonLabel(pApportionedPsi)})
                          </button>
                        )}
                    </>
                  ) : null;

                return (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                      fontSize: '12px',
                      marginTop: 4,
                    }}
                  >
                    {tableShortcuts}
                    {DetailedJunctionControl && selection ? (
                      <DetailedJunctionControl
                        elementId={selection.id}
                        onAdoptPsi={(psiWPerMK) => {
                          linearThermalTransmittanceInput.setValue(psiWPerMK);
                        }}
                        onHostReadinessAction={onHostReadinessAction}
                      />
                    ) : null}
                  </div>
                );
              })()}
        </div>
      </>
    );
  },
};
