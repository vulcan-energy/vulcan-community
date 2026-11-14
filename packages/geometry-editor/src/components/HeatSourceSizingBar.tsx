// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { StatusPill } from './StatusPill';
import type { HeatSourceView } from '../lib/heatingSizingView';
import './HeatingSizing.css';

/** Pill, sentence, working-range bar and basis line of one heat source. */
export function HeatSourceSizingBar({ view }: { view: HeatSourceView }) {
  const { bar } = view;
  return (
    <div className="heating-sizing">
      <StatusPill tone={view.pill.tone} labelOverride={view.pill.label} inline={false} />
      {view.sentence ? <p className="heating-sizing__sentence">{view.sentence}</p> : null}
      <div className={`heating-sizing-bar heating-sizing-bar--${bar.tone}`}>
        <div
          className="heating-sizing-bar__label heating-sizing-bar__label--marker"
          style={{ left: `${bar.markerPct}%`, transform: `translateX(${bar.markerLabelShiftPct}%)` }}
        >
          {bar.markerLabel}
        </div>
        <div className="heating-sizing-bar__track">
          <div className="heating-sizing-bar__segment" style={{ left: `${bar.segStartPct}%`, width: `${bar.segEndPct - bar.segStartPct}%` }} />
        </div>
        <div className="heating-sizing-bar__marker" style={{ left: `${bar.markerPct}%` }} />
        <div
          className="heating-sizing-bar__label heating-sizing-bar__label--segment"
          style={{ left: `${(bar.segStartPct + bar.segEndPct) / 2}%`, transform: `translateX(${bar.segLabelShiftPct}%)` }}
        >
          {bar.segLabel}
        </div>
      </div>
      <p className="heating-sizing__dim">{view.basis}</p>
    </div>
  );
}
