// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where a field's value comes from. Every "is this entered, a default or from the drawing"
 * decision asks `provenanceOf`, so the answer can move from value comparison to a recorded source
 * (the provenance table, FOUNDATION_PLAN.md §3) without changing a caller.
 */
export type FieldProvenance = 'user' | 'source';

export type ProvenanceRecord = { kind: 'element' | 'zone' | 'floor' | 'metadata'; id: string };

/** What the value-based answer compares: the value the source gives, and the value stated. */
export type ProvenanceProbe = {
  source: number | null | undefined;
  current: number | '' | null | undefined;
  /** Largest difference that still reads as the source's value. */
  tolerance?: number;
};

/**
 * `user` when the stated value differs from its source; `source` when it is blank, equal within
 * `tolerance`, or there is no source to differ from.
 */
// ponytail: value comparison until the provenance table records sources; `record` and `field`
// are its keys then.
export function provenanceOf(_record: ProvenanceRecord, _field: string, probe: ProvenanceProbe): FieldProvenance {
  const { source, current, tolerance = 0.005 } = probe;
  if (source === null || source === undefined || !Number.isFinite(source)) return 'source';
  return typeof current === 'number' && Number.isFinite(current) && Math.abs(current - source) > tolerance
    ? 'user'
    : 'source';
}
