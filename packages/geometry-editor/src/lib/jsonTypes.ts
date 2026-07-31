// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

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
