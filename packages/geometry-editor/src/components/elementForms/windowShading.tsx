// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// WindowShading form family, moved verbatim from ElementCreator's five inline
// structures. WindowShading has no global-chain hydrate branch (it isn't in the
// orchestrator's global-object type list), so element selection is the only path.
// Legacy resetFormFields' WindowShading lines move into reset(); the height and
// distance inputs are shared with the not-yet-extracted wall family (and, for
// distance, ContextShading) and are read/written only through ctx.shared — see
// elementForms/types.ts's ElementFormSharedCtx doc comment.
//
// Cross-reference: the orchestrator's getFieldValidationIssue ('windowShadingHeight'
// / 'windowShadingTransparency' / 'windowShadingDepth' cases) reads this family's
// shadingType to decide which of Height/Transparency/Depth apply — it now reads
// windowShadingFormState.shadingType instead of a local variable.

import { useState } from 'react';
import type { Element } from '../../geometry/types';
import { SHADING_TYPES } from '../../stores/geometryStore';
import { useKeyedState } from '../../hooks/useKeyedState';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import { decimalInputProps, useDecimalInput, type NumericDraftInputBinding } from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

type WindowShadingType = '' | 'object' | 'overhang' | 'sidefinright' | 'sidefinleft' | 'reveal';
type WindowShadingCoordinate = { x: number; y: number; z: number };

export function projectWindowShadingPointToSegment(
  point: WindowShadingCoordinate,
  a: WindowShadingCoordinate,
  b: WindowShadingCoordinate,
): WindowShadingCoordinate {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const v2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / v2));
  return { x: a.x + t * vx, y: a.y + t * vy, z: point.z };
}

export interface WindowShadingFormState {
  linkedWindow: string;
  setLinkedWindow: (value: string) => void;
  shadingType: WindowShadingType;
  setShadingType: (value: WindowShadingType) => void;
  depthInput: ReturnType<typeof useDecimalInput>;
  transparencyInput: ReturnType<typeof useDecimalInput>;
  /** Shared with the wall family — passed through from ctx.shared so hydrate (which
   * the module contract calls with no ctx) can still write it. */
  heightInput: NumericDraftInputBinding;
  /** Shared with the wall family and ContextShading — see heightInput above. */
  distanceInput: NumericDraftInputBinding;
}

function useFormState(ctx: ElementFormStateCtx): WindowShadingFormState {
  // Mirrors the orchestrator's own parentElement derivation (selectedDraftKey /
  // selectedParentElementValue): linkedWindow is WindowShading's independent
  // parent-element slot, keyed the same way so it snaps to the newly selected
  // element's parent_element synchronously, without a stale-value render.
  const selectedDraftElement = ctx.selection?.id
    && (ctx.selection.type === 'element' || ctx.selection.type === 'global')
    ? ctx.getElementById(ctx.selection.id)
    : undefined;
  const selectedDraftKey = selectedDraftElement
    ? `${selectedDraftElement.id}\0${ctx.selectedElementV}`
    : 'new';
  const selectedParentElementValue = selectedDraftElement && 'parent_element' in selectedDraftElement
    ? String((selectedDraftElement as { parent_element?: string | null }).parent_element ?? '').trim()
    : '';
  const [linkedWindow, setLinkedWindow] = useKeyedState(selectedDraftKey, selectedParentElementValue);
  const [shadingType, setShadingType] = useState<WindowShadingType>('');
  const depthInput = useDecimalInput('', ctx.commitElementNumericField('depth'), { commitOnChange: true });
  const transparencyInput = useDecimalInput('', ctx.commitElementNumericField('transparency'), { commitOnChange: true });

  return {
    linkedWindow,
    setLinkedWindow,
    shadingType,
    setShadingType,
    depthInput,
    transparencyInput,
    heightInput: ctx.shared.heightInput,
    distanceInput: ctx.shared.distanceInput,
  };
}

export const windowShadingFormModule: ElementFormModule<WindowShadingFormState> = {
  type: 'WindowShading',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'WindowShading') return;
    state.setLinkedWindow('parent_element' in element ? element.parent_element ?? '' : '');
    state.setShadingType('shading_type' in element ? element.shading_type ?? '' : '');
    state.heightInput.setValue('height' in element ? element.height ?? '' : '');
    state.depthInput.setValue('depth' in element ? element.depth ?? '' : '');
    state.distanceInput.setValue('distance' in element ? element.distance ?? '' : '');
    state.transparencyInput.setValue('transparency' in element ? element.transparency ?? '' : '');
  },

  reset(state) {
    state.setLinkedWindow('');
    state.setShadingType('');
    state.depthInput.setValue('');
    state.transparencyInput.setValue('');
    // heightInput/distanceInput are shared (wall family + ContextShading) and are
    // reset directly by the orchestrator's resetFormFields.
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      parent_element: state.linkedWindow,
      shading_type: state.shadingType || undefined,
      depth: state.depthInput.value || undefined,
      height: state.heightInput.value || undefined,
      distance: state.distanceInput.value || undefined,
      transparency: state.transparencyInput.value || undefined,
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { linkedWindow, setLinkedWindow, shadingType, setShadingType, depthInput, distanceInput, heightInput, transparencyInput } = state;
    const {
      elementType,
      elementZoneId,
      elementIds,
      elementsById,
      fieldUnit,
      renderFieldLabel,
      registerBaseFieldRefs,
      getFieldValidationIssue,
      selection,
      getElementById,
      updateElement,
    } = ctx;

    return (
      <>
        {renderFieldLabel('Linked Window:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['parentElement', 'parent_element', 'linked_window'])}>
          <StandardDropdown
            value={linkedWindow}
            onChange={(value) => {
              setLinkedWindow(value);
              // Update the element with the new parent_element
              if (selection && selection.type === 'element') {
                updateElement(selection.id, { parent_element: value });

                // If linking a WindowShading to a window, project the point to the nearest point on that window
                try {
                  const current = getElementById(selection.id);
                  // Only project when subtype is constrained (NOT 'object')
                  if (current && current.type === 'WindowShading' && (current as any).shading_type !== 'object') {
                    const parent = elementIds
                      .map(id => elementsById[id])
                      .find(el => el && el.type === 'BuildingElementTransparent' && el.name === value);
                    if (parent && current.coordinates && current.coordinates.length >= 1 && parent.coordinates && parent.coordinates.length === 2) {
                      const p = current.coordinates[0];
                      const [A, B] = parent.coordinates as Array<{x:number,y:number,z:number}>;
                      const proj = projectWindowShadingPointToSegment(p, A, B);
                      updateElement(selection.id, { coordinates: [proj] });
                    }
                  }
                } catch { /* swallow: best-effort */ }
              }
            }}
            options={[
              { value: '', label: 'Select a window' },
              ...elementIds
                .map(id => elementsById[id])
                .filter(el => el && el.type === 'BuildingElementTransparent' && el.zoneId === elementZoneId)
                .map(window => ({ value: window.name, label: window.name }))
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('Shading Type:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['shadingType', 'shading_type'])}>
          <StandardDropdown
            value={shadingType}
            onChange={(value) => {
              const nextShadingType = value as typeof shadingType;
              setShadingType(nextShadingType);
              // If switching away from 'object' to a constrained subtype, and parent exists,
              // re-project current point back onto the parent window axis
              try {
                if (selection && selection.type === 'element') {
                  const el = getElementById(selection.id);
                  if (el && el.type === 'WindowShading' && (el as any).parent_element && nextShadingType && nextShadingType !== 'object') {
                    const parent = elementIds
                      .map(id => elementsById[id])
                      .find(e => e && e.type === 'BuildingElementTransparent' && e.name === (el as any).parent_element);
                    if (parent && parent.coordinates && parent.coordinates.length === 2 && el.coordinates && el.coordinates.length >= 1) {
                      const p = el.coordinates[0];
                      const [A,B] = parent.coordinates as Array<{x:number,y:number,z:number}>;
                      const proj = projectWindowShadingPointToSegment(p, A, B);
                      updateElement(selection.id, { coordinates: [proj], shading_type: nextShadingType as any });
                      return;
                    }
                  }
                }
              } catch { /* swallow: best-effort */ }
              if (selection && selection.type === 'element') {
                updateElement(selection.id, { shading_type: nextShadingType || undefined as any });
              }
            }}
            options={[
              { value: '', label: 'Select shading type' },
              ...SHADING_TYPES.map(type => ({ value: type, label: type })),
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {shadingType === '' ? null : shadingType === 'object' ? (
          <>
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
            </div>
            {renderFieldLabel('Distance (m):', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs('distance')}>
              <StandardInput
                {...decimalInputProps(distanceInput)}
                unit={fieldUnit('distance')}
                step="0.01"
                min="0"
                required
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('distance', distanceInput.value)} issue={getFieldValidationIssue('distance', distanceInput.value) || undefined} />
            </div>
            {renderFieldLabel('Transparency:', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs('transparency')}>
              <StandardInput
                {...decimalInputProps(transparencyInput)}
                unit={fieldUnit('transparency')}
                step="0.01"
                min="0"
                max="1"
                required
                variant="ghost"
                size="md"
              />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('windowShadingTransparency', transparencyInput.value)} issue={getFieldValidationIssue('windowShadingTransparency', transparencyInput.value) || undefined} />
            </div>
          </>
        ) : (
          <>
            {renderFieldLabel('Depth (m):', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs('depth')}>
              <StandardInput
                {...decimalInputProps(depthInput)}
                unit={fieldUnit('depth')}
                step="0.01"
                min="0"
                required
                variant="ghost"
                size="md"
              />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('windowShadingDepth', depthInput.value)} issue={getFieldValidationIssue('windowShadingDepth', depthInput.value) || undefined} />
            </div>
            {renderFieldLabel('Distance (m):', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs('distance')}>
              <StandardInput
                {...decimalInputProps(distanceInput)}
                unit={fieldUnit('distance')}
                step="0.01"
                min="0"
                required
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('distance', distanceInput.value)} issue={getFieldValidationIssue('distance', distanceInput.value) || undefined} />
            </div>
          </>
        )}
      </>
    );
  },

  subtype(state) {
    return state.shadingType;
  },
};
