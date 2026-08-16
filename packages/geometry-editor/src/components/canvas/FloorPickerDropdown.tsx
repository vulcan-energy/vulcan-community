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
  FLOOR_STACK_WARNING_FIELD_KEY,
  FLOOR_STACK_WARNING_MESSAGE,
} from '../../geometry/validation/validateElement';
import {
  getCumulativeBaseHeightsByFloorId,
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
   * Apply a floor patch (`height` + `heightUserOverride`) when the user edits a floor base height.
   */
  onUpdateFloor?: (floorId: string, updates: Partial<Floor>) => void;
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
const FLOOR_STACK_WARNING = FLOOR_STACK_WARNING_MESSAGE;

function isFloorStackWarning(warning: ValidationIssue): boolean {
  return warning.source === 'geometry' && warning.fieldKey === FLOOR_STACK_WARNING_FIELD_KEY;
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
  getElementValidation,
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

  // Ground is the default drawing floor even before the first element has been created. Keep a
  // synthetic row in the picker until the store creates the real record via selection or editing.
  const pickerFloors = useMemo(() => {
    if (sortedFloors.some((floor) => floor.zIndex === 0)) return sortedFloors;
    return [
      { id: '__ground-floor-placeholder__', name: '0', zIndex: 0, height: 0, isRoofSpace: false },
      ...sortedFloors,
    ];
  }, [sortedFloors]);

  // All elements, used by strict floor-stack derivation.
  const allElements = useMemo(() => Object.values(elementsById), [elementsById]);

  const baseHeightsByFloorId = useMemo(() => {
    const baseHeights = getCumulativeBaseHeightsByFloorId(sortedFloors, allElements);
    // The synthetic ground row is a real zero elevation for display, but it must not make a
    // missing real lower floor look resolvable when calculating the base of an upper floor.
    if (!sortedFloors.some((floor) => floor.zIndex === 0)) {
      baseHeights.set('__ground-floor-placeholder__', 0);
    }
    return baseHeights;
  }, [sortedFloors, allElements]);

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
   * Commit a typed base height by changing the adjacent storey's stored height. Floor 0 is the
   * model datum (base 0) and is intentionally read-only; an upper floor's base is controlled by
   * the storey immediately below it, while a basement floor's base is controlled by itself.
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
      if (rowFloor.zIndex === 0) return;
      const parsed = Number.parseFloat(draft);
      if (!Number.isFinite(parsed)) return;
      const roundedBase = Math.round(parsed * 100) / 100;
      const floorAtZ = (zIndex: number): Floor | undefined =>
        sortedFloors.find((floor) => floor.zIndex === zIndex);
      const baseAtZ = (zIndex: number): number | null => {
        if (zIndex === 0) return 0;
        const floor = floorAtZ(zIndex);
        return floor ? baseHeightsByFloorId.get(floor.id) ?? null : null;
      };

      const targetFloor = rowFloor.zIndex > 0
        ? floorAtZ(rowFloor.zIndex - 1)
        : rowFloor;
      const referenceBase = rowFloor.zIndex > 0
        ? baseAtZ(rowFloor.zIndex - 1)
        : baseAtZ(rowFloor.zIndex + 1);
      if (!targetFloor || referenceBase === null) {
        setToastMessage('Base height is unresolved until the adjacent floor is set');
        return;
      }

      const targetStoreyHeight = rowFloor.zIndex > 0
        ? roundedBase - referenceBase
        : referenceBase - roundedBase;
      if (!Number.isFinite(targetStoreyHeight) || targetStoreyHeight <= 0) {
        setToastMessage(
          rowFloor.zIndex > 0
            ? 'Base height must be above the floor below'
            : 'Base height must be below the floor above',
        );
        return;
      }

      onUpdateFloor?.(targetFloor.id, {
        height: Math.round(targetStoreyHeight * 100) / 100,
        heightUserOverride: true,
      });
    },
    [baseDrafts, sortedFloors, baseHeightsByFloorId, onUpdateFloor],
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
            const baseElevation = baseHeightsByFloorId.get(row.floor.id) ?? null;
            const baseDraft = baseDrafts[row.floor.id];
            const baseValueDisplay = baseDraft ?? (baseElevation === null ? '' : formatMetres(baseElevation));
            const hasFloorStackWarning = floorStackWarningsByFloorId.has(row.floor.id);

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
                {onUpdateFloor ? (
                  row.floor.zIndex === 0 ? (
                    <div
                      className="floor-picker-height-shell floor-picker-height-shell-readonly"
                    >
                      <span className="floor-picker-metric-label">Base</span>
                      <span
                        className="floor-picker-metric-value"
                        title={`Base height of ${floorLabel(row.floor.zIndex)}, in metres`}
                        aria-label={`Base height of ${floorLabel(row.floor.zIndex)} in metres`}
                      >
                        {baseElevation === null ? '—' : formatMetres(baseElevation)}
                        {' m'}
                      </span>
                    </div>
                  ) : (
                    <label
                      className="floor-picker-height-shell"
                      title={`Base height of ${floorLabel(row.floor.zIndex)}, in metres`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="floor-picker-metric-label">Base</span>
                      <DraftSafeNumberInput
                        step="0.05"
                        className="floor-picker-height-input"
                        aria-label={`Base height for ${floorLabel(row.floor.zIndex)} in metres`}
                        value={baseValueDisplay}
                        placeholder="—"
                        onChange={(event) =>
                          setBaseDrafts((prev) => ({ ...prev, [row.floor.id]: event.target.value }))
                        }
                        onBlur={() => commitBaseHeight(row.floor)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            (event.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <span className="floor-picker-height-unit">m</span>
                    </label>
                  )
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
