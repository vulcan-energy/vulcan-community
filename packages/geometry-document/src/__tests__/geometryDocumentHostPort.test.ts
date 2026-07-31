// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryGeometryDocumentSession,
  createSerializedGeometryDocumentHostPort,
  type GeometryDocumentHostDriver,
  type GeometryDocumentHostPort,
  type GeometryDocumentHostResult,
  type GeometryDocumentHostSnapshot,
  type GeometryDocumentHostTarget,
} from '../index';

const COMPLETED = Object.freeze({ status: 'completed' as const }) as GeometryDocumentHostResult;
const SUPERSEDED = Object.freeze({ status: 'superseded' as const }) as GeometryDocumentHostResult;

type DriverSnapshot = Omit<GeometryDocumentHostSnapshot, 'operation'>;
type Operation = 'save' | 'new' | 'open' | 'delete' | 'duplicate';
type PreparedOperation = Readonly<{
  run(): Promise<GeometryDocumentHostResult>;
}>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function target(
  id: string,
  fileName = `${id}.csv`,
  storageVersion = `${id}:v1`,
): GeometryDocumentHostTarget {
  return Object.freeze({ id, fileName, storageVersion });
}

function createDriverHarness(options: Readonly<{
  activeDocument?: GeometryDocumentHostTarget | null;
  prepare?: (operation: Operation, request: unknown) => PreparedOperation;
}> = {}) {
  const session = createInMemoryGeometryDocumentSession({
    fileName: 'Home.csv',
    text: 'version,0\n',
    persisted: true,
  });
  let activeDocument = options.activeDocument === undefined
    ? target('home', 'Home.csv')
    : options.activeDocument;
  let snapshot: DriverSnapshot = Object.freeze({
    document: session.getSnapshot(),
    activeDocument,
  });
  const listeners = new Set<() => void>();
  const prepared: Array<Readonly<{
    operation: Operation;
    request: unknown;
    task: PreparedOperation;
  }>> = [];

  const publish = () => {
    snapshot = Object.freeze({
      document: session.getSnapshot(),
      activeDocument,
    });
    for (const listener of [...listeners]) listener();
  };
  const unsubscribeSession = session.subscribe(publish);

  const prepare = (operation: Operation, request: unknown): PreparedOperation => {
    const task = options.prepare?.(operation, request) ?? Object.freeze({
      run: async () => COMPLETED,
    });
    prepared.push(Object.freeze({ operation, request, task }));
    return task;
  };

  const updateFileName = vi.fn((raw: string) => {
    session.updateDocument({ fileName: raw });
  });
  const isDirty = vi.fn(() => session.getSnapshot().isDirty);
  const dispose = vi.fn(() => {
    unsubscribeSession();
    listeners.clear();
  });

  const driver = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    updateFileName,
    isDirty,
    prepareSave: () => prepare('save', undefined),
    prepareNew: (request: unknown) => prepare('new', request),
    prepareOpen: (request: unknown) => prepare('open', request),
    prepareDelete: (request: unknown) => prepare('delete', request),
    prepareDuplicate: (request: unknown) => prepare('duplicate', request),
    dispose,
  }) as GeometryDocumentHostDriver;

  return {
    driver,
    session,
    prepared,
    updateFileName,
    isDirty,
    dispose,
    touch() {
      publish();
    },
    setActiveDocument(next: GeometryDocumentHostTarget | null) {
      activeDocument = next;
      publish();
    },
  };
}

function createPort(
  driver: GeometryDocumentHostDriver,
): GeometryDocumentHostPort {
  return createSerializedGeometryDocumentHostPort({ driver });
}

describe('serialized geometry document host port', () => {
  it('does not subscribe its driver until a committed consumer subscribes, and releases the last listener', () => {
    const harness = createDriverHarness();
    const unsubscribeDriver = vi.fn();
    const subscribeDriver = vi.fn(() => unsubscribeDriver);
    const driver: GeometryDocumentHostDriver = Object.freeze({
      ...harness.driver,
      subscribe: subscribeDriver,
    });

    const port = createPort(driver);
    expect(subscribeDriver).not.toHaveBeenCalled();

    const unsubscribeFirst = port.subscribe(vi.fn());
    const unsubscribeSecond = port.subscribe(vi.fn());
    expect(subscribeDriver).toHaveBeenCalledOnce();

    unsubscribeFirst();
    expect(unsubscribeDriver).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(unsubscribeDriver).toHaveBeenCalledOnce();

    const unsubscribeThird = port.subscribe(vi.fn());
    expect(subscribeDriver).toHaveBeenCalledTimes(2);
    unsubscribeThird();
    expect(unsubscribeDriver).toHaveBeenCalledTimes(2);
    port.dispose();
  });

  it('captures and freezes one driver snapshot without trusting mutable objects or repeated accessors', () => {
    const rawDocument = {
      fileName: 'Mutable.csv',
      text: 'before\n',
      derivedResources: [],
      sourceFiles: [],
      revision: 2,
      persistedRevision: 1,
      isDirty: true,
    };
    const rawTarget = {
      id: 'mutable',
      fileName: 'Mutable.csv',
      storageVersion: 'mutable:v1',
    };
    let activeDocumentReads = 0;
    const rawSnapshot = {
      document: rawDocument,
      get activeDocument() {
        activeDocumentReads += 1;
        return rawTarget;
      },
    };
    const prepared = Object.freeze({ run: async () => COMPLETED });
    const driver: GeometryDocumentHostDriver = {
      getSnapshot: () => rawSnapshot,
      subscribe: () => () => undefined,
      updateFileName: vi.fn(),
      isDirty: () => true,
      prepareSave: () => prepared,
      prepareNew: () => prepared,
      prepareOpen: () => prepared,
      prepareDelete: () => prepared,
      prepareDuplicate: () => prepared,
      dispose: vi.fn(),
    };

    const port = createPort(driver);
    const captured = port.getSnapshot();
    expect(activeDocumentReads).toBe(1);
    expect(captured.document).not.toBe(rawDocument);
    expect(captured.activeDocument).not.toBe(rawTarget);
    expect(Object.isFrozen(captured.document)).toBe(true);
    expect(Object.isFrozen(captured.activeDocument)).toBe(true);

    rawDocument.fileName = 'Changed.csv';
    rawDocument.text = 'after\n';
    rawTarget.id = 'changed';
    expect(port.getSnapshot()).toBe(captured);
    expect(port.getSnapshot()).toMatchObject({
      document: { fileName: 'Mutable.csv', text: 'before\n' },
      activeDocument: { id: 'mutable' },
    });
    expect(activeDocumentReads).toBe(1);
    port.dispose();
  });

  it('publishes frozen stable snapshots and delegates filename and dirty state to one canonical driver', () => {
    const harness = createDriverHarness();
    const port = createPort(harness.driver);
    const initial = port.getSnapshot();

    expect(port.getSnapshot()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(initial).toMatchObject({
      operation: null,
      document: { fileName: 'Home.csv', isDirty: false },
      activeDocument: { id: 'home' },
    });
    expect(port.isDirty()).toBe(false);
    expect(harness.isDirty).toHaveBeenCalledOnce();

    const listener = vi.fn();
    const unsubscribe = port.subscribe(listener);
    port.updateFileName('Renamed.csv');

    expect(harness.updateFileName).toHaveBeenCalledOnce();
    expect(harness.updateFileName).toHaveBeenCalledWith('Renamed.csv');
    expect(port.getSnapshot()).not.toBe(initial);
    expect(port.getSnapshot()).toMatchObject({
      operation: null,
      document: { fileName: 'Renamed.csv', isDirty: true },
    });
    expect(Object.isFrozen(port.getSnapshot())).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(port.isDirty()).toBe(true);

    port.updateFileName('Home.csv');
    expect(port.getSnapshot()).toMatchObject({
      document: { fileName: 'Home.csv', isDirty: false },
    });
    expect(port.isDirty()).toBe(false);
    expect(harness.isDirty).toHaveBeenCalledTimes(3);

    unsubscribe();
    unsubscribe();
    const notifications = listener.mock.calls.length;
    port.updateFileName('After unsubscribe.csv');
    expect(listener).toHaveBeenCalledTimes(notifications);
    port.dispose();
  });

  it('prepares synchronously, then runs mixed document operations in FIFO order', async () => {
    const gates = new Map<Operation, ReturnType<typeof deferred<GeometryDocumentHostResult>>>();
    const starts: Operation[] = [];
    const harness = createDriverHarness({
      prepare: (operation) => {
        const gate = deferred<GeometryDocumentHostResult>();
        gates.set(operation, gate);
        return Object.freeze({
          run: vi.fn(() => {
            starts.push(operation);
            return gate.promise;
          }),
        });
      },
    });
    const port = createPort(harness.driver);
    const notifications: Array<GeometryDocumentHostSnapshot['operation']> = [];
    port.subscribe(() => notifications.push(port.getSnapshot().operation));

    const pendingSave = port.save();
    const pendingOpen = port.open({ target: target('other'), dirtyDecision: 'discard' });
    const pendingDelete = port.delete({ target: target('old'), confirmed: true });

    expect(harness.prepared.map(({ operation }) => operation)).toEqual([
      'save',
      'open',
      'delete',
    ]);
    await vi.waitFor(() => expect(starts).toEqual(['save']));
    expect(port.getSnapshot().operation).toBe('save');

    harness.touch();
    expect(port.getSnapshot().operation).toBe('save');
    gates.get('save')!.resolve(COMPLETED);
    await vi.waitFor(() => expect(starts).toEqual(['save', 'open']));
    expect(port.getSnapshot().operation).toBe('open');

    gates.get('open')!.resolve(COMPLETED);
    await vi.waitFor(() => expect(starts).toEqual(['save', 'open', 'delete']));
    expect(port.getSnapshot().operation).toBe('delete');

    gates.get('delete')!.resolve(COMPLETED);
    await expect(Promise.all([pendingSave, pendingOpen, pendingDelete])).resolves.toEqual([
      COMPLETED,
      COMPLETED,
      COMPLETED,
    ]);
    expect(port.getSnapshot().operation).toBeNull();
    expect(notifications).toContain('save');
    expect(notifications).toContain('open');
    expect(notifications).toContain('delete');
    expect(notifications.at(-1)).toBeNull();
    port.dispose();
  });

  it('captures every request and target before returning, before queued work can run', async () => {
    const firstGate = deferred<GeometryDocumentHostResult>();
    const harness = createDriverHarness({
      prepare: (operation) => Object.freeze({
        run: operation === 'save'
          ? vi.fn(() => firstGate.promise)
          : vi.fn(async () => COMPLETED),
      }),
    });
    const port = createPort(harness.driver);
    const pendingSave = port.save();
    await vi.waitFor(() => {
      expect(harness.prepared[0]?.operation).toBe('save');
      expect(harness.prepared[0]?.task.run).toHaveBeenCalledOnce();
    });

    let id = 'captured-id';
    let fileName = 'Captured.csv';
    let storageVersion = 'captured:v1';
    let text = 'captured\n';
    let dirtyDecision = 'discard';
    let confirmed = true;
    const reads = {
      target: 0,
      id: 0,
      fileName: 0,
      storageVersion: 0,
      contents: 0,
      text: 0,
      dirtyDecision: 0,
      confirmed: 0,
    };
    const changingTarget = {
      get id() {
        reads.id += 1;
        return id;
      },
      get fileName() {
        reads.fileName += 1;
        return fileName;
      },
      get storageVersion() {
        reads.storageVersion += 1;
        return storageVersion;
      },
    };
    const openRequest = {
      get target() {
        reads.target += 1;
        return changingTarget;
      },
      get dirtyDecision() {
        reads.dirtyDecision += 1;
        return dirtyDecision;
      },
    };
    const newRequest = {
      get contents() {
        reads.contents += 1;
        return {
          fileName,
          get text() {
            reads.text += 1;
            return text;
          },
        };
      },
      get dirtyDecision() {
        reads.dirtyDecision += 1;
        return dirtyDecision;
      },
    };
    const destructiveRequest = {
      get target() {
        reads.target += 1;
        return changingTarget;
      },
      get confirmed() {
        reads.confirmed += 1;
        return confirmed;
      },
      get dirtyDecision() {
        reads.dirtyDecision += 1;
        return dirtyDecision;
      },
    };

    const pendingOpen = port.open(openRequest);
    const pendingNew = port.newDocument(newRequest);
    const pendingDelete = port.delete(destructiveRequest);
    const pendingDuplicate = port.duplicate(destructiveRequest);

    expect(harness.prepared.map(({ operation }) => operation)).toEqual([
      'save',
      'open',
      'new',
      'delete',
      'duplicate',
    ]);
    expect(reads).toEqual({
      target: 3,
      id: 3,
      fileName: 3,
      storageVersion: 3,
      contents: 1,
      text: 1,
      dirtyDecision: 4,
      confirmed: 2,
    });

    id = 'changed-id';
    fileName = 'Changed.csv';
    storageVersion = 'changed:v9';
    text = 'changed\n';
    dirtyDecision = 'save';
    confirmed = false;

    const capturedOpen = harness.prepared[1]!.request as {
      target: GeometryDocumentHostTarget;
      dirtyDecision: string;
    };
    const capturedNew = harness.prepared[2]!.request as {
      contents: { fileName: string; text: string };
      dirtyDecision: string;
    };
    const capturedDelete = harness.prepared[3]!.request as {
      target: GeometryDocumentHostTarget;
      confirmed: boolean;
      dirtyDecision: string;
    };
    expect(capturedOpen).toEqual({
      target: target('captured-id', 'Captured.csv', 'captured:v1'),
      dirtyDecision: 'discard',
    });
    expect(capturedNew).toEqual({
      contents: {
        fileName: 'Captured.csv',
        text: 'captured\n',
        derivedResources: [],
        sourceFiles: [],
      },
      dirtyDecision: 'discard',
    });
    expect(capturedDelete).toEqual({
      target: target('captured-id', 'Captured.csv', 'captured:v1'),
      confirmed: true,
      dirtyDecision: 'discard',
    });
    expect(Object.isFrozen(capturedOpen)).toBe(true);
    expect(Object.isFrozen(capturedOpen.target)).toBe(true);
    expect(Object.isFrozen(capturedNew)).toBe(true);
    expect(Object.isFrozen(capturedNew.contents)).toBe(true);
    expect(Object.isFrozen(capturedDelete)).toBe(true);

    firstGate.resolve(COMPLETED);
    await expect(Promise.all([
      pendingSave,
      pendingOpen,
      pendingNew,
      pendingDelete,
      pendingDuplicate,
    ])).resolves.toEqual([
      COMPLETED,
      COMPLETED,
      COMPLETED,
      COMPLETED,
      COMPLETED,
    ]);
    port.dispose();
  });

  it('continues the FIFO tail after a rejected operation', async () => {
    const saveGate = deferred<GeometryDocumentHostResult>();
    const openGate = deferred<GeometryDocumentHostResult>();
    const starts: Operation[] = [];
    const harness = createDriverHarness({
      prepare: (operation) => Object.freeze({
        run: vi.fn(() => {
          starts.push(operation);
          return operation === 'save' ? saveGate.promise : openGate.promise;
        }),
      }),
    });
    const port = createPort(harness.driver);
    const failure = new Error('save failed');
    const pendingSave = port.save();
    const pendingOpen = port.open({ target: target('other') });

    await vi.waitFor(() => expect(starts).toEqual(['save']));
    const rejectedSave = expect(pendingSave).rejects.toBe(failure);
    saveGate.reject(failure);
    await rejectedSave;
    await vi.waitFor(() => expect(starts).toEqual(['save', 'open']));
    expect(port.getSnapshot().operation).toBe('open');

    openGate.resolve(COMPLETED);
    await expect(pendingOpen).resolves.toEqual(COMPLETED);
    expect(port.getSnapshot().operation).toBeNull();
    port.dispose();
  });

  it('captures, validates and freezes one hostile driver result before returning it', async () => {
    let statusReads = 0;
    let activeReads = 0;
    const rawTarget = {
      id: 'created',
      fileName: 'Created.csv',
      storageVersion: 'created:v1',
    };
    const rawResult = {
      get status() {
        statusReads += 1;
        return 'completed' as const;
      },
      get activeDocument() {
        activeReads += 1;
        return rawTarget;
      },
    };
    const harness = createDriverHarness({
      prepare: () => Object.freeze({ run: async () => rawResult }),
    });
    const port = createPort(harness.driver);

    const result = await port.save();
    expect(statusReads).toBe(1);
    expect(activeReads).toBe(1);
    expect(result).toEqual({
      status: 'completed',
      activeDocument: target('created', 'Created.csv', 'created:v1'),
    });
    expect(result).not.toBe(rawResult);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status === 'completed') {
      expect(Object.isFrozen(result.activeDocument)).toBe(true);
    }

    rawTarget.id = 'changed';
    expect(result).toMatchObject({ activeDocument: { id: 'created' } });
    port.dispose();
  });

  it('rejects an invalid driver result without wedging later queued work', async () => {
    let call = 0;
    const harness = createDriverHarness({
      prepare: () => Object.freeze({
        run: async () => {
          call += 1;
          return call === 1
            ? ({ status: 'unknown' } as never)
            : COMPLETED;
        },
      }),
    });
    const port = createPort(harness.driver);

    await expect(port.save()).rejects.toThrow(/result status is invalid/i);
    await expect(port.save()).resolves.toEqual(COMPLETED);
    port.dispose();
  });

  it('supersedes in-flight and queued work on disposal without stale publication', async () => {
    const saveGate = deferred<GeometryDocumentHostResult>();
    const starts: Operation[] = [];
    const harness = createDriverHarness({
      prepare: (operation) => Object.freeze({
        run: vi.fn(() => {
          starts.push(operation);
          return operation === 'save'
            ? saveGate.promise
            : Promise.resolve(COMPLETED);
        }),
      }),
    });
    const port = createPort(harness.driver);
    const listener = vi.fn();
    port.subscribe(listener);
    const pendingSave = port.save();
    const pendingOpen = port.open({ target: target('other') });

    await vi.waitFor(() => expect(starts).toEqual(['save']));
    port.dispose();
    port.dispose();
    expect(harness.dispose).toHaveBeenCalledOnce();
    const notificationsAfterDispose = listener.mock.calls.length;

    saveGate.resolve(COMPLETED);
    await expect(pendingSave).resolves.toEqual(SUPERSEDED);
    await expect(pendingOpen).resolves.toEqual(SUPERSEDED);
    expect(starts).toEqual(['save']);
    expect(listener).toHaveBeenCalledTimes(notificationsAfterDispose);
  });

  it('supersedes an in-flight rejection when disposal wins the lifecycle race', async () => {
    const saveGate = deferred<GeometryDocumentHostResult>();
    const harness = createDriverHarness({
      prepare: () => Object.freeze({ run: vi.fn(() => saveGate.promise) }),
    });
    const port = createPort(harness.driver);
    const pendingSave = port.save();

    await vi.waitFor(() => expect(harness.prepared[0]?.task.run).toHaveBeenCalledOnce());
    port.dispose();
    saveGate.reject(new Error('late driver rejection'));

    await expect(pendingSave).resolves.toEqual(SUPERSEDED);
  });

  it('does not prepare or delegate new work after disposal', async () => {
    const harness = createDriverHarness();
    const port = createPort(harness.driver);
    const dirtyBeforeDispose = port.isDirty();
    port.dispose();

    await expect(Promise.all([
      port.save(),
      port.newDocument(),
      port.open({ target: target('other') }),
      port.delete({ target: target('old') }),
      port.duplicate({ target: target('copy') }),
    ])).resolves.toEqual([
      SUPERSEDED,
      SUPERSEDED,
      SUPERSEDED,
      SUPERSEDED,
      SUPERSEDED,
    ]);
    expect(harness.prepared).toEqual([]);
    expect(port.isDirty()).toBe(dirtyBeforeDispose);
    expect(harness.isDirty).toHaveBeenCalledOnce();
  });

  it('keeps queues, snapshots, filename updates and disposal isolated per host', async () => {
    const firstGate = deferred<GeometryDocumentHostResult>();
    const firstStarts: Operation[] = [];
    const secondStarts: Operation[] = [];
    const firstHarness = createDriverHarness({
      activeDocument: target('first', 'First.csv'),
      prepare: (operation) => Object.freeze({
        run: vi.fn(() => {
          firstStarts.push(operation);
          return firstGate.promise;
        }),
      }),
    });
    const secondHarness = createDriverHarness({
      activeDocument: target('second', 'Second.csv'),
      prepare: (operation) => Object.freeze({
        run: vi.fn(async () => {
          secondStarts.push(operation);
          return COMPLETED;
        }),
      }),
    });
    const firstPort = createPort(firstHarness.driver);
    const secondPort = createPort(secondHarness.driver);

    firstPort.updateFileName('First edited.csv');
    expect(firstPort.getSnapshot().document.fileName).toBe('First edited.csv');
    expect(secondPort.getSnapshot().document.fileName).toBe('Home.csv');

    const firstSave = firstPort.save();
    await vi.waitFor(() => expect(firstStarts).toEqual(['save']));
    await expect(secondPort.save()).resolves.toEqual(COMPLETED);
    expect(secondStarts).toEqual(['save']);
    expect(firstPort.getSnapshot().operation).toBe('save');
    expect(secondPort.getSnapshot().operation).toBeNull();

    firstPort.dispose();
    expect(firstHarness.dispose).toHaveBeenCalledOnce();
    secondPort.updateFileName('Second edited.csv');
    expect(secondPort.getSnapshot().document.fileName).toBe('Second edited.csv');
    expect(secondHarness.dispose).not.toHaveBeenCalled();

    firstGate.resolve(COMPLETED);
    await expect(firstSave).resolves.toEqual(SUPERSEDED);
    secondPort.dispose();
    expect(secondHarness.dispose).toHaveBeenCalledOnce();
  });
});
