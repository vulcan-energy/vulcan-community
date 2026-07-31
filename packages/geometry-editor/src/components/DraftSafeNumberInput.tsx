// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

type DraftSafeNumberInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const DraftSafeNumberInput = forwardRef<HTMLInputElement, DraftSafeNumberInputProps>(
  ({ inputMode = 'decimal', value, onFocus, onChange, onBlur, ...props }, forwardedRef) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const isControlled = value !== undefined;
    const [isEditing, setIsEditing] = useState(false);
    const [draftValue, setDraftValue] = useState(() => (value == null ? '' : String(value)));

    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    useEffect(() => {
      if (!isControlled || isEditing) return;
      setDraftValue(value == null ? '' : String(value));
    }, [isControlled, isEditing, value]);

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      if (isControlled) {
        setIsEditing(true);
        setDraftValue(event.currentTarget.value);
      }

      onFocus?.(event);
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (isControlled) {
        setDraftValue(event.currentTarget.value);
      }

      onChange?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      if (isControlled) {
        setIsEditing(false);
      }

      onBlur?.(event);
    };

    return (
      <input
        ref={inputRef}
        type="text"
        inputMode={inputMode}
        value={isControlled ? (isEditing ? draftValue : value) : value}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
        {...props}
      />
    );
  },
);

DraftSafeNumberInput.displayName = 'DraftSafeNumberInput';
