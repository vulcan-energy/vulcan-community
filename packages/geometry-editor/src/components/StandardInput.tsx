// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useId, useState } from 'react';
import './StandardInput.css';
import {
  StandardControlShell,
  type StandardControlSize,
  type StandardControlVariant,
} from './StandardControlShell';

interface StandardInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: React.ReactNode;
  error?: string;
  helperText?: React.ReactNode;
  variant?: StandardControlVariant;
  size?: StandardControlSize;
  /** Display-only trailing unit. It is never included in the input value or events. */
  unit?: string;
}

export const StandardInput: React.FC<StandardInputProps> = ({
  label,
  error,
  helperText,
  variant = 'default',
  size = 'md',
  unit,
  className = '',
  id,
  type,
  inputMode,
  value,
  onFocus,
  onChange,
  onKeyDown,
  onBlur,
  disabled,
  readOnly,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  ...props
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const usesDraftSafeNumericInput = type === 'number';
  const isControlledNumericInput = usesDraftSafeNumericInput && value !== undefined;
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(() => (value == null ? '' : String(value)));

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (isControlledNumericInput) {
      setIsEditing(true);
      setDraftValue(e.currentTarget.value);
    }

    // Auto-select all text when input is focused
    e.target.select();

    // Call the original onFocus handler if provided
    if (onFocus) {
      onFocus(e);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isControlledNumericInput) {
      setDraftValue(e.currentTarget.value);
    }

    onChange?.(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);

    if (!e.defaultPrevented && e.key === 'Enter' && onBlur) {
      e.currentTarget.blur();
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (isControlledNumericInput) {
      setIsEditing(false);
    }

    onBlur?.(e);
  };

  const renderedType = usesDraftSafeNumericInput ? 'text' : type;
  const renderedInputMode = usesDraftSafeNumericInput ? (inputMode ?? 'decimal') : inputMode;
  const renderedValue = isControlledNumericInput
    ? (isEditing ? draftValue : value)
    : value;
  const errorId = error ? `${inputId}-error` : undefined;
  const helperTextId = helperText && !error ? `${inputId}-helper` : undefined;
  const describedBy = [ariaDescribedBy, errorId, helperTextId].filter(Boolean).join(' ') || undefined;
  const isInvalid = Boolean(error) || ariaInvalid === true || ariaInvalid === 'true';

  const renderInput = (controlDescribedBy: string | undefined) => (
    <input
      id={inputId}
      className={`standard-input standard-input-${size} ${variant === 'ghost' ? 'standard-input-ghost' : ''} ${
        isInvalid ? 'standard-input-error' : ''
      }`}
      type={renderedType}
      inputMode={renderedInputMode}
      value={renderedValue}
      onFocus={handleFocus}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      disabled={disabled}
      readOnly={readOnly}
      aria-describedby={controlDescribedBy}
      aria-invalid={isInvalid || undefined}
      {...props}
    />
  );

  return (
    <div className={`standard-input-container ${className}`}>
      {label && (
        <label htmlFor={inputId} className="standard-input-label">
          {label}
        </label>
      )}
      <StandardControlShell
        unit={unit}
        size={size}
        variant={variant}
        disabled={disabled}
        readOnly={readOnly}
        error={isInvalid}
        describedBy={describedBy}
      >
        {renderInput}
      </StandardControlShell>
      {error && (
        <div id={errorId} className="standard-input-error-text">
          {error}
        </div>
      )}
      {helperText && !error && (
        <div id={helperTextId} className="standard-input-helper-text">
          {helperText}
        </div>
      )}
    </div>
  );
};
