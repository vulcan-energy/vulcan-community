// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// ContextShading form family, moved verbatim from ElementCreator's five inline
// structures. The legacy element and global hydrate branches were byte-identical,
// so one hydrate covers both. height/distance/parentElement are shared with the
// not-yet-extracted wall family (and, for height/distance, WindowShading) and are
// read/written only through ctx.shared — see elementForms/types.ts's
// ElementFormSharedCtx doc comment. Distance here is a read-only computed display
// (disabled input mirroring the live parent-relative calculation), not a plain
// draft field. Passed through from ctx.shared into this module's own returned
// state (same precedent as OnSiteGeneration's getCurrentOrientation) so
// buildElementData and renderPanel — which the module contract does not hand
// ctx.shared directly — can still reach them.
//
// calculateContextShadingAngles / calculateShadingAngularRange /
// calculateContextShadingDistance are geometry-store selectors (the legacy
// component called useGeometryStore(...) at the top of ElementCreator's render);
// this module pulls them the same way, but from inside useFormState — the one
// hook-rule-safe call site the module contract guarantees runs every render.
//
// ADJACENT_LIKE_ELEMENT_TYPES: RESOLVED in slice-6 STAGE 6 — used to mirror
// ElementCreator's own copy as a local duplicate (modules cannot import from
// the orchestrator without an import cycle). Now imported from
// lib/elementArea.ts, a cycle-free shared home also used by ElementCreator.tsx,
// wallShared.tsx, and adjacentLikeElement.tsx.

import { useState } from 'react';
import type { ContextShading, Element } from '../../geometry/types';
import { useGeometryStore } from '../../stores/geometryStore';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import { decimalInputProps, useIntegerInput, type NumericDraftInputBinding } from './formPrimitives';
import { ADJACENT_LIKE_ELEMENT_TYPES } from '../../lib/elementArea';
import type { ElementFormModule, ElementFormStateCtx } from './types';

type ContextShadingType = '' | 'obstacle' | 'overhang';

export interface ContextShadingFormState {
  contextShadingType: ContextShadingType;
  setContextShadingType: (value: ContextShadingType) => void;
  startAngleInput: ReturnType<typeof useIntegerInput>;
  endAngleInput: ReturnType<typeof useIntegerInput>;
  /** Shared with the wall family and WindowShading — see module header comment. */
  heightInput: NumericDraftInputBinding;
  distanceInput: NumericDraftInputBinding;
  parentElement: string;
  setParentElement: (value: string) => void;
  calculateContextShadingAngles: (
    contextShading: ContextShading,
    parent: Element,
    globalOrientationOffset?: number,
  ) => { start_angle: number; end_angle: number };
  calculateShadingAngularRange: (
    contextShading: ContextShading,
    parent: Element,
    globalOrientationOffset?: number,
  ) => { start_angle: number; end_angle: number };
  calculateContextShadingDistance: (contextShading: ContextShading, parent: Element) => number;
}

function useFormState(ctx: ElementFormStateCtx): ContextShadingFormState {
  const [contextShadingType, setContextShadingType] = useState<ContextShadingType>('');
  const startAngleInput = useIntegerInput('', ctx.commitElementNumericField('start_angle'), { commitOnChange: true });
  const endAngleInput = useIntegerInput('', ctx.commitElementNumericField('end_angle'), { commitOnChange: true });
  const calculateContextShadingAngles = useGeometryStore((s) => s.calculateContextShadingAngles);
  const calculateShadingAngularRange = useGeometryStore((s) => s.calculateShadingAngularRange);
  const calculateContextShadingDistance = useGeometryStore((s) => s.calculateContextShadingDistance);

  return {
    contextShadingType,
    setContextShadingType,
    startAngleInput,
    endAngleInput,
    heightInput: ctx.shared.heightInput,
    distanceInput: ctx.shared.distanceInput,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    calculateContextShadingAngles,
    calculateShadingAngularRange,
    calculateContextShadingDistance,
  };
}

export const contextShadingFormModule: ElementFormModule<ContextShadingFormState> = {
  type: 'ContextShading',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'ContextShading') return;
    state.setContextShadingType('shading_type' in element ? element.shading_type ?? '' : '');
    state.startAngleInput.setValue('start_angle' in element && typeof element.start_angle === 'number' ? Math.round(element.start_angle) : '');
    state.endAngleInput.setValue('end_angle' in element && typeof element.end_angle === 'number' ? Math.round(element.end_angle) : '');
    state.distanceInput.setValue('distance' in element ? element.distance ?? '' : '');
    state.heightInput.setValue('height' in element ? element.height ?? '' : '');
    state.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
  },

  reset(state) {
    state.setContextShadingType('');
    state.startAngleInput.setValue('');
    state.endAngleInput.setValue('');
    // height/distance/parentElement are shared (wall family + WindowShading) and
    // are reset directly by the orchestrator's resetFormFields.
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      shading_type: state.contextShadingType || undefined,
      start_angle: state.startAngleInput.value === '' ? undefined : state.startAngleInput.value,
      end_angle: state.endAngleInput.value === '' ? undefined : state.endAngleInput.value,
      distance: state.distanceInput.value,
      height: state.heightInput.value,
      parent_element: state.parentElement || null,
      zoneId: undefined, // Global object
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      contextShadingType,
      setContextShadingType,
      startAngleInput,
      endAngleInput,
      heightInput,
      distanceInput,
      parentElement,
      setParentElement,
      calculateContextShadingAngles,
      calculateShadingAngularRange,
      calculateContextShadingDistance,
    } = state;
    const {
      elementType,
      elementIds,
      elementsById,
      fieldUnit,
      renderFieldLabel,
      registerBaseFieldRefs,
      getFieldValidationIssue,
      commitExistingElementDraft,
      selection,
      getElementById,
      updateElement,
      getGlobalOrientationOffset,
    } = ctx;

    return (
      <>
        {renderFieldLabel('Shading Type:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['shadingType', 'shading_type'])}>
          <StandardDropdown
            value={contextShadingType}
            onChange={(value) => {
              const nextValue = value as ContextShading['shading_type'];
              setContextShadingType(nextValue);
              commitExistingElementDraft({ shading_type: nextValue });
            }}
            options={[
              { value: 'obstacle', label: 'Obstacle' },
              { value: 'overhang', label: 'Overhang' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>

        {renderFieldLabel('Parent Element:', elementType, 'parent_element')}
        <div className="element-input" ref={registerBaseFieldRefs(['parentElement', 'parent_element'])}>
          <StandardDropdown
            value={parentElement || ''}
            onChange={(value) => {
              setParentElement(value || '');
              // Auto-calculate angles AND distance when parent changes
              if (value && selection?.type === 'element') {
                const contextShading = getElementById(selection.id) as any;
                const parentEl = elementIds
                  .map(id => elementsById[id])
                  .find(el => el && el.name === value);
                if (contextShading && parentEl) {
                  const { start_angle, end_angle } = calculateContextShadingAngles(
                    contextShading,
                    parentEl,
                    getGlobalOrientationOffset(),
                  );
                  startAngleInput.setValue(start_angle);
                  endAngleInput.setValue(end_angle);
                  // Calculate and store distance immediately
                  const distance = calculateContextShadingDistance(contextShading, parentEl);
                  updateElement(selection.id, { parent_element: value, start_angle, end_angle, distance });
                }
              }
            }}
            options={[
              { value: '', label: 'None' },
              ...elementIds
                .map(id => elementsById[id])
                .filter(el => el && ['BuildingElementGround', 'BuildingElementOpaque', ...ADJACENT_LIKE_ELEMENT_TYPES].includes(el.type))
                .map(el => ({ value: el!.name, label: `${el!.name} (${el!.type})` }))
            ]}
            variant="ghost"
            size="md"
          />
        </div>

        {renderFieldLabel('Start Angle (degrees):', elementType)}
        <div className="element-input">
          <StandardInput
            type="text"
            inputMode="numeric"
            value={(() => {
              // Calculate angles in real-time for ContextShading elements using the new angular range approach
              if (selection?.type === 'element' && elementType === 'ContextShading') {
                const contextShading = getElementById(selection.id) as any;
                const parentEl = elementIds
                  .map(id => elementsById[id])
                  .find(el => el && el.name === parentElement);
                if (contextShading && parentEl) {
                  const offset = getGlobalOrientationOffset();
                  const range = calculateShadingAngularRange(contextShading, parentEl, offset);
                  const shownStart = range.start_angle;
                  return Number.isFinite(shownStart) ? Number(shownStart.toFixed(2)) : 0;
                }
              }
              return startAngleInput.value;
            })()}
            unit={fieldUnit('start_angle')}
            onChange={startAngleInput.handleInputChange}
            onBlur={startAngleInput.handleBlur}
            step="1"
            min="0"
            max="360"
            required
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('End Angle (degrees):', elementType)}
        <div className="element-input">
          <StandardInput
            type="text"
            inputMode="numeric"
            value={(() => {
              // Calculate angles in real-time for ContextShading elements using the new angular range approach
              if (selection?.type === 'element' && elementType === 'ContextShading') {
                const contextShading = getElementById(selection.id) as any;
                const parentEl = elementIds
                  .map(id => elementsById[id])
                  .find(el => el && el.name === parentElement);
                if (contextShading && parentEl) {
                  const offset = getGlobalOrientationOffset();
                  const range = calculateShadingAngularRange(contextShading, parentEl, offset);
                  const shownEnd = range.end_angle;
                  return Number.isFinite(shownEnd) ? Number(shownEnd.toFixed(2)) : 0;
                }
              }
              return endAngleInput.value;
            })()}
            unit={fieldUnit('end_angle')}
            onChange={endAngleInput.handleInputChange}
            onBlur={endAngleInput.handleBlur}
            step="1"
            min="0"
            max="360"
            required
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('Distance (m):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('distance')}>
          <StandardInput
            type="text"
            inputMode="numeric"
            value={(() => {
              if (selection?.type === 'element' && elementType === 'ContextShading') {
                const contextShading = getElementById(selection.id) as any;
                const parentEl = elementIds
                  .map(id => elementsById[id])
                  .find(el => el && el.name === parentElement);
                if (contextShading && parentEl) {
                  const d = calculateContextShadingDistance(contextShading, parentEl);
                  return Number.isFinite(d) ? Number(d.toFixed(2)) : 0;
                }
              }
              const d = typeof distanceInput.value === 'number' ? distanceInput.value : parseFloat(String(distanceInput.value)) || 0;
              return Number.isFinite(d) ? Number(d.toFixed(2)) : 0;
            })()}
            unit={fieldUnit('distance')}
            onChange={() => {}}
            disabled
            step="0.01"
            min="0"
            required
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('distance', distanceInput.value)} issue={getFieldValidationIssue('distance', distanceInput.value) || undefined} />
        </div>
        {renderFieldLabel('Height (m):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('height')}>
          <StandardInput
            {...decimalInputProps(heightInput)}
            unit={fieldUnit('height')}
            step="0.01"
            min="0"
            required
            variant="ghost"
            size="md"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('height', heightInput.value)} issue={getFieldValidationIssue('height', heightInput.value) || undefined} />
        </div>
      </>
    );
  },

  subtype(state) {
    return state.contextShadingType || undefined;
  },
};
