// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import './HideElementsDropdown.css';

export type HidePanelKey = 'file' | 'compass' | 'drawToolbar' | `contribution:${string}`;

export type HidePanelOption = {
  key: HidePanelKey;
  label: string;
  available?: boolean;
};

type HidePanelsDropdownProps = {
  panelOptions: readonly HidePanelOption[];
  hiddenPanelKeys: ReadonlySet<HidePanelKey>;
  onTogglePanel: (key: HidePanelKey) => void;
  onHideAll: (keys: readonly HidePanelKey[]) => void;
  onShowAll: (keys: readonly HidePanelKey[]) => void;
};

export const HidePanelsDropdown: React.FC<HidePanelsDropdownProps> = ({
  panelOptions,
  hiddenPanelKeys,
  onTogglePanel,
  onHideAll,
  onShowAll,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const availableOptions = useMemo(
    () => panelOptions.filter((option) => option.available !== false),
    [panelOptions],
  );
  const availableKeys = useMemo(() => availableOptions.map((option) => option.key), [availableOptions]);
  const hiddenCount = availableOptions.filter((option) => hiddenPanelKeys.has(option.key)).length;
  const allHidden = availableOptions.length > 0 && hiddenCount === availableOptions.length;

  const buttonLabel =
    hiddenCount > 0
      ? `Panels (${hiddenCount} hidden)`
      : 'Panels';

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

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      className="files-dropdown hide-elements-dropdown hide-panels-dropdown"
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
        <div className="hide-panels-dropdown__actions">
          <button
            type="button"
            className="files-dropdown-action-pill"
            onClick={() => {
              if (allHidden) {
                onShowAll(availableKeys);
              } else {
                onHideAll(availableKeys);
              }
            }}
          >
            {allHidden ? 'Show all panels' : 'Hide all panels'}
          </button>
        </div>

        <div className="hide-elements-dropdown__divider" />

        {availableOptions.map(({ key, label }) => {
          const hidden = hiddenPanelKeys.has(key);
          return (
            <label
              key={key}
              className="files-dropdown-item hide-elements-dropdown__row"
              onClick={(e) => e.stopPropagation()}
            >
              <input type="checkbox" checked={hidden} onChange={() => onTogglePanel(key)} />
              <span style={{ fontSize: 11, flex: 1, minWidth: 0 }}>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div className="hide-control-button-wrap">
      <button
        type="button"
        ref={buttonRef}
        className={`draw-button hide-elements-button hide-control-button${hiddenCount > 0 ? ' hide-elements-button--active' : ''}`}
        aria-expanded={isOpen}
        aria-label={buttonLabel}
        onClick={() => {
          if (!isOpen) setIsPositioned(false);
          setIsOpen(!isOpen);
        }}
      >
        <span className="hide-elements-button__label">Panels</span>
        {hiddenCount > 0 ? (
          <span aria-hidden="true" className="hide-elements-count">
            {hiddenCount}
          </span>
        ) : null}
      </button>
      {typeof document !== 'undefined' && dropdown ? ReactDOM.createPortal(dropdown, document.body) : null}
    </div>
  );
};
