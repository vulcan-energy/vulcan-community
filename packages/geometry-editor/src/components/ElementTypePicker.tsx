// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import type { ElementType } from '../geometry/types';
import {
  getElementTypeMenuOption,
  getElementTypeMenuSections,
  getElementTypeSectionId,
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
