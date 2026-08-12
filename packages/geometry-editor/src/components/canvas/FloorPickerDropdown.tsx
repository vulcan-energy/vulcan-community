// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { DeleteConfirmModal } from '../DeleteConfirmModal';
import { DraftSafeNumberInput } from '../DraftSafeNumberInput';
import { getElementCanvasFloorZValue } from '../../lib/elementCanvasFloor';
import type { Element, Floor } from '../../geometry/types';
import {
  BASE_HEIGHT_AUTOSYNC_TOLERANCE_M,
  getCumulativeBaseHeightsByFloorId,
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
   * actions: typing a base height (sets override) and clicking the stale-override warning
   * (clears override, snaps to walls).
   */
  onUpdateFloor?: (floorId: string, updates: Partial<Floor>) => void;
  addDisabled?: boolean;
}

type FloorRow = {
  floor: Floor;
  elementCount: number;
  childElements: Array<{ name: string; type: string }>;
};

const TOAST_DURATION_MS = 2400;

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
  addDisabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [newFloorZInput, setNewFloorZInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, bottom: 0, width: 0 });
  const [pendingDeleteFloor, setPendingDeleteFloor] = useState<FloorRow | null>(null);
  // Per-row base-height drafts so users can type freely; commit to store on blur/Enter.
  const [baseDrafts, setBaseDrafts] = useState<Record<string, string>>({});
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

  // All elements, used by the effective-storey helpers (max wall height, override resolution).
  const allElements = useMemo(() => Object.values(elementsById), [elementsById]);

  /** Cumulative base height (slab elevation) per floor id — what the dropdown actually displays. */
  const baseHeightsByFloorId = useMemo(
    () => getCumulativeBaseHeightsByFloorId(floors, allElements),
    [floors, allElements],
  );

  /**
   * Per-floor wall-derived + effective storey heights, computed once per (floors, elements) change.
   * Without this, every floor row would re-walk `allElements` twice (max wall height + effective
   * storey) when checking the stale-override warning — O(rows × elements) per render. With the map,
   * it's O(floors × elements) once.
   */
  const heightsByFloorId = useMemo(() => {
    const m = new Map<string, { wallHeight: number; effective: number }>();
    for (const floor of floors) {
      m.set(floor.id, {
        wallHeight: getMaxLineWallHeightOnFloor(floor.zIndex, allElements),
        effective: getEffectiveStoreyHeight(floor, allElements),
      });
    }
    return m;
  }, [floors, allElements]);

  const floorRows = useMemo<FloorRow[]>(() => {
    return sortedFloors.map((floor) => {
      const childElements = Object.values(elementsById)
        .filter((element) => {
          const floorZ = getElementCanvasFloorZValue(element, floors);
          return floorZ === floor.zIndex || element.floorId === floor.id;
        })
        .map((element) => ({
          name: element.name || 'Unnamed',
          type: element.type || 'Element',
        }));

      return {
        floor,
        elementCount: childElements.length,
        childElements,
      };
    });
  }, [elementsById, floors, sortedFloors]);

  /**
   * Commit a typed base-height value for a row. The dropdown shows *base* (slab elevation), but
   * the storey height that determines it is stored on the adjacent floor: for upper floors that
   * is the floor below, while basement rows own their own below-ground storey height. Auto-clears
   * the override flag when the resulting storey matches the wall-derived height.
   */
  const commitBaseHeight = useCallback(
    (rowFloor: Floor) => {
      const rowKey = rowFloor.id;
      const draft = baseDrafts[rowKey];
      setBaseDrafts((prev) => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
      if (draft === undefined) return;
      const parsed = Number.parseFloat(draft);
      if (!Number.isFinite(parsed)) return;
      const rounded = Math.round(parsed * 100) / 100;

      const ownerFloor =
        rowFloor.zIndex > 0
          ? sortedFloors.find((f) => f.zIndex === rowFloor.zIndex - 1)
          : rowFloor.zIndex < 0
            ? rowFloor
            : undefined;
      if (!ownerFloor) return;

      const adjacentBase =
        rowFloor.zIndex > 0
          ? baseHeightsByFloorId.get(ownerFloor.id) ?? 0
          : baseHeightsByFloorId.get(sortedFloors.find((f) => f.zIndex === rowFloor.zIndex + 1)?.id ?? '') ?? 0;
      const rawStorey =
        rowFloor.zIndex > 0
          ? rounded - adjacentBase
          : adjacentBase - rounded;
      const targetStorey = Math.max(0, Math.round(rawStorey * 100) / 100);
      const wallDerived = getMaxLineWallHeightOnFloor(ownerFloor.zIndex, allElements);
      const matchesWalls =
        wallDerived > 0 && Math.abs(wallDerived - targetStorey) <= BASE_HEIGHT_AUTOSYNC_TOLERANCE_M;

      onUpdateFloor?.(ownerFloor.id, {
        height: targetStorey,
        heightUserOverride: !matchesWalls,
      });
    },
    [baseDrafts, sortedFloors, baseHeightsByFloorId, allElements, onUpdateFloor],
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
        {floorRows.length === 0 ? (
          <div className="floor-picker-empty">No floors yet.</div>
        ) : (
          floorRows.map((row) => {
            const isActive = row.floor.zIndex === currentFloorZ;
            // Internal z=0 is FHS Floor 1 and anchors the ground/base reference.
            const baseAtThisFloor = baseHeightsByFloorId.get(row.floor.id) ?? 0;
            const isGroundReference = row.floor.zIndex === 0;
            const baseDraft = baseDrafts[row.floor.id];
            const baseValueDisplay = baseDraft ?? formatMetres(baseAtThisFloor);

            // Stale-override detection — the row "owns" the storey height of the floor below,
            // while a basement row owns its own storey height below the next floor up.
            const ownerFloor =
              row.floor.zIndex > 0
                ? sortedFloors.find((f) => f.zIndex === row.floor.zIndex - 1)
                : row.floor.zIndex < 0
                  ? row.floor
                  : undefined;
            const ownerHeights = ownerFloor ? heightsByFloorId.get(ownerFloor.id) : undefined;
            const ownerWallHeight = ownerHeights?.wallHeight ?? 0;
            const ownerEffective = ownerHeights?.effective ?? 0;
            const ownerOverrideStale = !!(
              ownerFloor &&
              ownerFloor.heightUserOverride === true &&
              ownerWallHeight > 0 &&
              Math.abs(ownerWallHeight - ownerEffective) > BASE_HEIGHT_AUTOSYNC_TOLERANCE_M
            );
            const baseIfSnapped = ownerFloor && row.floor.zIndex > 0
              ? (baseHeightsByFloorId.get(ownerFloor.id) ?? 0) + ownerWallHeight
              : ownerFloor && row.floor.zIndex < 0
                ? (baseHeightsByFloorId.get(sortedFloors.find((f) => f.zIndex === row.floor.zIndex + 1)?.id ?? '') ?? 0) - ownerWallHeight
                : baseAtThisFloor;
            const staleTitle = ownerOverrideStale
              ? `Walls suggest ${formatMetres(baseIfSnapped)} m for ${floorLabel(row.floor.zIndex)}; override is ${formatMetres(baseAtThisFloor)} m. Click to reset.`
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
                    </div>
                  </div>
                </button>
                {ownerOverrideStale && ownerFloor ? (
                  <button
                    type="button"
                    className="floor-picker-override-warning"
                    title={staleTitle}
                    aria-label={`Reset ${floorLabel(row.floor.zIndex)} base height to wall-derived value`}
                    onClick={(event) => {
                      event.stopPropagation();
                      snapFloorToWalls(ownerFloor);
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
                    className={`floor-picker-height-shell ${isGroundReference ? 'floor-picker-height-shell-readonly' : ''}`}
                    title={
                      isGroundReference
                        ? `${floorLabel(row.floor.zIndex)} is the ground-floor reference (base = 0 m)`
                        : `Base height (slab elevation) of ${floorLabel(row.floor.zIndex)}, in metres`
                    }
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DraftSafeNumberInput
                      step="0.05"
                      min={row.floor.zIndex < 0 ? undefined : 0}
                      className="floor-picker-height-input"
                      aria-label={`Base height for ${floorLabel(row.floor.zIndex)} in metres`}
                      value={baseValueDisplay}
                      readOnly={isGroundReference}
                      disabled={isGroundReference}
                      onChange={(event) =>
                        setBaseDrafts((prev) => ({ ...prev, [row.floor.id]: event.target.value }))
                      }
                      onBlur={() => {
                        if (!isGroundReference) commitBaseHeight(row.floor);
                      }}
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
                <button
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
                </button>
              </div>
            );
          })
        )}
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
