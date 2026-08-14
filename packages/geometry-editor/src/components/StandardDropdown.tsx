// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useId } from 'react';
import './StandardDropdown.css';
import {
  StandardControlShell,
  type StandardControlSize,
  type StandardControlVariant,
} from './StandardControlShell';

interface StandardDropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface StandardDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: StandardDropdownOption[];
  label?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  helperText?: React.ReactNode;
  className?: string;
  size?: StandardControlSize;
  variant?: StandardControlVariant;
  onBlur?: () => void;
  /** Attached to the native select control for focus/scroll helpers. */
  selectRef?: React.Ref<HTMLSelectElement>;
  /** Display-only trailing unit. It is never included in the selected value or events. */
  unit?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export const StandardDropdown: React.FC<StandardDropdownProps> = ({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select...',
  disabled = false,
  error,
  helperText,
  className = '',
  size = 'md',
  variant = 'default',
  onBlur,
  selectRef,
  unit,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}) => {
  const generatedId = useId();
  const dropdownId = id ?? generatedId;
  const errorId = error ? `${dropdownId}-error` : undefined;
  const helperTextId = helperText && !error ? `${dropdownId}-helper` : undefined;
  const describedBy = [ariaDescribedBy, errorId, helperTextId].filter(Boolean).join(' ') || undefined;

  /**
   * A non-empty `value` that matches no option MUST still be what the select
   * displays. A native `<select>` whose value has no matching `<option>` silently
   * falls back to showing option index 0 -- so before this existed, a stored
   * out-of-enum value (e.g. `mass_distribution_class: "NOT_A_CLASS"` in a snippet)
   * rendered as the FIRST legitimate option, with nothing anywhere telling the user
   * the value on screen was not the value in their data. Any change event then
   * committed the misread. Rendering the stored value as its own entry makes the
   * control display the truth; `disabled` because it exists to REPRESENT current
   * state, not to be choosable -- picking any real option replaces it and the entry
   * disappears on the next render. (Whether an out-of-range value should also raise
   * a visible validation error is the host's job -- EnumControl's `errors` prop --
   * not this component's.)
   */
  const valueUnmatched = value !== '' && !options.some((option) => option.value === value);

  const renderSelect = (controlDescribedBy: string | undefined) => (
    <select
      ref={selectRef}
      id={dropdownId}
      name={name}
      aria-label={ariaLabel}
      aria-describedby={controlDescribedBy}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      className={`standard-dropdown standard-dropdown-${size} ${variant === 'ghost' ? 'standard-dropdown-ghost' : ''} ${error ? 'standard-dropdown-error' : ''} ${(!value && placeholder) ? 'placeholder-shown' : ''}`}
    >
      {placeholder && !value && !options.some((option) => option.value === '') && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {valueUnmatched && (
        <option value={value} disabled>
          {value} (not in list)
        </option>
      )}
      {options.map((option, index) => (
        <option
          key={`${option.value}-${index}`}
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className={`standard-dropdown-container ${className}`}>
      {label && (
        <label htmlFor={dropdownId} className="standard-dropdown-label">
          {label}
        </label>
      )}
      <StandardControlShell
        unit={unit}
        size={size}
        variant={variant}
        disabled={disabled}
        error={!!error}
        describedBy={describedBy}
      >
        {renderSelect}
      </StandardControlShell>
      {error && (
        <div id={errorId} className="standard-dropdown-error-text">
          {error}
        </div>
      )}
      {helperText && !error && (
        <div id={helperTextId} className="standard-dropdown-helper-text">
          {helperText}
        </div>
      )}
    </div>
  );
};
