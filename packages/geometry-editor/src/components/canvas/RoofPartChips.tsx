// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The selected roof part's chips on the plan: one per outline edge (a click moves it on through
// eaves, gable, half-hip and abuts; a party wall's is fixed), "↻ Turn" at the ridge where the
// roof is not fixed, the ridge height, and the junction of an L or T plan (which wing runs through).

import { useMemo } from 'react';
import type { Element } from '../../geometry/types';
import type { RoofEdgeType } from '../../lib/fitRoof';
import { fitRoofPart, roofEdgeTypes, roofParameters, roofRoom, roomHeight, storeyOutline, turnedEdges, type RoofParameters } from '../../lib/roofPart';
import '../HemieBundleEditor.css';

type P = { x: number; y: number };
const mid = (a: P, b: P, k = 0.5) => ({ x: a.x + k * (b.x - a.x), y: a.y + k * (b.y - a.y) });
const NEXT: Record<RoofEdgeType, RoofEdgeType> = { eaves: 'gable', gable: 'half-hip', 'half-hip': 'abuts', abuts: 'eaves' };

export function RoofPartChips({ anchor, elementsById, toScreen, commit }: {
  anchor: Element;
  elementsById: Record<string, Element>;
  toScreen: (p: P) => P;
  commit: (next: Partial<RoofParameters>) => void;
}) {
  const p = roofParameters(anchor);
  // Fitted once per change to the model, not on every pan or zoom.
  const view = useMemo(() => {
    const outline = p && storeyOutline(Object.values(elementsById), p.level, p.at);
    if (!p || !outline || p.flat) return null;
    const fit = fitRoofPart(outline, p);
    // The ridge height the section and 3D show: a room in the roof shifts the fitted roof.
    const measured = p.use === 'room' && 'faces' in fit ? roofRoom(outline, p, fit) : null;
    const room = measured && !('problem' in measured) ? measured : null;
    const ridge = 'faces' in fit ? (room ? roomHeight(room, fit.ridge.height) : fit.ridge.height) : 0;
    return { outline, fit, ridge, types: roofEdgeTypes(outline, p), turned: turnedEdges(outline, p) };
  }, [p, elementsById]);
  if (!p || !view) return null;
  const { outline, fit, ridge, types, turned } = view;
  /** `out`: a model-space direction to push the chip off its point by 16 px (edge chips sit outside the wall). */
  const chip = (key: string, at: P, body: React.ReactNode, className: string, onClick?: () => void, out?: P) => {
    const s0 = toScreen(at);
    const s1 = out ? toScreen({ x: at.x + out.x, y: at.y + out.y }) : s0;
    const k = out ? 16 / (Math.hypot(s1.x - s0.x, s1.y - s0.y) || 1) : 0;
    const s = { x: s0.x + k * (s1.x - s0.x), y: s0.y + k * (s1.y - s0.y) };
    return onClick ? (
      <button key={key} type="button" className={`roof-chip ${className}`} style={{ left: s.x, top: s.y }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClick(); }}>{body}</button>
    ) : (
      <span key={key} className={`roof-chip ${className}`} style={{ left: s.x, top: s.y }}>{body}</span>
    );
  };
  // A mono roof has no ridge: Turn sits halfway from the middle of the plan to the low side.
  const mono = types.filter((t) => t === 'eaves').length === 1;
  const middle = outline.edges.reduce((c, e) => ({ x: c.x + e.a.x / outline.edges.length, y: c.y + e.a.y / outline.edges.length }), { x: 0, y: 0 });
  const low = outline.edges[types.indexOf('eaves')];
  const centre = low ? mid(middle, mid(low.a, low.b)) : middle;
  const hip = (i: number) => 'faces' in fit && fit.faces.some((f) => f.edge === i && f.ring.length === 3);
  return (
    <div className="roof-chips">
      {outline.edges.map((e, i) => {
        // A third of the way along: a ridge ending at a gable or party edge ends at its middle.
        const at = mid(e.a, e.b, 0.3);
        // Outward: right of the edge on a counter-clockwise outline.
        const out = { x: e.b.y - e.a.y, y: -(e.b.x - e.a.x) };
        const name = e.wall || `Edge ${i + 1}`;
        if (e.fixed === 'party') return chip(`e${i}`, at, <><span className="roof-chip__k">Party · </span>gable</>, 'roof-chip--party', undefined, out);
        if (e.fixed === 'abuts') return chip(`e${i}`, at, <><span className="roof-chip__k">{name} · </span>abuts</>, '', undefined, out);
        return chip(`e${i}`, at, <><span className="roof-chip__k">{name} · </span>{types[i]}{types[i] === 'eaves' && hip(i) ? ' (hip)' : ''}</>, '', () => {
          commit({ edges: { ...p.edges, [e.wall]: NEXT[types[i]] } });
        }, out);
      })}
      {'faces' in fit && !mono && fit.ridge.height > 0 && Math.hypot(fit.ridge.b.x - fit.ridge.a.x, fit.ridge.b.y - fit.ridge.a.y) > 0.5
        ? chip('ridge', mid(fit.ridge.a, fit.ridge.b, turned ? 0.2 : 0.5), `ridge ${(outline.eaves + ridge).toFixed(2)} m`, 'roof-chip--quiet')
        : null}
      {turned && 'faces' in fit ? chip('turn', mono ? centre : mid(fit.ridge.a, fit.ridge.b), '↻ Turn', 'roof-chip--on', () => commit({ edges: turned })) : null}
      {'faces' in fit && fit.junctionAt
        ? chip('junction', fit.junctionAt, <><span className="roof-chip__k">Junction: </span>{(p.junction ?? 0) === 0 ? 'main runs through' : 'swapped'}</>, 'roof-chip--on', () => commit({ junction: ((p.junction ?? 0) + 1) % fit.junctions }))
        : null}
    </div>
  );
}
