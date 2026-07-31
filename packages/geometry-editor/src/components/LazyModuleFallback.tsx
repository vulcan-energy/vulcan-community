// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import ReactDOM from 'react-dom';

export function LazyInlineFallback({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '10px 12px',
        border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.35))',
        borderRadius: 6,
        background: 'var(--surface-control, var(--bg-secondary, #f8fafc))',
        color: 'var(--text-secondary, #475569)',
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      {label}
    </div>
  );
}

export function LazyModalFallback({ label }: { label: string }) {
  if (typeof document === 'undefined') return null;

  return ReactDOM.createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 22000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.32)',
      }}
    >
      <div
        style={{
          minWidth: 220,
          maxWidth: 'min(360px, calc(100vw - 40px))',
          padding: '14px 16px',
          border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.35))',
          borderRadius: 8,
          background: 'var(--surface-primary, var(--bg-primary, #ffffff))',
          color: 'var(--text-primary, #0f172a)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.28)',
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'center',
        }}
      >
        {label}
      </div>
    </div>,
    document.body,
  );
}
