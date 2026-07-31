// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './PresetDropdown.css';
import './StandardDropdown.css';

export interface PresetDropdownOption {
  value: string;
  label: string;
  source: 'system' | 'user';
}

interface PresetDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: PresetDropdownOption[];
  onDelete?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const PresetDropdown: React.FC<PresetDropdownProps> = ({
  value,
  onChange,
  options,
  onDelete,
  placeholder = 'None (manual)',
  disabled = false,
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);
  const displayLabel = selectedOption?.label || '';

  // Position the floating panel below the trigger
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ x: rect.left, y: rect.bottom + 4, width: rect.width });
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isOpen, updatePosition]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const handleDelete = (e: React.MouseEvent, optionValue: string) => {
    e.stopPropagation();
    onDelete?.(optionValue);
  };

  const triggerClasses = [
    'standard-dropdown',
    `standard-dropdown-${size}`,
    'standard-dropdown-ghost',
    'preset-dropdown-trigger',
    isOpen ? 'preset-dropdown-open' : '',
    !value ? 'placeholder-shown' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="preset-dropdown-container">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClasses}
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
      >
        {displayLabel || placeholder}
      </button>

      {isOpen && ReactDOM.createPortal(
        <div
          ref={panelRef}
          className="preset-dropdown-panel"
          style={{
            left: position.x,
            top: position.y,
            minWidth: Math.max(position.width, 200),
          }}
        >
          {/* "None" option */}
          <div
            className={`preset-dropdown-option ${!value ? 'preset-dropdown-option-selected' : ''}`}
            onClick={() => handleSelect('')}
          >
            <span className="preset-dropdown-option-label">{placeholder}</span>
          </div>

          {options.length > 0 && <div className="preset-dropdown-separator" />}

          {options.map(opt => (
            <div
              key={opt.value}
              className={`preset-dropdown-option ${opt.value === value ? 'preset-dropdown-option-selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              <span className="preset-dropdown-option-label">{opt.label}</span>
              {opt.source === 'system' && (
                <span className="preset-dropdown-option-badge">built-in</span>
              )}
              {opt.source === 'user' && onDelete && (
                <button
                  type="button"
                  className="preset-dropdown-option-delete"
                  title="Delete preset"
                  onClick={(e) => handleDelete(e, opt.value)}
                >
                  &#x2715;
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};
