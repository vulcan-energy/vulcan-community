// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useId } from 'react';
import { StatusPill } from './StatusPill';
import type { SvgLabel, SystemView } from '../lib/heatingSizingView';
import './HeatingSizing.css';

function Label({ label, className }: { label: SvgLabel; className: string }) {
  return <text className={className} x={label.x} y={label.y} textAnchor={label.anchor}>{label.text}</text>;
}

/** Pill, sentence and the output-against-flow-temperature chart of one SpaceHeatSystem. */
export function EmitterSizingChart({ view }: { view: SystemView }) {
  const { chart } = view;
  const { plot } = chart;
  const clipId = `heating-sizing-plot-${useId().replace(/:/g, '')}`;
  return (
    <div className="heating-sizing">
      <StatusPill tone={view.pill.tone} labelOverride={view.pill.label} inline={false} />
      <p className="heating-sizing__sentence">{view.sentence}</p>
      <svg className="heating-sizing-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={view.sentence}>
        <clipPath id={clipId}><rect x={plot.x0} y={plot.y0} width={plot.x1 - plot.x0} height={plot.y1 - plot.y0} rx={plot.radius} /></clipPath>
        <g clipPath={`url(#${clipId})`}>
        {chart.redZone ? <rect className="heating-sizing-chart__zone--red" x={chart.redZone.x} y={plot.y0} width={chart.redZone.width} height={plot.y1 - plot.y0} /> : null}
        {chart.greenZone ? <rect className="heating-sizing-chart__zone--green" x={chart.greenZone.x} y={plot.y0} width={chart.greenZone.width} height={plot.y1 - plot.y0} /> : null}
        {chart.yTicks.map((t) => <line key={t.text} className="heating-sizing-chart__grid" x1={plot.x0} x2={plot.x1} y1={t.y} y2={t.y} />)}
        <line className="heating-sizing-chart__need" x1={plot.x0} x2={plot.x1} y1={chart.designLineY} y2={chart.designLineY} />
        <path className="heating-sizing-chart__curve" d={chart.curvePath} />
        </g>
        {chart.yTicks.map((t) => <text key={t.text} className="heating-sizing-chart__tick" x={plot.x0 - 8} y={t.y + 4} textAnchor="end">{t.text}</text>)}
        {chart.xTicks.map((t) => <text key={t.text} className="heating-sizing-chart__tick" x={t.x} y={plot.y1 + 17} textAnchor="middle">{t.text}</text>)}
        {chart.dot?.label.leader ? <line className="heating-sizing-chart__leader" x1={chart.dot.label.leader.x} y1={chart.dot.label.leader.y} x2={chart.dot.x} y2={chart.dot.y} /> : null}
        {chart.cross ? <circle className="heating-sizing-chart__cross" cx={chart.cross.x} cy={chart.cross.y} r={5} /> : null}
        {chart.dot ? <circle className={`heating-sizing-chart__dot heating-sizing-chart__dot--${chart.dot.tone}`} cx={chart.dot.x} cy={chart.dot.y} r={5} /> : null}
        <Label label={chart.needLabel} className="heating-sizing-chart__label" />
        {chart.dot ? <Label label={chart.dot.label} className="heating-sizing-chart__label" /> : null}
        {chart.redLabel ? <Label label={chart.redLabel} className="heating-sizing-chart__label heating-sizing-chart__label--red" /> : null}
        {chart.greenLabel ? <Label label={chart.greenLabel} className="heating-sizing-chart__label heating-sizing-chart__label--green" /> : null}
        <Label label={chart.xTitle} className="heating-sizing-chart__title" />
        <Label label={chart.yTitle} className="heating-sizing-chart__title" />
      </svg>
      <p className="heating-sizing__dim">{view.caption}</p>
    </div>
  );
}
