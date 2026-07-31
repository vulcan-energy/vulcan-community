// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useId, useState } from 'react';
import ReactDOM from 'react-dom';
import './ExperimentalPill.css';

/** Default copy for thermal-bridge suggester and similar experimental geometry tools. */
export const DEFAULT_EXPERIMENTAL_TOOLTIP =
  'This feature is still being improved. It may not catch every case or may suggest lines you need to change. Please review the results carefully before relying on them for a formal assessment.';

export interface ExperimentalPillProps {
  /** Shown inside the pill (default: Experimental). */
  label?: string;
  /** Shown in the purple tooltip while hovering; follows the pointer. */
  tooltipText?: string;
  className?: string;
}

/**
 * Small purple “Experimental” badge with a cursor-following tooltip on hover.
 * Re-use anywhere we ship geometry or SAP-adjacent automation that needs a gentle caveat.
 */
export const ExperimentalPill: React.FC<ExperimentalPillProps> = ({
  label = 'Experimental',
  tooltipText = DEFAULT_EXPERIMENTAL_TOOLTIP,
  className,
}) => {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const onMove = useCallback((e: MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [open, onMove]);

  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  return (
    <>
      <span
        className={['experimental-pill', className].filter(Boolean).join(' ')}
        aria-describedby={open ? tipId : undefined}
        tabIndex={0}
        onMouseEnter={(e) => {
          setPos({ x: e.clientX, y: e.clientY });
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={(e) => {
          const r = (e.target as HTMLElement).getBoundingClientRect();
          setPos({ x: r.left + r.width / 2, y: r.bottom + 4 });
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        {label}
      </span>
      {open &&
        portalTarget &&
        ReactDOM.createPortal(
          <div
            id={tipId}
            role="tooltip"
            className="experimental-pill-tooltip"
            style={{
              left: pos.x + 14,
              top: pos.y + 14,
            }}
          >
            {tooltipText}
          </div>,
          portalTarget,
        )}
    </>
  );
};
