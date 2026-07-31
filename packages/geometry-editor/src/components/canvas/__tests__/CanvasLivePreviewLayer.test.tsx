// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasLivePreviewLayer } from '../CanvasLivePreviewLayer';

vi.mock('react-konva', () => ({
  Layer: ({ children, listening, name }: { children?: React.ReactNode; listening?: boolean; name?: string }) => (
    <div
      data-testid="konva-layer"
      data-listening={listening === false ? 'false' : 'true'}
      data-name={name ?? ''}
    >
      {children}
    </div>
  ),
}));

describe('CanvasLivePreviewLayer', () => {
  it('renders live previews in a named non-listening Konva layer', () => {
    render(
      <CanvasLivePreviewLayer>
        <div data-testid="preview-child" />
      </CanvasLivePreviewLayer>,
    );

    const layer = screen.getByTestId('konva-layer');
    expect(layer).toHaveAttribute('data-name', 'geometry-live-preview-layer');
    expect(layer).toHaveAttribute('data-listening', 'false');
    expect(screen.getByTestId('preview-child')).toBeInTheDocument();
  });
});
