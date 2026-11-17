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
  getStoreyHeight,
  getStrictStoreyHeight,
} from '../../lib/zoneDerivation';
import { isStoreyCopyElement, isUnderRoof } from '../../lib/storeyCopy';
import {
  canvasFloorToFhsStorey,
  fhsFloorCodeForCanvasFloor,
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
  /** "Copy of F2": copy storey `fromZ` onto the new storey `toZ`. */
  onCopyFloor?: (fromZ: number, toZ: number) => void;
  onDeleteFloor: (id: string) => void;
  /**
   * Apply a floor patch when the user edits a floor's base (`baseHeight` + `baseHeightUserOverride`)
   * or height (`height` + `heightUserOverride`).
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
  onCopyFloor,
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
  // Per-row drafts (keyed `base:<id>` / `height:<id>`) so users can type freely; commit to store on blur/Enter.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
   * Commit a typed base or height to the edited floor. A number is the floor's own; an emptied
   * field goes back to the derived value (the placeholder).
   */
  const commitFloorValue = useCallback(
    (rowFloor: Floor, field: 'base' | 'height') => {
      const key = `${field}:${rowFloor.id}`;
      const draft = drafts[key];
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (draft === undefined) return;
      const existing = sortedFloors.find((floor) => floor.zIndex === rowFloor.zIndex);
      if (draft.trim() === '') {
        if (!existing) return;
        onUpdateFloor?.(existing.id, field === 'base' ? { baseHeightUserOverride: false } : { heightUserOverride: false });
        return;
      }
      const parsed = Number.parseFloat(draft);
      if (!Number.isFinite(parsed) || (field === 'height' && parsed <= 0)) return;
      const rounded = Math.round(parsed * 100) / 100;
      const targetFloorId = existing?.id ?? onEnsureFloorForZ?.(rowFloor.zIndex);
      if (!targetFloorId) {
        setToastMessage(`${field === 'base' ? 'Base' : 'Height'} cannot be saved until this floor exists`);
        return;
      }
      onUpdateFloor?.(
        targetFloorId,
        field === 'base'
          ? { baseHeight: rounded, baseHeightUserOverride: true }
          : { height: rounded, heightUserOverride: true },
      );
    },
    [drafts, sortedFloors, onEnsureFloorForZ, onUpdateFloor],
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

  // "from the storey · F1" in a wall's Height opens the picker.
  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener('open-floor-picker', open);
    return () => window.removeEventListener('open-floor-picker', open);
  }, []);

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

  // "Copy of F2" is offered for the storey above an existing one with something to copy, unless a
  // roof rises through the new storey's floor (it is the roof space).
  const copySourceZ = pendingAddTargetZ - 1;
  const copySourceFloor = sortedFloors.find((floor) => floor.zIndex === copySourceZ);
  const canCopy = useMemo(() => {
    if (!onCopyFloor || pendingAddExists || pendingAddTargetZ <= 0 || !copySourceFloor) return false;
    const copyable = allElements.filter((element) =>
      isStoreyCopyElement(element) && getElementCanvasFloorZValue(element, floors) === copySourceZ);
    if (copyable.length === 0) return false;
    // The new storey's base as the floor stack places it.
    const sourceBase = baseHeightsByFloorId.get(copySourceFloor.id);
    const sourceHeight = getStrictStoreyHeight(copySourceFloor, allElements);
    const targetBase = typeof sourceBase === 'number' && sourceHeight > 0 ? sourceBase + sourceHeight : null;
    return targetBase === null || !isUnderRoof(targetBase, allElements, copyable);
  }, [onCopyFloor, pendingAddExists, pendingAddTargetZ, copySourceFloor, allElements, floors, copySourceZ, baseHeightsByFloorId]);

  const handleAddFloor = (copy: boolean) => {
    if (pendingAddExists) {
      setToastMessage(`${pendingAddLabel} already exists`);
      return;
    }
    if (copy) onCopyFloor?.(copySourceZ, pendingAddTargetZ);
    else onAddFloor(pendingAddTargetZ);
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
        width: Math.max(position.width, 440),
      }}
    >
      <div className="floor-picker-list" role="listbox" aria-label="Floors">
        {floorRows.map((row) => {
            const isActive = row.floor.zIndex === currentFloorZ;
            const isPlaceholderFloor = !sortedFloors.some((floor) => floor.id === row.floor.id);
            const baseElevation = baseHeightsByFloorId.get(row.floor.id) ?? null;
            // A typed value shows as the value; a derived one as the placeholder. Ground's 0 is the datum.
            const baseTyped = row.floor.baseHeightUserOverride === true && Number.isFinite(row.floor.baseHeight)
              ? formatMetres(row.floor.baseHeight!)
              : row.floor.zIndex === 0 && baseElevation === 0 ? '0' : '';
            const storeyHeight = getStoreyHeight(row.floor.zIndex, floors, allElements);
            const heightTyped = row.floor.heightUserOverride === true && row.floor.height > 0 ? formatMetres(row.floor.height) : '';
            const hasFloorStackWarning = floorStackWarningsByFloorId.has(row.floor.id);
            const metric = (field: 'base' | 'height', typed: string, derived: number | null) => {
              const name = field === 'base' ? 'Base' : 'Height';
              const key = `${field}:${row.floor.id}`;
              return (
                <label
                  className="floor-picker-height-shell"
                  title={`${name} of ${floorLabel(row.floor.zIndex)}, in metres`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="floor-picker-metric-label">{name}</span>
                  <DraftSafeNumberInput
                    step="0.05"
                    className="floor-picker-height-input"
                    aria-label={`${field === 'base' ? 'Base height' : 'Storey height'} for ${floorLabel(row.floor.zIndex)} in metres`}
                    value={drafts[key] ?? typed}
                    placeholder={derived === null || (field === 'height' && derived <= 0) ? '—' : formatMetres(derived)}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                    onBlur={() => commitFloorValue(row.floor, field)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        (event.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <span className="floor-picker-height-unit">m</span>
                </label>
              );
            };

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
                  <>
                    {metric('base', baseTyped, baseElevation)}
                    {metric('height', heightTyped, storeyHeight)}
                  </>
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
          <label
            className={`floor-picker-add-label ${addDisabled ? 'floor-picker-input-shell-disabled' : ''}`}
            title="FHS floor number: F1 is ground, F0 is basement 1"
          >
            Add F
            <DraftSafeNumberInput
              ref={addInputRef}
              inputMode="numeric"
              className="floor-picker-input"
              value={newFloorZInput}
              onChange={(event) => setNewFloorZInput(event.target.value)}
              placeholder={String(suggestedNextStorey)}
              aria-label="FHS floor number to add"
              disabled={addDisabled}
              style={{ width: `${Math.max(1, (newFloorZInput || String(suggestedNextStorey)).length) + 0.5}ch` }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !addDisabled) {
                  event.preventDefault();
                  handleAddFloor(false);
                }
              }}
            />
          </label>
          <span className="floor-picker-add-preview floor-picker-add-preview-existing">
            {pendingAddExists ? `${pendingAddLabel} exists` : null}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm floor-picker-add-button"
            onClick={() => handleAddFloor(false)}
            disabled={addDisabled}
            title={addDisabled ? 'Add floor is unavailable in 3D view' : `Add ${pendingAddLabel}, empty`}
          >
            Empty
          </button>
          {canCopy ? (
            <button
              type="button"
              className="btn btn-primary btn-sm floor-picker-add-button"
              onClick={() => handleAddFloor(true)}
              disabled={addDisabled}
              title={addDisabled ? 'Add floor is unavailable in 3D view' : `Add ${pendingAddLabel} as a copy of ${fhsFloorCodeForCanvasFloor(copySourceZ)}`}
            >
              {`Copy of ${fhsFloorCodeForCanvasFloor(copySourceZ)}`}
            </button>
          ) : null}
        </div>
        {canCopy ? (
          <div className="floor-picker-note">
            The copy takes the walls, windows and doors in place. Floors, ceilings and roofs are not copied.
          </div>
        ) : null}
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
