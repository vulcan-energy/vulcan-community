// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import * as THREE from 'three';

type GeometryCanvasRendererProps = Omit<THREE.WebGLRendererParameters, 'canvas'> & {
  canvas: NonNullable<THREE.WebGLRendererParameters['canvas']>;
};

type GeometryCanvasRendererConstructor = new (
  parameters?: THREE.WebGLRendererParameters,
) => THREE.WebGLRenderer;

export function createGeometryCanvasRenderer(
  defaultProps: GeometryCanvasRendererProps,
  Renderer: GeometryCanvasRendererConstructor = THREE.WebGLRenderer,
): THREE.WebGLRenderer {
  const { canvas } = defaultProps;
  let constructing = true;
  const suppressRestoreDuringConstruction = (event: Event) => {
    if (!constructing) return;
    event.stopImmediatePropagation();
  };

  canvas.addEventListener('webglcontextrestored', suppressRestoreDuringConstruction, true);
  try {
    return new Renderer(defaultProps);
  } finally {
    constructing = false;
    canvas.removeEventListener('webglcontextrestored', suppressRestoreDuringConstruction, true);
  }
}
