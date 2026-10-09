// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useKeyedState } from './useKeyedState';
import type { Element, ElementDraft, MechanicalVentilation } from '../geometry/types';
import { useGeometryStore, useGeometryStoreApi } from '../stores/geometryStore';
import { proposeAutoThermalBridges } from '../geometry/thermalBridge/autoThermalBridgePipeline';
import {
  createThermalBridgeLinearFromAutoProposal,
  enrichAutoThermalBridgeCandidates,
} from '../geometry/thermalBridge/autoThermalBridgeCandidates';
import type { ExternalDetailCataloguePort } from '../geometry/thermalBridge/externalDetailContracts';
import { buildThermalBridgeInventoryRows } from '../geometry/thermalBridge/thermalBridgeInventory';
import { findLinearThermalBridgeIssues } from '../geometry/thermalBridge/findLinearThermalBridgeIssues';
import { isElementOnActiveCanvasFloor } from '../lib/elementCanvasFloor';
import { geometryPerf } from '../lib/geometryPerf';
import { findHostElementForAutoTbProposal } from '../geometry/thermalBridge/resolveTbHostFloorId';
import { useThermalBridgePreviewMode } from './useThermalBridgePreviewMode';
import { getElementCanvasFloorZValue, networkPoint3 } from '../lib/elementCanvasFloor';
import { withEffectiveStoreyHeights } from '../lib/zoneDerivation';
import { planAutoDucts, planPrimaryPipework, primaryPipeworkPairs, type MvhrDuctRole, type Point3 } from '../lib/mvhrDuctwork';
import type { GeometryState } from '../stores/geometryStore';

export interface ThermalBridgePreviewAnchor { x: number; y: number }

/** Shared candidate state and commit path; neither renderer owns inference or ψ resolution. */
export function useAutoThermalBridgePreview(options: {
  enabled: boolean;
  blocked: boolean;
  viewMode: string;
  currentFloorZ: number;
  isElementHidden: (element: Element) => boolean;
  externalDetailCatalogue?: ExternalDetailCataloguePort;
}) {
  const { enabled, blocked, viewMode, currentFloorZ, isElementHidden, externalDetailCatalogue } = options;
  const store = useGeometryStoreApi();
  const elementsById = useGeometryStore((s) => s.elementsById);
  const floors = useGeometryStore(useShallow((s) => s.floors));
  const zones = useGeometryStore((s) => s.zones);
  const globalOrientationOffset = useGeometryStore((s) => s.globalOrientationOffset);
  const junctionPsiDefaultsMap = useGeometryStore((s) => s.junctionPsiDefaultsMap);
  const defaultDetailProfile = useGeometryStore((s) => s.detailedBridgePsiProfile);
  const mode = useThermalBridgePreviewMode({
    enabled,
    blocked,
    scopeKey: `${viewMode}:${currentFloorZ}`,
  });
  const { active, held, pinned, pin, unpin, dismiss: dismissMode } = mode;
  const [externalDetailSelection, setExternalDetailSelection] = useState<Record<string, string>>({});
  const interactionKey = `${viewMode}:${currentFloorZ}:${active}`;
  const [hover, setHover] = useKeyedState<{ ids: string[]; anchor: ThermalBridgePreviewAnchor } | null>(interactionKey, null);
  const [menu, setMenu] = useKeyedState<{ ids: string[]; anchor: ThermalBridgePreviewAnchor } | null>(interactionKey, null);
  const [error, setError] = useKeyedState<string | null>(interactionKey, null);
  const hoverClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverClearTimeout = useCallback(() => {
    if (hoverClearTimeoutRef.current === null) return;
    clearTimeout(hoverClearTimeoutRef.current);
    hoverClearTimeoutRef.current = null;
  }, []);
  useEffect(() => clearHoverClearTimeout, [clearHoverClearTimeout, interactionKey]);
  const allElements = useMemo(() => Object.values(elementsById), [elementsById]);
  // Existing bridge changes affect dedupe, not fabric inference. Shallow selection preserves this
  // array while only bridges/selection change, so additions do not re-run the geometry proposers.
  const fabricElements = useGeometryStore(useShallow((s) => Object.values(s.elementsById)
    .filter((element) => element.type !== 'ThermalBridgeLinear' && element.type !== 'ThermalBridgePoint')));
  const proposals = useMemo(() => enabled
    ? geometryPerf.measure('ThermalBridgePreview.propose', () =>
        proposeAutoThermalBridges(fabricElements, floors, globalOrientationOffset))
    : [], [enabled, fabricElements, floors, globalOrientationOffset]);
  const candidates = useMemo(() => enabled ? enrichAutoThermalBridgeCandidates(proposals, {
    elements: allElements, floors, junctionPsiDefaultsMap, externalDetailSelection,
    externalDetailCatalogue, defaultDetailProfile,
  }) : [], [enabled, proposals, allElements, floors, junctionPsiDefaultsMap,
    externalDetailCatalogue, defaultDetailProfile, externalDetailSelection]);
  const visibleAcrossFloors = useMemo(() => candidates.filter((candidate) => {
    const host = findHostElementForAutoTbProposal(candidate, elementsById);
    if (!host || isElementHidden(host)) return false;
    if (isElementHidden({ ...host, id: candidate.proposalId, type: 'ThermalBridgeLinear' } as Element)) return false;
    if ([...(candidate.hostElementIds ?? []), ...(candidate.cornerHostWallIds ?? []), ...(candidate.roofAdjacentPairIds ?? [])]
      .some((id) => elementsById[id] && isElementHidden(elementsById[id]))) return false;
    const opening = elementsById[candidate.openingId];
    if (opening && isElementHidden(opening)) return false;
    return candidate.status === 'new';
  }), [candidates, elementsById, isElementHidden]);
  const visibleCandidates = useMemo(() => visibleAcrossFloors.filter((candidate) =>
    candidate.floorStoreyIndexForTb === currentFloorZ), [visibleAcrossFloors, currentFloorZ]);
  const unplacedCount = visibleAcrossFloors.filter((candidate) => candidate.floorStoreyIndexForTb === undefined).length;
  const otherFloorCount = visibleAcrossFloors.filter((candidate) => !candidate.addabilityError &&
    candidate.floorStoreyIndexForTb !== undefined && candidate.floorStoreyIndexForTb !== currentFloorZ).length;
  const issues = useMemo(() => {
    if (!enabled) return [];
    const findings = findLinearThermalBridgeIssues(allElements, floors);
    const errorIds = new Set<string>();
    for (const finding of findings) {
      if (finding.severity === 'error') errorIds.add(finding.elementId);
    }
    return buildThermalBridgeInventoryRows(elementsById, zones, findings).flatMap((row) =>
      row.bucket === 'problematic' && !isElementHidden(row.tb) &&
      isElementOnActiveCanvasFloor(row.tb, currentFloorZ, floors)
        ? [{ ...row, severity: errorIds.has(row.tb.id) ? 'error' as const : 'warning' as const }]
        : []);
  }, [enabled, elementsById, zones, allElements, isElementHidden, currentFloorZ, floors]);

  const highlightedHostIds = useMemo(() => {
    const ids = new Set<string>();
    if (!active) return ids;
    const hoveredIds = new Set(hover?.ids);
    for (const candidate of visibleCandidates) {
      if (!hoveredIds.has(candidate.proposalId)) continue;
      const host = findHostElementForAutoTbProposal(candidate, elementsById);
      if (host) ids.add(host.id);
      if (elementsById[candidate.openingId]) ids.add(candidate.openingId);
      for (const id of [...(candidate.hostElementIds ?? []), ...(candidate.cornerHostWallIds ?? []), ...(candidate.roofAdjacentPairIds ?? [])]) ids.add(id);
    }
    return ids;
  }, [active, visibleCandidates, hover, elementsById]);

  const onHover = useCallback((ids: string[], anchor: ThermalBridgePreviewAnchor) => {
    if (ids.length === 0) {
      if (hoverClearTimeoutRef.current !== null) return;
      hoverClearTimeoutRef.current = setTimeout(() => {
        hoverClearTimeoutRef.current = null;
        setHover(null);
      }, 250);
      return;
    }
    clearHoverClearTimeout();
    setHover((previous) => previous?.ids.join('\0') === ids.join('\0') ? previous : { ids, anchor });
  }, [clearHoverClearTimeout, setHover]);
  const add = useCallback((id: string, junctionCode?: string) => {
    try {
      const current = store.getState();
      const elements = Object.values(current.elementsById);
      // Commit against live geometry, including changes while a chooser was open.
      const proposals = proposeAutoThermalBridges(elements, current.floors, current.globalOrientationOffset);
      const enrichLiveCandidates = (junctionOverridesForCommit: Record<string, string | undefined> = {}) =>
        enrichAutoThermalBridgeCandidates(proposals, {
          elements, floors: current.floors,
          junctionPsiDefaultsMap: current.junctionPsiDefaultsMap,
          junctionOverrides: junctionOverridesForCommit,
          externalDetailSelection,
          externalDetailCatalogue,
          defaultDetailProfile: current.detailedBridgePsiProfile,
        });
      const liveCandidate = enrichLiveCandidates().find((candidate) => candidate.proposalId === id);
      if (!liveCandidate) throw new Error('This suggestion is no longer available.');
      if (junctionCode !== undefined && !liveCandidate.junctionOptions.includes(junctionCode)) {
        throw new Error(`Junction type ${junctionCode} is not available for this suggestion.`);
      }
      const fresh = junctionCode === undefined
        ? liveCandidate
        : enrichLiveCandidates({ [id]: junctionCode })
            .find((candidate) => candidate.proposalId === id);
      if (fresh?.status === 'duplicate') return;
      if (!fresh) throw new Error('This suggestion is no longer available.');
      if (junctionCode !== undefined && fresh.junctionCode !== junctionCode) {
        throw new Error(`Junction type ${junctionCode} could not be applied to this suggestion.`);
      }
      if (fresh.addabilityError) throw new Error(fresh.addabilityError);
      if (fresh.floorStoreyIndexForTb !== currentFloorZ) {
        throw new Error('This suggestion is no longer on the current floor.');
      }
      current.addElements([createThermalBridgeLinearFromAutoProposal(fresh, current.elementsById, current.floors)]);
      setError(null);
      setHover(null);
      if (!held || !menu || menu.ids.length <= 1) {
        unpin();
        setMenu(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [store, externalDetailSelection, externalDetailCatalogue, currentFloorZ, unpin, held, menu, setError, setHover, setMenu]);
  const closeMenu = useCallback(() => {
    setMenu(null);
    setHover(null);
    unpin();
  }, [setMenu, setHover, unpin]);
  const onActivate = useCallback((ids: string[], anchor: ThermalBridgePreviewAnchor) => {
    if (pinned) { closeMenu(); return; }
    if (ids.length === 1) { add(ids[0]); return; }
    if (ids.length > 1) {
      setMenu({ ids, anchor });
      pin();
    }
  }, [add, pin, pinned, closeMenu, setMenu]);
  const configure = useCallback((id: string, anchor: ThermalBridgePreviewAnchor) => {
    setMenu({ ids: [id], anchor });
    pin();
  }, [pin, setMenu]);
  const chooseDetail = useCallback((groupKey: string, key: string) => {
    setExternalDetailSelection((previous) => ({ ...previous, [groupKey]: key }));
  }, []);
  const dismiss = useCallback(() => {
    setMenu(null);
    setHover(null);
    dismissMode();
  }, [dismissMode, setMenu, setHover]);

  return {
    kind: 'thermalBridge' as const,
    ...mode, dismiss, candidates: visibleCandidates, issues, otherFloorCount, unplacedCount, error, highlightedHostIds,
    hover: active ? hover : null,
    menu: pinned ? menu : null,
    onHover, onActivate, configure, add, closeMenu, chooseDetail,
  };
}

export type AutoThermalBridgePreview = ReturnType<typeof useAutoThermalBridgePreview>;

/** One auto-routed run: a room's L, an intake/exhaust duct with its terminal, or a heat source's primary pipework to a cylinder. Added as one step. */
export interface AutoDuctRun {
  proposalId: string;
  role: MvhrDuctRole | 'primary';
  /** The storey the run starts on (its unit's or heat source's); the preview shows it there. */
  storey: number | undefined;
  drafts: ElementDraft[];
  segments: Array<[Point3, Point3]>;
  lengthM: number;
}

/**
 * A planner's flat drafts as runs: a run starts with a segment leaving one of `starts` (the unit, or
 * each heat source) and takes that start's storey; a terminal ends the run of its own role just
 * before it. A terminal with no such run (its duct was zero-length) is dropped.
 */
export function groupAutoDuctRuns(
  drafts: readonly ElementDraft[],
  starts: ReadonlyArray<{ point: Point3; storey: number | undefined }>,
): AutoDuctRun[] {
  const pointKey = (p: Point3) => `${p.x},${p.y},${p.z}`;
  const startStorey = new Map(starts.map(({ point, storey }) => [pointKey(point), storey]));
  const runs: AutoDuctRun[] = [];
  for (const draft of drafts) {
    const run = runs[runs.length - 1];
    if (draft.type !== 'MechanicalVentilationDuctwork' && draft.type !== 'WaterPipework') {
      if (draft.type === 'MechanicalVentilationTerminal' && run && run.role === draft.terminal_type) run.drafts.push(draft);
      continue;
    }
    const [a, b] = draft.coordinates as [Point3, Point3];
    const startsRun = startStorey.has(pointKey(a));
    if (run && !startsRun) {
      run.drafts.push(draft);
      run.segments.push([a, b]);
      run.lengthM += draft.length!;
    } else {
      const role = draft.type === 'WaterPipework' ? 'primary' : draft.duct_type!;
      runs.push({ proposalId: '', role, storey: startStorey.get(pointKey(a)), drafts: [draft], segments: [[a, b]], lengthM: draft.length! });
    }
  }
  // Role and far end survive re-planning after an add; the index among equal keys keeps duplicates apart.
  const seen = new Map<string, number>();
  return runs.map((run) => {
    const end = run.segments[run.segments.length - 1]![1];
    const key = `${run.role}:${pointKey(end)}`;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    return { ...run, proposalId: `${key}:${index}` };
  });
}

type RunPlanState = Pick<GeometryState, 'elementsById' | 'floors' | 'spaceLabelIds' | 'spaceLabelsById'>;
type RunPlan = { runs: AutoDuctRun[]; highlightIds: string[] };

/** The named unit (the MVHR draw parent), else the only MVHR unit; null when there is no unambiguous unit. */
function planAutoDuctRuns(state: RunPlanState, unitName: string | null): RunPlan | null {
  const elements = Object.values(state.elementsById);
  const units = elements.filter((element): element is MechanicalVentilation =>
    element.type === 'MechanicalVentilation' && !element.isPlaceholder);
  const mvhrUnits = units.filter((unit) => unit.vent_type === 'MVHR');
  const unit = unitName ? units.find((candidate) => candidate.name === unitName)
    : mvhrUnits.length === 1 ? mvhrUnits[0] : undefined;
  const effectiveFloors = withEffectiveStoreyHeights(state.floors, elements);
  const unitPoint = unit && networkPoint3(unit, effectiveFloors);
  if (!unit || !unitPoint) return null;
  const labels = state.spaceLabelIds.flatMap((id) => state.spaceLabelsById[id] ?? []);
  const storey = getElementCanvasFloorZValue(unit, effectiveFloors);
  return {
    highlightIds: [unit.id],
    runs: groupAutoDuctRuns(planAutoDucts(unit, elements, labels, effectiveFloors), [{ point: unitPoint, storey }]),
  };
}

/** Primary pipework from every heat source to its cylinder; each run shows on its heat source's storey. */
function planPrimaryPipeworkRuns(state: RunPlanState): RunPlan {
  const elements = Object.values(state.elementsById);
  const effectiveFloors = withEffectiveStoreyHeights(state.floors, elements);
  const pairs = primaryPipeworkPairs(elements, effectiveFloors);
  return {
    highlightIds: [...new Set(pairs.flatMap((pair) => [pair.heatSource.id, pair.cylinder.id]))],
    runs: groupAutoDuctRuns(planPrimaryPipework(elements, effectiveFloors), pairs.map((pair) => ({
      point: pair.heatSourcePoint, storey: getElementCanvasFloorZValue(pair.heatSource, effectiveFloors),
    }))),
  };
}

/**
 * The hold-A preview for an auto-routing tool: the same gesture and controls as the thermal-bridge
 * preview. `plan` must be stable per scope; it runs only while the preview shows, and again on commit.
 */
function useAutoRunPreview<Kind extends 'duct' | 'pipe'>(kind: Kind, options: {
  enabled: boolean;
  blocked: boolean;
  currentFloorZ: number;
  scopeKey: string;
  plan: (state: RunPlanState) => RunPlan | null;
}) {
  const { enabled, blocked, currentFloorZ, scopeKey, plan: planRuns } = options;
  const store = useGeometryStoreApi();
  const elementsById = useGeometryStore((s) => s.elementsById);
  const floors = useGeometryStore(useShallow((s) => s.floors));
  const spaceLabelIds = useGeometryStore((s) => s.spaceLabelIds);
  const spaceLabelsById = useGeometryStore((s) => s.spaceLabelsById);
  // A new scope (floor, unit): hover, errors and any pin reset, and the plan rebuilds.
  const mode = useThermalBridgePreviewMode({ enabled, blocked, scopeKey });
  const { active, dismiss: dismissMode } = mode;
  const interactionKey = `${scopeKey}:${active}`;
  const [hover, setHover] = useKeyedState<{ ids: string[]; anchor: ThermalBridgePreviewAnchor } | null>(interactionKey, null);
  const [error, setError] = useKeyedState<string | null>(interactionKey, null);
  // Planned only while the preview shows, so edits with A released never re-plan.
  const plan = useMemo(() => active
    ? planRuns({ elementsById, floors, spaceLabelIds, spaceLabelsById })
    : null, [active, planRuns, elementsById, floors, spaceLabelIds, spaceLabelsById]);
  const runs = useMemo(() => plan?.runs.filter((run) => run.storey === currentFloorZ) ?? [], [plan, currentFloorZ]);
  const otherFloorCount = (plan?.runs.length ?? 0) - runs.length;
  const highlightIdsKey = plan?.highlightIds.join('\0') ?? '';
  const highlightedHostIds = useMemo(() => new Set(active && highlightIdsKey ? highlightIdsKey.split('\0') : []), [active, highlightIdsKey]);

  const onHover = useCallback((ids: string[], anchor: ThermalBridgePreviewAnchor) => {
    setHover((previous) => previous?.ids.join('\0') === ids.join('\0') ? previous : { ids, anchor });
  }, [setHover]);
  /** Re-plans against live geometry and commits the chosen runs on this floor as one history step. */
  const commit = useCallback((ids: string[] | null) => {
    try {
      const current = store.getState();
      const onFloor = planRuns(current)?.runs.filter((run) => run.storey === currentFloorZ) ?? [];
      const chosen = ids ? onFloor.filter((run) => ids.includes(run.proposalId)) : onFloor;
      if (chosen.length === 0) throw new Error('This suggestion is no longer available.');
      current.addElements(chosen.flatMap((run) => run.drafts));
      setError(null);
      setHover(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [store, planRuns, currentFloorZ, setError, setHover]);
  const add = useCallback((id: string) => commit([id]), [commit]);
  const addAll = useCallback(() => commit(null), [commit]);
  const onActivate = useCallback((ids: string[]) => {
    if (ids.length > 0) add(ids[0]!);
  }, [add]);
  const closeMenu = useCallback(() => setHover(null), [setHover]);
  const dismiss = useCallback(() => {
    setHover(null);
    dismissMode();
  }, [dismissMode, setHover]);

  return {
    kind,
    ...mode, dismiss, runs, chooseUnit: false, otherFloorCount, unplacedCount: 0, error, highlightedHostIds,
    hover: active ? hover : null,
    menu: null,
    onHover, onActivate, add, addAll, closeMenu,
  };
}

/** The hold-A preview for the ductwork tool. */
export function useAutoDuctPreview(options: {
  enabled: boolean;
  blocked: boolean;
  currentFloorZ: number;
  unitName: string | null;
}) {
  const { enabled, blocked, currentFloorZ, unitName } = options;
  const plan = useCallback((state: RunPlanState) => planAutoDuctRuns(state, unitName), [unitName]);
  const preview = useAutoRunPreview('duct', { enabled, blocked, currentFloorZ, scopeKey: `${currentFloorZ}:${unitName}`, plan });
  const elementsById = useGeometryStore((s) => s.elementsById);
  const chooseUnit = useMemo(() => preview.active && !unitName && Object.values(elementsById).filter((element) =>
    element.type === 'MechanicalVentilation' && !element.isPlaceholder && element.vent_type === 'MVHR').length > 1,
  [preview.active, unitName, elementsById]);
  return { ...preview, chooseUnit };
}

/** The hold-A preview for the pipework tool: primary pipework from each heat source to its cylinder. */
export function useAutoPipePreview(options: { enabled: boolean; blocked: boolean; currentFloorZ: number }) {
  return useAutoRunPreview('pipe', { ...options, scopeKey: String(options.currentFloorZ), plan: planPrimaryPipeworkRuns });
}

export type AutoDuctPreview = ReturnType<typeof useAutoDuctPreview>;
export type AutoPipePreview = ReturnType<typeof useAutoPipePreview>;
/** Any hold-A canvas preview; the 2D layer, label and toolbar report take each. */
export type CanvasPreview = AutoThermalBridgePreview | AutoDuctPreview | AutoPipePreview;
