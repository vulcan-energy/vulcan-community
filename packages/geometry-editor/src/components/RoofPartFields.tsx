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
  roofShape,
  shapeEdges,
  type RoofParameters,
  type RoofPitchCategory,
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
  const degrees = useRef<HTMLDivElement>(null);
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
      commit({ flat: true, mansard: undefined });
      return;
    }
    commit({ flat: undefined, mansard: next === 'mansard' || next === 'gambrel' ? true : undefined, edges: shapeEdges(outline, fit, next === 'mansard' ? 'hipped' : next === 'gambrel' ? 'gable' : next) });
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
        {!p.flat ? <div className="field-source-note">Click an edge on the plan: eaves, gable, half-hip.</div> : null}
      </Labelled>
      {!p.flat ? (
        <Labelled label="Pitch">
          <div className="part-editor__pitch">
            <CompactSegmentedControl
              ariaLabel="Pitch"
              value={(typeof p.pitchChoice === 'string' ? p.pitchChoice : '') as RoofPitchCategory}
              options={CATEGORIES.map((c) => ({ value: c, label: `${c}\n≈${PITCH_CATEGORY_DEGREES[c]}°` }))}
              onChange={(c) => commit({ pitchChoice: c === p.pitchChoice ? undefined : c })}
            />
            <div className="part-editor__pitch-or" ref={degrees}>
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
            options={[{ value: 'loft', label: 'Loft' }, { value: 'vaulted', label: 'Vaulted ceiling' }]}
            onChange={(use) => commit({ use: use === 'loft' ? undefined : use })}
          />
        </Labelled>
      ) : null}
      {fit && outline ? (
        <RoofSection
          input={{ points: fit.section.points, eaves: outline.eaves, pitch: { text: pitchText, editable: !p.flat }, use: p.use ?? 'loft' }}
          onEditPitch={() => degrees.current?.querySelector('input')?.focus()}
        />
      ) : null}
    </>
  );
}
