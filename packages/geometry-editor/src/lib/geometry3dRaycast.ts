// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import * as THREE from 'three';

export const ignoreObjectRaycast: THREE.Object3D['raycast'] = () => {};

const defaultMeshRaycast: THREE.Object3D['raycast'] = THREE.Mesh.prototype.raycast;

export function meshRaycastForInteractivity(isInteractive: boolean): THREE.Object3D['raycast'] {
  return isInteractive ? defaultMeshRaycast : ignoreObjectRaycast;
}
