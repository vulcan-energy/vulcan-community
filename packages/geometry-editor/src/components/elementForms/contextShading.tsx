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
// renderPanel — which the module contract does not hand
// ctx.shared directly — can still reach them.
//
// deriveContextShadingFor and setContextShadingCentre are geometry-store actions;
// this module pulls them from inside useFormState — the one hook-rule-safe call
// site the module contract guarantees runs every render. The Directions table
// (ContextShadingDirections.tsx) replaces the old Start Angle, End Angle and Distance fields.

import { useState } from 'react';
import type { ContextShading, Element } from '../../geometry/types';
import { useGeometryStore, useGeometryStoreApi, type GeometryState, type GeometryStoreApi } from '../../stores/geometryStore';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import { decimalInputProps, type NumericDraftInputBinding } from './formPrimitives';
import { CONTEXT_SHADING_DEFAULT_CENTRE, isFloorPlate, planContextShadingLineEdit } from '../../lib/contextShadingGeometry';
import { contextShadingSplitRefusal, isContextGeneratedElement } from '../../lib/developmentContextShading';
import { ContextShadingDirections, type DirectionIssue, type DirectionRow } from './ContextShadingDirections';
import { editStoredRow } from '../../lib/contextShadingDrawing';
import { ELEMENT_TYPE_COMPACT_LABELS } from '../../lib/elementTypeMetadata';
import type { ElementFormModule, ElementFormStateCtx } from './types';

type ContextShadingType = '' | 'obstacle' | 'overhang';

export interface ContextShadingFormState {
  contextShadingType: ContextShadingType;
  setContextShadingType: (value: ContextShadingType) => void;
  /** Shared with the wall family and WindowShading — see module header comment. */
  heightInput: NumericDraftInputBinding;
  distanceInput: NumericDraftInputBinding;
  parentElement: string;
  setParentElement: (value: string) => void;
  deriveContextShadingFor: GeometryState['deriveContextShadingFor'];
  setContextShadingCentre: GeometryState['setContextShadingCentre'];
  geometryStore: GeometryStoreApi;
  hoveredPart: GeometryState['hoveredContextShadingPart'];
  setHoveredPart: GeometryState['setHoveredContextShadingPart'];
  /** Rows in stated distant shading quadrants only, which the conversion does not use. */
  unusedNames: readonly string[] | undefined;
}

function useFormState(ctx: ElementFormStateCtx): ContextShadingFormState {
  const [contextShadingType, setContextShadingType] = useState<ContextShadingType>('');
  const deriveContextShadingFor = useGeometryStore((s) => s.deriveContextShadingFor);
  const setContextShadingCentre = useGeometryStore((s) => s.setContextShadingCentre);
  const unusedNames = useGeometryStore((s) => s.targetValidation?.distantShading?.unused_objects);
  const hoveredPart = useGeometryStore((s) => s.hoveredContextShadingPart);
  const setHoveredPart = useGeometryStore((s) => s.setHoveredContextShadingPart);

  return {
    contextShadingType,
    setContextShadingType,
    heightInput: ctx.shared.heightInput,
    distanceInput: ctx.shared.distanceInput,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    deriveContextShadingFor,
    setContextShadingCentre,
    geometryStore: useGeometryStoreApi(),
    hoveredPart,
    setHoveredPart,
    unusedNames,
  };
}

export const contextShadingFormModule: ElementFormModule<ContextShadingFormState> = {
  type: 'ContextShading',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'ContextShading') return;
    state.setContextShadingType('shading_type' in element ? element.shading_type ?? '' : '');
    state.distanceInput.setValue('distance' in element ? element.distance ?? '' : '');
    state.heightInput.setValue('height' in element ? element.height ?? '' : '');
    state.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
  },

  reset(state) {
    state.setContextShadingType('');
    // height/distance/parentElement are shared (wall family + WindowShading) and
    // are reset directly by the orchestrator's resetFormFields.
  },

  renderPanel(state, ctx) {
    const {
      contextShadingType,
      setContextShadingType,
      heightInput,
      parentElement,
      setParentElement,
      deriveContextShadingFor,
      setContextShadingCentre,
      geometryStore,
      hoveredPart,
      setHoveredPart,
      unusedNames,
    } = state;
    const {
      elementType,
      elementIds,
      elementsById,
      fieldUnit,
      renderFieldLabel,
      registerBaseFieldRefs,
      getFieldValidationIssue,
      getFieldValidationState,
      commitExistingElementDraft,
      updateElement,
      selection,
      getElementById,
    } = ctx;

    // Resolved by id: the Elements list, the canvas and the draw tools select this object as 'global', other paths as 'element'.
    const selected = selection?.id ? getElementById(selection.id) : undefined;
    const shading = selected?.type === 'ContextShading' ? (selected as ContextShading) : undefined;
    const shadingId = shading?.id;
    const drawn = (shading?.coordinates?.length ?? 0) >= 2;
    const isLine = drawn && shading?.coordinates?.length === 2;
    const derived = shading && drawn && shading.parent_element?.trim() ? deriveContextShadingFor(shading) : null;
    const generated = !!shading && isContextGeneratedElement(shading);
    // One row per part. A drawn object's come from the drawing; a row with no coordinates keeps what it stores,
    // and so does a drawn object with no centre (older files), which has nothing to measure from.
    const storedRows: DirectionRow[] = shading?.parts?.length
      ? shading.parts.map((part) => ({ from: part.start_angle, to: part.end_angle, distance: part.distance, key: part.start_angle }))
      : shading && Number.isFinite(shading.start_angle) && Number.isFinite(shading.end_angle) && Number.isFinite(shading.distance)
        ? [{ from: shading.start_angle, to: shading.end_angle, distance: shading.distance, key: 'range' }]
        : [];
    const noCentre = drawn && !shading?.parent_element?.trim();
    let rows: DirectionRow[] = [];
    if (shading && drawn && !noCentre) {
      if (derived && !('issue' in derived)) rows = derived.parts.map((part, index) => ({ from: part.start_angle, to: part.end_angle, distance: part.distance, key: `${index}-${part.face}` }));
    } else if (shading) {
      rows = storedRows;
    }
    const issues: DirectionIssue[] = rows.map((row, index) => (
      getFieldValidationState(`parts.${index}.distance`, row.distance)
      ?? (rows.length === 1 ? getFieldValidationState('distance', row.distance) : null)
    ));
    // Null when the edit is taken, otherwise why it was refused.
    const editRow = (index: number, field: 'start_angle' | 'end_angle' | 'distance', value: number): string | null => {
      if (!shading) return 'Nothing is selected.';
      if (drawn) {
        const state = geometryStore.getState();
        const plan = planContextShadingLineEdit(shading, Object.values(state.elementsById), state.floors, state.globalOrientationOffset, { field, value });
        if ('refusal' in plan) return plan.refusal;
        return state.editContextShadingLine(shading.id, { field, value }) ? null : "That edit couldn't be applied.";
      }
      const update = editStoredRow(shading, index, field, value);
      if (!update) {
        if (field === 'distance') return 'Distance must be above 0 m.';
        const other = field === 'start_angle' ? rows[index].to : rows[index].from;
        return rows.length === 1 || Math.round(value) === Math.round(other)
          ? 'From and To must differ.'
          : "Directions can't overlap or run out of order, and together can't pass 360 degrees.";
      }
      updateElement(shading.id, update);
      return null;
    };
    // Lines, rows without a drawing and generated objects show neither the button nor a note; for the rest
    // the refusal that is left is the shared-object one.
    const splittable = !!shading && !isLine && drawn && !noCentre && !generated && rows.length > 0;
    const splitRefusal = splittable ? contextShadingSplitRefusal(shading) : null;
    const canSplit = splittable && !splitRefusal;
    const centreState = getFieldValidationState('parent_element', parentElement);
    const centreOptions = [
      { value: CONTEXT_SHADING_DEFAULT_CENTRE, label: 'Default (lowest floor)' },
      ...elementIds
        .map(id => elementsById[id])
        .filter((el): el is Element => !!el && isFloorPlate(el))
        .map(el => ({ value: el.name, label: `${el.name} (${ELEMENT_TYPE_COMPACT_LABELS[el.type]})` }))
    ];
    // A stored centre that names no floor (renamed, removed or miscased) stays visible, marked, until another is chosen.
    if (parentElement && !centreOptions.some((option) => option.value === parentElement)) {
      centreOptions.unshift({ value: parentElement, label: `${parentElement} (not found)` });
    }

    const selectedName = shading?.name;
    return (
      <>
        {selectedName && unusedNames?.includes(selectedName) && (
          <div className="element-editor-note" role="note">
            This quadrant&apos;s band is stated, so this object doesn&apos;t change it. Reset the quadrant to use the drawing.
          </div>
        )}
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

        {renderFieldLabel('Shading Centre:', elementType, 'parent_element')}
        <div className="element-input" ref={registerBaseFieldRefs(['parentElement', 'parent_element'])}>
          <StandardDropdown
            value={parentElement || ''}
            onChange={(value) => {
              setParentElement(value || '');
              // One centre for the model: every object takes it.
              setContextShadingCentre(value || null);
            }}
            options={centreOptions}
            placeholder="Choose a centre"
            variant="ghost"
            size="md"
          />
          <FieldValidationIndicator hasIssue={!!centreState} issue={centreState?.message} variant={centreState?.variant} />
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

        {rows.length > 0 && renderFieldLabel('Directions, clockwise from north:', elementType)}
        {rows.length > 0 && (
          <div className="element-input element-input--stacked" ref={registerBaseFieldRefs(['distance', 'start_angle', 'end_angle', 'parts'])}>
            <ContextShadingDirections
              rows={rows}
              editable={!generated && !noCentre && (isLine || !drawn)}
              issues={issues}
              hoveredIndex={shading && hoveredPart?.elementId === shading.id ? hoveredPart.index : null}
              onHover={(index) => setHoveredPart(shading && index !== null ? { elementId: shading.id, index } : null)}
              onEdit={editRow}
            />
            {canSplit && shadingId && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setHoveredPart(null);
                  geometryStore.getState().splitContextShadingIntoLines(shadingId);
                }}
              >
                Split into lines
              </button>
            )}
            {canSplit && (
              <div className="element-editor-note">
                Replaces this shape with one editable line per direction. Select a line to edit it. Undo restores the shape.
              </div>
            )}
            {splitRefusal && <div className="element-editor-note">{splitRefusal}</div>}
          </div>
        )}
      </>
    );
  },

  subtype(state) {
    return state.contextShadingType || undefined;
  },
};
