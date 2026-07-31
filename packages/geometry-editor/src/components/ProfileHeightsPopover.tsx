// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ModalHeader } from './ModalHeader';
import { useKeyedState } from '../hooks/useKeyedState';

export type ProfileHeightsPopoverProps = {
  open: boolean;
  onClose: () => void;
  /** Shown when the popover opens; re-read when `open` becomes true */
  initialHeights: number[];
  onApply: (heights: number[]) => void;
  onClear: () => void;
};

export function ProfileHeightsPopover({
  open,
  onClose,
  initialHeights,
  onApply,
  onClear,
}: ProfileHeightsPopoverProps) {
  const initialHeightDrafts = (
    (initialHeights.length >= 2 ? initialHeights : [0, 0]).map((height) => (
      Number.isFinite(height) ? String(height) : ''
    ))
  );
  const [heightDrafts, setHeightDrafts] = useKeyedState(
    `${open ? 'open' : 'closed'}\0${initialHeights.join('\0')}`,
    initialHeightDrafts,
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const updateAt = (index: number, value: string) => {
    setHeightDrafts((prev) => {
      const next = prev.slice();
      next[index] = value;
      return next;
    });
  };

  const addPoint = () => {
    setHeightDrafts((prev) => [...prev, prev[prev.length - 1] ?? '0']);
  };

  const removePointAt = (index: number) => {
    setHeightDrafts((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleApply = () => {
    const valid = heightDrafts
      .map((heightDraft) => {
        const trimmed = heightDraft.trim();
        if (trimmed === '') return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      })
      .filter((height): height is number => height !== null);
    if (valid.length < 2) return;
    onApply(valid);
    onClose();
  };

  const handleClear = () => {
    onClear();
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!open || typeof document === 'undefined') return null;

  const modal = (
    <div className="modal-backdrop" onClick={handleBackdropClick} role="presentation">
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-label="Profile top"
        style={{
          maxWidth: 420,
          width: 'min(420px, calc(100vw - 2rem))',
          padding: '1.25rem 1.5rem 1.5rem',
        }}
      >
        <ModalHeader title="Profile top" onClose={onClose} />
        <p
          style={{
            margin: '0 0 1rem',
            fontSize: 'var(--font-size-sm, 13px)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          Enter the top edge height in metres at each point along the wall, from one end to the other (evenly
          spaced). You need at least two points. Use Add point for more samples along the wall, or the × beside a
          row to remove that point (you must keep at least two).
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {heightDrafts.map((heightDraft, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 'var(--font-size-sm, 13px)',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ width: 24, opacity: 0.65, flexShrink: 0 }}>{i + 1}</span>
              <input
                type="text"
                inputMode="decimal"
                value={heightDraft}
                onChange={(e) => updateAt(i, e.target.value)}
                className="standard-input standard-input-sm standard-input-ghost"
                style={{ flex: 1, minWidth: 0 }}
                aria-label={`Top height at point ${i + 1} (metres)`}
              />
              {heightDrafts.length > 2 ? (
                <button
                  type="button"
                  className="modal-close-button"
                  onClick={() => removePointAt(i)}
                  aria-label={`Remove point ${i + 1}`}
                  title="Remove this point"
                  style={{
                    flexShrink: 0,
                    padding: '0.35rem',
                    margin: 0,
                    lineHeight: 1,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" />
                    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
              ) : (
                <span style={{ width: 36, flexShrink: 0 }} aria-hidden />
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addPoint}>
            Add point
          </button>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 18,
            paddingTop: 16,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <button type="button" className="btn btn-primary" onClick={handleApply}>
            Apply
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleClear}>
            Clear profile
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
