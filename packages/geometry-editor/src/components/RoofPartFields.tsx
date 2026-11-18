// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The Roof part's fields in the part editor: shape (it sets every edge; edge chips on the plan
// take the exceptions), one pitch control (a category or typed degrees, never both), the use and
// the section across the ridge. Each change refits the roof in place.

import { useRef, useState, type ReactNode } from 'react';
import { roundToTwoDecimals } from '../geometry/constants';
import type { RoofFit } from '../lib/fitRoof';
import {
  DEFAULT_ROOF_PITCH,
  PITCH_CATEGORY_DEGREES,
  roofEdgeTypes,
  roofPitchDegrees,
  roofRoom,
  roomSection,
  roofSpan,
  roofShape,
  shapeEdges,
  type RoofParameters,
  type RoofPitchCategory,
  type RoofRoom,
  type RoofShape,
  type StoreyOutline,
} from '../lib/roofPart';
import { sentenceCaseLabel } from '../lib/fieldPresentation';
import { CompactSegmentedControl } from './WindowDetailControls';
import { StandardDropdown } from './StandardDropdown';
import { StandardInput } from './StandardInput';
import { RoofSection } from './RoofSection';

const SHAPES: Array<{ value: Exclude<RoofShape, 'custom'>; label: string }> = [
  { value: 'hipped', label: 'Hipped' },
  { value: 'gable', label: 'Gable ends' },
  { value: 'half-hip', label: 'Half-hip' },
  { value: 'mono', label: 'Mono' },
  { value: 'flat', label: 'Flat' },
  { value: 'mansard', label: 'Mansard' },
  { value: 'gambrel', label: 'Gambrel' },
];
const CATEGORIES: RoofPitchCategory[] = ['Steep', 'Average', 'Moderate'];
const REQUIRED = <span className="part-editor__required">required</span>;
const fmt = (n: number) => String(roundToTwoDecimals(n));
/** Degrees to 0.1°, whole ones without ".0" (45°, 25.5°). */
const deg = (n: number) => `${Number(n.toFixed(1))}°`;

function Labelled({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="part-editor__field">
      <div className="element-label part-editor__label"><span>{sentenceCaseLabel(label)}</span>{note ? <span className="part-editor__note">{note}</span> : null}</div>
      {children}
    </div>
  );
}

/** A number field that commits on Enter or leaving it; blank clears the value. */
function NumberInput({ value, label, unit, placeholder, onCommit }: {
  value: number | undefined;
  label: string;
  unit: string;
  placeholder?: string;
  onCommit: (value: number | undefined) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    setText(null);
    const next = text.trim() === '' ? undefined : Number(text);
    if (next !== value && (next === undefined || Number.isFinite(next))) onCommit(next);
  };
  return (
    <StandardInput
      type="number"
      value={text ?? (value === undefined ? '' : String(value))}
      unit={unit}
      step="0.01"
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      variant="ghost"
      size="md"
    />
  );
}

export interface RoofPartView {
  parameters: RoofParameters;
  outline: StoreyOutline | null;
  fit: RoofFit | null;
}

/** What HEM:EPC is told about the pitch, and the angle drawn. */
function pitchSource(p: RoofParameters, epc: boolean, mansard: boolean): string {
  if (mansard && epc) return `Sent as the area-weighted mean of both pitches (Custom) · lower slopes drawn at ${fmt(roofPitchDegrees(p))}°.`;
  if (p.pitchChoice === undefined) return `Average (default) · drawn at ${DEFAULT_ROOF_PITCH}°.`;
  if (typeof p.pitchChoice === 'number') return epc ? `Sent as ${fmt(p.pitchChoice)}° (Custom).` : `Drawn at ${fmt(p.pitchChoice)}°.`;
  const at = PITCH_CATEGORY_DEGREES[p.pitchChoice];
  return epc ? `Sent as ${p.pitchChoice} · drawn at ${at}°.` : `Drawn at ${at}°.`;
}

export function RoofPartFields({ view, epc, commit }: {
  view: RoofPartView;
  /** HEM:EPC for an existing building: it is told the pitch category. */
  epc: boolean;
  commit: (next: Partial<RoofParameters>) => void;
}) {
  const { parameters: p, outline, fit } = view;
  const fields = useRef<HTMLDivElement>(null);
  const focus = (field: string) => fields.current?.parentElement?.querySelector<HTMLInputElement>(`[data-field="${field}"] input`)?.focus();
  const isRoom = p.use === 'room';
  const measured = isRoom && outline && fit ? roofRoom(outline, p, fit) : null;
  const room = measured && !('problem' in measured) ? measured : null;
  const setIn = p.roomWalls === 'set-in';
  // As picked: Mansard shows (and asks for its break) before it can be drawn.
  const shape = outline ? roofShape(outline, p, true) : 'custom';
  const party = !!outline?.edges.some((e) => e.fixed === 'party');
  const types = outline ? roofEdgeTypes(outline, p) : [];
  const mansard = shape === 'mansard' || shape === 'gambrel';
  const drawnShape = outline ? roofShape(outline, p) : 'custom';
  const mansardDrawn = drawnShape === 'mansard' || drawnShape === 'gambrel';
  const pitchText = p.flat ? '' : mansardDrawn ? `${fmt(roofPitchDegrees(p))}° / ${fmt(p.upperPitch ?? 0)}°` : `${fmt(roofPitchDegrees(p))}°`;
  const pickShape = (next: Exclude<RoofShape, 'custom'>) => {
    if (!outline || next === shape) return;
    if (next === 'flat') {
      commit({ flat: true, mansard: undefined, ...(isRoom ? { use: undefined } : {}) });
      return;
    }
    // A mansard and a room in the roof do not go together: the later choice wins.
    const toMansard = next === 'mansard' || next === 'gambrel';
    commit({ flat: undefined, mansard: toMansard ? true : undefined, ...(toMansard && isRoom ? { use: undefined } : {}), edges: shapeEdges(outline, fit, next === 'mansard' ? 'hipped' : next === 'gambrel' ? 'gable' : next) });
  };
  const options = [...SHAPES, ...(shape === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : [])]
    .map((o) => ({ value: o.value, label: party && o.value !== 'flat' && o.value !== 'custom' ? `${o.label}, party gable` : o.label }));

  return (
    <>
      <Labelled label="Shape">
        <StandardDropdown
          value={shape}
          onChange={(value) => { if (value !== 'custom') pickShape(value as Exclude<RoofShape, 'custom'>); }}
          options={options}
          aria-label="Shape"
          variant="ghost"
          size="md"
        />
      </Labelled>
      {!p.flat && !isRoom ? (
        <Labelled label="Pitch">
          <div className="part-editor__pitch">
            <CompactSegmentedControl
              ariaLabel="Pitch"
              value={(typeof p.pitchChoice === 'string' ? p.pitchChoice : '') as RoofPitchCategory}
              options={CATEGORIES.map((c) => ({ value: c, label: `${c}\n≈${PITCH_CATEGORY_DEGREES[c]}°` }))}
              onChange={(c) => commit({ pitchChoice: c === p.pitchChoice ? undefined : c })}
            />
            <div className="part-editor__pitch-or" data-field="pitch">
              <span>or</span>
              <NumberInput
                label="Pitch in degrees"
                unit="°"
                value={typeof p.pitchChoice === 'number' ? p.pitchChoice : undefined}
                onCommit={(value) => commit({ pitchChoice: value })}
              />
            </div>
          </div>
          <div className="field-source-note">{p.pitchChoice === undefined ? 'Blank: ' : ''}{pitchSource(p, epc, mansardDrawn)}</div>
        </Labelled>
      ) : null}
      {mansard ? (
        <div className="part-editor__two">
          <Labelled label="Break height" note={p.breakHeight === undefined ? REQUIRED : undefined}>
            <NumberInput label="Break height" unit="m" value={p.breakHeight} onCommit={(breakHeight) => commit({ breakHeight })} />
          </Labelled>
          <Labelled label="Upper pitch" note={p.upperPitch === undefined ? REQUIRED : undefined}>
            <NumberInput label="Upper pitch" unit="°" value={p.upperPitch} onCommit={(upperPitch) => commit({ upperPitch })} />
          </Labelled>
        </div>
      ) : null}
      {types.includes('half-hip') && !p.flat ? (
        <Labelled label="Half-hip height" note={p.halfHipHeight === undefined ? REQUIRED : undefined}>
          <NumberInput label="Half-hip height" unit="m" value={p.halfHipHeight} onCommit={(halfHipHeight) => commit({ halfHipHeight })} />
        </Labelled>
      ) : null}
      {!p.flat ? (
        <Labelled label="Use">
          <CompactSegmentedControl
            ariaLabel="Use"
            value={p.use ?? 'loft'}
            options={[
              { value: 'loft', label: 'Loft' },
              ...(mansard ? [] : [{ value: 'room' as const, label: 'Room in roof' }]),
              { value: 'vaulted', label: 'Vaulted ceiling' },
            ]}
            onChange={(use) => commit({ use: use === 'loft' ? undefined : use })}
          />
        </Labelled>
      ) : null}
      <div ref={fields} hidden />
      {fit && outline ? (
        <RoofSection
          input={{
            points: room ? roomSection(room, fit.section.points) : fit.section.points,
            eaves: outline.eaves,
            pitch: room ? { text: deg(room.pitch), editable: false } : { text: pitchText, editable: !p.flat && !isRoom },
            use: p.use ?? 'loft',
            ...(room ? { room: { inset: (room.w - room.wi) / (room.mono ? 1 : 2), knee: room.hw, ceiling: room.hv, ceilingWidth: room.wc, width: room.wi, mono: room.mono, setIn } } : {}),
          }}
          onEdit={focus}
        />
      ) : null}
      {/* With the outline gone the notice line says so; the room's fields need the outline. */}
      {isRoom && !p.flat && outline ? <RoomFields parameters={p} outline={outline} fit={fit} commit={commit} room={room} /> : null}
    </>
  );
}

const two = (n: number | undefined) => (n === undefined ? '—' : `${n.toFixed(2)} m`);

/** A room in the roof: HEM:EPC's measurements. The full width and length come from the fit; the pitch from the measurements. */
function RoomFields({ parameters: p, outline, fit, commit, room }: {
  parameters: RoofParameters;
  outline: StoreyOutline;
  fit: RoofFit | null;
  commit: (next: Partial<RoofParameters>) => void;
  room: RoofRoom | null;
}) {
  const setIn = p.roomWalls === 'set-in';
  const span = fit ? roofSpan(fit) : null;
  // `short`: the label shown, so a "required" tag keeps the row on one line; the field keeps its full name.
  const field = (key: 'roomWidth' | 'kneeWallHeight' | 'maxCeilingHeight' | 'ceilingWidth', label: string, required = false, short = label) => (
    <div data-field={key}>
      <Labelled label={short} note={required && p[key] === undefined ? REQUIRED : undefined}>
        <NumberInput label={label} unit="m" placeholder={required ? undefined : '0'} value={p[key]} onCommit={(value) => commit({ [key]: value })} />
      </Labelled>
    </div>
  );
  const types = roofEdgeTypes(outline, p);
  const gables = outline.edges.flatMap((e, i) => (types[i] === 'gable' || types[i] === 'half-hip' ? [e.fixed === 'party' ? 'Party' : 'External'] : []));
  const hips = roofShape(outline, p) === 'mono' ? 0 : Math.max(0, 2 - gables.length);
  return (
    <>
      <div className="part-editor__two">
        {readout('Full width', two(span?.w), 'outline')}
        {readout('Length', two(span?.length), 'gable to gable')}
      </div>
      <Labelled label="Walls at the foot of the slopes">
        <CompactSegmentedControl
          ariaLabel="Walls at the foot of the slopes"
          value={setIn ? 'set-in' : 'common'}
          options={[{ value: 'common', label: 'Common' }, { value: 'set-in', label: 'Set in' }]}
          onChange={(walls) => commit({ roomWalls: walls === 'set-in' ? 'set-in' : undefined, ...(walls === 'set-in' ? {} : { roomWidth: undefined }) })}
        />
      </Labelled>
      <div className="part-editor__two">
        {setIn ? field('roomWidth', 'Width', true) : null}
        {field('kneeWallHeight', 'Knee wall height', !setIn, 'Knee height')}
      </div>
      <div className="part-editor__two">
        {field('maxCeilingHeight', 'Max ceiling height', true, 'Max height')}
        {field('ceilingWidth', 'Flat ceiling width')}
      </div>
      <div className="part-editor__two">
        {room ? readout('Pitch', deg(room.pitch), 'from the room') : null}
        {readout('Gables', [...gables, ...Array<string>(hips).fill('Hip end')].join(' · ') || '—', gables.length ? undefined : 'hip ends')}
      </div>
    </>
  );
}

function readout(label: string, value: ReactNode, note?: ReactNode) {
  return <Labelled label={label} note={note}><div className="part-editor__readout">{value}</div></Labelled>;
}
