// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import type { ValidationIssue } from '../geometry/validation/types';

export type ValidationVariant = 'error' | 'warning' | 'info';

const VALIDATION_PALETTE: Record<ValidationVariant, { background: string; border: string; foreground: string }> = {
  error: {
    background: 'var(--validation-error)',
    border: 'var(--validation-error-border)',
    foreground: 'var(--validation-error-on-fill)',
  },
  warning: {
    background: 'var(--validation-warning)',
    border: 'var(--validation-warning-border)',
    foreground: 'var(--validation-warning-on-fill)',
  },
  info: {
    background: 'var(--validation-info)',
    border: 'var(--validation-info-border)',
    foreground: 'var(--validation-info-on-fill)',
  },
};

type IssueItem = string | ValidationIssue;

function resolveMessages(items: readonly IssueItem[]): string[] {
  return items.map((item) => (typeof item === 'string' ? item : item.message));
}

interface ValidationIndicatorProps {
  hasIssues: boolean;
  issues?: readonly IssueItem[];
  size?: 'small' | 'medium';
  className?: string;
  variant?: ValidationVariant;
}

export const ValidationIndicator: React.FC<ValidationIndicatorProps> = ({
  hasIssues,
  issues = [],
  size = 'small',
  className = '',
  variant = 'error'
}) => {
  if (!hasIssues) return null;

  const sizePx = size === 'medium' ? 12 : 8;

  const messages = resolveMessages(issues);
  const title = messages.length > 0 ? messages.join(', ') : 'Validation issues detected';
  const colors = VALIDATION_PALETTE[variant];

  return (
    <div
      className={`validation-indicator ${className}`}
      title={title}
      style={{
        width: sizePx,
        height: sizePx,
        backgroundColor: colors.background,
        borderRadius: '50%',
        display: 'inline-block',
        flexShrink: 0,
        border: `1px solid ${colors.border}`
      }}
    />
  );
};

interface FieldValidationIndicatorProps {
  hasIssue: boolean;
  issue?: string;
  variant?: ValidationVariant;
}

export const FieldValidationIndicator: React.FC<FieldValidationIndicatorProps> = ({
  hasIssue,
  issue,
  variant = 'error'
}) => {
  if (!hasIssue) return null;

  const colors = VALIDATION_PALETTE[variant];

  return (
    <div
      className="field-validation-indicator"
      title={issue || 'This field has an issue'}
      style={{
        width: '8px',
        height: '8px',
        backgroundColor: colors.background,
        borderRadius: '50%',
        display: 'inline-block',
        flexShrink: 0,
        border: `1px solid ${colors.border}`,
        marginLeft: '4px',
        minWidth: '8px'
      }}
    />
  );
};

interface ValidationPillProps {
  message: string;
  title?: string;
  variant: ValidationVariant;
  onClick?: () => void;
}

export const ValidationPill: React.FC<ValidationPillProps> = ({
  message,
  title,
  variant,
  onClick
}) => {
  const colors = VALIDATION_PALETTE[variant];
  const isClickable = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || message}
      style={{
        border: 'none',
        background: 'none',
        padding: 0,
        margin: 0,
        cursor: isClickable ? 'pointer' : 'default',
        maxWidth: '100%',
        textAlign: 'left'
      }}
    >
      <div style={{
        fontSize: '11px',
        padding: '4px 8px',
        backgroundColor: colors.background,
        color: colors.foreground,
        borderRadius: '4px',
        display: 'inline-block',
        maxWidth: '100%',
        overflowWrap: 'anywhere',
        whiteSpace: 'normal',
        lineHeight: 1.2
      }}>
        {message}
      </div>
    </button>
  );
};
