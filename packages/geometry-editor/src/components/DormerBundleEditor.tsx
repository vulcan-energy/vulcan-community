// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Dormer bundle mutation + fields-panel machinery, moved from ElementCreator.tsx
// per the slice-6 brief's STAGE 5 (decision 2's "orchestrator-invoked" shape —
// the same useMvhrDuctTerminalManager / useServiceLineFormState precedent: the
// orchestrator calls this hook exactly once and wires its
// `renderDormerBundleEditor` return onto ElementFormRenderCtx.renderDormerBundleEditor,
// which BuildingElementOpaque's module (elementForms/buildingElementOpaque.tsx)
// invokes when `isDormerAnchorElement(selectedElement)` is true).
//
// SCOPE OF THE MOVE — classified during Stage 5's inventory pass:
//
// Moved here (dormer-exclusive, nothing outside the dormer cluster reads or
// writes them): the 8 dormer draft inputs (dormerWidthInput/
// dormerFrontWallHeightInput/dormerRoofPitchInput/gableRoofPitchInput/
// dormerWindow{Width,Height,SillHeight}Input/dormerFrameAreaFractionInput) and
// their derived numeric values; selectedDormerType/dormerDepth/
// dormerRoofIsUnheatedPitchedRoof; dormerDraftValuesRef;
// commitDormerNumericParameter/commitDormerAnchorChanges/regenerateDormerAnchor/
// handleSaveDormerAnchor/handleDuplicateDormerBundle/mergeDormerExtraJson/
// getDormerBundleNameIssue; renderDormerBundleEditor itself; and the
// hydrate-on-select / reset entry points (hydrateDormerMetadata/resetDormer)
// that ElementCreator's generic "load element data" effect and
// resetFormFields now call into, replacing the inline blocks that used to
// live there.
//
// regenerateDormerAnchor and commitDormerAnchorChanges are returned (not just
// used internally): commitDormerThermalSectionChanges (thermal-accordion +
// assembly-calculator edits) and handleResetDormerNameToAuto both still live
// in ElementCreator and call back into these — see "NOT moved" below for why.
//
// lateNumericInputSettersRef's dormer slots are GONE, not just moved: that ref
// existed only to solve a declaration-order problem (the old "load element
// data" effect, defined ~line 2645 of the pre-slice-6 file, needed to call
// setters for inputs declared ~900 lines later in the same function).
// buildingElementTransparent.tsx's header documents the identical fix for
// freeAreaFractionInput: "That ordering problem doesn't exist inside a single
// useFormState call, so this module calls state.X.setValue directly in its
// own hydrate()." Same here — hydrateDormerMetadata is defined AFTER the 8
// useDecimalInput calls in this same hook body, so it calls .setValue
// directly. ElementCreator.tsx's copy of lateNumericInputSettersRef is
// deleted (grep-verified zero remaining callers after this move).
//
// NOT moved (reclassified from the brief's initial "presumed dormer-exclusive"
// guess to orchestrator-shared, with evidence found during the Stage 5
// classification pass — the brief's decision 2/item 4 instruction that "the
// Selection.type 'dormer' plumbing and assembly-calculator modal invocation
// stay orchestrator-owned" turns out to reach further than just the modal
// invocation itself):
// - dormerAssemblySection/setDormerAssemblySection: NOT dormer-exclusive.
//   Grepped every setDormerAssemblySection(...) call site in the pre-move
//   file: 2 are dormer-owned (the thermal-accordion "Edit assembly" button,
//   the assembly modal's onClose), but 3 are NOT —
//   handleDetailedJunctionHostReadinessAction (a generic thermal-bridge-
//   junction handler for Opaque/Ground elements) and BOTH of the plain
//   (non-dormer) "Assembly calculator" buttons (AdjacentConditionedSpace's
//   party-floor button, Opaque/Ground/PartyWall/AdjacentUnconditionedSpace's
//   button) null it out defensively before opening the modal for a
//   non-dormer element. Moving this state into this hook would mean threading
//   a setter back out to 3 non-dormer call sites — worse than leaving it.
// - selectedDormerMetadata/selectedIsDormerAnchor: pure selection-derived
//   values (`getDormerBundleMetadata`/`isDormerAnchorElement` applied to
//   whatever's currently selected) read by orchestrator-generic code well
//   outside the dormer fields panel (name-edit routing, the Duplicate/Save
//   button dispatch, the "Advanced Fields" ternary) — selection machinery,
//   not dormer-editing machinery.
// - selectedDormerBundleElements/dormerThermalRepresentatives/
//   dormerAssemblyRepresentative/buildDormerThermalEditorData/
//   commitDormerThermalSectionChanges/renderDormerThermalAccordionSection:
//   these render in a SEPARATE part of ElementCreator's JSX tree (the
//   "dormer-editor-thermal-stack", a sibling of the generic AdvancedFieldsEditor
//   branch, not inside renderDormerBundleEditor) and share
//   AdvancedFieldsEditor/comparisonFieldIndicators/evidenceBridge/
//   comparisonFocusRequest/advancedFlat/useFHSSchema/inspectorContributions/
//   workspaceResourcePort with the GENERIC (non-dormer) AdvancedFieldsEditor
//   branch immediately below it in the same ternary. That infrastructure is
//   orchestrator-wide, not dormer-specific; threading it through here would
//   duplicate it rather than relocate it.
// - The AssemblyCalculatorModal invocation, assemblyInitialSnapshot/
//   appliedAssemblyEnvelope (which already blend dormer + non-dormer element
//   data in unified memos), and handleResetDormerNameToAuto/
//   selectedDormerNameIsManual (dormer bundles rename through
//   commitDormerAnchorChanges, called back into from ElementCreator) — all
//   decision-10 orchestrator-owned wiring.
//
// Together these exclusions keep this hook's own arg list to the
// genuinely-orchestrator pieces regenerateDormerAnchor/renderDormerBundleEditor
// actually need: selection, elementsById/getElementById, elementZoneId/
// elementFloorId, elementName, floors, geometryStore, wallShared (parentElement/
// setParentElement), the store mutators (addElement/updateElement/
// removeElement/setSelectedElementIds/setSelection), and the render helpers
// (elementType/fieldUnit/renderFieldLabel) — twelve grouped pieces, at the
// brief's ~12 guideline rather than over it.
//
// SEAM DECISION — renderDormerBundleEditor stays a zero-arg `() => ReactNode`
// (closing over this hook's own call-time args, including elementType/
// fieldUnit/renderFieldLabel), matching the locked
// `ElementFormRenderCtx.renderDormerBundleEditor: () => ReactNode` contract
// and the renderMvhrDuctAndTerminalManager/renderSpaceHeatSystemPicker
// precedent, rather than taking a render-ctx parameter at call time. Since
// ElementCreator calls useDormerBundleEditor fresh every render (not
// memoized), threading elementType/fieldUnit/renderFieldLabel as hook args
// costs nothing extra versus passing them at the ctx.renderDormerBundleEditor()
// call site — and every other render-bridge callback on ElementFormRenderCtx
// (renderMvhrDuctAndTerminalManager, renderSpaceHeatSystemPicker,
// renderSpaceHeatSystemEmitterManager) is genuinely zero-arg, so keeping this
// one zero-arg too avoids a one-off calling convention.
//
// THE (g).2 INVESTIGATION (slice-6 brief decision 8) — VERDICT: NOT REACHABLE.
// resetFormFields (ElementCreator.tsx) really does only reset
// dormerRoofIsUnheatedPitchedRoof, leaving the 8 draft inputs/
// selectedDormerType/dormerDepth uncleared when the selection moves away from
// a dormer anchor (preserved verbatim here as resetDormer() — not fixed
// speculatively, per decision 8). But this cannot leak into a NEW bundle's
// first regeneration: a brand-new dormer is created entirely in
// GeometryCanvas.tsx's handleStageClick (drawMode === 'dormer'), which calls
// buildDormerBundleDraft with ITS OWN hard-coded defaults and writes the five
// member elements directly via updateElement(..., skipAutoSave) — it never
// reads dormerDraftValuesRef or any of ElementCreator's dormer draft state.
// GeometryCanvas.tsx then sets its own selection to `{type:'dormer', id}` and
// passes ElementCreator a REMAPPED `editorSelection = {type:'element',
// id: anchorId}` (see GeometryCanvas.tsx's details-panel block). ElementCreator's
// "load element data" effect depends on `[selection?.id, selection?.type, ...]`
// (primitives, not object identity), so it fires synchronously the moment the
// new anchor id appears, and hydrateDormerMetadata (called from inside that
// SAME effect invocation, right after resetFormFields) unconditionally
// overwrites all 8 draft inputs + selectedDormerType + dormerDepth +
// dormerRoofIsUnheatedPitchedRoof from the FRESH anchor's own persisted
// dormer_bundle metadata — before the user can interact with anything, since
// regenerateDormerAnchor is only ever reachable via a user edit on
// ElementCreator's already-rendered (and by then already-hydrated) fields.
// handleDuplicateDormerBundle is likewise immune: it reads the SOURCE anchor's
// own getDormerBundleMetadata(...), never dormerDraftValuesRef. The residual
// gap is real (and dormerAssemblySection's 3 non-dormer null-out call sites
// are indirect evidence someone already had to work around a related "state
// isn't centrally reset" gap) but it does not reach the specific mechanism
// decision 8 hypothesized.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { roundToTwoDecimals } from '../geometry/constants';
import type { Element, ElementType, Floor } from '../geometry/types';
import type { GeometryStoreApi } from '../stores/geometryStore';
import {
  buildDormerBundleDraft,
  getDormerBundleInfo,
  getDormerBundleMetadata,
  getDormerBundleName,
  isDormerAnchorElement,
  isValidDormerHost,
  type DormerBundleParameters,
  type DormerThermalOverrides,
  type DormerType,
} from '../lib/dormerGeometry';
import {
  useDecimalInput,
  decimalInputProps,
  numericDraftValueOrDefault,
  formatConditionalDecimals,
} from './elementForms/formPrimitives';
import type { ElementFormSelection } from './elementForms/types';
import type { WallSharedFormGroup } from './elementForms/wallShared';
import { ParentElementDropdown } from './ParentElementDropdown';
import { StandardDropdown } from './StandardDropdown';
import { StandardInput } from './StandardInput';

/** Local copy of ElementCreator's shared inline-note style — see
 * MvhrDuctTerminalManager.tsx's header for the same precedent (dozens of
 * still-inline callers elsewhere in ElementCreator.tsx keep the canonical
 * copy there). */
const INLINE_FIELD_NOTE_STYLE: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};

export interface DormerBundleEditorApi {
  /** Bridged onto ElementFormRenderCtx.renderDormerBundleEditor; see this
   * file's header for the zero-arg seam decision. */
  renderDormerBundleEditor: () => ReactNode;
  /** Also called directly by ElementCreator's commitDormerThermalSectionChanges
   * (thermal-accordion + assembly-calculator edits stay orchestrator-owned —
   * see header). */
  regenerateDormerAnchor: (
    anchorId: string,
    overrides?: {
      bundleName?: string;
      hostName?: string;
      parameters?: Partial<DormerBundleParameters>;
      thermalOverrides?: DormerThermalOverrides;
    },
  ) => void;
  /** Also called directly by ElementCreator's handleResetDormerNameToAuto. */
  commitDormerAnchorChanges: (overrides?: {
    bundleName?: string;
    hostName?: string;
    parameters?: Partial<DormerBundleParameters>;
  }) => void;
  handleSaveDormerAnchor: (anchorId: string) => void;
  handleDuplicateDormerBundle: (anchorId: string) => void;
  getDormerBundleNameIssue: (candidateName: string, currentBundleId?: string | null) => string | null;
  /** Called from ElementCreator's "load element data" effect, right after
   * elementFormInstances.BuildingElementOpaque.hydrate(element) — no-ops when
   * `element` isn't a dormer anchor, matching the legacy inline `if
   * (dormerMetadata)` guard. */
  hydrateDormerMetadata: (element: Element) => void;
  /** Called from ElementCreator's resetFormFields. Preserved verbatim (only
   * resets dormerRoofIsUnheatedPitchedRoof) — see header's (g).2 verdict. */
  resetDormer: () => void;
}

export function useDormerBundleEditor(args: {
  selection: ElementFormSelection;
  elementsById: Record<string, Element>;
  getElementById: (id: string) => Element | undefined;
  elementZoneId: string;
  elementFloorId: string;
  elementName: string;
  floors: Floor[];
  geometryStore: GeometryStoreApi;
  wallShared: Pick<WallSharedFormGroup, 'parentElement' | 'setParentElement'>;
  addElement: (element: Omit<Element, 'id'>) => void;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  removeElement: (id: string) => void;
  setSelectedElementIds: (ids: string[]) => void;
  setSelection: (selection: ElementFormSelection) => void;
  elementType: ElementType;
  fieldUnit: (propertyKey: string, targetElementType?: string) => string | undefined;
  renderFieldLabel: (fieldLabel: string, targetElementType?: string, evidenceFieldKey?: string) => ReactNode;
}): DormerBundleEditorApi {
  const {
    selection,
    elementsById,
    getElementById,
    elementZoneId,
    elementFloorId,
    elementName,
    floors,
    geometryStore,
    wallShared,
    addElement,
    updateElement,
    removeElement,
    setSelectedElementIds,
    setSelection,
    elementType,
    fieldUnit,
    renderFieldLabel,
  } = args;

  const selectedElement = selection.id ? getElementById(selection.id) ?? null : null;
  const selectedIsDormerAnchor = isDormerAnchorElement(selectedElement);

  const [selectedDormerType, setSelectedDormerType] = useState<DormerType>('mono-pitch');
  const [dormerDepth, setDormerDepth] = useState<number>(1.5);
  const [dormerRoofIsUnheatedPitchedRoof, setDormerRoofIsUnheatedPitchedRoof] = useState<boolean>(false);

  const mergeDormerExtraJson = (
    existingExtraJson: Record<string, unknown> | undefined,
    nextExtraJson: Record<string, unknown> | undefined,
  ) => {
    const preserved = { ...(existingExtraJson || {}) };
    delete preserved.dormer_bundle;
    delete preserved.geometry_face;
    delete preserved.parent_netting_area;
    return { ...preserved, ...(nextExtraJson || {}) };
  };

  const getDormerBundleNameIssue = (candidateName: string, currentBundleId?: string | null): string | null => {
    const trimmed = candidateName.trim();
    if (!trimmed) return null;

    const seenBundles = new Set<string>();
    const duplicate = Object.values(elementsById).some((element) => {
      const metadata = getDormerBundleMetadata(element);
      if (!metadata) return false;
      if (seenBundles.has(metadata.bundle_id)) return false;
      seenBundles.add(metadata.bundle_id);
      if (metadata.bundle_id === currentBundleId) return false;
      return (getDormerBundleName(element) || '').trim() === trimmed;
    });

    return duplicate ? `Dormer name "${trimmed}" already exists` : null;
  };

  const dormerDraftValuesRef = useRef({
    dormerWidth: 2,
    frontWallHeight: 1.2,
    dormerRoofPitch: 15,
    gableRoofPitch: 35,
    windowWidth: 1.2,
    windowHeight: 1,
    windowSillHeight: 0.6,
    frameAreaFraction: 0.25,
  });

  const regenerateDormerAnchor = (
    anchorId: string,
    overrides: {
      bundleName?: string;
      hostName?: string;
      parameters?: Partial<DormerBundleParameters>;
      thermalOverrides?: DormerThermalOverrides;
    } = {},
  ) => {
    const anchor = getElementById(anchorId);
    if (!anchor || anchor.type !== 'BuildingElementOpaque') {
      throw new Error('Dormer anchor element not found.');
    }

    const metadata = getDormerBundleMetadata(anchor);
    if (!metadata) {
      throw new Error('This element is not a dormer anchor.');
    }

    const targetHostName = (overrides.hostName ?? wallShared.parentElement ?? metadata.host_element_name ?? '').trim();
    const host = Object.values(elementsById).find(
      (element) => element.type === 'BuildingElementOpaque' && element.name === targetHostName,
    );
    if (!host || !isValidDormerHost(host, geometryStore.getState().globalOrientationOffset)) {
      throw new Error('Dormers must stay attached to a valid sloped roof polygon.');
    }

    const nextParameters: DormerBundleParameters = {
      dormerType: selectedDormerType,
      windowCenterPlanPoint: metadata.windowCenterPlanPoint,
      dormerWidth: dormerDraftValuesRef.current.dormerWidth,
      dormerDepth,
      frontWallHeight: dormerDraftValuesRef.current.frontWallHeight,
      dormerRoofPitch: dormerDraftValuesRef.current.dormerRoofPitch,
      gableRoofPitch: dormerDraftValuesRef.current.gableRoofPitch,
      isUnheatedPitchedRoof: dormerRoofIsUnheatedPitchedRoof,
      windowWidth: dormerDraftValuesRef.current.windowWidth,
      windowHeight: dormerDraftValuesRef.current.windowHeight,
      windowSillHeight: dormerDraftValuesRef.current.windowSillHeight,
      frameAreaFraction: dormerDraftValuesRef.current.frameAreaFraction,
      ...(overrides.parameters || {}),
    };

    const names = {
      frontWall: anchor.name,
      leftCheekWall: metadata.cheek_wall_names[0],
      rightCheekWall: metadata.cheek_wall_names[1],
      roofs: metadata.roof_names,
      window: metadata.window_name,
    };
    const suppliedBundleName = overrides.bundleName;
    const bundleName = (
      suppliedBundleName?.trim()
      || elementName.trim()
      || getDormerBundleName(anchor)
      || metadata.bundle_name
      || anchor.name
    ).trim();
    if (!bundleName) {
      throw new Error('Dormer name is required.');
    }
    if (suppliedBundleName !== undefined) {
      const duplicateNameIssue = getDormerBundleNameIssue(bundleName, metadata.bundle_id);
      if (duplicateNameIssue) {
        throw new Error(duplicateNameIssue);
      }
    }

    const draft = buildDormerBundleDraft({
      host,
      dormerType: nextParameters.dormerType,
      windowCenterPlanPoint: nextParameters.windowCenterPlanPoint,
      placementDefaults: {
        dormerWidth: nextParameters.dormerWidth,
        dormerDepth: nextParameters.dormerDepth,
        frontWallHeight: nextParameters.frontWallHeight,
        dormerRoofPitch: nextParameters.dormerRoofPitch,
        gableRoofPitch: nextParameters.gableRoofPitch,
        windowWidth: nextParameters.windowWidth,
        windowHeight: nextParameters.windowHeight,
        windowSillHeight: nextParameters.windowSillHeight,
        frameAreaFraction: nextParameters.frameAreaFraction,
      },
      names,
      bundleName,
      bundleId: metadata.bundle_id,
      floors,
      thermalOverrides: overrides.thermalOverrides ?? metadata.thermal_overrides,
      globalOrientationOffset: geometryStore.getState().globalOrientationOffset,
    });

    if (!draft) {
      throw new Error('Unable to regenerate this dormer from the current parameters.');
    }

    const zoneId = host.zoneId || elementZoneId || anchor.zoneId;
    const floorId = host.floorId || elementFloorId || anchor.floorId;

    updateElement(anchorId, {
      name: names.frontWall,
      zoneId,
      floorId,
      parent_element: host.name,
      ...draft.frontWall,
      extra_json: mergeDormerExtraJson(anchor.extra_json, draft.frontWall.extra_json),
    });

    const existingChildrenByName = new Map(
      Object.values(elementsById)
        .filter((element) => element.id !== anchorId)
        .map((element) => [element.name, element] as const),
    );

    const siblingDefinitions = draft.members.filter((member) => member.role !== 'front-wall-anchor');
    const expectedMemberNames = new Set(draft.members.map((member) => member.name));
    Object.values(elementsById)
      .filter((element) => element.id !== anchorId)
      .filter((element) => getDormerBundleInfo(element)?.bundle_id === metadata.bundle_id)
      .filter((element) => !expectedMemberNames.has(element.name))
      .forEach((element) => removeElement(element.id));

    siblingDefinitions.forEach((definition) => {
      const existingChild = existingChildrenByName.get(definition.name);
      const payload = {
        name: definition.name,
        type: definition.type,
        zoneId,
        floorId,
        parent_element: definition.parent,
        ...definition.updates,
        extra_json: mergeDormerExtraJson(
          existingChild?.extra_json,
          definition.updates.extra_json,
        ),
      };

      if (existingChild) {
        updateElement(existingChild.id, payload as Partial<Element>, true);
      } else {
        addElement(payload as Omit<Element, 'id'>);
      }
    });

    const geometryState = geometryStore.getState();
    const regeneratedElementIds = geometryState.elementIds.filter((id) => {
      const element = geometryState.elementsById[id];
      return getDormerBundleInfo(element)?.bundle_id === metadata.bundle_id;
    });
    setSelectedElementIds(regeneratedElementIds);
    setSelection({ type: 'dormer', id: metadata.bundle_id });
  };

  const handleSaveDormerAnchor = (anchorId: string) => {
    regenerateDormerAnchor(anchorId);
  };

  const handleDuplicateDormerBundle = (anchorId: string) => {
    const anchor = getElementById(anchorId);
    if (!anchor || anchor.type !== 'BuildingElementOpaque') {
      throw new Error('Dormer anchor element not found.');
    }

    const metadata = getDormerBundleMetadata(anchor);
    if (!metadata) {
      throw new Error('This element is not a dormer anchor.');
    }

    const hostName = (metadata.host_element_name || anchor.parent_element || '').trim();
    const host = Object.values(elementsById).find(
      (element) => element.type === 'BuildingElementOpaque' && element.name === hostName,
    );
    if (!host || !isValidDormerHost(host, geometryStore.getState().globalOrientationOffset)) {
      throw new Error('Dormers must stay attached to a valid sloped roof polygon.');
    }

    const existingNames = Object.values(elementsById)
      .map((element) => element.name)
      .filter((name): name is string => Boolean(name));

    const seenBundleIds = new Set<string>();
    const existingBundleNames = Object.values(elementsById)
      .flatMap((element) => {
        const bundleInfo = getDormerBundleMetadata(element);
        if (!bundleInfo || seenBundleIds.has(bundleInfo.bundle_id)) return [];
        seenBundleIds.add(bundleInfo.bundle_id);
        const bundleName = getDormerBundleName(element)?.trim();
        return bundleName ? [bundleName] : [];
      });

    const placementDefaults = {
      dormerWidth: metadata.dormerWidth,
      dormerDepth: metadata.dormerDepth,
      frontWallHeight: metadata.frontWallHeight,
      dormerRoofPitch: metadata.dormerRoofPitch,
      gableRoofPitch: metadata.gableRoofPitch,
      isUnheatedPitchedRoof: metadata.isUnheatedPitchedRoof,
      windowWidth: metadata.windowWidth,
      windowHeight: metadata.windowHeight,
      windowSillHeight: metadata.windowSillHeight,
      frameAreaFraction: metadata.frameAreaFraction,
    };

    const duplicateOffsets = [
      { x: 0.5, y: 0.5 },
      { x: 0.35, y: 0.35 },
      { x: -0.5, y: 0.5 },
      { x: 0.5, y: -0.5 },
    ];

    const duplicateDraft = duplicateOffsets
      .map(({ x, y }) =>
        buildDormerBundleDraft({
          host,
          dormerType: metadata.dormerType,
          windowCenterPlanPoint: {
            x: metadata.windowCenterPlanPoint.x + x,
            y: metadata.windowCenterPlanPoint.y + y,
          },
          existingNames,
          existingBundleNames,
          placementDefaults,
          floors,
          thermalOverrides: metadata.thermal_overrides,
          globalOrientationOffset: geometryStore.getState().globalOrientationOffset,
        }),
      )
      .find((draft): draft is NonNullable<typeof draft> => Boolean(draft));

    if (!duplicateDraft) {
      throw new Error('Unable to place the duplicated dormer on the current host roof.');
    }

    const zoneId = host.zoneId || elementZoneId || anchor.zoneId;
    const floorId = host.floorId || elementFloorId || anchor.floorId;

    duplicateDraft.members.forEach((member) => {
      addElement({
        name: member.name,
        type: member.type,
        zoneId,
        floorId,
        parent_element: member.parent === host.name ? host.name : member.parent,
        ...member.updates,
      } as Omit<Element, 'id'>);
    });

    const geometryState = geometryStore.getState();
    const duplicatedElementIds = geometryState.elementIds.filter((id) => {
      const element = geometryState.elementsById[id];
      return getDormerBundleMetadata(element)?.bundle_id === duplicateDraft.bundleId;
    });
    setSelectedElementIds(duplicatedElementIds);
    setSelection({ type: 'dormer', id: duplicateDraft.bundleId });
  };

  const commitDormerAnchorChanges = (
    overrides: {
      bundleName?: string;
      hostName?: string;
      parameters?: Partial<DormerBundleParameters>;
    } = {},
  ) => {
    if (!selection.id || !selectedIsDormerAnchor) return;
    try {
      regenerateDormerAnchor(selection.id, overrides);
    } catch { /* swallow: best-effort */ }
  };

  const commitDormerNumericParameter =
    <K extends keyof DormerBundleParameters>(key: K) =>
    (value: number | '') => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      // dormerDraftValuesRef (read inside regenerateDormerAnchor, reached via
      // commitDormerAnchorChanges) is a component-local commit-time cache:
      // it's only ever read from this input's onChange/onBlur commit
      // callback, never during JSX render — same precedent as
      // GeometryCanvas.tsx's incremental render-cache refs.
      // eslint-disable-next-line react-hooks/refs -- see comment above
      commitDormerAnchorChanges({
        parameters: { [key]: value } as Partial<DormerBundleParameters>,
      });
    };

  const dormerWidthInput = useDecimalInput(
    2,
    commitDormerNumericParameter('dormerWidth'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerFrontWallHeightInput = useDecimalInput(
    1.2,
    commitDormerNumericParameter('frontWallHeight'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerRoofPitchInput = useDecimalInput(
    15,
    commitDormerNumericParameter('dormerRoofPitch'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const gableRoofPitchInput = useDecimalInput(
    35,
    commitDormerNumericParameter('gableRoofPitch'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerWindowWidthInput = useDecimalInput(
    1.2,
    commitDormerNumericParameter('windowWidth'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerWindowHeightInput = useDecimalInput(
    1,
    commitDormerNumericParameter('windowHeight'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerWindowSillHeightInput = useDecimalInput(
    0.6,
    commitDormerNumericParameter('windowSillHeight'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerFrameAreaFractionInput = useDecimalInput(
    0.25,
    commitDormerNumericParameter('frameAreaFraction'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerWidth = numericDraftValueOrDefault(dormerWidthInput.value, 2);
  const dormerFrontWallHeight = numericDraftValueOrDefault(dormerFrontWallHeightInput.value, 1.2);
  const dormerRoofPitch = numericDraftValueOrDefault(dormerRoofPitchInput.value, 15);
  const gableRoofPitch = numericDraftValueOrDefault(gableRoofPitchInput.value, 35);
  const dormerWindowWidth = numericDraftValueOrDefault(dormerWindowWidthInput.value, 1.2);
  const dormerWindowHeight = numericDraftValueOrDefault(dormerWindowHeightInput.value, 1);
  const dormerWindowSillHeight = numericDraftValueOrDefault(dormerWindowSillHeightInput.value, 0.6);
  const dormerFrameAreaFraction = numericDraftValueOrDefault(dormerFrameAreaFractionInput.value, 0.25);
  useLayoutEffect(() => {
    dormerDraftValuesRef.current = {
      dormerWidth,
      frontWallHeight: dormerFrontWallHeight,
      dormerRoofPitch,
      gableRoofPitch,
      windowWidth: dormerWindowWidth,
      windowHeight: dormerWindowHeight,
      windowSillHeight: dormerWindowSillHeight,
      frameAreaFraction: dormerFrameAreaFraction,
    };
  }, [
    dormerFrameAreaFraction,
    dormerFrontWallHeight,
    dormerRoofPitch,
    dormerWidth,
    dormerWindowHeight,
    dormerWindowSillHeight,
    dormerWindowWidth,
    gableRoofPitch,
  ]);

  const hydrateDormerMetadata = (element: Element) => {
    const dormerMetadata = getDormerBundleMetadata(element);
    if (!dormerMetadata) return;
    setSelectedDormerType(dormerMetadata.dormerType);
    dormerWidthInput.setValue(roundToTwoDecimals(dormerMetadata.dormerWidth));
    setDormerDepth(roundToTwoDecimals(dormerMetadata.dormerDepth));
    dormerFrontWallHeightInput.setValue(roundToTwoDecimals(dormerMetadata.frontWallHeight));
    dormerRoofPitchInput.setValue(dormerMetadata.dormerRoofPitch);
    gableRoofPitchInput.setValue(dormerMetadata.gableRoofPitch);
    setDormerRoofIsUnheatedPitchedRoof(!!dormerMetadata.isUnheatedPitchedRoof);
    dormerWindowWidthInput.setValue(roundToTwoDecimals(dormerMetadata.windowWidth));
    dormerWindowHeightInput.setValue(roundToTwoDecimals(dormerMetadata.windowHeight));
    dormerWindowSillHeightInput.setValue(roundToTwoDecimals(dormerMetadata.windowSillHeight));
    dormerFrameAreaFractionInput.setValue(roundToTwoDecimals(dormerMetadata.frameAreaFraction));
  };

  const resetDormer = () => {
    // Preserved verbatim (see header's (g).2 verdict — NOT fixed
    // speculatively): only dormerRoofIsUnheatedPitchedRoof is reset here,
    // exactly as legacy resetFormFields did.
    setDormerRoofIsUnheatedPitchedRoof(false);
  };

  const renderDormerBundleEditor = (): ReactNode => (
    <>
      {renderFieldLabel('Host Roof:', elementType, 'parent_element')}
      <div className="element-input">
        <ParentElementDropdown
          value={wallShared.parentElement}
          onChange={(value) => {
            wallShared.setParentElement(value);
            commitDormerAnchorChanges({ hostName: value });
          }}
          elementType={elementType}
          zoneId={elementZoneId}
          placeholder="Select the sloped roof hosting this dormer"
          selfId={selection.type === 'element' ? selection.id : undefined}
        />
        <div style={INLINE_FIELD_NOTE_STYLE}>
          Changes regenerate the dormer roof, cheek walls, window, and roof cutout instantly.
        </div>
      </div>
      {renderFieldLabel('Dormer Shape:', elementType)}
      <div className="element-input">
        <StandardDropdown
          value={selectedDormerType}
          onChange={(value) => {
            const nextValue = value as DormerType;
            setSelectedDormerType(nextValue);
            commitDormerAnchorChanges({ parameters: { dormerType: nextValue } });
          }}
          options={[
            { value: 'mono-pitch', label: 'Mono-pitch' },
            { value: 'gable-front', label: 'Gable-front' },
            { value: 'hip', label: 'Hip' },
          ]}
          variant="ghost"
          size="md"
        />
      </div>
      {renderFieldLabel('Dormer Width (m):', elementType, 'width')}
      <div className="element-input">
        <StandardInput
          {...decimalInputProps(dormerWidthInput)}
          unit={fieldUnit('width')}
          step="0.1"
          min="0"
          variant="ghost"
          size="md"
        />
      </div>
      {renderFieldLabel('Dormer Depth (derived):', elementType, 'depth')}
      <div className="element-input">
        <StandardInput
          type="text"
          inputMode="numeric"
          value={formatConditionalDecimals(dormerDepth)}
          unit={fieldUnit('depth')}
          step="0.1"
          min="0"
          variant="ghost"
          size="md"
          readOnly
        />
      </div>
      {renderFieldLabel('Front Wall Height (m):', elementType, 'height')}
      <div className="element-input">
        <StandardInput
          {...decimalInputProps(dormerFrontWallHeightInput)}
          unit={fieldUnit('height')}
          step="0.1"
          min="0"
          variant="ghost"
          size="md"
        />
      </div>
      {selectedDormerType === 'mono-pitch' ? (
        <>
          {renderFieldLabel('Dormer Roof Pitch (degrees):', elementType, 'pitch')}
          <div className="element-input">
            <StandardInput
              {...decimalInputProps(dormerRoofPitchInput)}
              unit={fieldUnit('pitch')}
              step="1"
              min="0"
              max="89"
              variant="ghost"
              size="md"
            />
          </div>
        </>
      ) : (
        <>
          {renderFieldLabel('Side Roof Pitch (degrees):', elementType, 'pitch')}
          <div className="element-input">
            <StandardInput
              {...decimalInputProps(gableRoofPitchInput)}
              unit={fieldUnit('pitch')}
              step="1"
              min="1"
              max="89"
              variant="ghost"
              size="md"
            />
          </div>
        </>
      )}
      {renderFieldLabel('Unheated Pitched Roof', elementType)}
      <div className="element-input">
        <label className="checkbox-container">
          <input
            type="checkbox"
            className="styled-checkbox"
            checked={!!dormerRoofIsUnheatedPitchedRoof}
            onChange={(e) => {
              const checked = e.target.checked;
              setDormerRoofIsUnheatedPitchedRoof(checked);
              commitDormerAnchorChanges({ parameters: { isUnheatedPitchedRoof: checked } });
            }}
            id="dormer-unheated-pitched-roof"
          />
          <span className="checkbox-custom"></span>
        </label>
      </div>
      {renderFieldLabel('Window Width (m):', 'BuildingElementTransparent', 'width')}
      <div className="element-input">
        <StandardInput
          {...decimalInputProps(dormerWindowWidthInput)}
          unit={fieldUnit('width', 'BuildingElementTransparent')}
          step="0.1"
          min="0"
          variant="ghost"
          size="md"
        />
      </div>
      {renderFieldLabel('Window Height (m):', 'BuildingElementTransparent', 'height')}
      <div className="element-input">
        <StandardInput
          {...decimalInputProps(dormerWindowHeightInput)}
          unit={fieldUnit('height', 'BuildingElementTransparent')}
          step="0.1"
          min="0"
          variant="ghost"
          size="md"
        />
      </div>
      {renderFieldLabel('Window Sill Height (m):', 'BuildingElementTransparent', 'base_height')}
      <div className="element-input">
        <StandardInput
          {...decimalInputProps(dormerWindowSillHeightInput)}
          unit={fieldUnit('base_height', 'BuildingElementTransparent')}
          step="0.1"
          min="0"
          variant="ghost"
          size="md"
        />
      </div>
      {renderFieldLabel('Window Frame Area Fraction:', 'BuildingElementTransparent', 'frame_area_fraction')}
      <div className="element-input">
        <StandardInput
          {...decimalInputProps(dormerFrameAreaFractionInput)}
          unit={fieldUnit('frame_area_fraction', 'BuildingElementTransparent')}
          step="0.01"
          min="0"
          max="1"
          variant="ghost"
          size="md"
        />
      </div>
    </>
  );

  return {
    renderDormerBundleEditor,
    regenerateDormerAnchor,
    commitDormerAnchorChanges,
    handleSaveDormerAnchor,
    handleDuplicateDormerBundle,
    getDormerBundleNameIssue,
    hydrateDormerMetadata,
    resetDormer,
  };
}
