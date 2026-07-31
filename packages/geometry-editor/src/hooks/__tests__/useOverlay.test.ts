// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';

const mockCreateDir = vi.fn().mockResolvedValue(undefined);
const mockWriteFileBytes = vi.fn().mockResolvedValue(undefined);
const mockReadFileBlob = vi.fn().mockRejectedValue(new Error('not needed'));
const mockDeleteFile = vi.fn().mockResolvedValue(undefined);
const mockOpenOverlayPdfDocument = vi.fn();
const mockRenderOverlayPdfPageToBlob = vi.fn();
const mockRenderOverlayPdfPageToFile = vi.fn();

const workspaceResourcePort: GeometryWorkspaceResourcePort = {
  availability: 'available',
  readText: vi.fn(),
  readFile: (...args) => mockReadFileBlob(...args),
  writeText: vi.fn(),
  writeBytes: (...args) => mockWriteFileBytes(...args),
  removeFile: (...args) => mockDeleteFile(...args),
  ensureDirectory: (...args) => mockCreateDir(...args),
  exists: vi.fn(),
  list: vi.fn(),
};

vi.mock('../../lib/overlayPdfImport', () => ({
  openOverlayPdfDocument: (...args: any[]) => mockOpenOverlayPdfDocument(...args),
  renderOverlayPdfPageToBlob: (...args: any[]) => mockRenderOverlayPdfPageToBlob(...args),
  renderOverlayPdfPageToFile: (...args: any[]) => mockRenderOverlayPdfPageToFile(...args),
}));

import { useOverlay } from '../useOverlay';

describe('useOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-overlay'),
      revokeObjectURL: vi.fn(),
    });
    mockOpenOverlayPdfDocument.mockResolvedValue({
      file: null,
      pdf: {} as any,
      numPages: 5,
    });
    mockRenderOverlayPdfPageToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  });

  it('accepts image overlays and persists them to the workspace', async () => {
    const setGuideOverlay = vi.fn();
    const uploadOverlayEvidence = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useOverlay({
        workspaceResourcePort,
        guideOverlay: null,
        setGuideOverlay,
        updateGuideOverlay: vi.fn(),
        scale: 1,
        panOffset: { x: 0, y: 0 },
        canvasCenter: { x: 0, y: 0 },
        stageSize: { width: 1000, height: 800 },
        uploadOverlayEvidence,
        onBeforeEnterCalibrateMode: vi.fn(),
      }),
    );

    const png = new File(['png'], 'ground_floor.png', { type: 'image/png' });

    await act(async () => {
      await result.current.handleOverlayFileChosen(png);
    });

    expect(mockCreateDir).toHaveBeenCalledWith('input/overlays');
    expect(mockWriteFileBytes).toHaveBeenCalled();
    expect(setGuideOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/^input\/overlays\/.+_ground_floor\.png$/),
      }),
    );
    expect(uploadOverlayEvidence).toHaveBeenCalledWith(expect.objectContaining({
      runtimeFile: png,
      runtimePath: expect.stringMatching(/^input\/overlays\/.+_ground_floor\.png$/),
    }));
    expect(result.current.showOverlayPanel).toBe(true);
    expect(result.current.overlayCalibrateMode).toBe(true);
  });

  it('opens the PDF page picker instead of rejecting PDF inputs', async () => {
    const setGuideOverlay = vi.fn();

    const { result } = renderHook(() =>
      useOverlay({
        workspaceResourcePort,
        guideOverlay: null,
        setGuideOverlay,
        updateGuideOverlay: vi.fn(),
        setGuideOverlaySource: vi.fn(),
        scale: 1,
        panOffset: { x: 0, y: 0 },
        canvasCenter: { x: 0, y: 0 },
        stageSize: { width: 1000, height: 800 },
        uploadOverlayEvidence: vi.fn().mockResolvedValue(undefined),
        onBeforeEnterCalibrateMode: vi.fn(),
      }),
    );

    const pdf = new File(['%PDF-1.7'], 'floorplans.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.handleOverlayFileChosen(pdf);
    });

    expect(window.alert).not.toHaveBeenCalledWith('Please select a PNG or JPG image.');
    expect(mockOpenOverlayPdfDocument).toHaveBeenCalledWith(pdf);
    expect(result.current.overlayPdfImportState).toEqual(
      expect.objectContaining({
        isOpen: true,
        fileName: 'floorplans.pdf',
        page: 1,
        numPages: 5,
      }),
    );
  });

  it('deletes local overlay files when clearing the overlay', async () => {
    const setGuideOverlay = vi.fn();
    const setGuideOverlaySource = vi.fn();
    mockReadFileBlob.mockResolvedValueOnce(new File(['png'], 'floorplans_p3.png', { type: 'image/png' }));

    const { result } = renderHook(() =>
      useOverlay({
        workspaceResourcePort,
        guideOverlay: {
          path: 'input/overlays/floorplans_p3.png',
          opacity01: 0.5,
          pos_m: { x: 0, y: 0 },
          pxPerM: 50,
        },
        guideOverlaySource: {
          kind: 'pdf',
          source_path: 'input/overlay-sources/floorplans.pdf',
          source_filename: 'floorplans.pdf',
          page: 3,
          derived_overlay_path: 'input/overlays/floorplans_p3.png',
        },
        setGuideOverlay,
        setGuideOverlaySource,
        updateGuideOverlay: vi.fn(),
        scale: 1,
        panOffset: { x: 0, y: 0 },
        canvasCenter: { x: 0, y: 0 },
        stageSize: { width: 1000, height: 800 },
        onBeforeEnterCalibrateMode: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.clearOverlayFiles();
    });

    expect(setGuideOverlay).toHaveBeenCalledWith(null);
    expect(setGuideOverlaySource).toHaveBeenCalledWith(null);
    expect(mockDeleteFile).toHaveBeenCalledWith('input/overlays/floorplans_p3.png');
    expect(mockDeleteFile).toHaveBeenCalledWith('input/overlay-sources/floorplans.pdf');
  });
});
