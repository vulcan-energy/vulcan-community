// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inline wall shape editor for a line wall: a face-on sketch, a Top row and (for walls, not
 * windows) a Bottom row. Each edge is Flat, fitted to the roof, or Custom points. Heights are
 * metres above the wall base. A valid edit is committed at once (as other wall fields are); an
 * invalid one stays here with its message and is not committed.
 */
import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { CompactSegmentedControl } from './WindowDetailControls';
import { StandardInput } from './StandardInput';
import { useNumericDraftInput } from './numericDraftInput';
import {
  interpolateProfileHeight,
  isFlatProfile,
  wallFaceBreakpoints,
  wallFaceOverlap,
  wallFaceProblem,
  type ProfileLineFace,
  type ProfilePoint,
} from '../lib/profileLineFace';
import { isRoofSnapshotStale, type WallRoofEdge } from '../lib/wallEdgeFromRoofs';

type EdgeMode = 'flat' | 'roof' | 'custom';
type Edge = 'top' | 'bottom';
type Profiles = { top: ProfilePoint[]; bottom: ProfilePoint[] };

/** What the wall should store: no face and a plain height, or a profiled face. */
export type WallShapeCommit = { flatHeight: number } | { face: ProfileLineFace };

export type WallShapeRowsProps = {
  widthM: number;
  /** Stored `geometry_face` (from readProfiledLineFace), or null for a plain wall. */
  face: ProfileLineFace | null;
  /** Stored `height`; the top of a plain wall. */
  height: number;
  /** The existing Height input, used as Top › Flat while the wall has no face. */
  children: ReactNode;
  /** False for windows: Top is Flat | Custom and there is no Bottom row. */
  roofModes: boolean;
  /** Fits an edge to the roofs over/under the wall; `limit` is the other edge. */
  fitRoof: (edge: Edge, limit: ProfilePoint[]) => WallRoofEdge | null;
  /** Where the wall line runs out from under every roof (m along the wall), or null: says why Under roof is greyed. */
  roofEndsAtM?: number | null;
  /** Field ref for the Top row (validation scroll target for `height`). */
  topRef?: (node: HTMLDivElement | null) => void;
  onCommit: (next: WallShapeCommit) => void;
};

const flat = (h: number): ProfilePoint[] => [{ t: 0, h }, { t: 1, h }];
const round2 = (v: number) => Math.round(v * 100) / 100;

function initialMode(face: ProfileLineFace | null, edge: Edge): EdgeMode {
  if (!face) return 'flat';
  if (face[`${edge}_mode`] === 'roof') return 'roof';
  const profile = face[`${edge}_profile`];
  return isFlatProfile(profile, edge === 'bottom' ? 0 : undefined) ? 'flat' : 'custom';
}

function toCommit(p: Profiles, modes: Record<Edge, EdgeMode>): WallShapeCommit {
  if (modes.top !== 'roof' && modes.bottom !== 'roof' && isFlatProfile(p.top) && isFlatProfile(p.bottom, 0)) {
    return { flatHeight: p.top[0].h };
  }
  return {
    face: {
      kind: 'profiled-line-face',
      top_profile: p.top,
      bottom_profile: p.bottom,
      ...(modes.top === 'roof' ? { top_mode: 'roof' as const } : {}),
      ...(modes.bottom === 'roof' ? { bottom_mode: 'roof' as const } : {}),
    },
  };
}

function PointInput({ value, onValue, label }: { value: number; onValue: (v: number) => void; label: string }) {
  const input = useNumericDraftInput(round2(value), (v) => { if (v !== '') onValue(v); }, {
    commitOnChange: true,
    syncExternal: true,
    formatOnBlur: 'fixed2',
  });
  return (
    <StandardInput
      type="text"
      inputMode="decimal"
      value={input.inputValue}
      onChange={input.handleInputChange}
      onBlur={input.handleBlur}
      aria-label={label}
      variant="ghost"
      size="sm"
    />
  );
}

function PointsTable({ edge, profile, widthM, onChange, onHover }: {
  edge: Edge;
  profile: ProfilePoint[];
  widthM: number;
  onChange: (next: ProfilePoint[]) => void;
  onHover: (index: number | null) => void;
}) {
  const set = (i: number, point: ProfilePoint) => onChange(profile.map((p, j) => (j === i ? point : p)));
  const addPoint = () => {
    // Split the longest gap on the current line, so the shape does not change.
    let gap = 0;
    for (let i = 1; i < profile.length - 1; i += 1) {
      if (profile[i + 1].t - profile[i].t > profile[gap + 1].t - profile[gap].t) gap = i;
    }
    const t = (profile[gap].t + profile[gap + 1].t) / 2;
    onChange([...profile.slice(0, gap + 1), { t, h: round2(interpolateProfileHeight(profile, t)) }, ...profile.slice(gap + 1)]);
  };
  const name = edge === 'top' ? 'Top' : 'Bottom';
  return (
    <div className="wall-shape-points">
      <span className="wall-shape-points-head">Along wall (m)</span>
      <span className="wall-shape-points-head">Height (m)</span>
      <span />
      {profile.map((p, i) => {
        const end = i === 0 || i === profile.length - 1;
        return (
          <div
            key={i}
            className="wall-shape-points-row"
            data-testid={`wall-shape-${edge}-point-${i}`}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
          >
            {end ? (
              <span className="wall-shape-points-fixed">{(p.t * widthM).toFixed(2)}</span>
            ) : (
              <PointInput
                value={p.t * widthM}
                onValue={(d) => set(i, { ...p, t: d / widthM })}
                label={`${name} point ${i + 1} distance along wall (m)`}
              />
            )}
            <PointInput
              value={p.h}
              onValue={(h) => set(i, { ...p, h: round2(h) })}
              label={`${name} point ${i + 1} height above base (m)`}
            />
            {end ? <span /> : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remove ${name.toLowerCase()} point ${i + 1}`}
                title="Remove this point"
                onClick={() => { onHover(null); onChange(profile.filter((_, j) => j !== i)); }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm wall-shape-points-add" onClick={addPoint}>
        + Add point
      </button>
    </div>
  );
}

function Sketch({ profiles, widthM, roofLines, invalid, highlight }: {
  profiles: Profiles;
  widthM: number;
  roofLines: ProfilePoint[][];
  /** Shows the stretch where the top is not above the bottom. */
  invalid: boolean;
  highlight: { edge: Edge; index: number } | null;
}) {
  const W = 300;
  const H = 110;
  const pad = 20;
  const ts = wallFaceBreakpoints(profiles.top, profiles.bottom);
  const outline = [
    ...ts.map((t) => [t, interpolateProfileHeight(profiles.top, t)]),
    ...[...ts].reverse().map((t) => [t, interpolateProfileHeight(profiles.bottom, t)]),
  ];
  const maxH = Math.max(1, ...outline.map((p) => p[1]), ...roofLines.flat().map((p) => p.h));
  const sx = (t: number) => pad + t * (W - pad * 2);
  const sy = (h: number) => 8 + (1 - h / maxH) * (H - 26);
  const pts = (list: number[][]) => list.map(([t, h]) => `${sx(t)},${sy(h)}`).join(' ');
  const marked = highlight ? profiles[highlight.edge][highlight.index] : undefined;
  const overlap = invalid ? wallFaceOverlap(profiles.top, profiles.bottom) : null;
  return (
    <svg className="wall-shape-sketch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Wall seen face-on">
      <line x1={4} x2={W - 4} y1={sy(0)} y2={sy(0)} className="wall-shape-sketch-base" />
      <polygon points={pts(outline)} className={invalid ? 'wall-shape-sketch-wall is-invalid' : 'wall-shape-sketch-wall'} />
      {overlap ? (
        <rect
          className="wall-shape-sketch-overlap"
          data-testid="wall-shape-overlap"
          x={Math.min(sx(overlap[0]), sx(overlap[1]) - 4)}
          width={Math.max(4, sx(overlap[1]) - sx(overlap[0]))}
          y={4}
          height={sy(0) - 4}
        />
      ) : null}
      {roofLines.map((line, i) => (
        <polyline key={i} points={pts(line.map((p) => [p.t, p.h]))} className="wall-shape-sketch-roof" />
      ))}
      {marked ? <circle cx={sx(marked.t)} cy={sy(marked.h)} r={4.5} className="wall-shape-sketch-point" /> : null}
      <text x={sx(0)} y={H - 3} textAnchor="middle" className="wall-shape-sketch-label">0 m</text>
      <text x={sx(1)} y={H - 3} textAnchor="middle" className="wall-shape-sketch-label">{`${widthM.toFixed(2)} m`}</text>
    </svg>
  );
}

function EdgeRow({ edge, mode, roofModes, hasRoof, roofEndsAtM, onPick, rowRef, children }: {
  edge: Edge;
  mode: EdgeMode;
  roofModes: boolean;
  hasRoof: boolean;
  roofEndsAtM?: number | null;
  onPick: (edge: Edge, mode: EdgeMode) => void;
  rowRef?: (node: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const options: Array<{ value: EdgeMode; label: string; disabled?: boolean; title?: string }> = [
    { value: 'flat', label: 'Flat' },
    ...(roofModes ? [{
      value: 'roof' as const,
      label: edge === 'top' ? 'Under roof' : 'On roof',
      disabled: !hasRoof && mode !== 'roof',
      title: hasRoof ? undefined : edge === 'top'
        ? (typeof roofEndsAtM === 'number'
          ? `No roof covers the whole wall: it runs past the roof edge at ${roofEndsAtM.toFixed(2)} m along the wall. Make the wall end at the roof edge, or pick Custom.`
          : 'No roof over this wall is above its bottom edge along the whole wall. Pick Custom to set the top by hand.')
        : 'No pitched roof is under this wall between its base and its top. Pick Custom to set the bottom by hand.',
    }] : []),
    { value: 'custom', label: 'Custom' },
  ];
  return (
    <>
      <div className="element-label">{edge === 'top' ? 'Top (m above base):' : 'Bottom (m above base):'}</div>
      <div className="element-input wall-shape-edge" data-testid={`wall-shape-${edge}`} ref={rowRef}>
        <CompactSegmentedControl
          value={mode}
          options={options}
          onChange={(next) => onPick(edge, next)}
          ariaLabel={edge === 'top' ? 'Top edge' : 'Bottom edge'}
        />
        {children}
      </div>
    </>
  );
}

export function WallShapeRows({
  widthM,
  face,
  height,
  children: heightField,
  roofModes,
  fitRoof,
  roofEndsAtM,
  topRef,
  onCommit,
}: WallShapeRowsProps) {
  const stored: Profiles = { top: face?.top_profile ?? flat(height), bottom: face?.bottom_profile ?? flat(0) };
  // Modes and an invalid draft belong to the stored face they were made against. Undo/redo or an
  // Advanced-fields edit can replace that face while the wall stays selected: the rows then follow
  // it, so a stale "Under roof" is never written onto a custom edge. A Custom edge that is still
  // flat stays Custom (the user picked it and has not edited it yet).
  const faceKey = JSON.stringify(face);
  const [modeState, setModeState] = useState(() => ({
    faceKey,
    modes: { top: initialMode(face, 'top'), bottom: initialMode(face, 'bottom') } as Record<Edge, EdgeMode>,
  }));
  const follow = (edge: Edge): EdgeMode => {
    const next = initialMode(face, edge);
    return next === 'flat' && modeState.modes[edge] === 'custom' ? 'custom' : next;
  };
  const modes = modeState.faceKey === faceKey ? modeState.modes : { top: follow('top'), bottom: follow('bottom') };
  const setModes = (next: Record<Edge, EdgeMode>) => setModeState({ faceKey, modes: next });
  const [pendingState, setPendingState] = useState<{ faceKey: string; profiles: Profiles } | null>(null);
  const pending = pendingState?.faceKey === faceKey ? pendingState.profiles : null;
  const setPending = (profiles: Profiles | null) => setPendingState(profiles ? { faceKey, profiles } : null);
  const [highlight, setHighlight] = useState<{ edge: Edge; index: number } | null>(null);
  const draft = pending ?? stored;
  const problem = pending ? wallFaceProblem(pending.top, pending.bottom, widthM) : null;

  const roofFor = (edge: Edge, p: Profiles = draft) => (roofModes ? fitRoof(edge, edge === 'top' ? p.bottom : p.top) : null);
  const freshTop = roofFor('top');
  const freshBottom = roofFor('bottom');
  const staleEdges = (['top', 'bottom'] as const).filter((edge) =>
    modes[edge] === 'roof' && face?.[`${edge}_mode`] === 'roof'
    && isRoofSnapshotStale(face[`${edge}_profile`], edge === 'top' ? freshTop?.profile ?? null : freshBottom?.profile ?? null));

  const apply = (next: Profiles, nextModes: Record<Edge, EdgeMode> = modes) => {
    setModes(nextModes);
    if (wallFaceProblem(next.top, next.bottom, widthM)) {
      setPending(next);
      return;
    }
    setPending(null);
    const commit = toCommit(next, nextModes);
    if (JSON.stringify(commit) !== JSON.stringify(toCommit(stored, { top: initialMode(face, 'top'), bottom: initialMode(face, 'bottom') }))) {
      onCommit(commit);
    }
  };

  const pick = (edge: Edge, mode: EdgeMode) => {
    if (mode === modes[edge]) return;
    const nextModes = { ...modes, [edge]: mode };
    const current = draft[edge];
    let profile = current;
    if (mode === 'flat') profile = flat(edge === 'top' ? Math.max(...current.map((p) => p.h)) : 0);
    if (mode === 'roof') profile = roofFor(edge)?.profile ?? current;
    apply({ ...draft, [edge]: profile }, nextModes);
  };

  const refit = () => {
    let next = draft;
    for (const edge of staleEdges) {
      const fit = roofFor(edge, next);
      if (fit) next = { ...next, [edge]: fit.profile };
    }
    apply(next);
  };

  const edgeBody = (edge: Edge): ReactNode => {
    const mode = modes[edge];
    const fresh = edge === 'top' ? freshTop : freshBottom;
    if (mode === 'custom') {
      return (
        <PointsTable
          edge={edge}
          profile={draft[edge]}
          widthM={widthM}
          onChange={(profile) => apply({ ...draft, [edge]: profile })}
          onHover={(index) => setHighlight(index === null ? null : { edge, index })}
        />
      );
    }
    if (mode === 'roof') {
      return (
        <span className="wall-shape-roof-name">
          <i aria-hidden="true" />
          {fresh?.roofNames.join(', ') ?? 'No roof'}
        </span>
      );
    }
    if (edge === 'bottom') return null;
    return face || pending ? (
      <PointInput value={draft.top[0].h} onValue={(h) => apply({ ...draft, top: flat(round2(h)) })} label="Top height above base (m)" />
    ) : heightField;
  };
  const topBody = edgeBody('top');
  const bottomBody = edgeBody('bottom');

  const roofLines = [freshTop, freshBottom].flatMap((fit) => (fit ? [fit.profile] : []));
  return (
    <>
      <div className="wall-shape-sketch-box">
        <Sketch profiles={draft} widthM={widthM} roofLines={roofLines} invalid={!!problem} highlight={highlight} />
        <div className="wall-shape-legend">
          <span><i className="wall-shape-legend-wall" />Wall</span>
          <span><i className="wall-shape-legend-base" />Base</span>
          {roofLines.length > 0 ? <span><i className="wall-shape-legend-roof" />Roof surface</span> : null}
        </div>
      </div>
      <EdgeRow edge="top" mode={modes.top} roofModes={roofModes} hasRoof={!!freshTop} roofEndsAtM={roofEndsAtM} onPick={pick} rowRef={topRef}>
        {topBody}
      </EdgeRow>
      {roofModes ? (
        <EdgeRow edge="bottom" mode={modes.bottom} roofModes hasRoof={!!freshBottom} onPick={pick}>
          {bottomBody}
        </EdgeRow>
      ) : null}
      {staleEdges.length > 0 ? (
        <div className="wall-shape-chip">
          Roof changed
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={refit}
            disabled={!staleEdges.some((edge) => (edge === 'top' ? freshTop : freshBottom))}
          >
            Re-fit
          </button>
        </div>
      ) : null}
      {problem ? <div className="wall-shape-error" role="alert">{problem}</div> : null}
    </>
  );
}
