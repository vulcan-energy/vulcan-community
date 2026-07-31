// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createContext,
  createElement,
  useContext,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  unavailableGeometrySchemaPort,
  type GeometrySchemaPort,
} from './schemaPort';
import {
  unavailableGeometryWorkspaceResourcePort,
  type GeometryWorkspaceResourcePort,
} from './workspaceResourcePort';
import {
  unavailableGeometrySourceComparisonPort,
  type GeometrySourceComparisonPort,
} from './sourceComparisonPort';

const GeometrySchemaPortContext = createContext<GeometrySchemaPort>(
  unavailableGeometrySchemaPort,
);

const GeometryWorkspaceResourcePortContext =
  createContext<GeometryWorkspaceResourcePort>(
    unavailableGeometryWorkspaceResourcePort,
  );

const GeometrySourceComparisonPortContext =
  createContext<GeometrySourceComparisonPort>(
    unavailableGeometrySourceComparisonPort,
  );

export type GeometryEditorServicePortsProviderProps = Readonly<{
  schemaPort: GeometrySchemaPort;
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  sourceComparisonPort?: GeometrySourceComparisonPort;
  children: ReactNode;
}>;

/** Supplies per-host services without introducing an ambient mutable singleton. */
export function GeometryEditorServicePortsProvider({
  schemaPort,
  workspaceResourcePort,
  sourceComparisonPort = unavailableGeometrySourceComparisonPort,
  children,
}: GeometryEditorServicePortsProviderProps): ReactElement {
  return createElement(
    GeometrySchemaPortContext.Provider,
    { value: schemaPort },
    createElement(
      GeometryWorkspaceResourcePortContext.Provider,
      { value: workspaceResourcePort },
      createElement(
        GeometrySourceComparisonPortContext.Provider,
        { value: sourceComparisonPort },
        children,
      ),
    ),
  );
}

export function useGeometrySchemaPort(): GeometrySchemaPort {
  return useContext(GeometrySchemaPortContext);
}

export function useGeometryWorkspaceResourcePort(): GeometryWorkspaceResourcePort {
  return useContext(GeometryWorkspaceResourcePortContext);
}

export function useGeometrySourceComparisonPort(): GeometrySourceComparisonPort {
  return useContext(GeometrySourceComparisonPortContext);
}
