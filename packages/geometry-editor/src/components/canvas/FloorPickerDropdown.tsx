// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { DeleteConfirmModal } from '../DeleteConfirmModal';
import { DraftSafeNumberInput } from '../DraftSafeNumberInput';
import { ValidationIndicator } from '../ValidationIndicator';
import { getElementCanvasFloorZValue } from '../../lib/elementCanvasFloor';
import type { Element, Floor } from '../../geometry/types';
import type { ValidationIssue, ValidationResult } from '../../geometry/validation/types';
import {
  BASE_HEIGHT_AUTOSYNC_TOLERANCE_M,
  getEffectiveStoreyHeight,
  getMaxLineWallHeightOnFloor,
} from '../../lib/zoneDerivation';
import {
  canvasFloorToFhsStorey,
  fhsFloorLabelForCanvasFloor,
  fhsStoreyToCanvasFloor,
} from '../../lib/storeySemantics';
import '../FilesDropdownPrimitives.css';
import './FloorPickerDropdown.css';

interface FloorPickerDropdownProps {
  currentFloorZ: number;
  floors: Floor[];
  elementsById: Record<string, Element>;
  onSelectFloor: (z: number) => void;
  onAddFloor: (z: number) => void;
  onDeleteFloor: (id: string) => void;
  /**
   * Apply a floor patch (`height` + `heightUserOverride`). The dropdown uses this for two
   * actions: typing a storey height (sets override) and clicking the stale-override warning
   * (clears override, snaps to walls).
   */
  onUpdateFloor?: (floorId: string, updates: Partial<Floor>) => void;
  /** Create the internal floor record when the picker is used before any element exists. */
  onEnsureFloorForZ?: (z: number) => string;
  /** Reuse element validation to flag real floor-stack overlap/separation warnings. */
  getElementValidation?: (element: Element) => ValidationResult;
  addDisabled?: boolean;
}

type FloorRow = {
  floor: Floor;
  elementCount: number;
  childElements: Array<{ id: string; name: string; type: string }>;
};

const TOAST_DURATION_MS = 2400;
const FLOOR_STACK_WARNING = 'Floor geometry may overlap or separate.';

function isFloorStackWarning(warning: ValidationIssue): boolean {
  if (warning.source !== 'geometry') return false;
  if (warning.fieldKey === 'base_height') {
    return warning.message.includes('< slab') || warning.message.includes('> storey ceiling');
  }
  return warning.fieldKey === 'height' && warning.message.startsWith('Top of element ');
}

function floorLabel(zIndex: number): string {
  return fhsFloorLabelForCanvasFloor(zIndex);
}

function floorCountLabel(count: number): string {
  return `${count} element${count === 1 ? '' : 's'}`;
}

function formatMetres(m: number): string {
  return (Math.round(m * 100) / 100).toString();
}

export const FloorPickerDropdown: React.FC<FloorPickerDropdownProps> = ({
  currentFloorZ,
  floors,
  elementsById,
  onSelectFloor,
  onAddFloor,
  onDeleteFloor,
  onUpdateFloor,
  onEnsureFloorForZ,
  getElementValidation,
  addDisabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [newFloorZInput, setNewFloorZInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, bottom: 0, width: 0 });
  const [pendingDeleteFloor, setPendingDeleteFloor] = useState<FloorRow | null>(null);
  // Per-row storey-height drafts so users can type freely; commit to store on blur/Enter.
  const [heightDrafts, setHeightDrafts] = useState<Record<string, string>>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const sortedFloors = useMemo(() => [...floors].sort((a, b) => a.zIndex - b.zIndex), [floors]);
  const suggestedNextFloorZ = sortedFloors.length > 0 ? Math.max(...sortedFloors.map((floor) => floor.zIndex)) + 1 : 1;
  const suggestedNextStorey = canvasFloorToFhsStorey(suggestedNextFloorZ);
  const pendingAddTargetZ = useMemo(() => {
    const parsed = Number.parseInt(newFloorZInput, 10);
    return Number.isFinite(parsed) ? fhsStoreyToCanvasFloor(parsed) : suggestedNextFloorZ;
  }, [newFloorZInput, suggestedNextFloorZ]);
  const pendingAddLabel = floorLabel(pendingAddTargetZ);
  const pendingAddExists = sortedFloors.some((floor) => floor.zIndex === pendingAddTargetZ);
  const pendingAddPreview = pendingAddExists ? `${pendingAddLabel} exists` : `Adds ${pendingAddLabel}`;
  const currentFloor = sortedFloors.find((floor) => floor.zIndex === currentFloorZ) ?? null;

  // Ground is the default drawing floor even before the first element has been created. Keep a
  // synthetic row in the picker until the store creates the real record via selection or editing.
  const pickerFloors = useMemo(() => {
    if (sortedFloors.some((floor) => floor.zIndex === 0)) return sortedFloors;
    return [
      { id: '__ground-floor-placeholder__', name: '0', zIndex: 0, height: 0, isRoofSpace: false },
      ...sortedFloors,
    ];
  }, [sortedFloors]);

  // All elements, used by the effective-storey helpers (max wall height, override resolution).
  const allElements = useMemo(() => Object.values(elementsById), [elementsById]);

  /**
   * Per-floor wall-derived + effective storey heights, computed once per (floors, elements) change.
   * Without this, every floor row would re-walk `allElements` twice (max wall height + effective
   * storey) when checking the stale-override warning — O(rows × elements) per render. With the map,
   * it's O(floors × elements) once.
   */
  const heightsByFloorId = useMemo(() => {
    const m = new Map<string, { wallHeight: number; effective: number }>();
    for (const floor of pickerFloors) {
      m.set(floor.id, {
        wallHeight: getMaxLineWallHeightOnFloor(floor.zIndex, allElements),
        effective: getEffectiveStoreyHeight(floor, allElements),
      });
    }
    return m;
  }, [pickerFloors, allElements]);

  const floorRows = useMemo<FloorRow[]>(() => {
    return pickerFloors.map((floor) => {
      const childElements = Object.values(elementsById)
        .filter((element) => {
          const floorZ = getElementCanvasFloorZValue(element, floors);
          return floorZ === floor.zIndex || element.floorId === floor.id;
        })
        .map((element) => ({
          id: element.id,
          name: element.name || 'Unnamed',
          type: element.type || 'Element',
        }));

      return {
        floor,
        elementCount: childElements.length,
        childElements,
      };
    });
  }, [elementsById, floors, pickerFloors]);

  const floorStackWarningsByFloorId = useMemo(() => {
    const warningFloorIds = new Set<string>();
    if (!getElementValidation) return warningFloorIds;

    for (const row of floorRows) {
      let hasWarning = false;
      for (const childElement of row.childElements) {
        const element = elementsById[childElement.id];
        if (!element) continue;
        for (const warning of getElementValidation(element).warnings) {
          if (isFloorStackWarning(warning)) {
            hasWarning = true;
            break;
          }
        }
        if (hasWarning) break;
      }
      if (hasWarning) warningFloorIds.add(row.floor.id);
    }
    return warningFloorIds;
  }, [elementsById, floorRows, getElementValidation]);

  /**
   * Commit a typed storey-height value to the same floor row. Auto-clears the override flag when
   * the resulting storey matches the wall-derived height.
   */
  const commitStoreyHeight = useCallback(
    (rowFloor: Floor) => {
      const rowKey = rowFloor.id;
      const draft = heightDrafts[rowKey];
      setHeightDrafts((prev) => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
      if (draft === undefined) return;
      const parsed = Number.parseFloat(draft);
      if (!Number.isFinite(parsed)) return;
      const rounded = Math.round(parsed * 100) / 100;

      const targetFloor = sortedFloors.find((floor) => floor.zIndex === rowFloor.zIndex);
      const targetFloorId = targetFloor?.id ?? onEnsureFloorForZ?.(rowFloor.zIndex);
      if (!targetFloorId) return;

      const targetStorey = Math.max(0, rounded);
      const wallDerived = getMaxLineWallHeightOnFloor(rowFloor.zIndex, allElements);
      const matchesWalls =
        wallDerived > 0 && Math.abs(wallDerived - targetStorey) <= BASE_HEIGHT_AUTOSYNC_TOLERANCE_M;

      onUpdateFloor?.(targetFloorId, {
        height: targetStorey,
        heightUserOverride: !matchesWalls,
      });
    },
    [heightDrafts, sortedFloors, allElements, onEnsureFloorForZ, onUpdateFloor],
  );

  /** Clear a floor's override so it snaps back to wall-derived storey height. */
  const snapFloorToWalls = useCallback(
    (floor: Floor) => {
      onUpdateFloor?.(floor.id, { heightUserOverride: false });
    },
    [onUpdateFloor],
  );

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      x: rect.left,
      bottom: window.innerHeight - rect.top + 8,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(updatePosition, 10);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => addInputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleAddFloor = () => {
    if (pendingAddExists) {
      setToastMessage(`${pendingAddLabel} already exists`);
      return;
    }
    onAddFloor(pendingAddTargetZ);
    setNewFloorZInput('');
    setIsOpen(false);
  };

  const handleDeleteConfirm = () => {
    if (!pendingDeleteFloor) return;
    onDeleteFloor(pendingDeleteFloor.floor.id);
    setPendingDeleteFloor(null);
    setIsOpen(false);
  };

  const dropdownElement = isOpen ? (
    <div
      ref={panelRef}
      className="floor-picker-panel"
      style={{
        left: position.x,
        bottom: position.bottom,
        minWidth: Math.max(position.width, 260),
      }}
    >
      <div className="floor-picker-list" role="listbox" aria-label="Floors">
        {floorRows.map((row) => {
            const isActive = row.floor.zIndex === currentFloorZ;
            const isPlaceholderFloor = !sortedFloors.some((floor) => floor.id === row.floor.id);
            const rowHeights = heightsByFloorId.get(row.floor.id);
            const wallHeight = rowHeights?.wallHeight ?? 0;
            const effectiveHeight = rowHeights?.effective ?? 0;
            const heightDraft = heightDrafts[row.floor.id];
            const heightValueDisplay = heightDraft ?? formatMetres(effectiveHeight);
            const hasFloorStackWarning = floorStackWarningsByFloorId.has(row.floor.id);
            const ownerOverrideStale = !!(
              !isPlaceholderFloor &&
              row.floor.heightUserOverride === true &&
              wallHeight > 0 &&
              Math.abs(wallHeight - effectiveHeight) > BASE_HEIGHT_AUTOSYNC_TOLERANCE_M
            );
            const staleTitle = ownerOverrideStale
              ? `Walls suggest ${formatMetres(wallHeight)} m for ${floorLabel(row.floor.zIndex)}; override is ${formatMetres(effectiveHeight)} m. Click to reset.`
              : undefined;

            return (
              <div key={row.floor.id} className="floor-picker-row-shell">
                <button
                  type="button"
                  className={`floor-picker-row ${isActive ? 'floor-picker-row-active' : ''}`}
                  onClick={() => {
                    onSelectFloor(row.floor.zIndex);
                    setIsOpen(false);
                  }}
                  role="option"
                  aria-selected={isActive}
                  title={`Switch to ${floorLabel(row.floor.zIndex)}`}
                >
                  <div className="floor-picker-row-main">
                    <div className="floor-picker-row-summary">
                      <span className="floor-picker-row-title">{floorLabel(row.floor.zIndex)}</span>
                      <span className="floor-picker-row-meta">{floorCountLabel(row.elementCount)}</span>
                      {hasFloorStackWarning ? (
                        <ValidationIndicator
                          hasIssues
                          issues={[FLOOR_STACK_WARNING]}
                          variant="warning"
                          size="small"
                        />
                      ) : null}
                    </div>
                  </div>
                </button>
                {ownerOverrideStale ? (
                  <button
                    type="button"
                    className="floor-picker-override-warning"
                    title={staleTitle}
                    aria-label={`Reset ${floorLabel(row.floor.zIndex)} storey height to wall-derived value`}
                    onClick={(event) => {
                      event.stopPropagation();
                      snapFloorToWalls(row.floor);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 3 1.5 21h21L12 3zm0 5 7.5 13h-15L12 8zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                ) : null}
                {onUpdateFloor ? (
                  <label
                    className="floor-picker-height-shell"
                    title={`Storey height of ${floorLabel(row.floor.zIndex)}, in metres`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DraftSafeNumberInput
                      step="0.05"
                      min={0}
                      className="floor-picker-height-input"
                      aria-label={`Storey height for ${floorLabel(row.floor.zIndex)} in metres`}
                      value={heightValueDisplay}
                      onChange={(event) =>
                        setHeightDrafts((prev) => ({ ...prev, [row.floor.id]: event.target.value }))
                      }
                      onBlur={() => commitStoreyHeight(row.floor)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          (event.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                    />
                    <span className="floor-picker-height-unit">m</span>
                  </label>
                ) : null}
                {!isPlaceholderFloor && <button
                  type="button"
                  className="files-dropdown-action-btn floor-picker-delete-btn"
                  title={
                    row.elementCount > 0
                      ? `Delete ${floorLabel(row.floor.zIndex)} and ${floorCountLabel(row.elementCount)}`
                      : `Delete ${floorLabel(row.floor.zIndex)}`
                  }
                  aria-label={`Delete ${floorLabel(row.floor.zIndex)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDeleteFloor(row);
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 6h18" stroke="currentColor" strokeWidth="2" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>}
              </div>
            );
          })}
      </div>

      <div className="floor-picker-divider" />

      <div className="floor-picker-footer">
        <div className="floor-picker-add-row">
          <div className={`floor-picker-input-shell ${addDisabled ? 'floor-picker-input-shell-disabled' : ''}`}>
            <DraftSafeNumberInput
              ref={addInputRef}
              inputMode="numeric"
              className="floor-picker-input"
              value={newFloorZInput}
              onChange={(event) => setNewFloorZInput(event.target.value)}
              placeholder={String(suggestedNextStorey)}
              aria-label="FHS floor number to add"
              title="FHS floor number: F1 is ground, F0 is basement 1"
              disabled={addDisabled}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !addDisabled) {
                  event.preventDefault();
                  handleAddFloor();
                }
              }}
            />
          </div>
          <span
            className={`floor-picker-add-preview ${pendingAddExists ? 'floor-picker-add-preview-existing' : ''}`}
            title={pendingAddPreview}
          >
            {pendingAddPreview}
          </span>
          <button
            type="button"
            className="draw-button floor-picker-add-button"
            onClick={handleAddFloor}
            disabled={addDisabled}
            title={addDisabled ? 'Add floor is unavailable in 3D view' : pendingAddPreview}
          >
            Add
          </button>
        </div>
        {toastMessage && (
          <div className="floor-picker-toast" role="status" aria-live="polite">
            {toastMessage}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="floor-picker-container">
        <button
          ref={triggerRef}
          type="button"
          className={`standard-dropdown standard-dropdown-sm standard-dropdown-ghost floor-picker-trigger ${isOpen ? 'floor-picker-trigger-open' : ''}`}
          onClick={() => {
            if (!isOpen) setNewFloorZInput('');
            setIsOpen(!isOpen);
          }}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          title="Current floor"
        >
          <span className="floor-picker-trigger-label" title={currentFloor ? floorLabel(currentFloor.zIndex) : floorLabel(currentFloorZ)}>
            {currentFloor ? floorLabel(currentFloor.zIndex) : floorLabel(currentFloorZ)}
          </span>
          {floorStackWarningsByFloorId.size > 0 ? (
            <ValidationIndicator
              hasIssues
              issues={[FLOOR_STACK_WARNING]}
              variant="warning"
              size="small"
            />
          ) : null}
        </button>
        {typeof window !== 'undefined' && dropdownElement ? ReactDOM.createPortal(dropdownElement, document.body) : null}
      </div>

      <DeleteConfirmModal
        isOpen={pendingDeleteFloor !== null}
        onClose={() => setPendingDeleteFloor(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Floor"
        message={
          pendingDeleteFloor && pendingDeleteFloor.elementCount > 0
            ? `Are you sure you want to delete ${floorLabel(pendingDeleteFloor.floor.zIndex)}? This will also delete ${floorCountLabel(pendingDeleteFloor.elementCount)} on this floor.`
            : `Are you sure you want to delete ${pendingDeleteFloor ? floorLabel(pendingDeleteFloor.floor.zIndex) : 'this floor'}?`
        }
        itemName={pendingDeleteFloor ? floorLabel(pendingDeleteFloor.floor.zIndex) : ''}
        itemType="element"
        itemTypeLabel="floor"
        childElements={pendingDeleteFloor?.childElements ?? []}
        actionButtonText="Delete"
      />
    </>
  );
};
