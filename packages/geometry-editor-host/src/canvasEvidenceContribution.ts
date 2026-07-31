// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GeometryCanvasOverlayEvidenceRequest = Readonly<{
  runtimeFile: File;
  runtimePath: string;
  sourceFile?: File;
  sourcePath?: string;
}>;

export type GeometryCanvasEvidenceState = Readonly<{
  lookupByElement: ReadonlyMap<string, readonly unknown[]>;
  hasLinkedDraft: boolean;
  uploadOverlayEvidence?: (
    request: GeometryCanvasOverlayEvidenceRequest,
  ) => Promise<void>;
}>;

export interface GeometryCanvasEvidenceContribution {
  /** Stable compile-time hook registered by the host composition. */
  useEvidence(documentFileName: string): GeometryCanvasEvidenceState;
}

const EMPTY_LOOKUP: ReadonlyMap<string, readonly unknown[]> = new Map();
const EMPTY_STATE: GeometryCanvasEvidenceState = Object.freeze({
  lookupByElement: EMPTY_LOOKUP,
  hasLinkedDraft: false,
});

/** Community/no-evidence composition: no controls, service or network path. */
export const unavailableGeometryCanvasEvidenceContribution:
  GeometryCanvasEvidenceContribution = Object.freeze({
    useEvidence: () => EMPTY_STATE,
  });
