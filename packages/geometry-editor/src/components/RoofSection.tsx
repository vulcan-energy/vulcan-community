// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect, useRef, useState } from 'react';
import { roofSectionView, roofSectionSummary, type RoofSectionInput } from '../lib/roofSectionView';
import type { SvgLabel } from '../lib/heatingSizingView';
import './RoofSection.css';

/** Content width from which the section is drawn inline; narrower panels get one summary line. */
const INLINE_MIN_PX = 320;

/** Open state of the narrow disclosure, kept for the browser session. */
let narrowOpen = false;

function Label({ label, className }: { label: SvgLabel; className?: string }) {
  return <text className={className} x={label.x} y={label.y} textAnchor={label.anchor}>{label.text}</text>;
}

export function RoofSection({ input, onEditPitch }: { input: RoofSectionInput; onEditPitch?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(narrowOpen);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = roofSectionView(input);
  const summary = roofSectionSummary(input);
  const summaryLine = <><strong>Section</strong> · {summary}</>;
  const inline = width >= INLINE_MIN_PX;

  let body;
  if (!view) {
    body = <p className="roof-section__summary">{summaryLine}</p>;
  } else {
    const link = input.pitch.editable && onEditPitch;
    const drawing = (
      <svg className="roof-section__svg" viewBox={`0 0 ${view.width} ${view.height}`} role="img" aria-label={`Section across the ridge: ${summary}`}>
        <path className="roof-section__roof" d={view.outline} />
        <line className="roof-section__eaves" {...view.eavesLine} />
        {view.ticks.map((t) => <line key={t.x} className="roof-section__eaves" x1={t.x} x2={t.x} y1={t.y1} y2={t.y2} />)}
        <Label label={view.labels.ridge} />
        <Label label={view.labels.eaves} />
        <Label label={view.labels.fill} className="roof-section__fill" />
        {link ? (
          <text
            className="roof-section__link"
            x={view.labels.pitch.x}
            y={view.labels.pitch.y}
            textAnchor={view.labels.pitch.anchor}
            role="button"
            tabIndex={0}
            onClick={onEditPitch}
            onKeyDown={(e) => { if (e.key === 'Enter') onEditPitch(); }}
          >{view.labels.pitch.text}</text>
        ) : <Label label={view.labels.pitch} />}
      </svg>
    );
    body = inline ? <div className="roof-section__box">{drawing}</div> : (
      <>
        <button type="button" className="roof-section__summary roof-section__toggle" aria-expanded={open} onClick={() => { narrowOpen = !open; setOpen(!open); }}>
          <span>{summaryLine}</span><span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        {open ? <div className="roof-section__box">{drawing}</div> : null}
      </>
    );
  }
  return <div ref={ref} className="roof-section">{body}</div>;
}
