// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import './HideElementsDropdown.css';
import type { Element } from '../../stores/geometryStore';
import {
  ELEMENT_CATEGORY_GHOST_OPTIONS,
  type ElementCategoryGhostKey,
  type ElementCategoryGhostState,
} from '../../lib/elementCategoryVisibility';

type HideElementsDropdownProps = {
  categoryGhost: ElementCategoryGhostState;
  onToggle: (key: ElementCategoryGhostKey) => void;
  hiddenElementIds: ReadonlySet<string>;
  elementsById: Record<string, Element>;
  onUnhideElement: (id: string) => void;
  buttonText?: string;
};

export const HideElementsDropdown: React.FC<HideElementsDropdownProps> = ({
  categoryGhost,
  onToggle,
  hiddenElementIds,
  elementsById,
  onUnhideElement,
  buttonText = 'Hide Elements',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const hiddenCategoryCount = Object.values(categoryGhost).filter(Boolean).length;
  const individualHiddenCount = hiddenElementIds.size;
  const totalHiddenCount = hiddenCategoryCount + individualHiddenCount;

  const buttonLabel =
    totalHiddenCount > 0
      ? `${buttonText} (${totalHiddenCount} hidden on view)`
      : buttonText;

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setDropdownPosition({ x: r.left, y: r.bottom + 8 });
    setIsPositioned(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(updatePosition, 0);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      clearTimeout(t);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const sortedIndividualIds = useMemo(() => [...hiddenElementIds].sort(), [hiddenElementIds]);

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      className="files-dropdown hide-elements-dropdown"
      style={{
        left: isPositioned ? dropdownPosition.x : -9999,
        top: isPositioned ? dropdownPosition.y : -9999,
        position: 'fixed',
        zIndex: 10000,
        opacity: isPositioned ? 1 : 0,
        pointerEvents: isPositioned ? 'auto' : 'none',
        maxHeight: 'min(70vh, 420px)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <div className="files-dropdown-content hide-elements-dropdown__content" style={{ overflowY: 'auto', flex: 1 }}>
        <div className="hide-elements-dropdown__section-title">
          By category
        </div>
        {ELEMENT_CATEGORY_GHOST_OPTIONS.map(({ key, label }) => (
          <label
            key={key}
            className="files-dropdown-item hide-elements-dropdown__row"
            onClick={(e) => e.stopPropagation()}
          >
            <input type="checkbox" checked={categoryGhost[key]} onChange={() => onToggle(key)} />
            <span style={{ fontSize: 11, flex: 1, minWidth: 0 }}>{label}</span>
          </label>
        ))}

        <div className="hide-elements-dropdown__divider" />

        <div className="hide-elements-dropdown__section-title">
          Hidden individually ({individualHiddenCount})
        </div>
        {individualHiddenCount === 0 ? (
          <div className="hide-elements-dropdown__empty">No elements hidden from the list.</div>
        ) : (
          sortedIndividualIds.map((id) => {
            const el = elementsById[id];
            const label = el?.name || el?.type || id;
            return (
              <label
                key={id}
                className="files-dropdown-item hide-elements-dropdown__row"
                title={`${label} — unchecked shows on canvas`}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked
                  onChange={(e) => {
                    if (!e.target.checked) onUnhideElement(id);
                  }}
                />
                <span className="hide-elements-dropdown__individual-label">{label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="hide-control-button-wrap">
      <button
        type="button"
        ref={buttonRef}
        className={`draw-button hide-elements-button hide-control-button${totalHiddenCount > 0 ? ' hide-elements-button--active' : ''}`}
        aria-expanded={isOpen}
        aria-label={buttonLabel}
        onClick={() => {
          if (!isOpen) setIsPositioned(false);
          setIsOpen(!isOpen);
        }}
      >
        <span className="hide-elements-button__label">{buttonText}</span>
        {totalHiddenCount > 0 ? (
          <span aria-hidden="true" className="hide-elements-count">
            {totalHiddenCount}
          </span>
        ) : null}
      </button>
      {typeof document !== 'undefined' && dropdown ? ReactDOM.createPortal(dropdown, document.body) : null}
    </div>
  );
};
