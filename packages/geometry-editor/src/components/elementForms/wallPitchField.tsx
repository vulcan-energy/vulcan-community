// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Shared Pitch (degrees) / Surface-facing field — the third parallel
// structure slice-6 brief decision 9 flags for dedup. Opaque, Transparent,
// and Adjacent-like (BuildingElementPartyWall/AdjacentConditionedSpace/
// AdjacentUnconditionedSpace_Simple) each carried their own near-identical
// copy of this field, locatable via the '// Check for shape-pitch mismatches
// before updating' comment and the two window.confirm message strings.
// Follows the serviceLine.tsx renderServiceLineCoreFields precedent: a plain
// exported render function parameterized by opts, not an ElementFormModule
// itself.
//
// Lives as a sibling to wallShared.tsx rather than inside it: wallShared.tsx
// is a pure state hook (STAGE 0's "ownership inversion" seam) with no JSX/
// StandardDropdown/StandardInput imports of its own; this file is a render
// helper in the same shape as serviceLine.tsx's renderServiceLineCoreFields.
// Keeping it separate avoids mixing those two concerns into one file — the
// brief left the choice of location open ("your call, report it"); this is
// that call.
//
// Byte-diff of the three legacy copies:
// - Common to all three: the field label ('Surface facing:' for polygon
//   shape, 'Pitch (degrees):' otherwise), the polygon-shape StandardDropdown
//   (0deg/180deg only, HORIZONTAL_POLYGON_PITCH_OPTIONS), and the
//   non-polygon StandardInput with the shape-pitch-mismatch window.confirm
//   flow (polygon-shape pitch != 0/180 offers "convert to sloped polygon";
//   line-shape pitch === 0/180 offers "convert to polygon"), plus the
//   Facing-up/Vertical/Facing-down/Angled-surface note.
// - Opaque-only, both folded under opts.disabledWhenParented: the polygon
//   dropdown's `disabled={!!parentElement}`, the line/sloped input's
//   `readOnly={!!parentElement}`, and an "Inherited from parent: X" note
//   rendered whenever parentElement is set. The brief names only the
//   disabled/readOnly pair explicitly (decision 9); the "Inherited from
//   parent" note is folded into the same opt as this stage's own design
//   call, since all three exist purely to reflect "a parent element governs
//   this value" and always co-occur in the legacy Opaque copy.
// - Opaque-only: inside the polygon-to-sloped-polygon confirm branch, when
//   the element actually being edited (`currentElement`, resolved fresh from
//   the store by id) is a BuildingElementAdjacentConditionedSpace, strips
//   the VULCAN_UI_PARTY_ELEMENT_KEY extra_json flag before writing the
//   pitch. Reachable ONLY through the currentElement.type !== elementType
//   divergence — the currently *displayed* family (ctx.elementType) can
//   differ from the currently *selected* element's own type when the user
//   has retyped the family picker without an intervening selection change.
//   RELOCATED (origin/main PR #31 "Let pitch carry decimals" port): this
//   check now lives inside wallShared.tsx's single shared `commitTypedPitch`
//   (gated there on `elementType === 'BuildingElementOpaque'`, reproducing
//   this same Opaque-only scoping) rather than here, because commitTypedPitch
//   itself had to become a single, unconditionally-called hook instance —
//   see wallShared.tsx's own header for the full writeup, including why this
//   diverges from what PR #31 shipped upstream (it silently widened the
//   strip to all three fields; this port keeps the pre-existing Opaque-only
//   scoping instead). `opts.cleansPartyFloorKeyOnConvert` is gone from this
//   file accordingly — the render layer no longer makes this decision.
// - Transparent-only: `ref={registerBaseFieldRef(...)}` (SINGULAR) instead
//   of the plural `registerBaseFieldRefs` Opaque/Adjacent-like use — slice-6
//   brief decision 6, Stage 3's problem (verify whether the plural form's
//   extra camelCase-alias registration is load-bearing for validation-ref
//   highlighting). This helper stays agnostic: `opts.refRegistrar` is typed
//   to accept a single field-key string, so either
//   ElementFormRenderCtx.registerBaseFieldRef (singular) or
//   .registerBaseFieldRefs (plural — a strict superset, also accepts
//   string[]) can be passed in without redesigning this helper later.
//
// THIS STAGE (slice-6 brief STAGE 2): only Adjacent-like (elementForms/
// adjacentLikeElement.tsx) calls this, with opts { disabledWhenParented:
// false, refRegistrar: ctx.registerBaseFieldRefs } — a straight lift of its
// existing plain copy, zero behaviour change beyond the PR #31 port above
// (decimal pitch entry, which is a repo-wide/all-three-callers change, not a
// per-family one). Opaque/Transparent keep their inline copies (with the
// extra behaviours still hand-written) until Stages 3-4 switch them over to
// this same helper with their own opts.

import type { CSSProperties, ReactNode } from 'react';
import { StandardDropdown } from '../StandardDropdown';
import { StandardInput } from '../StandardInput';
import {
  HORIZONTAL_POLYGON_PITCH_OPTIONS,
  HORIZONTAL_POLYGON_SURFACE_PLACEHOLDER,
  horizontalPolygonSurfaceSelectValue,
  type NumericDraftInputBinding,
} from './formPrimitives';
import type { ElementFormRenderCtx } from './types';

// Duplicated from ElementCreator.tsx — see buildingElementGround.tsx's
// header for why these small style/pure-formatting constants are
// duplicated per-module rather than imported (other callers left behind in
// ElementCreator.tsx, so they couldn't just move).
const INLINE_FIELD_NOTE_STYLE: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};

export interface WallPitchFieldGroup {
  pitch: number;
  setPitch: (value: number) => void;
  /** Draft-string commit for the typed pitch input (origin/main PR #31 "Let pitch carry
   * decimals: the schemas always did") — one shared instance, owned by wallShared.tsx and
   * fed straight through here; see this file's own header and wallShared.tsx's for the
   * full port writeup. */
  pitchDraftInput: NumericDraftInputBinding;
  parentElement: string;
}

export interface WallPitchFieldOptions {
  /** Opaque-only extra behaviour (decision 9) — see module header. */
  disabledWhenParented: boolean;
  /** Registers the field's outer ref. Pass ctx.registerBaseFieldRefs
   * (plural — Opaque/Adjacent-like) or ctx.registerBaseFieldRef (singular —
   * Transparent, decision 6); both satisfy this narrower single-string
   * signature. */
  refRegistrar: (fieldKey: string) => (node: HTMLDivElement | null) => void;
}

export function renderWallPitchField(
  group: WallPitchFieldGroup,
  ctx: ElementFormRenderCtx,
  opts: WallPitchFieldOptions,
): ReactNode {
  const { pitch, setPitch, pitchDraftInput, parentElement } = group;
  const {
    elementType,
    selection,
    updateElement,
    fieldUnit,
    renderFieldLabel,
    selectedShape,
    horizontalPolygonControlPitch,
  } = ctx;

  return (
    <>
      {renderFieldLabel(selectedShape === 'polygon' ? 'Surface facing:' : 'Pitch (degrees):', elementType, 'pitch')}
      <div
        className="element-input"
        style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
        ref={opts.refRegistrar('pitch')}
      >
        {selectedShape === 'polygon' ? (
          <StandardDropdown
            value={horizontalPolygonSurfaceSelectValue(horizontalPolygonControlPitch)}
            unit={fieldUnit('pitch')}
            onChange={(value) => {
              if (value !== '0' && value !== '180') return;
              const next = value === '180' ? 180 : 0;
              setPitch(next);
              if (selection?.type === 'element') {
                updateElement(selection.id, { pitch: next });
              }
            }}
            options={HORIZONTAL_POLYGON_PITCH_OPTIONS}
            placeholder={HORIZONTAL_POLYGON_SURFACE_PLACEHOLDER}
            variant="ghost"
            size="md"
            disabled={opts.disabledWhenParented ? !!parentElement : undefined}
          />
        ) : (
          <StandardInput
            type="text"
            inputMode="decimal"
            value={pitchDraftInput.inputValue}
            unit={fieldUnit('pitch')}
            onChange={pitchDraftInput.handleInputChange}
            onBlur={pitchDraftInput.handleBlur}
            min="0"
            max="180"
            readOnly={opts.disabledWhenParented ? !!parentElement : undefined}
            variant="ghost"
            size="md"
          />
        )}
        {selectedShape !== 'polygon' && (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            {pitch === 0
              ? 'Facing up (horizontal)'
              : pitch === 90
                ? 'Vertical'
                : pitch === 180
                  ? 'Facing down (horizontal)'
                  : 'Angled surface'}
          </div>
        )}
        {opts.disabledWhenParented && parentElement && (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            Inherited from parent: {parentElement}
          </div>
        )}
      </div>
    </>
  );
}
