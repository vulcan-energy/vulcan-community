// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// FHS occupancy is undefined below one bedroom: the upstream wrapper bails with
// "Invalid number of bedrooms: 0" from calc_n_occupants, and the FHS schema
// declares `minimum: 0`, so nothing rejects it before the run. Catch it in the
// editor instead of surfacing an opaque preflight failure at save time.
//
// A bedsit counts as one bedroom (HEM-FHS guidance, Dwelling Details §2.2.4).

import { describe, expect, it } from 'vitest';
import { fhsBedroomCountIssue } from '../globalSettingsValidation';

describe('fhsBedroomCountIssue', () => {
  it('flags zero bedrooms', () => {
    expect(fhsBedroomCountIssue(0)).toMatch(/at least one bedroom/i);
  });

  it('flags negative counts', () => {
    expect(fhsBedroomCountIssue(-1)).toMatch(/at least one bedroom/i);
  });

  it('accepts one or more bedrooms', () => {
    expect(fhsBedroomCountIssue(1)).toBeUndefined();
    expect(fhsBedroomCountIssue(5)).toBeUndefined();
  });

  it('says nothing when the count is not set (a separate required-field issue)', () => {
    expect(fhsBedroomCountIssue(undefined)).toBeUndefined();
  });

  it('ignores non-finite values rather than inventing an issue', () => {
    expect(fhsBedroomCountIssue(Number.NaN)).toBeUndefined();
  });
});
