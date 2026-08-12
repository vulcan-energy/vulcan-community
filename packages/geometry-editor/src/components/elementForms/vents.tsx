// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Vents form family, moved verbatim from ElementCreator's five inline structures.
// The legacy element and global hydrate branches were byte-identical, so one
// hydrate covers both. Legacy resetFormFields' Vents lines move into reset().
//
// Vents is the bridging-rule family: parentElement, pitch, and orientation360 are
// shared with the not-yet-extracted wall family (see elementForms/types.ts's
// ElementFormSharedCtx doc comment) and are read/written only through
// ctx.shared, captured into this module's own returned state during
// useFormState (same precedent as OnSiteGeneration's getCurrentOrientation) so
// hydrate/reset/buildElementData/renderPanel — which the module contract doesn't
// hand ctx.shared directly — can still reach them. Choosing a parent wall/window
// makes an *optimistic display write* of that parent's pitch/orientation360 into
// the shared inputs (ctx.shared.applyParentPitchOrientationForDisplay) so the
// panel shows the inherited values immediately; buildElementData separately
// *recomputes* inherited pitch/orientation from the live parent at save time
// (legacy behaviour) via findWallOrWindowParentByName, never by reading the
// shared pitch/orientation360 state.
//
// Note: Vents is special-cased out of the generic zoneId sync in the
// orchestrator's hydrate effect (`element.type !== 'Vents'`) — that stays in the
// orchestrator, untouched.
//
// The pitch/orientation editing UI below is the same block the not-yet-extracted
// wall family renders for itself (BuildingElementOpaque/Transparent/Ground/
// Adjacent all have their own literal copy in ElementCreator.tsx) — Vents shares
// the exact legacy behaviour, including the shape-mismatch confirm() prompts.
// getElementShape/convertShapeCoordinates are pure lib functions (no orchestrator
// closure), so this module imports them directly; the formatting/options helpers
// (formatConditionalDecimals, HORIZONTAL_POLYGON_*) were moved to formPrimitives
// for the same reason. horizontalPolygonControlPitch (the orchestrator's pitch
// override for adjacent-like polygon elements) always equals plain `pitch` for
// Vents, since Vents is never adjacent-like — so this module uses the shared
// pitch value directly instead of threading that memo through ctx.

import type { CSSProperties } from 'react';
import { getElementShape, convertShapeCoordinates } from '../../lib/shapeUtils';
import type { Element } from '../../geometry/types';
import { ParentElementDropdown } from '../ParentElementDropdown';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import {
  decimalInputProps,
  formatConditionalDecimals,
  HORIZONTAL_POLYGON_PITCH_OPTIONS,
  HORIZONTAL_POLYGON_SURFACE_PLACEHOLDER,
  horizontalPolygonSurfaceSelectValue,
  useDecimalInput,
} from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

const INLINE_FIELD_NOTE_STYLE: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};

export interface VentsFormState {
  midHeightAirFlowPathInput: ReturnType<typeof useDecimalInput>;
  areaCm2Input: ReturnType<typeof useDecimalInput>;
  /** Shared with the wall family — see module header comment. */
  parentElement: string;
  setParentElement: (value: string) => void;
  pitch: number;
  setPitch: (value: number) => void;
  orientation360: number;
  setOrientation360: (value: number) => void;
  applyOrientationToGeometry: (desiredOrientationDeg: number) => void;
  applyParentPitchOrientationForDisplay: (pitch: number | undefined, orientation: number | undefined) => void;
  /** Passed through from ElementFormStateCtx so the render's orientation display
   * matches the wall family's shared getCurrentOrientation exactly. */
  getCurrentOrientation: (element: Element) => number;
  /** Legacy buildNewElementData's inline parent-by-name-and-type lookup, kept as
   * a module-owned helper (not the shared pitch/orientation360 state) so save
   * time recomputes inherited pitch/orientation from the live parent. */
  findWallOrWindowParentByName: (name: string) => { orientation360?: number; pitch?: number } | undefined;
}

function useFormState(ctx: ElementFormStateCtx): VentsFormState {
  const midHeightAirFlowPathInput = useDecimalInput('', ctx.commitElementNumericField('mid_height_air_flow_path'), { commitOnChange: true });
  const areaCm2Input = useDecimalInput('', ctx.commitElementNumericField('area_cm2'), { commitOnChange: true });

  const findWallOrWindowParentByName = (name: string): { orientation360?: number; pitch?: number } | undefined =>
    ctx.elementIds
      .map((id) => ctx.elementsById[id])
      .find(
        (e): e is Element =>
          !!e && e.name === name && (e.type === 'BuildingElementOpaque' || e.type === 'BuildingElementTransparent'),
      ) as { orientation360?: number; pitch?: number } | undefined;

  return {
    midHeightAirFlowPathInput,
    areaCm2Input,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    pitch: ctx.shared.pitch,
    setPitch: ctx.shared.setPitch,
    orientation360: ctx.shared.orientation360,
    setOrientation360: ctx.shared.setOrientation360,
    applyOrientationToGeometry: ctx.shared.applyOrientationToGeometry,
    applyParentPitchOrientationForDisplay: ctx.shared.applyParentPitchOrientationForDisplay,
    getCurrentOrientation: ctx.getCurrentOrientation,
    findWallOrWindowParentByName,
  };
}

export const ventsFormModule: ElementFormModule<VentsFormState> = {
  type: 'Vents',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'Vents') return;
    state.midHeightAirFlowPathInput.setValue('mid_height_air_flow_path' in element ? element.mid_height_air_flow_path ?? '' : '');
    state.areaCm2Input.setValue('area_cm2' in element ? element.area_cm2 ?? '' : '');
    state.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
  },

  reset(state) {
    state.midHeightAirFlowPathInput.setValue('');
    state.areaCm2Input.setValue('');
    // parentElement is shared (wall family/ContextShading) and is reset directly
    // by the orchestrator's resetFormFields.
  },

  buildElementData(state, ctx) {
    // Find the selected wall/window parent to inherit orientation360 and pitch
    const ventParentElement = state.findWallOrWindowParentByName(state.parentElement);
    const inheritedOrientation = typeof ventParentElement?.orientation360 === 'number' ? ventParentElement.orientation360 : undefined;
    const inheritedPitch = typeof ventParentElement?.pitch === 'number' ? ventParentElement.pitch : undefined;
    return {
      ...ctx.baseData,
      mid_height_air_flow_path: state.midHeightAirFlowPathInput.value,
      area_cm2: state.areaCm2Input.value,
      parent_element: state.parentElement,
      orientation360: inheritedOrientation,
      pitch: inheritedPitch,
      zoneId: undefined, // Global object
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      midHeightAirFlowPathInput,
      areaCm2Input,
      parentElement,
      setParentElement,
      pitch,
      setPitch,
      orientation360,
      setOrientation360,
      applyOrientationToGeometry,
      applyParentPitchOrientationForDisplay,
      getCurrentOrientation,
    } = state;
    const {
      elementType,
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

    const getCurrentElementData = (): Element | Record<string, never> => {
      const currentSelection = selection;
      if (currentSelection && (currentSelection.type === 'element' || currentSelection.type === 'global')) {
        const element = getElementById(currentSelection.id);
        return element || {};
      }
      return {};
    };

    const selectedElementForShape = selection?.id ? getElementById(selection.id) : undefined;
    const selectedShape = selectedElementForShape ? getElementShape(selectedElementForShape) : null;

    return (
      <>
        {renderFieldLabel('Parent Element:', elementType, 'parent_element')}
        <div className="element-input" ref={registerBaseFieldRefs(['parentElement', 'parent_element'])}>
          <ParentElementDropdown
            value={parentElement}
            onChange={(value) => {
              setParentElement(value);
              // Auto-inherit pitch and orientation from parent element
              if (value) {
                const parent = elementIds
                  .map(id => elementsById[id])
                  .find(e => e && e.name === value);
                if (parent && ('pitch' in parent || 'orientation360' in parent)) {
                  const nextPitch = 'pitch' in parent && parent.pitch !== undefined ? parent.pitch : undefined;
                  const nextOrientation = 'orientation360' in parent && parent.orientation360 !== undefined ? parent.orientation360 : undefined;
                  applyParentPitchOrientationForDisplay(nextPitch, nextOrientation);
                }
              }
              // Update the element in the store with the new parent_element (both placeholder and non-placeholder)
              if (selection && (selection.type === 'element' || selection.type === 'global')) {
                updateElement(selection.id, { parent_element: value });
              }
            }}
            elementType={elementType}
            zoneId="" // Global object - can select from any zone
            placeholder="Select a parent wall/window element (required)"
            selfId={selection?.type === 'element' ? selection.id : undefined}
          />
        </div>
        {renderFieldLabel('Mid Height Air Flow Path (m):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['midHeightAirFlowPath', 'mid_height_air_flow_path'])}>
          <StandardInput
            {...decimalInputProps(midHeightAirFlowPathInput)}
            unit={fieldUnit('mid_height_air_flow_path')}
            step="0.1"
            min="0"
            required
            variant="ghost"
            size="md"
            className="flex-1"
          />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('midHeightAirFlowPath', midHeightAirFlowPathInput.value)} issue={getFieldValidationIssue('midHeightAirFlowPath', midHeightAirFlowPathInput.value) || undefined} />
        </div>
        {renderFieldLabel('Area (cm²):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['areaCm2', 'area_cm2'])}>
          <StandardInput
            {...decimalInputProps(areaCm2Input)}
            unit={fieldUnit('area_cm2')}
            step="1"
            min="0"
            required
            variant="ghost"
            size="md"
            className="flex-1"
          />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('areaCm2', areaCm2Input.value)} issue={getFieldValidationIssue('areaCm2', areaCm2Input.value) || undefined} />
        </div>
        {renderFieldLabel('Orientation (degrees):', elementType, 'orientation360')}
        <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRefs('orientation360')}>
          <StandardInput
            type="text"
            inputMode="numeric"
            value={getCurrentOrientation(getCurrentElementData() as Element)}
            unit={fieldUnit('orientation360')}
            onChange={(e) => setOrientation360(Math.round(parseFloat(e.target.value) || 0))}
            onBlur={() => {
              if (!Number.isFinite(orientation360)) return;
              applyOrientationToGeometry(orientation360);
            }}
            step="1"
            min="0"
            max="360"
            readOnly={!!parentElement}
            variant="ghost"
            size="md"
          />
          {parentElement && (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Inherited from parent: {parentElement}
            </div>
          )}
        </div>
        {renderFieldLabel(selectedShape === 'polygon' ? 'Surface facing:' : 'Pitch (degrees):', elementType, 'pitch')}
        <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRefs('pitch')}>
          {selectedShape === 'polygon' ? (
            <StandardDropdown
              value={horizontalPolygonSurfaceSelectValue(pitch)}
              unit={fieldUnit('pitch')}
              onChange={(value) => {
                if (value !== '0' && value !== '180') return;
                const next = value === '180' ? 180 : 0;
                setPitch(next);
                if (selection?.type === 'element') {
                  updateElement(selection.id, { pitch: next });
                }
              }}
              options={HORIZONTAL_POLYGON_PITCH_OPTIONS}
              placeholder={HORIZONTAL_POLYGON_SURFACE_PLACEHOLDER}
              variant="ghost"
              size="md"
              disabled={!!parentElement}
            />
          ) : (
            <StandardInput
              type="text"
              inputMode="numeric"
              value={formatConditionalDecimals(pitch)}
              unit={fieldUnit('pitch')}
              onChange={(e) => {
                const newPitch = parseFloat(e.target.value) || 0;

                // Check for shape-pitch mismatches before updating
                if (selection?.type === 'element') {
                  const currentElement = getElementById(selection.id);
                  if (currentElement) {
                    const currentShape = getElementShape(currentElement);

                    // For polygons: only allow 0° or 180° (horizontal surfaces)
                    if (currentShape === 'polygon' && newPitch !== 0 && newPitch !== 180) {
                      const ok = window.confirm(
                        `Polygon elements should have pitch 0° (horizontal up) or 180° (horizontal down). Convert to sloped polygon shape to use angled pitch ${newPitch}°?`
                      );
                      if (ok) {
                        // Keep same coordinates, just update pitch - sloped-polygon uses same coordinate structure
                        const roundedPitch = Math.round(newPitch);
                        updateElement(currentElement.id, { pitch: roundedPitch });
                        setPitch(roundedPitch);
                        return;
                      } else {
                        // Reset to 0° if user cancels
                        setPitch(0);
                        updateElement(selection.id, { pitch: 0 });
                        return;
                      }
                    }

                    // For lines: suggest polygon conversion for horizontal surfaces
                    if (currentShape === 'line' && (newPitch === 0 || newPitch === 180)) {
                      const ok = window.confirm(
                        `Pitch ${newPitch}° suggests a horizontal surface. Convert to polygon shape?`
                      );
                      if (ok) {
                        const nextCoords = convertShapeCoordinates(currentElement as any, 'polygon');
                        const roundedPitch = Math.round(newPitch);
                        updateElement(currentElement.id, { coordinates: nextCoords, pitch: roundedPitch });
                      }
                    }
                  }
                }

                const roundedPitch = Math.round(newPitch);
                setPitch(roundedPitch);
                // Only update pitch, don't touch coordinates
                if (selection?.type === 'element') {
                  updateElement(selection.id, { pitch: roundedPitch });
                }
              }}
              step="1"
              min="0"
              max="180"
              readOnly={!!parentElement}
              variant="ghost"
              style={{ fontFamily: 'Clash Grotesk, sans-serif', fontWeight: 400 }}
            />
          )}
          {selectedShape !== 'polygon' && (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              {pitch === 0
                ? 'Facing up (horizontal)'
                : pitch === 90
                  ? 'Vertical'
                  : pitch === 180
                    ? 'Facing down (horizontal)'
                    : 'Angled surface'}
            </div>
          )}
          {parentElement && (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Inherited from parent: {parentElement}
            </div>
          )}
        </div>
      </>
    );
  },
};
