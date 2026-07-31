// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

let overlayPdfWorkerConfigured = false;

const ensureOverlayPdfWorker = () => {
  if (overlayPdfWorkerConfigured) return;
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  overlayPdfWorkerConfigured = true;
};

export type OverlayPdfDocumentHandle = {
  file: File;
  pdf: PDFDocumentProxy;
  numPages: number;
};

export const openOverlayPdfDocument = async (file: File): Promise<OverlayPdfDocumentHandle> => {
  ensureOverlayPdfWorker();
  const data = await file.arrayBuffer();
  const pdf = await getDocument({ data }).promise;
  return {
    file,
    pdf,
    numPages: pdf.numPages,
  };
};

export const renderOverlayPdfPageToBlob = async (
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale = 1.5,
): Promise<Blob> => {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create canvas context for PDF overlay rendering.');
  }
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Failed to encode PDF overlay image.'));
    }, 'image/png');
  });
};

export const renderOverlayPdfPageToFile = async (
  pdf: PDFDocumentProxy,
  pageNumber: number,
  outputName: string,
  scale = 2,
): Promise<File> => {
  const blob = await renderOverlayPdfPageToBlob(pdf, pageNumber, scale);
  return new File([blob], outputName, { type: 'image/png' });
};
