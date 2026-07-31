// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { parseDimensionOverride } from "../../lib/globalSettingsValidation";

describe("dwelling dimension overrides", () => {
  it("keeps a usable measurement, including a deliberate zero", () => {
    expect(parseDimensionOverride("42")).toBe(42);
    expect(parseDimensionOverride("42.5")).toBe(42.5);
    expect(parseDimensionOverride(" 42.5 ")).toBe(42.5);
    expect(parseDimensionOverride("0")).toBe(0);
  });

  it("treats unusable input as no override rather than a hard zero", () => {
    // The coercion this replaces stored 0 as an explicit manual override, which
    // reaches the HEM input as a deliberate 0 m² / 0 m and silently replaces the
    // derived geometry. Undefined means "use the derived value", as clearing does.
    for (const raw of ["abc", "-", "-3", "-0.5", "NaN", "", " ", "e5"]) {
      expect(parseDimensionOverride(raw), raw).toBeUndefined();
    }
  });
});
