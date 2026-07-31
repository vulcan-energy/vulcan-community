// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GeometryWorkspaceResourcePort } from '../../../packages/geometry-editor-host/src';

import assembliesText from '../../../data/assembly_library/assemblies.json?raw';
import cavitiesText from '../../../data/assembly_library/cavity_resistances.json?raw';
import materialsText from '../../../data/assembly_library/materials.json?raw';
import defaultsTemplateText from '../../../data/defaults/defaults_template.json?raw';
import junctionPsiText from '../../../data/junction_psi_defaults/table_3_7_default_psi.csv?raw';

export const COMMUNITY_STARTER_RESOURCES = Object.freeze([
  Object.freeze({
    path: 'input/defaults/defaults_template.json',
    content: defaultsTemplateText,
  }),
  Object.freeze({
    path: 'input/assembly_library/materials.json',
    content: materialsText,
  }),
  Object.freeze({
    path: 'input/assembly_library/cavity_resistances.json',
    content: cavitiesText,
  }),
  Object.freeze({
    path: 'input/assembly_library/assemblies.json',
    content: assembliesText,
  }),
  Object.freeze({
    path: 'input/junction_psi_defaults/table_3_7_default_psi.csv',
    content: junctionPsiText,
  }),
]);

export const COMMUNITY_STARTER_RESOURCE_PATHS = Object.freeze(
  COMMUNITY_STARTER_RESOURCES.map(({ path }) => path),
);

const STARTER_DIRECTORIES = Object.freeze([
  'input',
  'input/defaults',
  'input/assembly_library',
  'input/junction_psi_defaults',
]);

/** Adds only absent starter files. Existing user-owned resources are never replaced. */
export async function installCommunityStarterWorkspace(
  workspaceResourcePort: GeometryWorkspaceResourcePort,
  sourceResourcePort?: GeometryWorkspaceResourcePort,
): Promise<void> {
  if (workspaceResourcePort.availability !== 'available') {
    throw new Error('Community starter workspace requires an available folder');
  }
  for (const path of STARTER_DIRECTORIES) {
    await workspaceResourcePort.ensureDirectory(path);
  }
  for (const resource of COMMUNITY_STARTER_RESOURCES) {
    if (!(await workspaceResourcePort.exists(resource.path))) {
      const content = sourceResourcePort === undefined
        ? resource.content
        : await sourceResourcePort.readText(resource.path);
      await workspaceResourcePort.writeText(resource.path, content);
    }
  }
}
