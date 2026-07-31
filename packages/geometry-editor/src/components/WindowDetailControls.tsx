// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';

export const WINDOW_DETAIL_ROW_MARGIN = (compact: boolean) => (compact ? '6px 0' : '10px 0');

const compactButtonBase: React.CSSProperties = {
  border: 'var(--border-width-thin) solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: '12px',
  fontWeight: 500,
  lineHeight: 1,
  cursor: 'pointer',
};

export function WindowDetailSection({
  fieldKey,
  label,
  actions,
  children,
  compact = false,
}: {
  fieldKey?: string;
  label: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      data-field-key={fieldKey}
      style={{
        width: '100%',
        minWidth: 0,
        margin: WINDOW_DETAIL_ROW_MARGIN(compact),
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>{label}</div>
        {actions ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>{actions}</div>
        ) : null}
      </div>
      {children ? <div style={{ marginTop: compact ? '6px' : '8px', minWidth: 0 }}>{children}</div> : null}
    </div>
  );
}

export function CompactSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        border: 'none',
        background: 'transparent',
        color: 'var(--text-secondary)',
        padding: 0,
        cursor: 'pointer',
        fontSize: '12px',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '26px',
          height: '14px',
          borderRadius: '999px',
          border: 'var(--border-width-thin) solid var(--border-subtle)',
          background: checked ? 'var(--accent-primary)' : 'transparent',
          position: 'relative',
          display: 'inline-block',
          transition: 'var(--transition-all)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '2px',
            left: checked ? '14px' : '2px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: checked ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            transition: 'var(--transition-all)',
          }}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function CompactSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: 'var(--border-width-thin) solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        minHeight: '26px',
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            style={{
              border: 'none',
              borderLeft: option === options[0] ? 'none' : 'var(--border-width-thin) solid var(--border-subtle)',
              background: active ? 'var(--hover-bg)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              padding: '5px 9px',
              fontSize: '12px',
              fontWeight: active ? 600 : 500,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function WindowDetailCollectionShell({
  children,
  empty,
  addLabel,
  onAdd,
  canAdd = true,
}: {
  children?: React.ReactNode;
  empty: React.ReactNode;
  addLabel: string;
  onAdd: () => void;
  canAdd?: boolean;
}) {
  const hasItems = React.Children.count(children) > 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        minWidth: 0,
        border: 'var(--border-width-thin) solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'transparent',
        overflow: 'hidden',
        minHeight: 'var(--form-input-height)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: '4px',
          overflowX: 'auto',
          minWidth: 0,
          flex: 1,
          padding: 'var(--spacing-xs)',
        }}
      >
        {hasItems ? children : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: '0 0 auto',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              padding: '0 var(--spacing-md)',
              whiteSpace: 'nowrap',
            }}
          >
            {empty}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        title={addLabel}
        aria-label={addLabel}
        style={{
          flex: '0 0 auto',
          width: '38px',
          border: 'none',
          borderLeft: 'var(--border-width-thin) solid var(--border-subtle)',
          background: 'transparent',
          color: canAdd ? 'var(--text-secondary)' : 'var(--text-muted)',
          fontSize: '18px',
          lineHeight: 1,
          cursor: canAdd ? 'pointer' : 'not-allowed',
        }}
      >
        +
      </button>
    </div>
  );
}

export function WindowDetailChip({
  children,
  onClick,
  title,
  minWidth = 98,
  maxWidth = 170,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  minWidth?: number;
  maxWidth?: number;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      style={{
        flex: '0 0 auto',
        textAlign: 'left',
        border: 'var(--border-width-thin) solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        color: 'var(--text-primary)',
        padding: '4px 8px',
        minWidth,
        maxWidth,
        minHeight: 'calc(var(--form-input-height) - 10px)',
        cursor: onClick ? 'pointer' : 'default',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </Tag>
  );
}

export function WindowDetailMiniButton({
  children,
  onClick,
  title,
  ariaLabel,
  ariaExpanded,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      style={{
        ...compactButtonBase,
        minHeight: '26px',
        padding: '5px 8px',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
