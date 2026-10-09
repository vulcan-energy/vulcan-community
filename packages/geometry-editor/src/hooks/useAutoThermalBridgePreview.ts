// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useMemo, useState } from 'react';
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
import { getElementCanvasFloorZValue } from '../lib/elementCanvasFloor';
import { getFirstPoint3, planAutoDucts, type MvhrDuctRole, type Point3 } from '../lib/mvhrDuctwork';
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
  const [junctionOverrides, setJunctionOverrides] = useState<Record<string, string>>({});
  const interactionKey = `${viewMode}:${currentFloorZ}:${active}`;
  const [hover, setHover] = useKeyedState<{ ids: string[]; anchor: ThermalBridgePreviewAnchor } | null>(interactionKey, null);
  const [menu, setMenu] = useKeyedState<{ ids: string[]; anchor: ThermalBridgePreviewAnchor } | null>(interactionKey, null);
  const [error, setError] = useKeyedState<string | null>(interactionKey, null);
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
    elements: allElements, floors, junctionPsiDefaultsMap, junctionOverrides, externalDetailSelection,
    externalDetailCatalogue, defaultDetailProfile,
  }) : [], [enabled, proposals, allElements, floors, junctionPsiDefaultsMap, junctionOverrides,
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
    setHover((previous) => previous?.ids.join('\0') === ids.join('\0') ? previous : { ids, anchor });
  }, [setHover]);
  const add = useCallback((id: string) => {
    try {
      const current = store.getState();
      const elements = Object.values(current.elementsById);
      // Commit against live geometry, including changes while a chooser was open.
      const fresh = enrichAutoThermalBridgeCandidates(
        proposeAutoThermalBridges(elements, current.floors, current.globalOrientationOffset), {
          elements, floors: current.floors,
          junctionPsiDefaultsMap: current.junctionPsiDefaultsMap, junctionOverrides, externalDetailSelection,
          externalDetailCatalogue,
          defaultDetailProfile: current.detailedBridgePsiProfile,
        }).find((candidate) => candidate.proposalId === id);
      if (fresh?.status === 'duplicate') return;
      if (!fresh) throw new Error('This suggestion is no longer available.');
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
  }, [store, junctionOverrides, externalDetailSelection, externalDetailCatalogue, currentFloorZ, unpin, held, menu, setError, setHover, setMenu]);
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
  const override = useCallback((id: string, code: string) => {
    setJunctionOverrides((previous) => ({ ...previous, [id]: code }));
  }, []);
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
    onHover, onActivate, configure, add, override, closeMenu, chooseDetail,
  };
}

export type AutoThermalBridgePreview = ReturnType<typeof useAutoThermalBridgePreview>;

/** One auto-duct run: a room's L, or an intake/exhaust duct with its terminal. Added as one step. */
export interface AutoDuctRun {
  proposalId: string;
  role: MvhrDuctRole;
  drafts: ElementDraft[];
  segments: Array<[Point3, Point3]>;
  lengthM: number;
}

/**
 * planAutoDucts' flat drafts as runs: every run's first duct starts at the unit; a terminal ends the
 * run of its own role just before it. A terminal with no such run (its duct was zero-length) is dropped.
 */
export function groupAutoDuctRuns(drafts: readonly ElementDraft[], unitPoint: Point3): AutoDuctRun[] {
  const runs: AutoDuctRun[] = [];
  for (const draft of drafts) {
    const run = runs[runs.length - 1];
    if (draft.type !== 'MechanicalVentilationDuctwork') {
      if (run && run.role === draft.terminal_type) run.drafts.push(draft);
      continue;
    }
    const [a, b] = draft.coordinates as [Point3, Point3];
    if (run && !(a.x === unitPoint.x && a.y === unitPoint.y && a.z === unitPoint.z)) {
      run.drafts.push(draft);
      run.segments.push([a, b]);
      run.lengthM += draft.length!;
    } else {
      runs.push({ proposalId: '', role: draft.duct_type!, drafts: [draft], segments: [[a, b]], lengthM: draft.length! });
    }
  }
  // Role and far end survive re-planning after an add; the index among equal keys keeps duplicates apart.
  const seen = new Map<string, number>();
  return runs.map((run) => {
    const end = run.segments[run.segments.length - 1]![1];
    const key = `${run.role}:${end.x},${end.y},${end.z}`;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    return { ...run, proposalId: `${key}:${index}` };
  });
}

type DuctPlanState = Pick<GeometryState, 'elementsById' | 'floors' | 'spaceLabelIds' | 'spaceLabelsById'>;

/** The named unit (the MVHR draw parent), else the only MVHR unit; null when there is no unambiguous unit. */
function planAutoDuctRuns(state: DuctPlanState, unitName: string | null) {
  const elements = Object.values(state.elementsById);
  const units = elements.filter((element): element is MechanicalVentilation =>
    element.type === 'MechanicalVentilation' && !element.isPlaceholder);
  const mvhrUnits = units.filter((unit) => unit.vent_type === 'MVHR');
  const unit = unitName ? units.find((candidate) => candidate.name === unitName)
    : mvhrUnits.length === 1 ? mvhrUnits[0] : undefined;
  const unitPoint = unit && getFirstPoint3(unit);
  if (!unit || !unitPoint) return null;
  const labels = state.spaceLabelIds.flatMap((id) => state.spaceLabelsById[id] ?? []);
  return {
    unit,
    storey: getElementCanvasFloorZValue(unit, state.floors),
    runs: groupAutoDuctRuns(planAutoDucts(unit, elements, labels, state.floors), unitPoint),
  };
}

/** The hold-A preview for the ductwork tool: the same gesture and controls as the thermal-bridge preview. */
export function useAutoDuctPreview(options: {
  enabled: boolean;
  blocked: boolean;
  currentFloorZ: number;
  unitName: string | null;
}) {
  const { enabled, blocked, currentFloorZ, unitName } = options;
  const store = useGeometryStoreApi();
  const elementsById = useGeometryStore((s) => s.elementsById);
  const floors = useGeometryStore(useShallow((s) => s.floors));
  const spaceLabelIds = useGeometryStore((s) => s.spaceLabelIds);
  const spaceLabelsById = useGeometryStore((s) => s.spaceLabelsById);
  // A new unit is a new scope: hover, errors and any pin reset, and the plan rebuilds for that unit.
  const mode = useThermalBridgePreviewMode({ enabled, blocked, scopeKey: `${currentFloorZ}:${unitName}` });
  const { active, dismiss: dismissMode } = mode;
  const interactionKey = `${currentFloorZ}:${unitName}:${active}`;
  const [hover, setHover] = useKeyedState<{ ids: string[]; anchor: ThermalBridgePreviewAnchor } | null>(interactionKey, null);
  const [error, setError] = useKeyedState<string | null>(interactionKey, null);
  // Planned only while the preview shows, so edits with A released never re-plan.
  const plan = useMemo(() => active
    ? planAutoDuctRuns({ elementsById, floors, spaceLabelIds, spaceLabelsById }, unitName)
    : null, [active, elementsById, floors, spaceLabelIds, spaceLabelsById, unitName]);
  const chooseUnit = useMemo(() => active && !unitName && Object.values(elementsById).filter((element) =>
    element.type === 'MechanicalVentilation' && !element.isPlaceholder && element.vent_type === 'MVHR').length > 1,
  [active, unitName, elementsById]);
  const onFloor = plan?.storey === currentFloorZ;
  const runs = useMemo(() => (plan && onFloor ? plan.runs : []), [plan, onFloor]);
  const otherFloorCount = plan && !onFloor ? plan.runs.length : 0;
  const unitId = plan?.unit.id;
  const highlightedHostIds = useMemo(() => new Set(active && unitId ? [unitId] : []), [active, unitId]);

  const onHover = useCallback((ids: string[], anchor: ThermalBridgePreviewAnchor) => {
    setHover((previous) => previous?.ids.join('\0') === ids.join('\0') ? previous : { ids, anchor });
  }, [setHover]);
  /** Re-plans against live geometry and commits the chosen runs as one history step. */
  const commit = useCallback((ids: string[] | null) => {
    try {
      const current = store.getState();
      const fresh = planAutoDuctRuns(current, unitName);
      if (!fresh || fresh.storey !== currentFloorZ) throw new Error('This suggestion is no longer on the current floor.');
      const chosen = ids ? fresh.runs.filter((run) => ids.includes(run.proposalId)) : fresh.runs;
      if (chosen.length === 0) throw new Error('This suggestion is no longer available.');
      current.addElements(chosen.flatMap((run) => run.drafts));
      setError(null);
      setHover(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [store, unitName, currentFloorZ, setError, setHover]);
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
    kind: 'duct' as const,
    ...mode, dismiss, runs, chooseUnit, otherFloorCount, unplacedCount: 0, error, highlightedHostIds,
    hover: active ? hover : null,
    menu: null,
    onHover, onActivate, add, addAll, closeMenu,
  };
}

export type AutoDuctPreview = ReturnType<typeof useAutoDuctPreview>;
/** Either hold-A canvas preview; the 2D layer, label and toolbar report take both. */
export type CanvasPreview = AutoThermalBridgePreview | AutoDuctPreview;
