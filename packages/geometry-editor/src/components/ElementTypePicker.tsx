// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import type { ElementType } from '../geometry/types';
import {
  ELEMENT_TYPE_ORDER,
  getElementTypeMenuOption,
  getElementTypeMenuSections,
  getElementTypeSectionId,
  type ElementTypeSectionId,
} from '../lib/elementTypeMetadata';
import './ElementTypePicker.css';

type ElementTypePickerProps = {
  /** None when the picker chooses a type for something new. */
  value: ElementType | null;
  options: readonly ElementType[];
  /** Shown on the trigger in place of the type's own name (a Systems row that is not a plant). */
  valueLabel?: string;
  onChange: (type: ElementType) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
  /** Entries that are not element types (a bay, a conservatory), listed after the type they draw. */
  extraOptions?: readonly ElementTypePickerExtra[];
};

export type ElementTypePickerExtra = {
  key: string;
  label: string;
  subtitle: string;
  /** Listed after this type, in its section. */
  after: ElementType;
  selected: boolean;
  onSelect: () => void;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

/** The group of the last type picked for something new: "+ Element" opens on it next time. */
let lastNewTypeSectionId: ElementTypeSectionId | undefined;

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
  valueLabel,
  extraOptions = [],
}: ElementTypePickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const sections = useMemo(() => getElementTypeMenuSections(options), [options]);
  const selectedOption = value ? getElementTypeMenuOption(value) : null;
  const selectedSection = value ? sections.find((section) => section.types.includes(value)) : undefined;
  const lastNewSection = value === null ? sections.find((section) => section.id === lastNewTypeSectionId) : undefined;
  const fallbackSectionId = lastNewSection?.id ?? sections[0]?.id ?? getElementTypeSectionId(value ?? ELEMENT_TYPE_ORDER[0]);
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

  const extraSelected = extraOptions.some((extra) => extra.selected);
  const close = () => {
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
                      const picked = () => {
                        if (value === null) lastNewTypeSectionId = section.id;
                        close();
                      };
                      return (
                        <Fragment key={type}>
                          <PickerOption label={option.label} subtitle={option.subtitle} selected={type === value && !extraSelected} onClick={() => { onChange(type); picked(); }} />
                          {extraOptions.flatMap((extra) => (extra.after !== type ? [] : [
                            <PickerOption key={extra.key} label={extra.label} subtitle={extra.subtitle} selected={extra.selected} onClick={() => { extra.onSelect(); picked(); }} />,
                          ]))}
                        </Fragment>
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
        title={valueLabel ?? (selectedOption ? `${selectedOption.label}: ${selectedOption.subtitle}` : placeholder)}
        onClick={() => {
          if (disabled) return;
          if (!open) setExpandedSectionId(selectedSection?.id ?? fallbackSectionId);
          setOpen(!open);
        }}
      >
        <span className="element-type-picker__trigger-label">
          {valueLabel ?? (selectedOption?.label || placeholder)}
        </span>
      </button>
      {menu}
    </div>
  );
}

function PickerOption({ label, subtitle, selected, onClick }: { label: string; subtitle: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`element-type-picker__option${selected ? ' is-selected' : ''}`}
      onClick={onClick}
    >
      <span className="element-type-picker__option-text">
        <span className="element-type-picker__option-label">{label}</span>
        <span className="element-type-picker__option-subtitle">{subtitle}</span>
      </span>
    </button>
  );
}
