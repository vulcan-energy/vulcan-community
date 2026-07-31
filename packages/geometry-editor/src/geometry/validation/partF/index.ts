// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Part F (England — Domestic ventilation) validation barrel.
//
// Composition:
//   - rules.ts    — pure threshold formulas + the evaluator (mirrors upstream parity)
//   - placement.ts — batched-CTA placement plan (window/space matching)
//   - selector.ts  — store-state → context + findings (uses defaultsCache for element fallbacks)

export * from './rules';
export * from './placement';
export * from './selector';
