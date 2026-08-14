// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useState, useRef, useEffect, useLayoutEffect, useMemo, memo, useSyncExternalStore } from 'react';
import { Rnd } from 'react-rnd';
import type { Element, ElementType, Zone } from '../../geometry/types';
import { useGeometryStore, useGeometryStoreApi, validateZone } from '../../stores/geometryStore';
import type { ValidationResult, MissingElement } from '../../geometry/validation/types';
import { validateSpaceLabels } from '../../geometry/validation/validateSpaceLabels';
import { getVolumeCalculationBreakdown } from '../../lib/zoneDerivation';
import { getContextualElementDisplayName, getElementTypeDisplayName } from '../../lib/displayNames';
import { getElementCanvasFloorZValue } from '../../lib/elementCanvasFloor';
import { selectionForElement } from '../../lib/drawnElementSelection';
import { fhsFloorLabelForCanvasFloor } from '../../lib/storeySemantics';
import { worldToCanvas, canvasToWorld } from '../../lib/shapeUtils';
import { ValidationIndicator } from '../ValidationIndicator';
import { useDrawingMode } from '../../hooks/useDrawingMode';
import {
  ELEMENTS_PANEL_MIN_W,
  ELEMENTS_PANEL_MIN_H,
  ELEMENTS_PANEL_DEFAULT_W,
  ELEMENTS_PANEL_DEFAULT_H,
} from '../../hooks/usePanelLayout';
import type { PanelRect } from '../../hooks/usePanelLayout';
import { getDormerAnchorName, getDormerBundleInfo, getDormerBundleName } from '../../lib/dormerGeometry';
import type { CanvasViewMode } from './DrawToolbar';
import {
  unavailableGeometryModelSchemaProfilePort,
  type GeometryModelSchemaProfilePort,
} from '../../../../geometry-editor-host/src/modelSchemaProfilePort';
import type { GeometrySourceComparisonPort } from '../../../../geometry-editor-host/src/sourceComparisonPort';
import type { ElementCategoryGhostKey, ElementCategoryGhostState } from '../../lib/elementCategoryVisibility';
import { HideElementsDropdown } from './HideElementsDropdown';
import { HidePanelsDropdown, type HidePanelKey, type HidePanelOption } from './HidePanelsDropdown';
import {
  areAllEntryMembersSelected,
  getElementEntryKey,
  getElementEntrySelectionState,
  removeEntryMembersFromSelection,
  sortElementEntriesForCurrentFloor,
  summarizeElementEntry,
  type ElementsPanelEntry,
  type ElementsPanelEntrySummary,
} from './elementsZonesPanelModel';

export type Selection = { type: 'zone' | 'element' | 'global' | 'dormer'; id: string; isPlaceholder?: boolean } | null;

const EMPTY_VALIDATION_RESULT: ValidationResult = {
  hasIssues: false,
  hasWarnings: false,
  issues: [],
  warnings: [],
};

function ElementsVisibilityEyeIcon({ hidden }: { hidden: boolean }) {
  const s = 9;
  if (hidden) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14.12 14.12a3 3 0 0 1-4.24-4.24"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M1 1l22 22" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export interface ElementsZonesPanelProps {
  selection: Selection;
  setSelection: (s: Selection) => void;
  selectedElementIds: string[];
  setSelectedElementIds: (ids: string[]) => void;
  clearElementSelection: () => void;
  zones: Zone[];
  elementsById: Record<string, Element>;
  elementIds: string[];
  modelSchemaProfilePort?: GeometryModelSchemaProfilePort;
  currentFloorZ: number;
  getValidation: (el: Element) => ValidationResult;
  elementsRect: PanelRect;
  setElementsRect: (rect: PanelRect | ((prev: PanelRect) => PanelRect)) => void;
  activePanel: 'elements' | 'details' | null;
  setActivePanel: (panel: 'elements' | 'details' | null) => void;
  stageSize: { width: number; height: number };
  clampElementsRectToCanvas: (rect: PanelRect) => PanelRect;
  getElementsDefaultRect: () => PanelRect;
  canvasCenter: { x: number; y: number };
  scale: number;
  panOffset: { x: number; y: number };
  setPanOffset: (p: { x: number; y: number }) => void;
  createPlaceholderZone: () => string;
  createPlaceholderElement: (zoneId: string, type: ElementType) => string;
  updateElement: (id: string, patch: Partial<Element>, optional?: boolean) => void;
  setCurrentFloorZ: (z: number) => void;
  complianceSettings: { complianceValidationEnabled?: boolean };
  sourceComparisonPort: GeometrySourceComparisonPort;
  lookupByElement: ReadonlyMap<string, readonly unknown[]>;
  hasEvidenceDraft: boolean;
  filename?: string;
  viewMode?: CanvasViewMode;
  panelHideOptions: readonly HidePanelOption[];
  hiddenPanelKeys: ReadonlySet<HidePanelKey>;
  onTogglePanelHidden: (key: HidePanelKey) => void;
  onHideAllPanels: (keys: readonly HidePanelKey[]) => void;
  onShowAllPanels: (keys: readonly HidePanelKey[]) => void;
  /** 3D: double-click element row to orbit the camera onto it (2D uses pan/zoom). */
  onFrameElementIn3D?: (elementId: string) => void;
  elementCategoryGhost: ElementCategoryGhostState;
  onToggleElementCategoryGhost: (key: ElementCategoryGhostKey) => void;
  hiddenElementIds: ReadonlySet<string>;
  toggleElementsHidden: (ids: readonly string[]) => void;
  unhideElement: (id: string) => void;
  /**
   * When search or validation filter is active, ⌘A uses this to select only filtered rows (still scoped to current floor).
   * Parent sets ref to null on unmount via cleanup.
   */
  cmdASelectIdsRef?: React.MutableRefObject<(() => string[] | null) | null>;
}

type ElementEntryRowProps = {
  entry: ElementsPanelEntry;
  dormerBundleName: string | null;
  isSelected: boolean;
  isFullySelected: boolean;
  validation: ValidationResult;
  hasComparisonInfo: boolean;
  elementFloorZ: number;
  isCurrentFloor: boolean;
  currentFloorZ: number;
  hasEvidenceDraft: boolean;
  evidenceCount: number;
  allMembersIndividuallyHidden: boolean;
  onEntryClick: (entry: ElementsPanelEntry, isFullySelected: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
  onEntryDoubleClick: (entry: ElementsPanelEntry, elementFloorZ: number) => void;
  onToggleEntryHidden: (entry: ElementsPanelEntry, event: React.MouseEvent<HTMLButtonElement>) => void;
};

const ElementEntryRow = memo(function ElementEntryRow({
  entry,
  dormerBundleName,
  isSelected,
  isFullySelected,
  validation,
  hasComparisonInfo,
  elementFloorZ,
  isCurrentFloor,
  currentFloorZ,
  hasEvidenceDraft,
  evidenceCount,
  allMembersIndividuallyHidden,
  onEntryClick,
  onEntryDoubleClick,
  onToggleEntryHidden,
}: ElementEntryRowProps) {
  const element = entry.representative;
  const pillOpacity = isCurrentFloor ? 1.0 : 0.3;

  return (
    <div
      className={`element-pill element-pill--with-visibility ${isSelected ? 'selected' : ''}`}
      style={{ opacity: pillOpacity }}
    >
      <button
        type="button"
        className="element-pill__main"
        onClick={(e) => onEntryClick(entry, isFullySelected, e)}
        onDoubleClick={() => onEntryDoubleClick(entry, elementFloorZ)}
        title={`${dormerBundleName || element.name || getContextualElementDisplayName(element)}${entry.isDormerBundle ? ' • Dormer' : element.name && element.type ? ` • ${getContextualElementDisplayName(element)}` : ''}${elementFloorZ !== currentFloorZ ? ` (${fhsFloorLabelForCanvasFloor(elementFloorZ)})` : ''}`}
      >
        <div className="element-pill__content">
          <div className="element-pill__text">
            <span className="element-pill__name">{dormerBundleName || element.name || element.type}</span>
            {element.name && element.type && <span className="element-pill__separator">•</span>}
            {(entry.isDormerBundle || element.type) && (
              <span className="element-pill__meta">
                {entry.isDormerBundle ? 'Dormer' : getContextualElementDisplayName(element)}
              </span>
            )}
          </div>
          {validation.hasIssues && (
            <ValidationIndicator
              hasIssues
              issues={validation.issues}
              size="small"
              variant="error"
            />
          )}
          {validation.hasWarnings && (
            <ValidationIndicator
              hasIssues
              issues={validation.warnings}
              size="small"
              variant="warning"
            />
          )}
          {hasComparisonInfo && (
            <ValidationIndicator
              hasIssues
              issues={['Source comparison differences']}
              size="small"
              variant="info"
            />
          )}
          {hasEvidenceDraft && evidenceCount > 0 && (
            <span
              title={`${evidenceCount} evidence file${evidenceCount > 1 ? 's' : ''} linked`}
              className="element-evidence-dot"
            />
          )}
        </div>
      </button>
      <button
        type="button"
        className="element-pill__visibility-ghost"
        onClick={(e) => onToggleEntryHidden(entry, e)}
        title={allMembersIndividuallyHidden ? 'Show on canvas' : 'Hide from canvas'}
        aria-label={allMembersIndividuallyHidden ? 'Show on canvas' : 'Hide from canvas'}
        aria-pressed={allMembersIndividuallyHidden}
      >
        <ElementsVisibilityEyeIcon hidden={allMembersIndividuallyHidden} />
      </button>
    </div>
  );
});

function getSelectionForEntry(entry: ElementsPanelEntry): Selection {
  const bundleInfo = getDormerBundleInfo(entry.representative);
  return bundleInfo ? { type: 'dormer', id: bundleInfo.bundle_id } : selectionForElement(entry.representative);
}

function getSelectionForElementIdFromElements(
  elementsById: Record<string, Element>,
  elementId: string,
): Selection {
  const element = elementsById[elementId];
  if (!element) return null;
  const bundleInfo = getDormerBundleInfo(element);
  return bundleInfo ? { type: 'dormer', id: bundleInfo.bundle_id } : selectionForElement(element);
}

type ElementEntryRowActionState = {
  selectedElementIds: string[];
  elementsById: Record<string, Element>;
  currentFloorZ: number;
  scale: number;
  panOffset: { x: number; y: number };
  canvasCenter: { x: number; y: number };
  viewMode: CanvasViewMode;
  onFrameElementIn3D: ElementsZonesPanelProps['onFrameElementIn3D'];
  setSelection: ElementsZonesPanelProps['setSelection'];
  setSelectedElementIds: ElementsZonesPanelProps['setSelectedElementIds'];
  clearElementSelection: ElementsZonesPanelProps['clearElementSelection'];
  setCurrentFloorZ: ElementsZonesPanelProps['setCurrentFloorZ'];
  setPanOffset: ElementsZonesPanelProps['setPanOffset'];
  toggleElementsHidden: ElementsZonesPanelProps['toggleElementsHidden'];
};

export const ElementsZonesPanel = memo(function ElementsZonesPanel({
  selection,
  setSelection,
  selectedElementIds,
  setSelectedElementIds,
  clearElementSelection,
  zones,
  elementsById,
  elementIds,
  modelSchemaProfilePort = unavailableGeometryModelSchemaProfilePort,
  currentFloorZ,
  getValidation,
  elementsRect,
  setElementsRect,
  activePanel,
  setActivePanel,
  stageSize,
  clampElementsRectToCanvas,
  getElementsDefaultRect,
  canvasCenter,
  scale,
  panOffset,
  setPanOffset,
  createPlaceholderZone,
  createPlaceholderElement,
  updateElement,
  setCurrentFloorZ,
  complianceSettings,
  sourceComparisonPort,
  lookupByElement,
  hasEvidenceDraft,
  viewMode = '2d',
  panelHideOptions,
  hiddenPanelKeys,
  onTogglePanelHidden,
  onHideAllPanels,
  onShowAllPanels,
  onFrameElementIn3D,
  elementCategoryGhost,
  onToggleElementCategoryGhost,
  hiddenElementIds,
  toggleElementsHidden,
  unhideElement,
  cmdASelectIdsRef,
}: ElementsZonesPanelProps) {
  const geometryStore = useGeometryStoreApi();
  const elementsMenuRef = useRef<HTMLDivElement>(null);

  const [elementSearchQuery, setElementSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [validationFilter, setValidationFilter] = useState<'critical' | 'warning' | 'info' | null>(null);
  const [sourceAssignTargetKey, setSourceAssignTargetKey] = useState<string | null>(null);
  const [sourceAssignSelectionId, setSourceAssignSelectionId] = useState('');
  const selectedElementIdSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const elementEntryRowActionStateRef = useRef<ElementEntryRowActionState | null>(null);
  useEffect(() => {
    elementEntryRowActionStateRef.current = {
      selectedElementIds,
      elementsById,
      currentFloorZ,
      scale,
      panOffset,
      canvasCenter,
      viewMode,
      onFrameElementIn3D,
      setSelection,
      setSelectedElementIds,
      clearElementSelection,
      setCurrentFloorZ,
      setPanOffset,
      toggleElementsHidden,
    };
  }, [
    canvasCenter,
    clearElementSelection,
    currentFloorZ,
    elementsById,
    onFrameElementIn3D,
    panOffset,
    scale,
    selectedElementIds,
    setCurrentFloorZ,
    setPanOffset,
    setSelectedElementIds,
    setSelection,
    toggleElementsHidden,
    viewMode,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(elementSearchQuery), 200);
    return () => clearTimeout(timer);
  }, [elementSearchQuery]);

  const sourceComparisonSnapshot = useSyncExternalStore(
    sourceComparisonPort.subscribe,
    sourceComparisonPort.getSnapshot,
    sourceComparisonPort.getSnapshot,
  );
  const sourceMissingItems = useMemo(
    () => {
      void sourceComparisonSnapshot.revision;
      return sourceComparisonPort.listMissingItems(debouncedSearchQuery);
    },
    [debouncedSearchQuery, sourceComparisonPort, sourceComparisonSnapshot.revision],
  );
  const zoneHasComparisonInfo = useCallback(
    (zoneId: string) => {
      void sourceComparisonSnapshot.revision;
      return (sourceComparisonPort.zoneInfo(zoneId)?.items.length ?? 0) > 0;
    },
    [sourceComparisonPort, sourceComparisonSnapshot.revision],
  );
  const elementHasComparisonInfo = useCallback(
    (element: Element) => {
      void sourceComparisonSnapshot.revision;
      return (sourceComparisonPort.elementInfo(element.id)?.items.length ?? 0) > 0;
    },
    [sourceComparisonPort, sourceComparisonSnapshot.revision],
  );
  const getSourceAssignCandidates = useCallback(
    (itemId: string) => {
      void sourceComparisonSnapshot.revision;
      const allowedTypes = sourceComparisonPort.candidateElementTypes(itemId);
      return elementIds
        .map((id) => elementsById[id])
        .filter((element): element is Element => Boolean(element) && allowedTypes.includes(element.type));
    },
    [elementIds, elementsById, sourceComparisonPort, sourceComparisonSnapshot.revision],
  );
  const handleAssignSource = useCallback(async (itemId: string, elementId: string) => {
    try {
      await sourceComparisonPort.assignMissingItem(itemId, elementId);
      setSourceAssignTargetKey(null);
      setSourceAssignSelectionId('');
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : `Failed to save ${sourceComparisonPort.label} mapping`,
      );
    }
  }, [sourceComparisonPort]);

  const {
    setDrawMode,
    setDrawElementType,
    setDrawPoints,
    setRoomWalls,
    setRoomWallElements,
    setOrthogonalRoomStart,
    setOrthogonalRoomEnd,
    pendingHostElementCreationRef,
  } = useDrawingMode();

  const missingCategory = complianceSettings.complianceValidationEnabled ? 'critical' : 'warning';
  const defaultThermalBridging = useGeometryStore((s) => s.defaultThermalBridging);
  const floors = useGeometryStore((s) => s.floors);
  const spaceLabelsById = useGeometryStore((s) => s.spaceLabelsById);
  const spaceLabelIds = useGeometryStore((s) => s.spaceLabelIds);
  const spaceInferenceWallPrintByZone = useGeometryStore((s) => s.spaceInferenceWallPrintByZone);
  const detectMissingElementsThunk = useGeometryStore((s) => s.detectMissingElements);
  const storeZones = useGeometryStore((s) => s.zones);
  const missingElements = useMemo(
    (): MissingElement[] => {
      void zones;
      void elementsById;
      void elementIds;
      void complianceSettings;
      void defaultThermalBridging;
      void spaceLabelsById;
      void spaceLabelIds;
      void storeZones;
      return detectMissingElementsThunk();
    }, [
      zones,
      elementsById,
      elementIds,
      complianceSettings,
      defaultThermalBridging,
      spaceLabelsById,
      spaceLabelIds,
      storeZones,
      detectMissingElementsThunk,
    ],
  );
  const filteredMissingElements = useMemo(() => {
    if (!debouncedSearchQuery) return missingElements;
    const query = debouncedSearchQuery.toLowerCase();
    return missingElements.filter((missing) => {
      const typeMatch = getElementTypeDisplayName(missing.type as ElementType).toLowerCase().includes(query);
      const zoneName = zones.find((zone) => zone.id === missing.zoneId)?.name ?? '';
      return typeMatch
        || zoneName.toLowerCase().includes(query)
        || (missing.pillQualifier ?? '').toLowerCase().includes(query)
        || missing.message.toLowerCase().includes(query);
    });
  }, [debouncedSearchQuery, missingElements, zones]);
  const ecaasCycleRef = useRef(0);
  const ecaasOnlySystems = useMemo(() => {
    if (modelSchemaProfilePort.availability !== 'available') return [];
    return elementIds
      .map((id) => elementsById[id])
      .filter(
        (element): element is Element =>
          !!element &&
          element.type === 'System' &&
          !element.isPlaceholder &&
          modelSchemaProfilePort.metadataValueForElements([element]) === 'ecaas_input_fhs',
      );
  }, [elementIds, elementsById, modelSchemaProfilePort]);
  useEffect(() => {
    ecaasCycleRef.current = 0;
  }, [ecaasOnlySystems.length]);
  const panelMissingElements = useMemo(
    () => filteredMissingElements.filter((missing) => !missing.path.endsWith('/ThermalBridging')),
    [filteredMissingElements],
  );
  const visibleElementEntries = useMemo(() => {
    const entries: ElementsPanelEntry[] = [];
    const seenBundles = new Set<string>();

    for (const id of elementIds) {
      const element = elementsById[id];
      if (!element) continue;

      const bundleInfo = getDormerBundleInfo(element);
      if (!bundleInfo) {
        entries.push({
          representative: element,
          memberIds: [element.id],
          members: [element],
          isDormerBundle: false,
        });
        continue;
      }

      if (seenBundles.has(bundleInfo.bundle_id)) continue;
      seenBundles.add(bundleInfo.bundle_id);

      const members = elementIds
        .map((elementId) => elementsById[elementId])
        .filter((candidate): candidate is Element => {
          if (!candidate) return false;
          return getDormerBundleInfo(candidate)?.bundle_id === bundleInfo.bundle_id;
        });
      const anchorName = getDormerAnchorName(element) ?? element.name;
      const representative =
        members.find((candidate) => candidate.name === anchorName) ??
        members.find((candidate) => getDormerBundleInfo(candidate)?.role === 'front-wall-anchor') ??
        element;

      entries.push({
        representative,
        memberIds: members.map((member) => member.id),
        members,
        isDormerBundle: true,
      });
    }

    return entries;
  }, [elementIds, elementsById]);

  const elementMatchesFilter = useCallback((element: Element, filter: typeof validationFilter) => {
    if (!filter) return true;
    const validation = getValidation(element);
    if (filter === 'critical') return validation.hasIssues;
    if (filter === 'warning') return validation.hasWarnings;
    if (filter === 'info') return elementHasComparisonInfo(element);
    return true;
  }, [elementHasComparisonInfo, getValidation]);

  const filteredElementEntries = useMemo(() => {
    return visibleElementEntries.filter((entry) => {
      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase();
        const bundleNameMatch = entry.isDormerBundle
          ? (getDormerBundleName(entry.representative) || '').toLowerCase().includes(query)
          : false;
        const matchesAnyMember = entry.members.some((element) => {
          const nameMatch = element.name?.toLowerCase().includes(query);
          const rawTypeMatch = element.type?.toLowerCase().includes(query);
          const displayTypeMatch = element.type
            ? getContextualElementDisplayName(element).toLowerCase().includes(query)
            : false;
          return Boolean(nameMatch || rawTypeMatch || displayTypeMatch);
        });
        const dormerMatch = entry.isDormerBundle && 'dormer'.includes(query);
        if (!matchesAnyMember && !bundleNameMatch && !dormerMatch) return false;
      }

      if (validationFilter) {
        const matchesValidation = entry.members.some((element) => elementMatchesFilter(element, validationFilter));
        if (!matchesValidation) return false;
      }

      return true;
    });
  }, [debouncedSearchQuery, elementMatchesFilter, validationFilter, visibleElementEntries]);

  useLayoutEffect(() => {
    if (!cmdASelectIdsRef) return;
    const ref = cmdASelectIdsRef;
    ref.current = () => {
      const hasPanelFilter =
        debouncedSearchQuery.trim().length > 0 || validationFilter !== null;
      if (!hasPanelFilter) return null;
      return filteredElementEntries.flatMap((entry) => entry.memberIds);
    };
    return () => {
      ref.current = null;
    };
  }, [cmdASelectIdsRef, debouncedSearchQuery, validationFilter, filteredElementEntries]);

  const primaryFhsZoneId = useMemo(
    () => zones.find((candidate) => !candidate.isPlaceholder)?.id,
    [zones],
  );
  const zoneElementCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const element of Object.values(elementsById)) {
      if (!element.zoneId) continue;
      counts.set(element.zoneId, (counts.get(element.zoneId) ?? 0) + 1);
    }
    return counts;
  }, [elementsById]);
  const zoneValidationById = useMemo(() => {
    const validations = new Map<string, ValidationResult>();
    const spaceLabelIdsByZone = new Map<string, string[]>();
    for (const id of spaceLabelIds) {
      const zoneId = spaceLabelsById[id]?.zoneId;
      if (!zoneId) continue;
      const ids = spaceLabelIdsByZone.get(zoneId) ?? [];
      ids.push(id);
      spaceLabelIdsByZone.set(zoneId, ids);
    }

    for (const zone of zones) {
      const zoneValidation = validateZone(zone, {
        elementsById,
        complianceValidationEnabled: complianceSettings.complianceValidationEnabled || false,
        defaultThermalBridging,
        primaryFhsZoneId,
      });
      const zoneSpaceLabelIds = spaceLabelIdsByZone.get(zone.id) ?? [];
      if (zoneSpaceLabelIds.length === 0) {
        validations.set(zone.id, zoneValidation);
        continue;
      }
      const spaceValidation = validateSpaceLabels(spaceLabelsById, zoneSpaceLabelIds, {
        zones,
        elementsById,
        floors,
        spaceInferenceWallPrintByZone,
      });
      validations.set(zone.id, {
        hasIssues: zoneValidation.hasIssues || spaceValidation.hasIssues,
        hasWarnings: zoneValidation.hasWarnings || spaceValidation.hasWarnings,
        issues: [...zoneValidation.issues, ...spaceValidation.issues],
        warnings: [...zoneValidation.warnings, ...spaceValidation.warnings],
      });
    }

    return validations;
  }, [
    complianceSettings.complianceValidationEnabled,
    defaultThermalBridging,
    elementsById,
    floors,
    primaryFhsZoneId,
    spaceInferenceWallPrintByZone,
    spaceLabelIds,
    spaceLabelsById,
    zones,
  ]);
  const filteredZones = useMemo(() => {
    if (!validationFilter) return zones;
    return zones.filter((zone) => {
      const zoneValidation = zoneValidationById.get(zone.id) ?? EMPTY_VALIDATION_RESULT;
      if (validationFilter === 'critical') return zoneValidation.hasIssues;
      if (validationFilter === 'warning') return zoneValidation.hasWarnings;
      if (validationFilter === 'info') return zoneHasComparisonInfo(zone.id);
      return true;
    });
  }, [validationFilter, zoneHasComparisonInfo, zoneValidationById, zones]);
  const sortedElementEntries = useMemo(
    () => sortElementEntriesForCurrentFloor(filteredElementEntries, currentFloorZ, floors),
    [currentFloorZ, filteredElementEntries, floors],
  );
  const elementEntrySummaries = useMemo(() => {
    const summaries = new Map<string, ReturnType<typeof summarizeElementEntry>>();
    for (const entry of sortedElementEntries) {
      summaries.set(getElementEntryKey(entry), summarizeElementEntry(entry, {
        currentFloorZ,
        elementHasComparisonInfo,
        floors,
        getValidation,
      }));
    }
    return summaries;
  }, [currentFloorZ, elementHasComparisonInfo, floors, getValidation, sortedElementEntries]);
  const elementStatusCounts = useMemo(() => {
    let criticalCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    for (const summary of elementEntrySummaries.values()) {
      if (summary.validation.hasIssues) criticalCount++;
      if (summary.validation.hasWarnings) warningCount++;
      if (summary.hasComparisonInfo) infoCount++;
    }
    infoCount += sourceMissingItems.length;
    const missingCount = panelMissingElements.length;
    const criticalMissing = missingCategory === 'critical' ? missingCount : 0;
    const warningMissing = missingCategory === 'warning' ? missingCount : 0;
    criticalCount += criticalMissing;
    warningCount += warningMissing;
    return {
      criticalCount,
      warningCount,
      infoCount,
      criticalMissing,
      warningMissing,
    };
  }, [elementEntrySummaries, sourceMissingItems.length, missingCategory, panelMissingElements.length]);
  const filteredPanelMissingElements = useMemo(() => {
    if (validationFilter !== 'warning' && validationFilter !== 'critical') return panelMissingElements;
    return panelMissingElements.filter(() => validationFilter === missingCategory);
  }, [missingCategory, panelMissingElements, validationFilter]);

  if (validationFilter) {
    const matchingCount = elementIds.filter((id) => {
      const element = elementsById[id];
      if (!element) return false;
      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase();
        const nameMatch = element.name?.toLowerCase().includes(query);
        const bundleNameMatch = (getDormerBundleName(element) || '').toLowerCase().includes(query);
        const rawTypeMatch = element.type?.toLowerCase().includes(query);
        const displayTypeMatch = element.type
          ? getContextualElementDisplayName(element).toLowerCase().includes(query)
          : false;
        if (!nameMatch && !bundleNameMatch && !rawTypeMatch && !displayTypeMatch) return false;
      }
      if (!elementMatchesFilter(element, validationFilter)) return false;
      return true;
    }).length;
    if (validationFilter === 'info') {
      if (matchingCount === 0 && sourceMissingItems.length === 0) setValidationFilter(null);
    } else if (validationFilter === 'warning' || validationFilter === 'critical') {
      const missingInCategory = panelMissingElements.filter(() => {
        const category = complianceSettings.complianceValidationEnabled ? 'critical' : 'warning';
        return category === validationFilter;
      }).length;
      if (matchingCount === 0 && missingInCategory === 0) setValidationFilter(null);
    } else if (matchingCount === 0) {
      setValidationFilter(null);
    }
  }

  const handleElementEntryClick = useCallback((
    entry: ElementsPanelEntry,
    isFullySelected: boolean,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    const state = elementEntryRowActionStateRef.current;
    if (!state) return;

    const nextIds = event.shiftKey
      ? (
          isFullySelected
            ? removeEntryMembersFromSelection(state.selectedElementIds, entry)
            : Array.from(new Set([...state.selectedElementIds, ...entry.memberIds]))
        )
      : entry.memberIds;

    if (event.shiftKey) {
      state.setSelectedElementIds(nextIds);
      if (nextIds.length === 0) {
        state.setSelection(null);
      } else if (!isFullySelected) {
        state.setSelection(getSelectionForEntry(entry));
      } else {
        const fallbackId = nextIds[nextIds.length - 1];
        state.setSelection(fallbackId ? getSelectionForElementIdFromElements(state.elementsById, fallbackId) : null);
      }
      return;
    }

    state.clearElementSelection();
    state.setSelectedElementIds(nextIds);
    state.setSelection(getSelectionForEntry(entry));
  }, []);

  const handleElementEntryDoubleClick = useCallback((entry: ElementsPanelEntry, elementFloorZ: number) => {
    const state = elementEntryRowActionStateRef.current;
    if (!state) return;

    try {
      const elemFloorZ = Math.floor(elementFloorZ);
      const currFloorZ = Math.floor(state.currentFloorZ);
      if (elemFloorZ !== currFloorZ) state.setCurrentFloorZ(elemFloorZ);
      if (state.viewMode === '3d' && state.onFrameElementIn3D) {
        state.onFrameElementIn3D(entry.representative.id);
        return;
      }
      const coords = entry.members.flatMap((member) => member.coordinates || []);
      let cx = 0;
      let cy = 0;
      if (coords.length === 2) {
        cx = (coords[0].x + coords[1].x) / 2;
        cy = (coords[0].y + coords[1].y) / 2;
      } else if (coords.length >= 1) {
        const xs = coords.map((c) => c.x);
        const ys = coords.map((c) => c.y);
        cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      }
      const target = worldToCanvas({ x: cx, y: cy }, state.scale, { x: 0, y: 0 }, state.canvasCenter);
      state.setPanOffset({ x: state.canvasCenter.x - target.x, y: state.canvasCenter.y - target.y });
    } catch {
      /* swallow: best-effort */
    }
  }, []);

  const handleToggleEntryHidden = useCallback((
    entry: ElementsPanelEntry,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    const state = elementEntryRowActionStateRef.current;
    if (!state) return;

    event.preventDefault();
    event.stopPropagation();
    state.toggleElementsHidden(entry.memberIds);
  }, []);

  return (
    <Rnd
      bounds="parent"
      size={{ width: elementsRect.width, height: elementsRect.height }}
      position={{ x: elementsRect.x, y: elementsRect.y }}
      minWidth={ELEMENTS_PANEL_MIN_W}
      minHeight={ELEMENTS_PANEL_MIN_H}
      maxWidth={Math.max(ELEMENTS_PANEL_MIN_W, Math.floor(stageSize.width - 24))}
      maxHeight={Math.max(ELEMENTS_PANEL_MIN_H, Math.floor(stageSize.height * 0.8))}
      dragHandleClassName="panel-drag-handle"
      cancel="input, textarea, select, button"
      style={{ zIndex: activePanel === 'elements' ? 2100 : 2000 }}
      onMouseDown={() => setActivePanel('elements')}
      onDragStart={() => setActivePanel('elements')}
      onResizeStart={() => setActivePanel('elements')}
      onDragStop={(_e, d) => {
        setElementsRect((prev) => clampElementsRectToCanvas({ ...prev, x: d.x, y: d.y }));
      }}
      onResizeStop={(_e, _dir, ref, _delta, position) => {
        const width = parseInt(ref.style.width, 10) || ELEMENTS_PANEL_DEFAULT_W;
        const height = parseInt(ref.style.height, 10) || ELEMENTS_PANEL_DEFAULT_H;
        setElementsRect(clampElementsRectToCanvas({ x: position.x, y: position.y, width, height }));
      }}
    >
      <div
        ref={elementsMenuRef}
        className="glass-panel overlay-elementsmenu"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label="Move panel"
          className="panel-drag-handle panel-drag-handle-overlay"
          title="Drag to move • Double-click to reset"
          onDoubleClick={(e) => {
            e.preventDefault();
            setActivePanel('elements');
            setElementsRect(getElementsDefaultRect());
          }}
        >
          <span className="panel-drag-handle-dots" aria-hidden="true" />
        </div>

        <div className="elements-panel__columns">
          {/* Left Panel: Zones (33%) */}
          <div className="elements-panel__zones-column">
            <div className="controls-label">Zones:</div>
            <div className="elements-panel__zone-list">
              {filteredZones
                .map((zone) => {
                  const zoneElementCount = zoneElementCounts.get(zone.id) ?? 0;
                  const zoneValidation = zoneValidationById.get(zone.id) ?? EMPTY_VALIDATION_RESULT;
                  return (
                    <button
                      key={zone.id}
                      className={`zone-pill ${selection?.type === 'zone' && selection.id === zone.id ? 'selected' : ''}`}
                      onClick={() => setSelection({ type: 'zone', id: zone.id })}
                      title={getVolumeCalculationBreakdown(zone, Object.values(elementsById))}
                    >
                      <div className="zone-pill-content">
                        <div className="zone-name">
                          {zone.name}
                          {zoneValidation.hasIssues && (
                            <ValidationIndicator
                              hasIssues
                              issues={zoneValidation.issues}
                              size="small"
                              className="zone-validation-dot"
                            />
                          )}
                          {zoneValidation.hasWarnings && !zoneValidation.hasIssues && (
                            <ValidationIndicator
                              hasIssues
                              issues={zoneValidation.warnings}
                              size="small"
                              variant="warning"
                              className="zone-validation-dot"
                            />
                          )}
                          {zoneHasComparisonInfo(zone.id) && (
                            <ValidationIndicator
                              hasIssues
                              issues={['Source comparison differences']}
                              size="small"
                              variant="info"
                              className="zone-validation-dot"
                            />
                          )}
                        </div>
                        <div className="zone-details">
                          {zone.floorArea?.toFixed(1) || '0.0'}m² • {zone.volume?.toFixed(1) || '0.0'}m³ • {zoneElementCount} elements
                        </div>
                      </div>
                    </button>
                  );
                })}
              {ecaasOnlySystems.length > 0 ? (
                <button
                  className="add-button elements-panel-status-button"
                  onClick={() => {
                    const idx = ecaasCycleRef.current % ecaasOnlySystems.length;
                    ecaasCycleRef.current += 1;
                    const target = ecaasOnlySystems[idx];
                    if (!target) return;
                    const targetZ = getElementCanvasFloorZValue(target, floors) ?? 0;
                    if (targetZ !== currentFloorZ) setCurrentFloorZ(targetZ);
                    setSelection(target.zoneId ? { type: 'element', id: target.id } : { type: 'global', id: target.id });
                    clearElementSelection();
                    setSelectedElementIds([target.id]);
                  }}
                  title="Cycle through ECaaS-only PCDB systems"
                >
                  ECaaS-Only x{ecaasOnlySystems.length}
                </button>
              ) : null}
              {!complianceSettings.complianceValidationEnabled && (
                <button
                  className="add-button"
                  onClick={() => {
                    try {
                      const zoneId = createPlaceholderZone();
                      setSelection({ type: 'zone', id: zoneId, isPlaceholder: true });
                    } catch (error) {
                      alert(error instanceof Error ? error.message : 'Failed to create zone');
                    }
                  }}
                  title="Add Zone"
                >
                  + Zone
                </button>
              )}
              <div className="elements-panel__tools">
                <div className="hide-control">
                  <div className="hide-control__label">Hide</div>
                  <div className="hide-control__buttons">
                    <HideElementsDropdown
                      categoryGhost={elementCategoryGhost}
                      onToggle={onToggleElementCategoryGhost}
                      hiddenElementIds={hiddenElementIds}
                      elementsById={elementsById}
                      onUnhideElement={unhideElement}
                      buttonText="Elements"
                    />
                    <HidePanelsDropdown
                      panelOptions={panelHideOptions}
                      hiddenPanelKeys={hiddenPanelKeys}
                      onTogglePanel={onTogglePanelHidden}
                      onHideAll={onHideAllPanels}
                      onShowAll={onShowAllPanels}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: Elements (67%) */}
          <div className="elements-panel__elements-column">
            <div className="controls-label">Elements:</div>

            <div className="elements-panel__toolbar">
              <input
                type="text"
                className="elements-panel__search"
                placeholder="Search by name or type..."
                value={elementSearchQuery}
                onChange={(e) => {
                  setElementSearchQuery(e.target.value);
                  if (validationFilter) setValidationFilter(null);
                }}
              />
              {(() => {
                const {
                  criticalCount,
                  warningCount,
                  infoCount,
                  criticalMissing,
                  warningMissing,
                } = elementStatusCounts;
                if (criticalCount === 0 && warningCount === 0 && infoCount === 0) return null;
                return (
                  <div className="elements-panel__status-filters">
                    {criticalCount > 0 && (
                      <button
                        type="button"
                        title={`${criticalCount} critical issue${criticalCount !== 1 ? 's' : ''}${criticalMissing ? ` (${criticalMissing} missing element${criticalMissing !== 1 ? 's' : ''})` : ''}. Click to filter.`}
                        onClick={() => setValidationFilter(validationFilter === 'critical' ? null : 'critical')}
                        className={`elements-panel__status-chip elements-panel__status-chip--critical ${validationFilter === 'critical' ? 'elements-panel__status-chip--active' : ''}`}
                      >
                        {criticalCount}
                      </button>
                    )}
                    {warningCount > 0 && (
                      <button
                        type="button"
                        title={`${warningCount} warning${warningCount !== 1 ? 's' : ''}${warningMissing ? ` (${warningMissing} missing element${warningMissing !== 1 ? 's' : ''})` : ''}. Click to filter.`}
                        onClick={() => setValidationFilter(validationFilter === 'warning' ? null : 'warning')}
                        className={`elements-panel__status-chip elements-panel__status-chip--warning ${validationFilter === 'warning' ? 'elements-panel__status-chip--active' : ''}`}
                      >
                        {warningCount}
                      </button>
                    )}
                    {infoCount > 0 && (
                      <button
                        type="button"
                        title={`${infoCount} source comparison difference${infoCount !== 1 ? 's' : ''}. Click to filter.`}
                        onClick={() => setValidationFilter(validationFilter === 'info' ? null : 'info')}
                        className={`elements-panel__status-chip elements-panel__status-chip--info ${validationFilter === 'info' ? 'elements-panel__status-chip--active' : ''}`}
                      >
                        {infoCount}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="elements-panel__element-list">
              {sortedElementEntries
                .map((entry) => {
                  const element = entry.representative;
                  const entryKey = getElementEntryKey(entry);
                  const summary: ElementsPanelEntrySummary | undefined = elementEntrySummaries.get(entryKey);
                  const dormerBundleName = entry.isDormerBundle ? getDormerBundleName(element) : null;
                  const dormerBundleId = getDormerBundleInfo(element)?.bundle_id ?? null;
                  const isSelected = getElementEntrySelectionState(
                    entry,
                    selection,
                    selectedElementIdSet,
                    dormerBundleId,
                  );
                  const validation = summary?.validation ?? EMPTY_VALIDATION_RESULT;
                  const hasComparisonInfo = summary?.hasComparisonInfo ?? false;
                  const elementFloorZ = summary?.elementFloorZ ?? 0;
                  const isCurrentFloor = summary?.isCurrentFloor ?? false;
                  const isFullySelected = areAllEntryMembersSelected(entry, selectedElementIdSet);
                  const allMembersIndividuallyHidden = entry.memberIds.every((id) => hiddenElementIds.has(id));
                  const evidenceCount = lookupByElement.get(element.name ?? '')?.length ?? 0;
                  return (
                    <ElementEntryRow
                      key={entryKey}
                      entry={entry}
                      dormerBundleName={dormerBundleName}
                      isSelected={isSelected}
                      isFullySelected={isFullySelected}
                      validation={validation}
                      hasComparisonInfo={hasComparisonInfo}
                      elementFloorZ={elementFloorZ}
                      isCurrentFloor={isCurrentFloor}
                      currentFloorZ={currentFloorZ}
                      hasEvidenceDraft={hasEvidenceDraft}
                      evidenceCount={evidenceCount}
                      allMembersIndividuallyHidden={allMembersIndividuallyHidden}
                      onEntryClick={handleElementEntryClick}
                      onEntryDoubleClick={handleElementEntryDoubleClick}
                      onToggleEntryHidden={handleToggleEntryHidden}
                    />
                  );
                })}

              {/* Optional private-host source comparison items. */}
              {sourceMissingItems.length > 0 && (!validationFilter || validationFilter === 'info') && (
                <>
                  {sourceMissingItems.map((missing) => {
                    const zone = zones.find((z) => z.id === missing.zoneId);
                    const zoneName = zone?.name || 'Unknown Zone';
                    const isAssigning = sourceAssignTargetKey === missing.id;
                    const assignCandidates = isAssigning ? getSourceAssignCandidates(missing.id) : [];
                    return (
                      <div
                        key={missing.id}
                        className="element-pill element-pill--missing element-pill--missing-info"
                        title={missing.message}
                      >
                        <div className="element-pill__missing-body element-pill__missing-body--wrap">
                          <div className="element-pill__missing-line">
                            <span>
                              + {getElementTypeDisplayName(missing.elementType as ElementType)}
                            </span>
                            {missing.name && (
                              <>
                                <span className="element-pill__missing-separator">•</span>
                                <span className="element-pill__missing-meta">{missing.name}</span>
                              </>
                            )}
                            {missing.zoneId && (
                              <>
                                <span className="element-pill__missing-separator">•</span>
                                <span className="element-pill__missing-meta">{zoneName}</span>
                              </>
                            )}
                          </div>
                          <div className="element-pill__missing-actions">
                            <button
                              className="files-dropdown-action-pill"
                              onClick={async () => {
                                try {
                                  const targetZoneId = missing.zoneId || zones[0]?.id || createPlaceholderZone();
                                  const elementId = createPlaceholderElement(targetZoneId, missing.elementType as ElementType);
                                  try {
                                    const centerWorld = canvasToWorld(
                                      { x: canvasCenter.x, y: canvasCenter.y },
                                      scale,
                                      panOffset,
                                      canvasCenter
                                    );
                                    const z = currentFloorZ;
                                    const prefill = sourceComparisonPort.prefillMissingItem(missing.id) ?? {};
                                    updateElement(
                                      elementId,
                                      { coordinates: [{ x: centerWorld.x, y: centerWorld.y, z }], ...prefill } as Partial<Element>,
                                      true
                                    );
                                  } catch { /* swallow: best-effort */ }
                                  const createdElement = geometryStore.getState().elementsById[elementId];
                                  if (!createdElement) throw new Error('Created element is missing from the geometry store');
                                  setSelectedElementIds([elementId]);
                                  setSelection({ ...selectionForElement(createdElement), isPlaceholder: true });
                                  await handleAssignSource(missing.id, elementId);
                                } catch (error) {
                                  alert(error instanceof Error ? error.message : 'Failed to create element');
                                }
                              }}
                              title="Create element"
                            >
                              Create
                            </button>
                            <button
                              className="files-dropdown-action-pill"
                              onClick={() => {
                                pendingHostElementCreationRef.current = {
                                  prefill: sourceComparisonPort.prefillMissingItem(missing.id) ?? undefined,
                                  onCreated: (elementId) => handleAssignSource(missing.id, elementId),
                                };
                                setDrawElementType(missing.elementType as ElementType);
                                setDrawPoints([]);
                                setRoomWalls([]);
                                setRoomWallElements([]);
                                setOrthogonalRoomStart(null);
                                setOrthogonalRoomEnd(null);
                                setDrawMode(missing.drawMode);
                              }}
                              title="Draw this element on the canvas"
                            >
                              Draw
                            </button>
                            {missing.canAssign && (
                              <button
                                className="files-dropdown-action-pill"
                                onClick={() => {
                                  setSourceAssignSelectionId('');
                                  setSourceAssignTargetKey(isAssigning ? null : missing.id);
                                }}
                                title="Assign to existing element"
                              >
                                Assign
                              </button>
                            )}
                          </div>
                        </div>
                        {isAssigning && (
                          <div className="element-pill__missing-assign">
                            <select
                              value={sourceAssignSelectionId}
                              onChange={(e) => setSourceAssignSelectionId(e.target.value)}
                              className="element-pill__missing-select"
                            >
                              <option value="">Select HEM element…</option>
                              {assignCandidates.map((el) => (
                                <option key={el.id} value={el.id}>
                                  {el.name || el.id} • {getElementTypeDisplayName(el.type as ElementType)}
                                </option>
                              ))}
                            </select>
                            <button
                              className="files-dropdown-action-pill"
                              disabled={!sourceAssignSelectionId}
                              onClick={() => handleAssignSource(missing.id, sourceAssignSelectionId)}
                            >
                              Link
                            </button>
                            <button
                              className="files-dropdown-action-pill"
                              onClick={() => {
                                setSourceAssignTargetKey(null);
                                setSourceAssignSelectionId('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {/* Missing Element Pills - always visible when missing elements exist */}
              {(() => {
                if (panelMissingElements.length === 0) return null;
                if (filteredPanelMissingElements.length === 0) return null;
                return (
                  <>
                    {filteredPanelMissingElements.map((missing, index) => {
                      const zone = zones.find((z) => z.id === missing.zoneId);
                      const zoneName = zone?.name || 'Unknown Zone';
                      return (
                        <button
                          key={`missing-${missing.path}-${missing.type}-${index}`}
                          className="element-pill element-pill--missing element-pill--missing-required element-pill--missing-cta"
                          onClick={() => {
                            try {
                              const targetZoneId = missing.zoneId || zones[0]?.id || createPlaceholderZone();

                              // Part F batched CTA: create all planned vents in one go, parented
                              // and sized per the placement plan. Selects the first as the user's
                              // entry point.
                              if (missing.batchPlan && missing.batchPlan.vents.length > 0) {
                                const ids: string[] = [];
                                for (const planned of missing.batchPlan.vents) {
                                  const id = createPlaceholderElement(targetZoneId, missing.type);
                                  ids.push(id);
                                  updateElement(
                                    id,
                                    {
                                      area_cm2: planned.area_cm2,
                                      mid_height_air_flow_path: planned.mid_height_air_flow_path,
                                      parent_element: planned.parent_element ?? '',
                                      coordinates: [planned.coordinates],
                                    } as any,
                                    true,
                                  );
                                }
                                const firstId = ids[0];
                                const firstElement = geometryStore.getState().elementsById[firstId];
                                if (!firstElement) throw new Error('Created element is missing from the geometry store');
                                setSelectedElementIds([firstId]);
                                setSelection({ ...selectionForElement(firstElement), isPlaceholder: true });
                                return;
                              }

                              const elementId = createPlaceholderElement(targetZoneId, missing.type);
                              try {
                                const centerWorld = canvasToWorld(
                                  { x: canvasCenter.x, y: canvasCenter.y },
                                  scale,
                                  panOffset,
                                  canvasCenter
                                );
                                const z = currentFloorZ;
                                const missingSystemSubtype =
                                  missing.type !== 'System'
                                    ? undefined
                                    : missing.path.endsWith('/SpaceCoolSystem')
                                      ? 'SpaceCoolSystem'
                                      : missing.path.endsWith('/SpaceHeatSystem')
                                        ? 'SpaceHeatSystem'
                                        : missing.path === '/HotWaterSource' ||
                                            missing.path.endsWith('/HotWaterSource')
                                          ? 'HotWaterSource'
                                          : missing.path === '/HeatSourceWet' ||
                                              missing.path.endsWith('/HeatSourceWet')
                                            ? 'HeatSourceWet'
                                            : undefined;
                                const missingHotWaterOther =
                                  missing.type === 'HotWaterDemand'
                                  && missing.path.includes('/HotWaterDemand/Other');
                                const missingHotWaterShowerOrBath =
                                  missing.type === 'HotWaterDemand'
                                  && missing.path.includes('/HotWaterDemand/ShowerOrBath');
                                const missingHotWaterShower =
                                  missing.type === 'HotWaterDemand'
                                  && missing.path === '/HotWaterDemand/Shower';
                                const missingRefrigerationAppliance =
                                  missing.type === 'Appliance'
                                  && missing.path === '/Appliances/FridgeOrFridgeFreezer';
                                updateElement(
                                  elementId,
                                  {
                                    coordinates: [{ x: centerWorld.x, y: centerWorld.y, z }],
                                    ...(missingSystemSubtype ? { subcategory: missingSystemSubtype } : {}),
                                    ...(missingHotWaterOther
                                      ? {
                                          subcategory: 'OtherWaterUseDetails',
                                          flowrate: 8,
                                        }
                                      : {}),
                                    ...(missingHotWaterShowerOrBath || missingHotWaterShower
                                      ? {
                                          subcategory: 'MixerShower',
                                          flowrate: 8,
                                          allow_low_flowrate: false,
                                        }
                                      : {}),
                                    ...(missingRefrigerationAppliance
                                      ? { appliancekey: 'Fridge' }
                                      : {}),
                                  } as any,
                                  true
                                );
                              } catch { /* swallow: best-effort */ }
                              const createdElement = geometryStore.getState().elementsById[elementId];
                              if (!createdElement) throw new Error('Created element is missing from the geometry store');
                              setSelectedElementIds([elementId]);
                              setSelection({ ...selectionForElement(createdElement), isPlaceholder: true });
                            } catch (error) {
                              alert(error instanceof Error ? error.message : 'Failed to create element');
                            }
                          }}
                          title={missing.message}
                          aria-label={`Add missing element: ${getElementTypeDisplayName(missing.type as ElementType)}${
                            missing.pillQualifier ? ` — ${missing.pillQualifier}` : ''
                          }${missing.zoneId ? ` (${zoneName})` : ''}`}
                        >
                          <span>
                            + {getElementTypeDisplayName(missing.type as ElementType)}
                          </span>
                          {missing.pillQualifier ? (
                            <>
                              <span className="element-pill__missing-separator" aria-hidden="true">
                                ·
                              </span>
                              <span className="element-pill__missing-meta">
                                {missing.pillQualifier}
                              </span>
                            </>
                          ) : null}
                          {missing.zoneId && (
                            <>
                              <span className="element-pill__missing-separator">•</span>
                              <span className="element-pill__missing-meta">{zoneName}</span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </>
                );
              })()}

              <button
                className="add-button"
                onClick={() => {
                  try {
                    const targetZoneId = zones.length > 0 ? zones[0].id : createPlaceholderZone();
                    const elementId = createPlaceholderElement(targetZoneId, 'BuildingElementOpaque');
                    const createdElement = geometryStore.getState().elementsById[elementId];
                    if (!createdElement) throw new Error('Created element is missing from the geometry store');
                    setSelectedElementIds([elementId]);
                    setSelection({ ...selectionForElement(createdElement), isPlaceholder: true });
                  } catch (error) {
                    alert(error instanceof Error ? error.message : 'Failed to create element');
                  }
                }}
                title="Add Element"
              >
                + Element
              </button>
            </div>
          </div>
        </div>
      </div>
    </Rnd>
  );
});
