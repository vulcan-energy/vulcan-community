// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Two families, both about plain JSON data rather than about any renderer:
 *  - record narrowing (`isRecord`, `readRecord`) and the one error-to-string helper;
 *  - the PATH-SEGMENT walk (`segmentsFromLayoutScope`, `getAtPath`, `setAtPath`) that
 *    every direct-render walk uses to read and write a value inside a nested record.
 *
 * R4.6b-2 moved the second family here from `components/DirectAdvancedFields.tsx`,
 * verbatim. Its `lodash/fp` array-hop semantics are a reviewed contract, documented at
 * length on each function below — the point of the move is that a data walk stops being
 * something you have to import a React component module to reach.
 */

import { decodePointerToken } from './schemaRefResolver';

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function errorMessageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Splits a System layout-spec scope (`#/properties/a/properties/b/properties/c`,
 * every token RFC-6901-escaped by `buildSystemAdvancedUischema`) into raw path
 * segments (`['a', 'b', 'c']`). Splitting on the literal '/properties/' delimiter is
 * safe here because escaping turned every raw '/' into '~1' first — no token can
 * contain an unescaped '/' by construction (see
 * `../lib/systemAdvancedUischema`'s docstring). Each segment is then RFC-6901-decoded
 * back to the raw key ('~1' -> '/', '~0' -> '~') the schema/data actually use. Keeps
 * the defensive shape of the function this replaces for a scope that does not start
 * with '#/properties/' (should not happen; every scope here is built by
 * `buildSystemAdvancedUischema` or the flat walk's own literal `#/properties/${key}`)
 * — such a scope is split as-is rather than having a leading segment dropped.
 *
 * R4.3b: replaces the old `pathFromLayoutScope`/`leafKeyFromPath` pair, which joined
 * segments into a single dot-separated string and split it back apart downstream —
 * exactly the scheme a '.' in a raw plant key (e.g. "Zone 1.5 circuit") would corrupt.
 * Everything downstream of this function now carries `segments: string[]` instead of
 * a joined path, until the point (`path = segments.join('.')`, in
 * `renderControlForProperty`) where a dot-joined string is still handed to the control
 * components themselves for their OWN id/propKey derivation — see the residual note
 * there.
 */
export function segmentsFromLayoutScope(scope: string): string[] {
  const tokens = scope.split('/properties/');
  const segments = scope.startsWith('#/properties/') ? tokens.slice(1) : tokens;
  return segments.map(decodePointerToken);
}

/**
 * A path segment is a valid ARRAY index (not an object key) only when canonical:
 * '0', '1', '2', … — never '01' (leading zero), '-1', or a non-numeric string like a
 * plant key that just happens to read as a number in some other base. Shared by
 * `getAtPath` and `setAtPath`'s array-hop support (R4.5 review round 1 fix) so both
 * sides agree on exactly the same set of segments that mean "array index."
 */
function isCanonicalArrayIndexSegment(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment);
}

/**
 * Walk `data` along path segments; undefined at any missing hop.
 *
 * R4.5 review round 1 fix: array hops are now supported, matching `setAtPath`'s own
 * contract below (both must agree, or a value written via one would read back as
 * undefined via the other). When the CURRENT node at a hop is an array, a canonical
 * non-negative-integer segment (see `isCanonicalArrayIndexSegment`) indexes into it;
 * a non-canonical segment against an array (should not happen — every array-hop
 * segment in this file comes from a decoded plant/instance-path token that is
 * genuinely a numeric array index, e.g. a per-item Group's `pathOverride`) returns
 * undefined rather than guessing. A non-array, non-null object hop still uses
 * ordinary record property lookup as before.
 */
export function getAtPath(data: Record<string, unknown>, segments: string[]): unknown {
  let current: unknown = data;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!isCanonicalArrayIndexSegment(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Immutable nested set/delete along path segments (Stage 2.1): clones each hop, and
 * either sets or deletes the leaf. `value === undefined` deletes the leaf key
 * outright (matches the top-level spike behaviour, extended to every hop).
 * Intermediate containers are left in place even if the delete empties them — this is
 * NOT a stylistic choice, it matches what the retired JsonForms path's own JsonForms
 * core reducer did: `UPDATE_DATA`'s unset branch is `lodash/fp/unset(path, data)`
 * (verified in node_modules/@jsonforms/core), which only removes the leaf and never
 * prunes now-empty ancestors. A missing intermediate hop is created as `{}` on set.
 * That matches `lodash/fp/set`'s auto-vivification for an ORDINARY key only: lodash
 * vivifies an ARRAY when the next segment is a canonical integer index — the same
 * integer-key rule the R4.5 note below cites as the reason an existing array must be
 * preserved — and `setAtPathNode` still vivifies `{}` there. Deliberate, not an
 * oversight; see the first divergence below.
 *
 * Two standing divergences from `lodash/fp`, both currently unreachable, both left
 * as-is:
 *  - SET through a MISSING hop whose next segment is an integer builds `{'0': …}`
 *    where lodash would build `[…]`. Nothing can reach it: the only builder that emits
 *    integer path segments (web's `SimplifiedFabricEditor`, per-item Groups) derives
 *    those indices by iterating an array that is already present in the data, so the
 *    array hop is never missing at the moment it is walked.
 *  - DELETE along a missing intermediate hop vivifies `{}` ancestors here where
 *    `lodash/fp/unset` is a no-op — reset buttons only render when a value exists, so
 *    the path is always present.
 *
 * R4.5 review round 1 fix (REAL finding, adversarial review round 1): array hops are
 * now preserved instead of destroyed. `lodash/fp`'s own `set`/`unset` — the contract
 * this function has always cited above — PRESERVES an array for an integer key (it
 * only auto-vivifies a plain object for a NON-numeric key), but this function used to
 * treat every array child as "not a valid container" and silently replace the WHOLE
 * array with `{}` on any nested write under it. A per-item Group's `pathOverride`
 * (e.g. `'window.window_part_list.0'`, from `DirectSpecFields`' self-rooted array
 * shape) would therefore have destroyed every sibling item on the very first edit to
 * item 0. Fixed via `setAtPathNode`: when the EXISTING child at a hop is an array and
 * the next segment is a canonical index (`isCanonicalArrayIndexSegment`), clone the
 * array (`.slice()`) and recurse into that index instead of falling through to record
 * semantics. A data/plant key that happens to be the literal string `'0'` over an
 * OBJECT (not an array) is UNAFFECTED — this only activates when the value ALREADY
 * THERE is an array; a key still only means an array index when the parent it hangs
 * off actually is one.
 *
 * R4.6a (R4.5 review note, closed): unsetting a leaf that IS an array index now
 * SPLICES the element out. R4.5 landed it as `delete arr[i]` — a hole — on the stated
 * grounds that this "mirrors `lodash/fp/unset` exactly". It did, and that was the
 * right call while JsonForms' `UPDATE_DATA` reducer (built on `lodash/fp/unset`) was
 * the reference implementation this whole module was being held against. R4.4/R4.5
 * deleted that reducer along with the rest of JsonForms; parity with it is no longer a
 * contract, and what is left is just the behaviour on its own merits — where a hole is
 * indefensible. `JSON.stringify` serialises a hole as `null`, and `null` is never
 * valid HEM input for any of the arrays this walker can reach: `window_part_list`,
 * `edge_insulation` and `treatment` are all variable-length lists OF OBJECTS, so the
 * export would carry a `null` entry straight into the engine. Splicing keeps the array
 * a list of the things it is a list of; later items shifting down is the correct
 * consequence of removing one, not a side effect to be avoided.
 *
 * UNREACHABLE FROM TODAY'S UI, deliberately fixed anyway (correctness by construction,
 * not a live bug) — though not for the reason this note originally gave. Reaching the
 * leaf-unset above needs a control bound DIRECTLY to an array index, and a production
 * builder does emit exactly that shape: web's `SimplifiedFabricEditor` (`buildControls`,
 * parent repo) puts a `Control` scoped `#/properties/<i>` inside a Group whose
 * `pathOverride` ends at the array, chosen PER ITEM for items that are not objects. So
 * the binding exists in the code; what makes it dead is the data it is chosen against.
 * Every array those fabric sections can reach in today's schemas holds OBJECTS
 * (`BuildingElementTransparent.treatment` / `.shading` / `.window_part_list`,
 * `edge_insulation` on the slab-with-edge-insulation ground variant), so the per-item
 * GROUP branch is taken instead and every live array-hop path ends at a leaf inside an
 * item OBJECT (`sec.list.0.value`), which unsets through the record branch below and
 * never touches the array. The other `DirectSpecFields` host, `SnippetEditor`, emits a
 * flat list of top-level Controls with no array hops at all, and `DirectAdvancedFields`'
 * own two walks never descend into an array — an array-typed property renders as a
 * single JSON-blob `TextControl`.
 *
 * So a primitive-item array is the ONE missing precondition, and the load-bearing thing
 * to watch: the affordance that produces `value === undefined` is already live. It is
 * NOT the reset button that holds this back — that renders for any non-blank value even
 * under the fabric editor's `config={{}}` mount, because with no `elementType` there is
 * no template default and `shouldShowResetToSource` reduces to
 * `isMeaningfulExplicitValue`; clicking it commits `undefined`. The two OTHER routes to
 * `undefined` are the ones that happen not to apply: `NumberControl` commits `''`, not
 * `undefined`, when its input is cleared, and `TextControl`'s unset-on-blur only fires
 * for JSON-like (object/array-typed) rows. So this is about what the next array shape
 * inherits, not about anything a user can do today — which is exactly why it is worth
 * getting right while the reasoning is still written down.
 */
function setAtPathNode(node: unknown, segments: string[], value: unknown): unknown {
  const [head, ...rest] = segments;
  if (Array.isArray(node) && isCanonicalArrayIndexSegment(head)) {
    const index = Number(head);
    const nextArray = node.slice();
    if (rest.length === 0) {
      if (value === undefined) {
        // R4.6a: splice, not `delete` — see the docstring's own paragraph on why the
        // lodash-parity hole died with the reducer it mirrored.
        nextArray.splice(index, 1);
      } else {
        nextArray[index] = value;
      }
      return nextArray;
    }
    nextArray[index] = setAtPathNode(nextArray[index], rest, value);
    return nextArray;
  }
  const record =
    node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>) : {};
  const nextRecord: Record<string, unknown> = { ...record };
  if (rest.length === 0) {
    if (value === undefined) {
      delete nextRecord[head];
    } else {
      nextRecord[head] = value;
    }
    return nextRecord;
  }
  nextRecord[head] = setAtPathNode(nextRecord[head], rest, value);
  return nextRecord;
}

export function setAtPath(obj: Record<string, unknown>, segments: string[], value: unknown): Record<string, unknown> {
  return setAtPathNode(obj, segments, value) as Record<string, unknown>;
}
