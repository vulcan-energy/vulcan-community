// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The part editor for a bay window or a conservatory: one panel for the whole part, opened by a
// click on any of its members. Header (kind, name, host wall), the measurements in HEM:EPC's
// terms (drawn values say so), the choices, one notice line, the member list and the actions.
// A committed change redraws the members in place; what the user set on a member (its fabric,
// a window's opening type) stays.

import { useState, type ReactNode } from 'react';
import type { BuildingElementOpaque, Element } from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';
import { useGeometryStore, useGeometryStoreApi } from '../stores/geometryStore';
import { useTargetRules } from '../hooks/useTargetRules';
import { openFabricTab } from '../lib/fieldSource';
import { hemieConstructionSetting } from '../lib/hemieFabric';
import {
  BAY_ROOF_PITCH,
  CONSERVATORY_DEFAULT_PITCH,
  bayCoveredAbove,
  bayParametersProblem,
  conservatoryParametersProblem,
  detachHemieBundle,
  drawHemieBundle,
  getHemieBundle,
  getHemieBundleMembers,
  hemieBundleHost,
  hemieBundleHostProblem,
  hemieBundleMissing,
  hemieBundleParameters,
  hemieBundleParts,
  type BayParameters,
  type ConservatoryParameters,
} from '../lib/hemieBundles';
import { sentenceCaseLabel } from '../lib/fieldPresentation';
import { CompactSegmentedControl } from './WindowDetailControls';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { StandardDropdown } from './StandardDropdown';
import { StandardInput } from './StandardInput';
import { drawRoofPart, fitRoofPart, roofBlankNotice, roofEpcNotes, roofOutlineChanged, roofParameters, storeyOutline, type RoofParameters } from '../lib/roofPart';
import { fhsFloorCodeForCanvasFloor } from '../lib/storeySemantics';
import { RoofPartFields, type RoofPartView } from './RoofPartFields';
import './HemieBundleEditor.css';

type Parameters = Omit<BayParameters, 'roof'> & Omit<ConservatoryParameters, 'roof'> & {
  roof?: BayParameters['roof'] | ConservatoryParameters['roof'];
};
type Edits = Partial<Record<keyof Parameters | keyof RoofParameters, unknown>>;

const SPACE_TYPES = ['corridor', 'garage', 'roof void', 'stairwell'] as const;
const fmt = (n: number) => String(roundToTwoDecimals(n));
const REQUIRED = <span className="part-editor__required">required</span>;

/** What a field kind needs from the part editor: the draft, the host and how to commit. */
interface FieldKit {
  draft: Parameters;
  host: BuildingElementOpaque | null;
  all: Element[];
  level: number;
  epc: boolean;
  commit: (next: Edits) => void;
  input: (key: keyof Parameters, label: string, placeholder?: string, unit?: string) => ReactNode;
  numberField: (key: keyof Parameters, label: string, options?: { unit?: string; placeholder?: string; note?: ReactNode }) => ReactNode;
}

/** A field: its label (with a note on the right, such as "drawn" or "required") over its control. */
function Labelled({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="part-editor__field">
      <div className="element-label part-editor__label">
        <span>{sentenceCaseLabel(label)}</span>
        {note ? <span className="part-editor__note">{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

function choice<T extends string>(label: string, value: T | '', options: Array<{ value: T; label: string }>, onChange: (value: T) => void, note?: ReactNode) {
  return (
    <Labelled label={label} note={note}>
      <CompactSegmentedControl ariaLabel={label} value={value as T} options={options} onChange={onChange} />
    </Labelled>
  );
}

function readout(label: string, value: ReactNode, note?: ReactNode) {
  return <Labelled label={label} note={note}><div className="part-editor__readout">{value}</div></Labelled>;
}

const blank = (value: unknown) => value === undefined || value === '';

/** The conservatory fields shown only when it is entered (heated and open to the dwelling). */
const CONSERVATORY_ENTERED_FIELDS = new Set(['wallHeight', 'wallGlazingFraction', 'roof', 'roofPitch', 'roofGlazingFraction']);

/** The labels of the required fields still blank, in panel order. */
function blankRequired(draft: Parameters, isBay: boolean, covered: boolean, epc: boolean): string[] {
  const fields: Array<[string, boolean]> = isBay
    ? [
        ['Roof', !covered && !draft.roof],
        ['Front window width', epc && blank(draft.windowWidth)],
        ['Front window height', epc && blank(draft.windowHeight)],
      ]
    : draft.conservatoryType === 'non-separated'
      ? [
          ['Wall height to eaves', blank(draft.wallHeight)],
          ['Wall glazing fraction', blank(draft.wallGlazingFraction)],
          ['Roof', !draft.roof],
          ['Roof glazing fraction', blank(draft.roofGlazingFraction)],
        ]
      : [
          ['Not entered in the EPC', !draft.conservatoryType],
          ['Unheated space type', draft.conservatoryType === 'unheated' && !draft.adjacentSpaceType],
        ];
  return fields.flatMap(([label, empty]) => (empty ? [label] : []));
}

/** Remount per anchor (`key`): field edits not yet committed belong to one part. */
export function HemieBundleEditor({
  anchor,
  markedId,
  onMark,
  onEditMembers,
  onRedrawn,
  onDone,
  onDelete,
}: {
  anchor: Element;
  /** The member clicked: marked in the parts list. */
  markedId: string;
  onMark: (id: string) => void;
  /** Opens these members' own editor (one member, or a row of them together). */
  onEditMembers: (ids: string[]) => void;
  /** The part was redrawn: these are its members now (a roof or windows may have come or gone). */
  onRedrawn: (ids: string[]) => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  const store = useGeometryStoreApi();
  const elementsById = useGeometryStore((s) => s.elementsById);
  const { hemieBundles: epc } = useTargetRules();
  const [edits, setEdits] = useState<Edits>({});
  const [detaching, setDetaching] = useState(false);
  const all = Object.values(elementsById);
  const tag = getHemieBundle(anchor)!;
  const isBay = tag.kind === 'bay';
  const isRoof = tag.kind === 'roof';
  const name = tag.bundle_name ?? anchor.name;
  const members = getHemieBundleMembers(all, tag.bundle_id);
  const host = hemieBundleHost(anchor, all);
  const draft = { ...hemieBundleParameters(anchor, all), ...edits } as Parameters;
  const problem = host ? (isBay ? bayParametersProblem(host, draft as BayParameters) : conservatoryParametersProblem(host, draft as ConservatoryParameters)) : null;
  const hostProblem = hemieBundleHostProblem(anchor, all);
  const notice = problem ?? hostProblem ?? hemieBundleMissing(anchor, all, epc);
  const level = Math.floor(anchor.coordinates[0]?.z ?? 0);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  /** Why the last rename, or the last roof change, did not go through. */
  const [problems, setProblems] = useState<{ rename?: string | null; roof?: string | null }>({});
  const renameProblem = problems.rename ?? null;
  const roofProblem = problems.roof ?? null;
  const setRenameProblem = (rename: string | null) => setProblems((p) => ({ ...p, rename }));
  const roof = isRoof ? roofView(anchor, all) : null;
  const roofChanged = isRoof && roofOutlineChanged(anchor, all);
  const roofNotice = roof
    ? roofProblem ?? roof.problem ?? (roof.outline ? roofBlankNotice(name, roof.outline, roof.parameters) : null) ?? (roofChanged ? 'Outline changed · Refit' : null)
    : null;
  const roofNotes = roof ? [...('fit' in roof && roof.fit ? roof.fit.notes : []), ...(epc ? roofEpcNotes(roof) : [])] : [];
  const firstBlank = isRoof ? undefined : blankRequired(draft, isBay, !!host && isBay && bayCoveredAbove(host, draft as BayParameters, all), epc)[0];

  /** Renames the part and the members named after it ("Bay 1 front" → "Porch bay front"). */
  const rename = (raw: string) => {
    setNameDraft(null);
    const stem = raw.trim();
    if (!stem || stem === name) return;
    const renamed = members.flatMap((member) => (member.name.startsWith(`${name} `)
      ? [{ id: member.id, name: `${stem}${member.name.slice(name.length)}` }]
      : []));
    const taken = new Set(all.flatMap((element) => (members.includes(element) ? [] : [element.name])));
    const clash = renamed.find((member) => taken.has(member.name));
    if (clash) {
      setRenameProblem(`'${clash.name}' is already taken: choose another name.`);
      return;
    }
    setRenameProblem(null);
    const state = store.getState();
    for (const member of renamed) state.updateElement(member.id, { name: member.name });
    const current = store.getState().elementsById[anchor.id];
    state.updateElement(anchor.id, { extra_json: { ...current.extra_json, hemie_bundle: { ...getHemieBundle(current), bundle_name: stem } } });
  };

  /** Refits the roof with these parameters (undefined clears one). */
  const commitRoof = (next: Partial<RoofParameters>) => {
    const parameters = Object.fromEntries(
      Object.entries({ ...roofParameters(store.getState().elementsById[anchor.id] ?? anchor), ...edits, ...next }).filter(([, value]) => value !== undefined),
    ) as unknown as RoofParameters;
    const drawn = drawRoofPart(store.getState(), parameters, store.getState().elementsById[anchor.id] ?? anchor);
    setProblems((p) => ({ ...p, roof: 'problem' in drawn ? drawn.problem : null }));
    // Typed values stay on screen while they cannot be drawn, as for the other parts.
    setEdits('problem' in drawn ? { ...edits, ...next } : {});
    if (!('problem' in drawn)) onRedrawn(getHemieBundleMembers(Object.values(store.getState().elementsById), tag.bundle_id).map((member) => member.id));
  };

  /** Draws the part with these parameters; typed values stay on screen while they cannot be drawn. */
  const commit = (next: Edits) => {
    if (isRoof) {
      commitRoof({});
      return;
    }
    // A conservatory not entered hides its entered-only fields: a value typed there and not drawn goes.
    const pending = tag.kind === 'conservatory' && ({ ...draft, ...next } as ConservatoryParameters).conservatoryType !== 'non-separated'
      ? Object.fromEntries(Object.entries(edits).filter(([key]) => !CONSERVATORY_ENTERED_FIELDS.has(key)))
      : edits;
    const parameters = Object.fromEntries(
      Object.entries({ ...hemieBundleParameters(anchor, all), ...pending, ...next }).filter(([, value]) => value !== undefined && value !== ''),
    ) as unknown as Parameters;
    if (!host) {
      setEdits({ ...pending, ...next });
      return;
    }
    const drawn = drawHemieBundle(store.getState(), tag.kind, host, parameters, anchor);
    setEdits('problem' in drawn ? { ...pending, ...next } : {});
    if (!('problem' in drawn)) {
      onRedrawn(getHemieBundleMembers(Object.values(store.getState().elementsById), tag.bundle_id).map((member) => member.id));
    }
  };

  const input = (key: keyof Parameters, label: string, placeholder?: string, unit = 'm') => (
    <StandardInput
      type="number"
      value={draft[key] === undefined ? '' : String(draft[key])}
      unit={unit}
      step="0.01"
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setEdits({ ...edits, [key]: e.target.value === '' ? undefined : Number(e.target.value) })}
      // Leaving a field unchanged (as after the focus on placing) redraws nothing, so adds no undo step.
      onBlur={() => { if (key in edits) commit({}); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit({}); }}
      variant="ghost"
      size="md"
    />
  );
  const kit: FieldKit = {
    draft,
    host,
    all,
    level,
    epc,
    commit,
    input,
    numberField: (key, label, options = {}) => (
      <Labelled label={label} note={options.note}>{input(key, label, options.placeholder, options.unit)}</Labelled>
    ),
  };

  const parts = hemieBundleParts(members);
  const marked = parts.find((part) => part.ids.includes(markedId));
  const markedLabel = marked?.ids.length === 1 ? marked.label : null;

  return (
    <div className="element-creator part-editor">
      <div className="element-editor-header">
        <span className="controls-label element-editor-header__title part-editor__kind">{isRoof ? 'Roof' : isBay ? 'Bay' : 'Conservatory'}</span>
        <div className="element-editor-header__name">
          <StandardInput
            type="text"
            value={nameDraft ?? name}
            aria-label="Part name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            variant="ghost"
            size="md"
            className="element-editor-name-input"
          />
        </div>
        <span className="part-editor__host">{roof ? `over ${fhsFloorCodeForCanvasFloor(roof.parameters.level)}` : host ? `on ${host.name}` : null}</span>
      </div>
      {/* Just after placing, GeometryCanvas focuses this field (a choice: its first option). */}
      <div className="part-editor__body" data-first-blank={firstBlank}>
        {roof ? <RoofPartFields view={{ ...roof, parameters: { ...roof.parameters, ...edits } as RoofParameters }} epc={epc} commit={commitRoof} /> : isBay ? <BayFields kit={kit} /> : <ConservatoryFields kit={kit} />}
        {renameProblem ?? (roof ? roofNotice : notice)
          ? <div className="field-source-note part-editor__notice" role="alert">{renameProblem ?? (roof ? roofNotice : notice)}</div>
          : null}
        {roofNotes.map((text) => <div key={text} className="field-source-note">{text}</div>)}
        <div className="part-editor__divider" />
        <div className="part-editor__field">
          <div className="element-label part-editor__label"><span>Parts</span></div>
          <div className="part-editor__chips">
            {parts.map((part) => (
              <button
                key={part.label}
                type="button"
                className={`part-editor__chip${part === marked ? ' is-marked' : ''}`}
                aria-pressed={part === marked}
                onClick={() => onMark(part.ids[0])}
              >
                {part.label}{part.mixed ? ' · Mixed' : ''}
              </button>
            ))}
          </div>
          {roof && epc && roof.parameters.use === 'vaulted' ? (
            // HEM:EPC has no default for a vaulted ceiling: Fabric › Pitched roof holds loft fields only.
            <div className="field-source-note">Give the slopes a U-value: HEM:EPC has no default for a vaulted ceiling.</div>
          ) : roof && roof.parameters.use === 'room' ? (
            <div className="field-source-note">
              Slopes from{' '}
              <button type="button" className="field-source-note__link" onClick={() => openFabricTab(epc ? hemieConstructionSetting('heated_pitched_roof') : undefined)}>
                Fabric › Heated pitched roof
              </button>
              {members.some((m) => getHemieBundle(m)?.role.startsWith('void:')) ? (
                <>
                  ; voids from{' '}
                  <button type="button" className="field-source-note__link" onClick={() => openFabricTab(epc ? hemieConstructionSetting('unheated_pitched_roof') : undefined)}>
                    Pitched roof
                  </button>
                </>
              ) : null}
              .
            </div>
          ) : roof ? (
            <div className="field-source-note">
              {roof.parameters.use === 'vaulted' ? 'Slopes' : 'Loft insulation'} from{' '}
              <button type="button" className="field-source-note__link" onClick={() => openFabricTab(epc ? hemieConstructionSetting('unheated_pitched_roof') : undefined)}>
                Fabric › Pitched roof
              </button>
              {roof.parameters.use === 'vaulted' ? ' unless set on a slope.' : '.'}
            </div>
          ) : null}
          {marked ? (
            <div className="field-source-note">
              <b>{marked.label}</b>:{' '}
              <button type="button" className="field-source-note__link" onClick={() => onEditMembers(marked.ids)}>
                {markedLabel ? 'Edit this element' : 'Edit these elements'}
              </button>{' '}
              for {markedLabel ? 'its' : 'their'} fabric.
            </div>
          ) : null}
        </div>
      </div>
      <div className="element-creator-sticky-footer">
        <div className="form-actions element-editor-actions-row element-editor-actions-row--three">
          <div className="element-editor-footer-group">
            {roofChanged ? (
              <button type="button" className="btn btn-standard btn-yellow editor-action-btn editor-action-btn--primary" onClick={() => commitRoof({ outline: undefined })}>Refit</button>
            ) : host && hostProblem ? (
              <button type="button" className="btn btn-standard btn-yellow editor-action-btn editor-action-btn--primary" onClick={() => commit({})}>Place again</button>
            ) : (
              <button type="button" className="btn btn-standard btn-yellow editor-action-btn editor-action-btn--primary" onClick={onDone}>Done</button>
            )}
            <button type="button" className="btn editor-action-btn editor-action-btn--secondary" onClick={() => setDetaching(true)}>Detach</button>
          </div>
          <div className="element-editor-footer-group element-editor-footer-group--danger">
            <button type="button" className="btn btn-standard btn-danger editor-action-btn editor-action-btn--danger" onClick={onDelete}>Delete</button>
          </div>
        </div>
      </div>
      <DeleteConfirmModal
        isOpen={detaching}
        onClose={() => setDetaching(false)}
        onConfirm={() => {
          setDetaching(false);
          detachHemieBundle(store.getState(), tag.bundle_id);
          onDone();
        }}
        title={`Detach ${name}?`}
        message={isRoof
          ? `Its ${members.length} planes become ordinary roof planes and keep their shape and fabric. Its settings go, and a change to the walls no longer offers a refit.`
          : `Its ${members.length} parts become ordinary elements and keep their shape and fabric. Its settings go${isBay ? '' : ', and it is no longer entered as a conservatory'}.`}
        actionButtonText="Detach"
        confirmVariant="primary"
        hideIrreversibleWarning
      />
    </div>
  );
}

function BayFields({ kit: { draft, host, all, level, epc, commit, input, numberField } }: { kit: FieldKit }) {
  const covered = !!host && bayCoveredAbove(host, draft as BayParameters, all);
  const centred = host && typeof draft.windowHeight === 'number'
    ? ((typeof draft.wallHeight === 'number' ? draft.wallHeight : host.height) - draft.windowHeight) / 2
    : null;
  return (
    <>
      <div className="part-editor__two">
        {numberField('openingWidth', 'Opening width', { note: 'drawn' })}
        {numberField('depth', 'Projection', { note: 'drawn' })}
      </div>
      <div className="part-editor__two">
        {numberField('frontWidth', 'Front facet width', { placeholder: `${fmt(draft.openingWidth)} (box)` })}
        {numberField('wallHeight', 'Bay height', { placeholder: host ? `${fmt(host.height)} (default)` : undefined })}
      </div>
      {covered || draft.roof === 'none'
        ? readout('Roof', 'None', covered ? `F${level + 2} covers it` : 'as saved')
        : choice('Roof', draft.roof ?? '', [{ value: 'flat', label: 'Flat' }, { value: 'pitched', label: `Pitched (${BAY_ROOF_PITCH}°)` }], (roof) => commit({ roof }), draft.roof ? undefined : REQUIRED)}
      <div className="part-editor__divider" />
      <div className="part-editor__field">
        <div className="element-label part-editor__label"><span>Front window</span>{epc ? REQUIRED : null}</div>
        <div className="part-editor__two">
          <Labelled label="Width">{input('windowWidth', 'Front window width')}</Labelled>
          <Labelled label="Height">{input('windowHeight', 'Front window height')}</Labelled>
        </div>
      </div>
      {choice('Side windows', draft.sideWindows ? 'same' : 'none', [{ value: 'none', label: 'None' }, { value: 'same', label: 'Same in both sides' }], (value) => commit({ sideWindows: value === 'same' ? true : undefined }))}
      {draft.sideWindows ? (
        <div className="part-editor__two">
          <Labelled label="Width">{input('sideWindowWidth', 'Side window width')}</Labelled>
          <Labelled label="Height">{input('sideWindowHeight', 'Side window height')}</Labelled>
        </div>
      ) : null}
      {/* HEM:EPC centres the windows; other targets take a sill (shown on EPC too when one was saved). */}
      {!epc || typeof draft.sillHeight === 'number' ? numberField('sillHeight', 'Window sill height', { placeholder: centred !== null ? `${fmt(centred)} (centred)` : 'centred' }) : null}
    </>
  );
}

function ConservatoryFields({ kit: { draft, commit, numberField } }: { kit: FieldKit }) {
  const entered = draft.conservatoryType === 'non-separated';
  const H = typeof draft.wallHeight === 'number' ? draft.wallHeight : null;
  const dwarf = H !== null && typeof draft.wallGlazingFraction === 'number' ? H * (1 - draft.wallGlazingFraction) : null;
  const pitched = draft.roof === 'lean-to' || draft.roof === 'dual';
  return (
    <>
      {choice('Heated and open to the dwelling', entered ? 'yes' : 'no', [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], (answer) => commit({
        conservatoryType: answer === 'yes' ? 'non-separated' : (entered ? undefined : draft.conservatoryType),
        adjacentSpaceType: answer === 'yes' ? undefined : draft.adjacentSpaceType,
      }))}
      {draft.conservatoryType !== 'non-separated' ? (
        <>
          {choice('Not entered in the EPC', draft.conservatoryType ?? '', [{ value: 'separated', label: 'Separated' }, { value: 'unheated', label: 'Unheated' }], (conservatoryType) => commit({ conservatoryType }))}
          {draft.conservatoryType === 'unheated' ? (
            <div className="part-editor__field">
              <div className="element-label part-editor__label"><span>Unheated space type</span></div>
              <StandardDropdown
                value={draft.adjacentSpaceType ?? ''}
                onChange={(value) => commit({ adjacentSpaceType: value || undefined })}
                options={[{ value: '', label: 'Choose…' }, ...SPACE_TYPES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]}
                aria-label="Unheated space type"
                variant="ghost"
                size="md"
              />
              <div className="field-source-note">There is no conservatory option. Pick the closest space type.</div>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="part-editor__two">
        {numberField('width', 'Width', { note: 'drawn' })}
        {numberField('depth', 'Projection', { note: 'drawn' })}
      </div>
      {/* Not entered: the converter reads only the type, the space type and the drawn span. */}
      {entered ? (
        <>
          {numberField('wallHeight', 'Wall height to eaves', { note: REQUIRED })}
          {numberField('wallGlazingFraction', 'Wall glazing fraction', { unit: '0–1', note: REQUIRED })}
          {dwarf !== null ? <div className="field-source-note">Glazed from {fmt(dwarf)} m to the eaves: a {fmt(dwarf)} m dwarf wall.</div> : null}
          <div className="part-editor__divider" />
          {choice('Roof', draft.roof ?? '', [{ value: 'flat', label: 'Flat' }, { value: 'lean-to', label: 'Lean-to' }, { value: 'dual', label: 'Dual' }], (roof) => commit({ roof }), draft.roof ? undefined : REQUIRED)}
          {/* Pitch beside the roof glazing fraction on a pitched roof; alone, the fraction takes the row. */}
          <div className={pitched ? 'part-editor__two' : undefined}>
            {pitched ? numberField('roofPitch', 'Pitch', { unit: '°', placeholder: `${CONSERVATORY_DEFAULT_PITCH} (default)` }) : null}
            {numberField('roofGlazingFraction', 'Roof glazing fraction', { unit: '0–1', note: REQUIRED })}
          </div>
          {pitched
            ? readout('Gables', draft.roof === 'dual' ? 'Front exposed' : 'Left and right exposed', draft.roof === 'dual' ? 'from the front wall' : 'from the side walls')
            : null}
        </>
      ) : null}
    </>
  );
}

/** The conservatory tool's first question, before anything is drawn: HEM:EPC enters only a heated conservatory open to the dwelling. */
export function ConservatoryQuestion({ answer, onAnswer }: { answer: boolean | null; onAnswer: (heatedOpen: boolean) => void }) {
  const card = (value: boolean, label: string, text: string) => (
    <button type="button" className={`part-question__choice${answer === value ? ' is-on' : ''}`} aria-pressed={answer === value} onClick={() => onAnswer(value)}>
      <b>{label}</b>
      <span>{text}</span>
    </button>
  );
  return (
    <div className="element-creator part-question" data-conservatory-question>
      <div className="element-editor-header">
        <span className="controls-label element-editor-header__title part-editor__kind">Conservatory</span>
      </div>
      <div className="part-question__ask">
        <div className="part-question__q">Heated and open to the dwelling?</div>
        {card(true, 'Yes', 'Entered in the EPC as its own building part.')}
        {card(false, 'No', 'Separated or unheated: not entered. The wall it adjoins stays external, or becomes sheltered if unheated.')}
      </div>
      <div className="field-source-note">Then click the opening start and end on a ground-floor wall, and drag out.</div>
    </div>
  );
}

/** A roof part's parameters, its storey outline now and the fit they give. */
function roofView(anchor: Element, all: Element[]): RoofPartView & { problem: string | null } {
  const parameters = roofParameters(anchor) ?? ({ level: 0, at: { x: 0, y: 0 } } as RoofParameters);
  const outline = storeyOutline(all, parameters.level, parameters.at);
  if (!outline) return { parameters, outline: null, fit: null, problem: 'The storey outline under this roof is gone: draw its walls again, or delete the roof.' };
  const fit = fitRoofPart(outline, parameters);
  return 'problem' in fit ? { parameters, outline, fit: null, problem: fit.problem } : { parameters, outline, fit, problem: null };
}
