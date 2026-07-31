// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createElement, type ReactNode } from 'react';
import { defineGeometryEditorContributions } from '../../../packages/geometry-editor-host/src';
import {
  GlobalSettingsFilenameAction,
  type FilenameBarActionContext,
} from '../../../packages/geometry-editor/src';

export type CommunityGeometryEditorContributionRenderers = Readonly<{
  renderFilesAction: () => ReactNode;
}>;

/** Creates one isolated Community composition for one editor mount. */
export function createCommunityGeometryEditorContributions(
  runtime: CommunityGeometryEditorContributionRenderers,
) {
  const renderFilesAction = runtime.renderFilesAction;
  if (typeof renderFilesAction !== 'function') {
    throw new TypeError('Community Files action renderer must be a function');
  }
  return defineGeometryEditorContributions<
    unknown,
    ReactNode,
    FilenameBarActionContext
  >({
    canvasPanels: [],
    filenameActions: [
      Object.freeze({
        id: 'files',
        order: 100,
        render: () => renderFilesAction(),
      }),
      Object.freeze({
        id: 'globalSettings',
        order: 200,
        isAvailable: (context) => Boolean(context.onOpenDefaults),
        render: (context) => createElement(GlobalSettingsFilenameAction, { context }),
      }),
    ],
  });
}
