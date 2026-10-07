// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
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

const subscribeStaticSchema = (): (() => void) => () => {};
const staticSchemaRevision = (): number => 0;

export function useGeometrySchemaPort(): GeometrySchemaPort {
  const port = useContext(GeometrySchemaPortContext);
  const revision = useSyncExternalStore(
    port.subscribe ?? subscribeStaticSchema,
    port.getRevision ?? staticSchemaRevision,
    port.getRevision ?? staticSchemaRevision,
  );
  // Existing field memos depend on the port; a new snapshot refreshes them without
  // remounting the editor or discarding an in-progress input draft.
  return useMemo(() => ({ ...port, getRevision: () => revision }), [port, revision]);
}

export function useGeometryWorkspaceResourcePort(): GeometryWorkspaceResourcePort {
  return useContext(GeometryWorkspaceResourcePortContext);
}

export function useGeometrySourceComparisonPort(): GeometrySourceComparisonPort {
  return useContext(GeometrySourceComparisonPortContext);
}
