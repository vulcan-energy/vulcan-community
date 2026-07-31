// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  CommunityModelBuildInput,
  CommunityModelBuildResult,
  CommunityModelBuilder,
} from './communityModelBuildDocumentHost';

export type CommunityModelWorkerBuilderOptions = Readonly<{
  createWorker?: () => Worker;
}>;

type WorkerResponse = Readonly<{
  id: number;
  result?: CommunityModelBuildResult;
  error?: string;
}>;

type Pending = Readonly<{
  resolve(result: CommunityModelBuildResult): void;
  reject(error: Error): void;
}>;

function defaultWorker(): Worker {
  return new Worker(new URL('./communityModelWorker.ts', import.meta.url), {
    type: 'module',
    name: 'vulcan-community-model-build',
  });
}

function responseError(value: unknown): Error {
  return new Error(
    typeof value === 'string' && value.trim()
      ? value
      : 'Community model worker returned an invalid response',
  );
}

/** One lazy worker client per mounted Community editor. */
export function createCommunityModelWorkerBuilder(
  options: CommunityModelWorkerBuilderOptions = {},
): CommunityModelBuilder {
  let worker: Worker | null = null;
  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, Pending>();

  const rejectAll = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  const onMessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    if (
      typeof response !== 'object'
      || response === null
      || !Number.isSafeInteger(response.id)
    ) return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.result !== undefined) request.resolve(response.result);
    else request.reject(responseError(response.error));
  };

  const onError = (event: ErrorEvent) => {
    rejectAll(responseError(event.message));
  };

  const requireWorker = (): Worker => {
    if (disposed) throw new Error('Community model worker was disposed');
    if (worker) return worker;
    worker = (options.createWorker ?? defaultWorker)();
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    return worker;
  };

  return Object.freeze({
    build(input: CommunityModelBuildInput) {
      if (disposed) {
        return Promise.reject(new Error('Community model worker was disposed'));
      }
      const id = nextId;
      nextId += 1;
      const activeWorker = requireWorker();
      return new Promise<CommunityModelBuildResult>((resolve, reject) => {
        pending.set(id, Object.freeze({ resolve, reject }));
        try {
          activeWorker.postMessage({ id, input });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rejectAll(new Error('Community model worker was disposed'));
      if (worker) {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.terminate();
        worker = null;
      }
    },
  });
}
