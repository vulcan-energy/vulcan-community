// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import type { ElementType } from '../geometry/types';
import {
  getElementTypeMenuOption,
  getElementTypeMenuSections,
  getElementTypeSectionId,
  type ElementTypeDiagramKind,
  type ElementTypeSectionId,
} from '../lib/elementTypeMetadata';
import './ElementTypePicker.css';

type ElementTypePickerProps = {
  value: ElementType;
  options: readonly ElementType[];
  onChange: (type: ElementType) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const MENU_MARGIN = 8;
const MENU_MIN_WIDTH = 390;
const MENU_MAX_WIDTH = 480;

function pathForDiagram(kind: ElementTypeDiagramKind): React.ReactNode {
  switch (kind) {
    case 'surface':
      return (
        <>
          <path d="M7 36h34" />
          <path className="diagram-fill" d="M12 32V15l12-8 12 8v17z" />
          <path d="M12 32V15l12-8 12 8v17" />
          <path d="M17 32V20h14v12" />
          <path className="diagram-emphasis" d="M12 15l12-8 12 8M12 15v17M36 15v17" />
          <path className="diagram-heat-flow" d="M5 23h7M9 20l-4 3 4 3" />
        </>
      );
    case 'window':
      return (
        <>
          <path d="M10 8v32M38 8v32" />
          <rect className="diagram-fill" x="16" y="12" width="16" height="24" rx="1.5" />
          <rect x="16" y="12" width="16" height="24" rx="1.5" />
          <path d="M24 12v24M16 24h16" />
          <path className="diagram-hatch" d="M19 16l4-4M27 36l5-5" />
        </>
      );
    case 'floor':
      return (
        <>
          <path className="diagram-fill" d="M8 23h32v7H8z" />
          <path d="M8 23h32v7H8z" />
          <path d="M7 35h34" />
          <path className="diagram-hatch" d="M11 38l4-3M18 38l4-3M25 38l4-3M32 38l4-3" />
          <path d="M12 19h24" />
        </>
      );
    case 'internal':
      return (
        <>
          <rect className="diagram-fill" x="7" y="12" width="34" height="24" rx="2" />
          <rect x="7" y="12" width="34" height="24" rx="2" />
          <path className="diagram-emphasis" d="M24 12v24" />
          <path d="M12 19h8M28 19h8M12 30h8M28 30h8" />
          <path className="diagram-heat-flow" d="M19 24h-7M29 24h7" />
        </>
      );
    case 'unheated':
      return (
        <>
          <rect x="7" y="12" width="34" height="24" rx="2" />
          <path className="diagram-emphasis" d="M24 12v24" />
          <path d="M12 19h7M12 29h7" />
          <path className="diagram-dashed" d="M30 16h7M30 22h7M30 28h7M30 34h7" />
        </>
      );
    case 'party-wall':
      return (
        <>
          <path d="M7 36h34" />
          <path d="M8 36V20l10-8 6 6v18" />
          <path d="M40 36V20l-10-8-6 6v18" />
          <path className="diagram-emphasis" d="M24 18v18" />
          <path d="M12 26h7M29 26h7" />
        </>
      );
    case 'linear-bridge':
      return (
        <>
          <path d="M10 34h28M16 12v22M16 18h22" />
          <path className="diagram-emphasis" d="M16 18h20" />
        </>
      );
    case 'point-bridge':
      return (
        <>
          <path d="M10 34h28M16 12v22M16 18h22" />
          <circle className="diagram-fill" cx="16" cy="17" r="6" />
          <circle className="diagram-emphasis" cx="16" cy="17" r="6" />
        </>
      );
    case 'window-shading':
      return (
        <>
          <rect x="16" y="13" width="16" height="23" rx="1.5" />
          <path d="M24 13v23M16 24h16" />
          <path className="diagram-fill" d="M12 9h24l-5 7H17z" />
          <path className="diagram-emphasis" d="M12 9h24l-5 7H17z" />
          <path d="M14 18v8M34 18v8" />
        </>
      );
    case 'context-shading':
      return (
        <>
          <path d="M7 36h34" />
          <path d="M12 36V22h10v14M30 36V11h8v25" />
          <circle cx="16" cy="15" r="4" />
          <path className="diagram-heat-flow" d="M16 8V4M10 11L7 8" />
          <path className="diagram-fill" d="M30 22L40 36H17z" />
        </>
      );
    case 'ventilation-system':
      return (
        <>
          <circle className="diagram-fill" cx="24" cy="24" r="13" />
          <circle cx="24" cy="24" r="13" />
          <circle cx="24" cy="24" r="3" />
          <path className="diagram-emphasis" d="M24 21V12" />
          <path className="diagram-emphasis" d="M27 25l8 5" />
          <path className="diagram-emphasis" d="M21 26l-8 5" />
        </>
      );
    case 'ductwork':
      return (
        <>
          <path className="diagram-emphasis" d="M7 24h34" />
          <path className="diagram-dashed" d="M12 16h24M12 32h24" />
          <path className="diagram-heat-flow" d="M34 21l7 3-7 3" />
        </>
      );
    case 'terminal':
      return (
        <>
          <path d="M10 8v32" />
          <rect className="diagram-fill" x="14" y="16" width="14" height="16" rx="2" />
          <rect x="14" y="16" width="14" height="16" rx="2" />
          <path d="M17 20h8M17 24h8M17 28h8" />
          <path className="diagram-emphasis" d="M28 20h12M28 28h12" />
          <path d="M40 20v8" />
          <path className="diagram-heat-flow" d="M33 24h7M37 21l3 3-3 3" />
        </>
      );
    case 'vent':
      return (
        <>
          <path d="M12 8v32" />
          <rect className="diagram-fill" x="18" y="16" width="14" height="16" rx="2" />
          <rect x="18" y="16" width="14" height="16" rx="2" />
          <path d="M21 20h8M21 24h8M21 28h8" />
          <path className="diagram-heat-flow" d="M32 24h8M37 21l3 3-3 3" />
        </>
      );
    case 'system':
      return (
        <>
          <rect className="diagram-fill" x="13" y="8" width="22" height="28" rx="3" />
          <rect x="13" y="8" width="22" height="28" rx="3" />
          <path d="M18 14h12" />
          <circle className="diagram-emphasis" cx="24" cy="25" r="5" />
          <path d="M19 36v6M29 36v6" />
          <path d="M15 42h8M25 42h8" />
        </>
      );
    case 'emitter':
      return (
        <>
          <rect x="9" y="17" width="30" height="17" rx="2" />
          <path d="M15 17v17M21 17v17M27 17v17M33 17v17" />
          <path className="diagram-heat-flow" d="M14 12c-2-2-2-4 0-6M24 12c-2-2-2-4 0-6M34 12c-2-2-2-4 0-6" />
        </>
      );
    case 'hot-water':
      return (
        <>
          <path className="diagram-emphasis" d="M11 19h23" />
          <path d="M34 19v8h-8" />
          <path d="M23 19v-8" />
          <path d="M17 11h12" />
          <path d="M15 27h11" />
          <path className="diagram-fill" d="M38 39c0 5-7 5-7 0 0-3 3.5-7 3.5-7s3.5 4 3.5 7z" />
          <path d="M38 39c0 5-7 5-7 0 0-3 3.5-7 3.5-7s3.5 4 3.5 7z" />
        </>
      );
    case 'pipework':
      return (
        <>
          <path className="diagram-emphasis" d="M8 14h20v10h12" />
          <path className="diagram-emphasis" d="M8 34h20V24h12" />
          <path d="M8 10v8M8 30v8M40 20v8M40 30v8" />
          <path className="diagram-fill" d="M24 20h8v8h-8z" />
          <path d="M24 20h8v8h-8z" />
        </>
      );
    case 'combustion':
      return (
        <>
          <rect x="12" y="15" width="19" height="22" rx="3" />
          <path d="M31 19h7v-8" />
          <path className="diagram-fill" d="M22 32c4-2 6-5 4-9-2 3-4 1-3-3-4 3-7 6-5 11 1 1 2 2 4 1z" />
          <path d="M22 32c4-2 6-5 4-9-2 3-4 1-3-3-4 3-7 6-5 11 1 1 2 2 4 1z" />
        </>
      );
    case 'lighting':
      return (
        <>
          <path d="M24 6v6" />
          <path className="diagram-fill" d="M17 22a7 7 0 1 1 14 0c0 3-3 5-3 8h-8c0-3-3-5-3-8z" />
          <path d="M17 22a7 7 0 1 1 14 0c0 3-3 5-3 8h-8c0-3-3-5-3-8z" />
          <path d="M20 34h8M21 38h6" />
          <path className="diagram-heat-flow" d="M11 22H6M42 22h-5M14 14l-4-4M34 14l4-4" />
        </>
      );
    case 'appliance':
      return (
        <>
          <rect className="diagram-fill" x="12" y="10" width="24" height="28" rx="4" />
          <rect x="12" y="10" width="24" height="28" rx="4" />
          <path d="M17 16h8" />
          <circle cx="24" cy="29" r="6" />
          <path className="diagram-emphasis" d="M31 15l-4 7h5l-4 6" />
        </>
      );
    case 'solar':
      return (
        <>
          <path className="diagram-heat-flow" d="M12 10l-3-3M19 8V4M26 10l3-3" />
          <circle cx="19" cy="14" r="4" />
          <path className="diagram-fill" d="M12 22h24l4 16H8z" />
          <path d="M12 22h24l4 16H8z" />
          <path d="M18 22l-2 16M24 22v16M30 22l2 16M10 30h28" />
        </>
      );
    case 'battery':
      return (
        <>
          <rect x="10" y="15" width="27" height="18" rx="3" />
          <path d="M37 21h4v6h-4" />
          <path className="diagram-emphasis" d="M24 18l-5 8h7l-4 8" />
          <path d="M15 20v8" />
        </>
      );
  }
}

function ElementTypeDiagram({ kind }: { kind: ElementTypeDiagramKind }) {
  return (
    <svg className="element-type-picker__diagram-svg" viewBox="0 0 48 48" aria-hidden="true">
      {pathForDiagram(kind)}
    </svg>
  );
}

export function ElementTypePicker({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select element type',
  ariaLabel = 'Element type',
  className,
  triggerClassName,
}: ElementTypePickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const sections = useMemo(() => getElementTypeMenuSections(options), [options]);
  const selectedOption = getElementTypeMenuOption(value);
  const selectedSection = sections.find((section) => section.types.includes(value));
  const fallbackSectionId = sections[0]?.id ?? getElementTypeSectionId(value);
  const [expandedSectionId, setExpandedSectionId] = useState<ElementTypeSectionId>(
    selectedSection?.id ?? fallbackSectionId,
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(
      MENU_MAX_WIDTH,
      Math.max(MENU_MIN_WIDTH, rect.width),
      viewportWidth - MENU_MARGIN * 2,
    );
    const below = viewportHeight - rect.bottom - MENU_MARGIN;
    const above = rect.top - MENU_MARGIN;
    const maxHeight = Math.min(520, Math.max(260, Math.max(below, above)));
    const openAbove = below < 320 && above > below;
    const left = Math.min(Math.max(MENU_MARGIN, rect.left), viewportWidth - width - MENU_MARGIN);
    const top = openAbove
      ? Math.max(MENU_MARGIN, rect.top - maxHeight - 4)
      : Math.min(rect.bottom + 4, viewportHeight - MENU_MARGIN);
    setPosition({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  const handleSelect = (type: ElementType) => {
    onChange(type);
    setOpen(false);
    const focusTrigger = () => triggerRef.current?.focus();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusTrigger);
    } else {
      setTimeout(focusTrigger, 0);
    }
  };

  const rootClasses = ['element-type-picker', className].filter(Boolean).join(' ');
  const triggerClasses = [
    'standard-dropdown',
    'standard-dropdown-ghost',
    'element-type-picker__trigger',
    triggerClassName,
  ].filter(Boolean).join(' ');

  const menu = open && position && typeof document !== 'undefined'
    ? ReactDOM.createPortal(
        <div
          ref={menuRef}
          className="element-type-picker__menu"
          role="listbox"
          aria-label={ariaLabel}
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
        >
          {sections.map((section) => {
            const expanded = section.id === expandedSectionId;
            return (
              <div className="element-type-picker__section" key={section.id}>
                <button
                  type="button"
                  className={`element-type-picker__section-button${expanded ? ' is-expanded' : ''}`}
                  aria-expanded={expanded}
                  onClick={() => setExpandedSectionId(section.id)}
                >
                  <span className="element-type-picker__section-text">
                    <span className="element-type-picker__section-label">{section.label}</span>
                    <span className="element-type-picker__section-summary">{section.summary}</span>
                  </span>
                </button>
                {expanded ? (
                  <div className="element-type-picker__options">
                    {section.types.map((type) => {
                      const option = getElementTypeMenuOption(type);
                      const selected = type === value;
                      return (
                        <button
                          type="button"
                          key={type}
                          role="option"
                          aria-selected={selected}
                          className={`element-type-picker__option${selected ? ' is-selected' : ''}`}
                          onClick={() => handleSelect(type)}
                        >
                          <span className="element-type-picker__diagram">
                            <ElementTypeDiagram kind={option.diagram} />
                          </span>
                          <span className="element-type-picker__option-text">
                            <span className="element-type-picker__option-label">{option.label}</span>
                            <span className="element-type-picker__option-subtitle">{option.subtitle}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={rootClasses}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClasses}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${selectedOption.label}: ${selectedOption.subtitle}`}
        onClick={() => {
          if (disabled) return;
          if (!open) setExpandedSectionId(selectedSection?.id ?? fallbackSectionId);
          setOpen(!open);
        }}
      >
        <span className="element-type-picker__trigger-label">
          {selectedOption?.label || placeholder}
        </span>
      </button>
      {menu}
    </div>
  );
}
