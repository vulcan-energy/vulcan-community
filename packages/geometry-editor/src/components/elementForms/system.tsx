// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// System form family (HeatSourceWet/HotWaterSource/SpaceCoolSystem/
// SpaceHeatSystem), moved verbatim from ElementCreator's five inline
// structures (slice-5 brief: System + WetEmitter). System is the larger of
// the two families in this slice and the first whose store-sync effect and
// surrounding memo graph move into its own useFormState per slice-5 brief
// decision (f).2 ("GO" — a new-but-approved contract shape: a module's
// useFormState may declare its own useEffect/useMemo beyond a flat
// useState list, same as every other module already does for derived
// values, just applied here to the store-sync effect too).
//
// CONTRACT ADDITIONS (this stage): ElementFormStateCtx.elementType and
// ElementFormStateCtx/ElementFormBuildCtx.getZoneNameForElementZoneId — see
// elementForms/types.ts's doc comments on those fields. elementType is
// needed because several moved pieces (systemPresetDirectory's useKeyedState
// key, selectedSystemElement(+Full), systemSwitchNeedsWarning/
// requestSystemUiMode's isSystemElementType gate) must know whether System is
// currently the *displayed* family, which is orchestrator UI state
// (ElementTypePicker can retype an existing element without a selection
// change) and not otherwise derivable from ctx.selection.
//
// MEMO-PARTITION (the hard part of this stage — read before editing the
// heat-source/emitters block): the brief's per-family inventory lists
// heatSourceWetReferenceOptions and six selectedSpaceHeatSystem* memos as
// System's exclusive state. Tracing every consumer (grep-verified) found:
//   - selectedSpaceHeatSystemHeatSourceName, ...Type, ...IsWetDistribution,
//     ...UsesHeatSourceWet, ...HeatSourceElement, ...LinkedEmitterElements,
//     ...AvailableEmitterElements, heatSourceWetReferenceOptions (+derived
//     singleHeatSourceWetReferenceName), and handleSpaceHeatSystemHeatSourceChange
//     are ALL consumed only by (a) the orchestrator-retained cross-creation/
//     jump handlers (handleEditSelectedSpaceHeatSystemHeatSource,
//     handleSpaceHeatSystemEmitterToggle, handleCreateRadiatorForSelectedSpaceHeatSystem
//     — decision (f).1's CONSERVATIVE six) and (b) the single JSX fragment
//     that renders the heat-source dropdown + its "Edit" jump-link + the
//     linked-emitters manager. Decision (f).1's own text already maps THREE
//     handlers (not two) onto ctx.renderSpaceHeatSystemEmitterManager, so
//     stage 3 widens that callback's JSX boundary (it only covered the
//     emitter dropdown in stage 1, because System's panel was still inline
//     then) to cover the whole fragment — see ElementCreator.tsx's comment
//     above renderSpaceHeatSystemEmitterManager for the full writeup. Net
//     result: ALL of the above stay 100% orchestrator-owned; NONE of them
//     appear in this module. Only two pieces from that cluster survive here:
//   - selectedSystemElement / selectedSystemElementFull: genuinely forked.
//     selectedSystemElement moves cleanly (only consumers were
//     systemSourceFromStore and the store-sync effect, both moving).
//     selectedSystemElementFull is ALSO needed by this module's own
//     renderPanel (the PCDB-source branch's `element` prop) while its OTHER
//     consumers (the orchestrator-retained cluster above) need the
//     orchestrator's own copy — so it is duplicated-by-derivation here
//     (cheap, pure, from ctx.elementType/selection/selectedElementV/
//     getElementById) rather than threaded through a new ctx field, per the
//     brief's stated preference.
//   - heatSourceWetReferenceOptions / singleHeatSourceWetReferenceName ARE
//     also forked: applySystemPresetChange (moving) needs
//     singleHeatSourceWetReferenceName, while the orchestrator's
//     createSpaceHeatSystemForCurrentEmitter (retained) and the widened
//     renderSpaceHeatSystemEmitterManager (retained) also need them. Same
//     duplicated-by-derivation resolution: this module re-derives its own
//     copy from ctx.elementsById via resolveHeatSourceWetReferenceName.
// CREATE_SPACE_HEAT_SYSTEM_OPTION / DEFAULT_WET_DISTRIBUTION_PRESET_ID: per
// the same tracing, every remaining consumer of both constants is
// orchestrator-retained code (the WetEmitter bridge handlers and, after the
// widening above, selectedSpaceHeatSystemIsWetDistribution). Neither constant
// is referenced anywhere in this module, so — unlike the brief's assumption
// that one file would need to import them from the other — both simply stay
// defined in ElementCreator.tsx untouched, with zero import in either
// direction.
//
// DeleteConfirmModal (the pendingSystemAction confirm dialog): stays
// orchestrator-side (option (b) from the brief's item 8), NOT moved into this
// module's renderPanel. This module exposes pendingSystemAction/
// setPendingSystemAction/confirmSystemSourceSwitch on its returned state for
// the orchestrator's tail-rendered modal to read. That placement decision is
// unchanged by the simplify-commit fix below: renderPanel only mounts while
// `elementType === 'System' && (selection.type === 'element' || 'global')`,
// so moving the modal inside would still make it vanish (not close, just
// unmount mid-confirm with no onClose/onConfirm run) the instant selection
// changes away — the orchestrator-tail placement (mounted unconditionally in
// `body`, outside any selection/elementType gate) does not do that.
// formatSystemPresetName and PendingSystemAction are exported here (per the
// brief's move list) and imported back into ElementCreator.tsx for the
// modal's title/message text — the same "import a helper back from its
// module" pattern already used for e.g. getLightingFieldValue.
//
// INTENTIONAL BEHAVIOUR FIX (slice-5 brief decision (g), landed in the
// simplify commit): legacy resetFormFields never cleared pendingSystemAction,
// so a pending confirm could survive a selection change to ANY other
// element/zone/dormer. reset() below now calls setPendingSystemAction(null)
// — see its own comment for the mechanics. That closes the modal itself on
// selection change too (isOpen={!!systemFormState.pendingSystemAction} in
// ElementCreator.tsx reads this module's state live), which is a genuine
// behaviour change from the pre-fix leak, not a further argument for
// relocating the modal above.
//
// systemPresetOptions/preset-loading effect: uses ctx.workspaceResourcePort
// (stage-1 ctx addition) exactly as the brief anticipated. useKeyedState
// import source matches the already-extracted windowShading.tsx precedent:
// '../../hooks/useKeyedState'.
//
// traceSystemFlow: also forked. It moves into this module's useFormState
// (decision (f).2) for commitSystemSelectionUpdate/the store-sync effect/
// handlePcdbSystemApply, all of which move. But it is ALSO called by
// ElementCreator's handleAdvancedFieldsChange, which stays orchestrator per
// the brief's CRITICAL EXCLUSIONS. traceSystemFlow is dev-only console.debug
// instrumentation gated behind `window.__TRACE_SYSTEM_PCDB === true` (no test
// coverage anywhere in the repo — grep-verified), so ElementCreator.tsx keeps
// its own small copy for handleAdvancedFieldsChange's call sites, with the
// `localUiMode`/`localSubcategory`/`localSystemPreset` debug fields dropped
// (those now live exclusively in this module's state and are not reachable
// from the orchestrator) — the only non-verbatim deviation in this stage,
// and it affects nothing but an opt-in developer console payload.

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Element } from '../../geometry/types';
import { listCategoryJsonOptions, type WorkspaceSnippetOption } from '../../geometry/parameterLibraryCatalog';
import { syncSpaceHeatSystemZoneNameInExtraJson } from '../../lib/spaceHeatSystemSync';
import { useKeyedState } from '../../hooks/useKeyedState';
import { StandardDropdown } from '../StandardDropdown';
import {
  buildSpaceHeatSystemSampleBaselineExtraJson,
  getSystemElementSourceFromState,
  readSelectedSystemElement,
  resolveHeatSourceWetReferenceName,
  SYSTEM_SOURCE_META_KEY,
  SYSTEM_SUBCATEGORY_LABELS,
  SYSTEM_SUBCATEGORY_TO_DIR,
  systemExtraJsonHasPcdb,
  systemExtraJsonHasSamplePlant,
  systemExtraJsonIsMeaningfulSampleSide,
  type SystemElementSource,
  uiModeForSystemSource,
} from '../systemEditorUtils';
import type { ElementFormModule, ElementFormSelection, ElementFormStateCtx } from './types';

/** This module's exclusive share of ElementCreator's `PendingSystemAction`
 * local type — moved verbatim, exported for the orchestrator's DeleteConfirmModal
 * (see module header's "DeleteConfirmModal" note). */
export type PendingSystemAction =
  | { kind: 'source'; target: 'presets' | 'pcdb' }
  | { kind: 'subcategory'; value: string }
  | { kind: 'preset'; value: string };

export function formatSystemPresetName(preset: string): string {
  return preset.replace(/_/g, ' ');
}

/** Pure, stateless — duplicated verbatim from ElementCreator's own copy
 * (which the orchestrator keeps for createSpaceHeatSystemForCurrentEmitter,
 * one of the retained cross-creation handlers). See module header. */
function withSystemSourceMeta(
  extraJson: Record<string, unknown> | null | undefined,
  source: SystemElementSource,
): Record<string, unknown> | null {
  if (!extraJson || typeof extraJson !== 'object' || Array.isArray(extraJson)) return null;
  return { ...extraJson, [SYSTEM_SOURCE_META_KEY]: source };
}

export interface SystemFormState {
  systemSubcategory: string;
  setSystemSubcategory: (value: string) => void;
  systemPreset: string;
  setSystemPreset: (value: string) => void;
  systemExtraJson: unknown;
  /** Also called directly by ElementCreator's orchestrator-retained
   * handleSpaceHeatSystemHeatSourceChange (see system.tsx's module header —
   * that handler stays orchestrator-owned but still writes this module's
   * local draft state, same as the DeleteConfirmModal fields below). */
  setSystemExtraJson: (value: unknown) => void;
  systemUiMode: 'presets' | 'pcdb';
  /** Not read by renderPanel (systemUiMode above is the read side); exposed
   * only because ElementFormModule.reset(state) needs to restore it to
   * 'presets', matching the legacy resetFormFields' five System lines. */
  setSystemUiMode: (value: 'presets' | 'pcdb') => void;
  /** Internal to this module's own hydrate/store-sync effect — exposed only
   * because ElementFormModule.reset(state) can't otherwise reach it. */
  prevSystemSelectionIdRef: MutableRefObject<string | null>;
  /** Exposed for the orchestrator's tail-rendered DeleteConfirmModal — see
   * module header's "DeleteConfirmModal" note. */
  pendingSystemAction: PendingSystemAction | null;
  setPendingSystemAction: (value: PendingSystemAction | null) => void;
  confirmSystemSourceSwitch: () => void;
  systemPresetOptions: WorkspaceSnippetOption[];
  systemPresetDropdownOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  selectedSystemPresetLabel: string;
  systemSourceFromStore: SystemElementSource;
  /** Duplicated-by-derivation from ctx.elementsById — see module header. */
  selectedSystemElementFull: Extract<Element, { type: 'System' }> | null;
  selectedElementV: number;
  handleSystemSubcategoryChange: (value: string) => void;
  handleSystemPresetChange: (value: string) => void;
  requestSystemUiMode: (target: 'presets' | 'pcdb') => void;
  handlePcdbSystemApply: (payload: { subcategory: string; extraJson: Record<string, unknown> }) => void;
}

function useFormState(ctx: ElementFormStateCtx): SystemFormState {
  const selection = ctx.selection;
  const isSystemElementType = ctx.elementType === 'System';

  const isExistingElementSelection = (
    target: ElementFormSelection | null = selection,
  ): target is ElementFormSelection & { type: 'element' | 'global' } =>
    !!target && (target.type === 'element' || target.type === 'global') && !target.isPlaceholder;

  const [systemSubcategory, setSystemSubcategory] = useState<string>('');
  const [systemPreset, setSystemPreset] = useState<string>('');
  const systemPresetDirectory = isSystemElementType
    ? SYSTEM_SUBCATEGORY_TO_DIR[systemSubcategory]
    : undefined;
  const emptySystemPresetOptions = useMemo<WorkspaceSnippetOption[]>(() => [], []);
  const [systemPresetOptions, setSystemPresetOptions] = useKeyedState(
    systemPresetDirectory ?? 'unsupported',
    emptySystemPresetOptions,
  );
  const [systemExtraJson, setSystemExtraJson] = useState<unknown>(null);
  const [systemUiMode, setSystemUiMode] = useState<'presets' | 'pcdb'>('presets');
  const prevSystemSelectionIdRef = useRef<string | null>(null);
  const [pendingSystemAction, setPendingSystemAction] = useState<PendingSystemAction | null>(null);

  const traceSystemFlow = useCallback(
    (event: string, payload?: Record<string, unknown>) => {
      if (typeof window === 'undefined') return;
      if (((window as unknown) as Record<string, unknown>).__TRACE_SYSTEM_PCDB !== true) return;
      const currentSelection = selection;
      const selected = readSelectedSystemElement(
        currentSelection,
        (id) => ctx.getElementById(id) as {
          type?: unknown;
          extra_json?: unknown;
          system_preset?: unknown;
          subcategory?: unknown;
        } | undefined,
      );
      const selectedExtra =
        selected &&
        selected.extra_json &&
        typeof selected.extra_json === 'object' &&
        !Array.isArray(selected.extra_json)
          ? (selected.extra_json as Record<string, unknown>)
          : null;
      const hasStorePcdb =
        !!selectedExtra &&
        !!selectedExtra._pcdb &&
        typeof selectedExtra._pcdb === 'object' &&
        !Array.isArray(selectedExtra._pcdb);
      console.debug('[SystemTrace]', event, {
        at: new Date().toISOString(),
        selectionId: currentSelection?.id ?? null,
        selectionType: currentSelection?.type ?? null,
        selectionPlaceholder: !!currentSelection?.isPlaceholder,
        localUiMode: systemUiMode,
        localSubcategory: systemSubcategory,
        localSystemPreset: systemPreset || null,
        storeSystemPreset: selected ? (selected.system_preset ?? null) : null,
        storeHasPcdb: hasStorePcdb,
        ...payload,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is a fresh object literal every render (see ElementCreator.tsx's elementFormStateCtx); ctx.getElementById is itself a stable store-selector reference, so depending on the whole object would defeat memoization for no benefit (same idiom as thermalBridgeLinear.tsx's ctx.* dep arrays).
    [selection, ctx.getElementById, systemUiMode, systemSubcategory, systemPreset],
  );

  const selectedSystemElement = useMemo(() => {
    void ctx.selectedElementV;
    if (!isSystemElementType) return null;
    return readSelectedSystemElement(
      selection,
      (id) => ctx.getElementById(id) as {
        type?: unknown;
        extra_json?: unknown;
        system_preset?: unknown;
        subcategory?: unknown;
      } | undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see commitSystemSelectionUpdate's dep-array comment above.
  }, [isSystemElementType, selection, ctx.selectedElementV, ctx.getElementById]);

  const selectedSystemElementFull = useMemo(() => {
    void ctx.selectedElementV;
    if (!isSystemElementType) return null;
    if (!selection?.id || selection.isPlaceholder) return null;
    if (selection.type !== 'element' && selection.type !== 'global') return null;
    const element = ctx.getElementById(selection.id);
    return element?.type === 'System' ? element : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see commitSystemSelectionUpdate's dep-array comment above.
  }, [isSystemElementType, selection?.id, selection?.isPlaceholder, selection?.type, ctx.selectedElementV, ctx.getElementById]);

  // Re-derived locally rather than threaded through ctx — see module header's
  // "heatSourceWetReferenceOptions / singleHeatSourceWetReferenceName ARE
  // also forked" note. Only applySystemPresetChange below needs it; the
  // orchestrator keeps its own separate copy for the pieces that stayed there.
  const heatSourceWetReferenceOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    for (const element of Object.values(ctx.elementsById)) {
      const value = resolveHeatSourceWetReferenceName(element);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const label = element.name && element.name !== value ? `${element.name} (${value})` : value;
      options.push({ value, label });
    }
    return options;
  }, [ctx.elementsById]);
  const singleHeatSourceWetReferenceName = useMemo(
    () => heatSourceWetReferenceOptions.length === 1 ? heatSourceWetReferenceOptions[0].value : null,
    [heatSourceWetReferenceOptions],
  );

  const systemSourceFromStore = useMemo<SystemElementSource>(() => {
    if (!selectedSystemElement) return 'presets';
    return getSystemElementSourceFromState(selectedSystemElement.system_preset, selectedSystemElement.extra_json);
  }, [selectedSystemElement]);
  const systemUiModeFromStore = useMemo(
    () => uiModeForSystemSource(systemSourceFromStore),
    [systemSourceFromStore],
  );

  const commitSystemSelectionUpdate = useCallback(
    (params: {
      source: SystemElementSource;
      subcategory: string;
      systemPreset?: string;
      extraJson?: Record<string, unknown> | null;
      reason: string;
    }) => {
      if (!isExistingElementSelection()) return;
      // TS doesn't narrow the outer `selection` closure variable from the
      // type-predicate default-parameter call above (unlike the orchestrator's
      // own equivalent, where `selection` is the destructured prop itself) —
      // non-null assertion is safe here since isExistingElementSelection()
      // just verified it.
      const id = selection!.id;
      const nextSystemPreset = params.systemPreset && params.systemPreset.trim() ? params.systemPreset : undefined;
      const incomingExtra =
        params.extraJson && typeof params.extraJson === 'object' && !Array.isArray(params.extraJson)
          ? ({ ...params.extraJson } as Record<string, unknown>)
          : undefined;
      let nextExtraJson: Record<string, unknown> | undefined = incomingExtra;
      if (params.source === 'pcdb') {
        if (!nextExtraJson) nextExtraJson = {};
        nextExtraJson[SYSTEM_SOURCE_META_KEY] = 'pcdb';
      } else if (params.source === 'presets') {
        if (!nextExtraJson) nextExtraJson = {};
        nextExtraJson[SYSTEM_SOURCE_META_KEY] = 'presets';
      } else if (nextExtraJson) {
        nextExtraJson[SYSTEM_SOURCE_META_KEY] = 'custom';
      }
      setSystemSubcategory(params.subcategory);
      setSystemPreset(nextSystemPreset ?? '');
      setSystemExtraJson(nextExtraJson ?? null);
      setSystemUiMode(uiModeForSystemSource(params.source));
      traceSystemFlow('system-commit', {
        reason: params.reason,
        source: params.source,
        subcategory: params.subcategory,
        systemPreset: nextSystemPreset ?? null,
        hasPcdb:
          !!nextExtraJson?._pcdb &&
          typeof nextExtraJson._pcdb === 'object' &&
          !Array.isArray(nextExtraJson._pcdb),
        keys: nextExtraJson ? Object.keys(nextExtraJson) : [],
      });
      ctx.updateElement(id, {
        subcategory: params.subcategory,
        system_preset: nextSystemPreset,
        extra_json: nextExtraJson,
      } as Partial<Element>);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isExistingElementSelection closes over `selection` (already listed) and is redefined every render, not a stable identity.
    [selection, ctx.updateElement, traceSystemFlow],
  );

  // System UI mode follows persisted source-of-truth in the selected element
  // — moved verbatim into this module's useFormState per decision (f).2.
  useEffect(() => {
    if (!isSystemElementType) {
      prevSystemSelectionIdRef.current = null;
      return;
    }
    if (!selection?.id || selection.isPlaceholder) return;
    if (selection.type !== 'element' && selection.type !== 'global') return;
    if (!selectedSystemElement) return;
    const idChanged = prevSystemSelectionIdRef.current !== selection.id;
    prevSystemSelectionIdRef.current = selection.id;
    const nextMode = uiModeForSystemSource(systemSourceFromStore);
    if (systemUiMode !== nextMode || idChanged) {
      traceSystemFlow('system-ui-mode-from-store', {
        nextMode,
        idChanged,
        source: systemSourceFromStore,
      });
      setSystemUiMode(nextMode);
    }
  }, [
    isSystemElementType,
    selection?.id,
    selection?.type,
    selection?.isPlaceholder,
    selectedSystemElement,
    systemSourceFromStore,
    systemUiMode,
    traceSystemFlow,
  ]);

  const systemSwitchNeedsWarning = useCallback(
    (target: 'presets' | 'pcdb'): boolean => {
      if (!isSystemElementType) return false;
      if (!selection?.id || selection.isPlaceholder) return false;
      if (selection.type !== 'element' && selection.type !== 'global') return false;
      const el = ctx.getElementById(selection.id) as {
        type?: string;
        extra_json?: unknown;
        system_preset?: string;
      } | undefined;
      if (!el || el.type !== 'System') return false;
      const ex = el.extra_json;
      if (target === 'pcdb') {
        const sp = el.system_preset;
        if (sp != null && String(sp).trim() !== '') return true;
        return systemExtraJsonHasSamplePlant(ex) || systemExtraJsonIsMeaningfulSampleSide(ex);
      }
      return systemExtraJsonHasPcdb(ex);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see commitSystemSelectionUpdate's dep-array comment above.
    [ctx.getElementById, isSystemElementType, selection],
  );

  const applySystemSubcategoryChange = useCallback(
    (value: string) => {
      setSystemSubcategory(value);
      setSystemPreset('');
      setSystemExtraJson(null);
      if (
        selection?.id
        && !selection.isPlaceholder
        && (selection.type === 'element' || selection.type === 'global')
      ) {
        ctx.updateElement(selection.id, {
          subcategory: value || undefined,
          system_preset: undefined,
          extra_json: undefined,
        } as Partial<Element>);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see commitSystemSelectionUpdate's dep-array comment above.
    [selection, ctx.updateElement],
  );

  const handleSystemSubcategoryChange = useCallback(
    (value: string) => {
      if (value === systemSubcategory) return;
      if (systemSwitchNeedsWarning('pcdb')) {
        setPendingSystemAction({ kind: 'subcategory', value });
        return;
      }
      applySystemSubcategoryChange(value);
    },
    [applySystemSubcategoryChange, systemSubcategory, systemSwitchNeedsWarning],
  );

  const applySystemPresetChange = useCallback(
    async (value: string) => {
      const nextPreset = value.trim();
      if (!nextPreset) {
        setSystemPreset('');
        setSystemExtraJson(null);
        if (
          selection?.id
          && !selection.isPlaceholder
          && (selection.type === 'element' || selection.type === 'global')
        ) {
          ctx.updateElement(selection.id, {
            system_preset: undefined,
            extra_json: undefined,
          } as Partial<Element>);
        }
        return;
      }

      const dir = SYSTEM_SUBCATEGORY_TO_DIR[systemSubcategory];
      if (!dir) return;

      try {
        const raw = await ctx.workspaceResourcePort.readText(
          `input/batch_parameters/${dir}/${nextPreset}.json`,
        );
        const parsedRaw = JSON.parse(raw) as Record<string, unknown>;
        const selectedElement =
          selection?.id && !selection.isPlaceholder && (selection.type === 'element' || selection.type === 'global')
            ? ctx.getElementById(selection.id)
            : null;
        const selectedZoneName =
          selectedElement?.zoneId
            ? ctx.getZoneNameForElementZoneId(selectedElement.zoneId)
            : null;
        const parsed =
          systemSubcategory === 'SpaceHeatSystem' && selectedElement?.type === 'System'
            ? buildSpaceHeatSystemSampleBaselineExtraJson(
                parsedRaw,
                selectedElement.extra_json,
                selectedElement.name || 'Space heating',
                selectedZoneName,
                singleHeatSourceWetReferenceName,
              )
            : parsedRaw;
        const nextExtraJson = withSystemSourceMeta(parsed, 'presets') ?? {};
        setSystemPreset(nextPreset);
        setSystemExtraJson(nextExtraJson);
        if (
          selection?.id
          && !selection.isPlaceholder
          && (selection.type === 'element' || selection.type === 'global')
        ) {
          commitSystemSelectionUpdate({
            source: 'presets',
            subcategory: systemSubcategory,
            systemPreset: nextPreset,
            extraJson: parsed,
            reason: 'preset-dropdown-change',
          });
        }
      } catch (e) {
        console.warn(`[System] Failed to load preset ${dir}/${nextPreset}.json`, e);
        alert(`Failed to load system preset "${nextPreset}".`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see commitSystemSelectionUpdate's dep-array comment above.
    [
      selection,
      systemSubcategory,
      ctx.updateElement,
      ctx.workspaceResourcePort,
      ctx.getElementById,
      ctx.getZoneNameForElementZoneId,
      singleHeatSourceWetReferenceName,
      commitSystemSelectionUpdate,
    ],
  );

  const handleSystemPresetChange = useCallback(
    (value: string) => {
      if (value.trim() === systemPreset) return;
      if (systemSwitchNeedsWarning('pcdb')) {
        setPendingSystemAction({ kind: 'preset', value });
        return;
      }
      void applySystemPresetChange(value);
    },
    [applySystemPresetChange, systemPreset, systemSwitchNeedsWarning],
  );

  const handlePcdbSystemApply = useCallback(
    (payload: { subcategory: string; extraJson: Record<string, unknown> }) => {
      if (!isExistingElementSelection()) return;
      traceSystemFlow('pcdb-apply-start', {
        payloadSubcategory: payload.subcategory,
        payloadHasPcdb:
          !!payload.extraJson?._pcdb &&
          typeof payload.extraJson._pcdb === 'object' &&
          !Array.isArray(payload.extraJson._pcdb),
        payloadKeys: Object.keys(payload.extraJson ?? {}),
      });
      setSystemSubcategory(payload.subcategory);
      commitSystemSelectionUpdate({
        source: 'pcdb',
        subcategory: payload.subcategory,
        systemPreset: '',
        extraJson: payload.extraJson,
        reason: 'pcdb-apply',
      });
      traceSystemFlow('pcdb-apply-committed', {
        payloadSubcategory: payload.subcategory,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isExistingElementSelection closes over `selection` (already reachable via traceSystemFlow/commitSystemSelectionUpdate's own deps), redefined every render.
    [traceSystemFlow, commitSystemSelectionUpdate],
  );

  const clearSystemToPcdbShell = useCallback(() => {
    if (!selection?.id || selection.isPlaceholder) return;
    if (selection.type !== 'element' && selection.type !== 'global') return;
    commitSystemSelectionUpdate({
      source: 'pcdb',
      subcategory: systemSubcategory,
      systemPreset: '',
      extraJson: null,
      reason: 'switch-to-pcdb-shell',
    });
  }, [selection, systemSubcategory, commitSystemSelectionUpdate]);

  const applyFirstSamplePresetAfterPcdb = useCallback(async () => {
    if (!selection?.id || selection.isPlaceholder) return;
    if (selection.type !== 'element' && selection.type !== 'global') return;
    const dir = SYSTEM_SUBCATEGORY_TO_DIR[systemSubcategory];
    const options = dir
      ? await listCategoryJsonOptions(ctx.workspaceResourcePort, dir)
      : [];
    const first = options[0]?.id || '';
    if (!dir || !first) {
      commitSystemSelectionUpdate({
        source: 'custom',
        subcategory: systemSubcategory,
        systemPreset: '',
        extraJson: null,
        reason: 'switch-to-presets-empty',
      });
      return;
    }
    try {
      const raw = await ctx.workspaceResourcePort.readText(
        `input/batch_parameters/${dir}/${first}.json`,
      );
      const nextExtraJson = JSON.parse(raw);
      commitSystemSelectionUpdate({
        source: 'presets',
        subcategory: systemSubcategory,
        systemPreset: first,
        extraJson: nextExtraJson,
        reason: 'switch-to-presets-first',
      });
    } catch (e) {
      console.warn(`[System] Failed to load default preset ${dir}/${first}.json`, e);
      commitSystemSelectionUpdate({
        source: 'custom',
        subcategory: systemSubcategory,
        systemPreset: '',
        extraJson: null,
        reason: 'switch-to-presets-failed',
      });
    }
  }, [selection, systemSubcategory, commitSystemSelectionUpdate, ctx.workspaceResourcePort]);

  const requestSystemUiMode = useCallback(
    (target: 'presets' | 'pcdb') => {
      if (!isSystemElementType) return;
      if (target === systemUiModeFromStore) return;
      if (systemSwitchNeedsWarning(target)) {
        setPendingSystemAction({ kind: 'source', target });
        return;
      }
      if (target === 'pcdb') {
        clearSystemToPcdbShell();
      } else {
        void applyFirstSamplePresetAfterPcdb();
      }
    },
    [
      applyFirstSamplePresetAfterPcdb,
      clearSystemToPcdbShell,
      isSystemElementType,
      systemSwitchNeedsWarning,
      systemUiModeFromStore,
    ],
  );

  const confirmSystemSourceSwitch = useCallback(() => {
    const action = pendingSystemAction;
    setPendingSystemAction(null);
    if (!action) return;
    if (action.kind === 'source') {
      if (action.target === 'pcdb') {
        clearSystemToPcdbShell();
      } else {
        void applyFirstSamplePresetAfterPcdb();
      }
      return;
    }
    if (action.kind === 'subcategory') {
      applySystemSubcategoryChange(action.value);
      return;
    }
    void applySystemPresetChange(action.value);
  }, [
    pendingSystemAction,
    clearSystemToPcdbShell,
    applyFirstSamplePresetAfterPcdb,
    applySystemSubcategoryChange,
    applySystemPresetChange,
  ]);

  // Update preset options when subcategory changes. The workspace files are
  // authoritative; manifest membership only marks which rows are library-owned.
  useEffect(() => {
    if (!systemPresetDirectory) return;
    let cancelled = false;
    (async () => {
      const options = await listCategoryJsonOptions(ctx.workspaceResourcePort, systemPresetDirectory);
      if (!cancelled) {
        setSystemPresetOptions(options);
      }
    })();
    return () => { cancelled = true; };
  }, [setSystemPresetOptions, systemPresetDirectory, ctx.workspaceResourcePort]);

  const systemPresetDropdownOptions = useMemo(() => {
    const options = systemPresetOptions.map((option) => ({
      value: option.id,
      label: option.label,
    }));
    if (systemPreset && !options.some((option) => option.value === systemPreset)) {
      return [
        {
          value: systemPreset,
          label: `${systemPreset.replace(/_/g, ' ')} (missing)`,
          disabled: true,
        },
        ...options,
      ];
    }
    return options;
  }, [systemPresetOptions, systemPreset]);

  const selectedSystemPresetLabel = useMemo(() => {
    if (!systemPreset) return '';
    const option = systemPresetOptions.find((candidate) => candidate.id === systemPreset);
    return option?.label ?? formatSystemPresetName(systemPreset);
  }, [systemPreset, systemPresetOptions]);

  return {
    systemSubcategory,
    setSystemSubcategory,
    systemPreset,
    setSystemPreset,
    systemExtraJson,
    setSystemExtraJson,
    systemUiMode,
    setSystemUiMode,
    prevSystemSelectionIdRef,
    pendingSystemAction,
    setPendingSystemAction,
    confirmSystemSourceSwitch,
    systemPresetOptions,
    systemPresetDropdownOptions,
    selectedSystemPresetLabel,
    systemSourceFromStore,
    selectedSystemElementFull: selectedSystemElementFull as Extract<Element, { type: 'System' }> | null,
    selectedElementV: ctx.selectedElementV,
    handleSystemSubcategoryChange,
    handleSystemPresetChange,
    requestSystemUiMode,
    handlePcdbSystemApply,
  };
}

export const systemFormModule: ElementFormModule<SystemFormState> = {
  type: 'System',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'System') return;
    state.setSystemSubcategory(element.subcategory || '');
    state.setSystemPreset(element.system_preset || '');
    state.setSystemExtraJson(element.extra_json || null);
  },

  reset(state) {
    // System's five legacy resetFormFields lines, verbatim.
    state.setSystemSubcategory('');
    state.setSystemPreset('');
    state.setSystemExtraJson(null);
    state.setSystemUiMode('presets');
    state.prevSystemSelectionIdRef.current = null;

    // INTENTIONAL BEHAVIOUR FIX (slice-5 brief decision (g)): legacy
    // resetFormFields never cleared pendingSystemAction, so a pending
    // source-switch confirm (the DeleteConfirmModal orchestrator-tail-
    // renders whenever `!!systemFormState.pendingSystemAction`) could
    // survive a selection change to ANY other element/zone/dormer — the
    // modal would stay open, or a stale confirm could later fire, against
    // whatever got selected next. resetFormFields runs on every selection
    // change (see ElementCreator.tsx's selection effect, before hydrate),
    // and the modal reads this module's pendingSystemAction directly (a
    // live reference, not a copy), so clearing it here closes the leak.
    state.setPendingSystemAction(null);
  },

  buildElementData(state, ctx) {
    const syncedSystemExtraJson =
      state.systemSubcategory === 'SpaceHeatSystem'
        ? syncSpaceHeatSystemZoneNameInExtraJson(state.systemExtraJson, ctx.getZoneNameForElementZoneId?.(ctx.elementZoneId) ?? null)
        : null;
    const elementData: Record<string, unknown> = {
      ...ctx.baseData,
      subcategory: state.systemSubcategory || undefined,
      system_preset: state.systemPreset || undefined,
      zoneId: ctx.elementZoneId || undefined,
      extra_json: syncedSystemExtraJson || state.systemExtraJson || undefined,
    };
    return elementData as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      systemSubcategory,
      systemPreset,
      systemUiMode,
      systemPresetOptions,
      systemPresetDropdownOptions,
      selectedSystemPresetLabel,
      systemSourceFromStore,
      selectedSystemElementFull,
      selectedElementV,
      handleSystemSubcategoryChange,
      handleSystemPresetChange,
      requestSystemUiMode,
      handlePcdbSystemApply,
    } = state;
    const { elementType, renderFieldLabel, elementsById, productCatalogue, renderSpaceHeatSystemEmitterManager } = ctx;

    return (
      <>
        {productCatalogue ? (
          <div className="element-editor-segment">
            <div className="element-editor-segment__label">Source</div>
            <div className="element-editor-segment__control">
              <button
                type="button"
                className={`element-editor-segment__button ${systemUiMode === 'presets' ? 'element-editor-segment__button--active' : ''}`}
                onClick={() => requestSystemUiMode('presets')}
              >
                Sample
              </button>
              <button
                type="button"
                className={`element-editor-segment__button ${systemUiMode === 'pcdb' ? 'element-editor-segment__button--active' : ''}`}
                onPointerEnter={productCatalogue.prefetchSystemSource}
                onFocus={productCatalogue.prefetchSystemSource}
                onMouseDown={productCatalogue.prefetchSystemSource}
                onClick={() => requestSystemUiMode('pcdb')}
              >
                PCDB
              </button>
            </div>
          </div>
        ) : null}

        {!productCatalogue || systemUiMode === 'presets' ? (
          <>
            {renderFieldLabel('Category:', elementType)}
            <div className="element-input">
              <StandardDropdown
                value={systemSubcategory}
                onChange={handleSystemSubcategoryChange}
                options={[
                  { value: 'HeatSourceWet', label: SYSTEM_SUBCATEGORY_LABELS.HeatSourceWet },
                  { value: 'HotWaterSource', label: SYSTEM_SUBCATEGORY_LABELS.HotWaterSource },
                  { value: 'SpaceCoolSystem', label: SYSTEM_SUBCATEGORY_LABELS.SpaceCoolSystem },
                  { value: 'SpaceHeatSystem', label: SYSTEM_SUBCATEGORY_LABELS.SpaceHeatSystem },
                ]}
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Preset:', elementType)}
            <div className="element-input">
              <StandardDropdown
                value={systemPreset}
                onChange={handleSystemPresetChange}
                options={systemPresetDropdownOptions}
                placeholder={systemPresetOptions.length === 0 ? 'Loading…' : 'Select preset…'}
                variant="ghost"
                size="md"
              />
            </div>
            {systemSubcategory === 'SpaceHeatSystem' ? renderSpaceHeatSystemEmitterManager() : null}
            {systemSourceFromStore === 'custom' ? (
              <div className="element-editor-note">
                {systemPreset
                  ? `Custom system. Started from ${selectedSystemPresetLabel}; edits are saved in this model.`
                  : 'Custom system. Edits are saved in this model.'}
              </div>
            ) : null}
          </>
        ) : productCatalogue.renderSystemSource({
          active: true,
          element: selectedSystemElementFull,
          elementsById,
          elementVersion: selectedElementV,
          onApply: handlePcdbSystemApply,
        })}
      </>
    );
  },

  subtype(state) {
    return state.systemSubcategory || undefined;
  },
};
