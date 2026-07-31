// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import './StandardDropdown.css';

export type SearchableDescribedOption = {
  value: string;
  label: string;
  description?: string;
  /** Extra text matched by search only (not shown). */
  searchText?: string;
};

type Section = {
  title?: string;
  options: SearchableDescribedOption[];
};

interface SearchableDescribedSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minWidth?: string;
  sections: Section[];
  searchable?: boolean;
  searchPlaceholder?: string;
  maxVisibleOptions?: number;
  /**
   * When true, each titled section gets a header that expands/collapses its options (reduces scrolling).
   * Search expands all sections with matches; with an empty search, only the section containing `value` starts expanded.
   */
  collapsibleSections?: boolean;
  /** Use when the control sits inside a high z-index modal (dropdown is portaled to `document.body`). */
  menuZIndex?: number;
  /** Renders below the scrollable options (e.g. compact “add custom” row). Stays inside the menu panel. */
  menuFooter?: React.ReactNode;
  /** Increment (e.g. after a footer action) to programmatically close the menu. */
  closeMenuSignal?: number;
  /** Use the shared native dropdown visual treatment while keeping the searchable portaled menu. */
  triggerVariant?: 'default' | 'standard';
}

export const SearchableDescribedSelect: React.FC<SearchableDescribedSelectProps> = ({
  value,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  minWidth = '180px',
  sections,
  searchable = true,
  searchPlaceholder = 'Search…',
  maxVisibleOptions = 250,
  collapsibleSections = false,
  menuZIndex = 50,
  menuFooter,
  closeMenuSignal,
  triggerVariant = 'default',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSectionIndices, setExpandedSectionIndices] = useState<Set<number>>(() => new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const prevCloseMenuSignal = useRef<number | undefined>(undefined);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number; width: number; maxHeight: number }>({
    x: 0,
    y: 0,
    width: 0,
    maxHeight: 360,
  });
  const [isPositioned, setIsPositioned] = useState(false);

  const allOptions = useMemo(() => sections.flatMap((s) => s.options), [sections]);

  const selectedLabel = useMemo(() => {
    const found = allOptions.find((o) => o.value === value);
    return found?.label || value || '';
  }, [allOptions, value]);

  const normalizedNeedle = searchQuery.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!searchable || !normalizedNeedle) return sections;
    return sections
      .map((s) => ({
        ...s,
        options: s.options.filter((o) => {
          const hay = `${o.label} ${o.value} ${o.description || ''} ${o.searchText || ''}`.toLowerCase();
          return hay.includes(normalizedNeedle);
        }),
      }))
      .filter((s) => s.options.length > 0);
  }, [sections, searchable, normalizedNeedle]);

  const totalFilteredCount = useMemo(
    () => filteredSections.reduce((acc, s) => acc + s.options.length, 0),
    [filteredSections],
  );

  const truncatedSections = useMemo(() => {
    if (!maxVisibleOptions || totalFilteredCount <= maxVisibleOptions) return filteredSections;
    let remaining = maxVisibleOptions;
    const out: Section[] = [];
    for (const s of filteredSections) {
      if (remaining <= 0) break;
      const take = s.options.slice(0, remaining);
      remaining -= take.length;
      if (take.length) out.push({ title: s.title, options: take });
    }
    return out;
  }, [filteredSections, maxVisibleOptions, totalFilteredCount]);

  const displaySections = useMemo(
    () => (collapsibleSections ? filteredSections : truncatedSections),
    [collapsibleSections, filteredSections, truncatedSections],
  );
  const selectedSectionIndices = useMemo(() => {
    const next = new Set<number>();
    sections.forEach((section, index) => {
      if (section.options.some((option) => option.value === value)) next.add(index);
    });
    return next;
  }, [sections, value]);
  const visibleExpandedSectionIndices = useMemo(
    () => normalizedNeedle
      ? new Set(filteredSections.map((_, index) => index))
      : expandedSectionIndices,
    [expandedSectionIndices, filteredSections, normalizedNeedle],
  );

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
  }, []);

  useEffect(() => {
    if (closeMenuSignal === undefined) return;
    if (prevCloseMenuSignal.current === undefined) {
      prevCloseMenuSignal.current = closeMenuSignal;
      return;
    }
    if (closeMenuSignal !== prevCloseMenuSignal.current) {
      prevCloseMenuSignal.current = closeMenuSignal;
      closeMenu();
    }
  }, [closeMenu, closeMenuSignal]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      if (triggerRef.current && triggerRef.current.contains(t)) return;
      if (menuRef.current && menuRef.current.contains(t)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeMenu]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [closeMenu, isOpen]);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportMargin = 12;
    const gap = 8;
    const preferredHeight = 460;
    const minComfortableHeight = 260;
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportMargin;
    const spaceAbove = rect.top - gap - viewportMargin;
    const openAbove = spaceBelow < minComfortableHeight && spaceAbove > spaceBelow;
    const available = Math.max(openAbove ? spaceAbove : spaceBelow, 160);
    const maxHeight = Math.min(preferredHeight, available);
    setMenuPosition({
      x: rect.left,
      y: openAbove
        ? Math.max(viewportMargin, rect.top - gap - maxHeight)
        : Math.min(rect.bottom + gap, window.innerHeight - viewportMargin - maxHeight),
      width: rect.width,
      maxHeight,
    });
    setIsPositioned(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    // Let layout settle before measuring.
    const t = window.setTimeout(updatePosition, 10);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };

  }, [isOpen]);

  const showEmpty = displaySections.length === 0;

  const toggleSection = (sectionIdx: number) => {
    setExpandedSectionIndices((prev) => {
      const next = new Set(prev);
      if (next.has(sectionIdx)) next.delete(sectionIdx);
      else next.add(sectionIdx);
      return next;
    });
  };

  const usesStandardTrigger = triggerVariant === 'standard';

  return (
    <div style={{ position: 'relative', minWidth }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            closeMenu();
            return;
          }
          setSearchQuery('');
          setExpandedSectionIndices(selectedSectionIndices);
          setIsPositioned(false);
          setIsOpen(true);
        }}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        ref={triggerRef}
        className={
          usesStandardTrigger
            ? `standard-dropdown standard-dropdown-md standard-dropdown-ghost ${selectedLabel ? '' : 'placeholder-shown'}`
            : undefined
        }
        style={
          usesStandardTrigger
            ? {
                width: '100%',
                textAlign: 'left',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }
            : {
                width: '100%',
                fontFamily: 'var(--font-family)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-normal)',
                color: disabled ? 'var(--text-muted)' : 'var(--text-input)',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                height: 'var(--form-input-height)',
                borderRadius: 'var(--form-input-radius)',
                padding: 'var(--spacing-sm) var(--spacing-lg)',
                paddingRight: 'var(--spacing-xxxl)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                outline: 'none',
                transition: 'var(--transition-colors)',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }
        }
        onMouseEnter={(e) => {
          if (!disabled && !usesStandardTrigger) {
            e.currentTarget.style.borderColor = 'var(--border-medium)';
            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled && !usesStandardTrigger) {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
          }
        }}
      >
        <span
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={selectedLabel || placeholder}
        >
          {selectedLabel || placeholder}
        </span>
        {!usesStandardTrigger && (
          <span aria-hidden="true" style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
            ▾
          </span>
        )}
      </button>

      {isOpen && !disabled && ReactDOM.createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            position: 'fixed',
            left: isPositioned ? menuPosition.x : -9999,
            top: isPositioned ? menuPosition.y : -9999,
            zIndex: menuZIndex,
            width: `min(calc(100vw - 24px), max(${menuPosition.width}px, 560px), 820px)`,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-elevated)',
            overflow: 'hidden',
            maxHeight: menuPosition.maxHeight,
            display: 'flex',
            flexDirection: 'column',
            opacity: isPositioned ? 1 : 0,
            pointerEvents: isPositioned ? 'auto' : 'none',
          }}
        >
          {searchable && (
            <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  const nextQuery = e.target.value;
                  if (!nextQuery.trim()) setExpandedSectionIndices(selectedSectionIndices);
                  setSearchQuery(nextQuery);
                }}
                placeholder={searchPlaceholder}
                autoFocus
                className="standard-input standard-input-sm standard-input-ghost"
                style={{ width: '100%' }}
              />
              {!collapsibleSections && totalFilteredCount > maxVisibleOptions && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                  Showing first {maxVisibleOptions.toLocaleString()} of {totalFilteredCount.toLocaleString()} matches. Refine your search to
                  narrow it down.
                </div>
              )}
            </div>
          )}

          <div style={{ overflow: 'auto', flex: '1 1 auto', minHeight: 0 }}>
            {showEmpty ? (
              <div style={{ padding: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                No options match your search.
              </div>
            ) : (
              displaySections.map((section, sectionIdx) => {
                const useCollapsibleHeader = Boolean(collapsibleSections && section.title);
                const sectionExpanded = !useCollapsibleHeader || visibleExpandedSectionIndices.has(sectionIdx);
                return (
                  <div key={sectionIdx} style={{ padding: '8px 0' }}>
                    {section.title && !useCollapsibleHeader && (
                      <div
                        style={{
                          padding: '6px 12px',
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.2,
                          textTransform: 'uppercase',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {section.title}
                      </div>
                    )}
                    {section.title && useCollapsibleHeader && (
                      <button
                        type="button"
                        onClick={() => toggleSection(sectionIdx)}
                        aria-expanded={sectionExpanded}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.2,
                          textTransform: 'uppercase',
                          color: 'var(--text-secondary)',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          userSelect: 'none',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--surface-control-hover)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <span aria-hidden style={{ width: 14, flexShrink: 0, opacity: 0.85 }}>
                          {sectionExpanded ? '▼' : '▶'}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>{section.title}</span>
                        <span
                          style={{
                            fontWeight: 600,
                            opacity: 0.65,
                            fontSize: 10,
                            textTransform: 'none',
                            letterSpacing: 0,
                          }}
                        >
                          {section.options.length}
                        </span>
                      </button>
                    )}
                    {sectionExpanded &&
                      section.options.map((opt) => {
                        const isSelected = opt.value === value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              onChange(opt.value);
                              closeMenu();
                            }}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '10px 12px',
                              paddingLeft: useCollapsibleHeader ? 34 : 12,
                              background: isSelected ? 'var(--selected-bg)' : 'transparent',
                              border: 'none',
                              borderLeft: isSelected ? '2px solid var(--accent-primary)' : '2px solid transparent',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              gap: 10,
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) e.currentTarget.style.background = 'var(--hover-bg)';
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 650,
                                  color: 'var(--text-primary)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={opt.label}
                              >
                                {opt.label}
                              </div>
                              {opt.description && (
                                <div
                                  style={{ marginTop: 2, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.35 }}
                                >
                                  {opt.description}
                                </div>
                              )}
                            </div>
                            {isSelected && (
                              <div style={{ color: 'var(--accent-primary)', paddingTop: 2, flexShrink: 0 }} aria-hidden="true">
                                ✓
                              </div>
                            )}
                          </button>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>

          {menuFooter && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                borderTop: '1px solid var(--border)',
                padding: '8px 10px',
                background: 'var(--bg-secondary)',
              }}
            >
              {menuFooter}
            </div>
          )}
        </div>
      , document.body)}
    </div>
  );
};
