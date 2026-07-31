// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

type GeometryPerfStats = {
  calls: number;
  samples: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  samplesMs: number[];
};

type GeometryPerfOptions = {
  sampleRate?: number;
};

type GeometryPerfSnapshotOptions = {
  minTotalMs?: number;
  minMaxMs?: number;
  sortBy?: 'total' | 'max' | 'avg' | 'samples';
  includeSamples?: boolean;
};

type GeometryPerfSnapshotRow = {
  name: string;
  calls: number;
  samples: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  minMs: number;
  p95Ms: number;
  lastMs: number;
  samplesMs?: number[];
};

type GeometryPerfApi = {
  enable: (options?: { sampleRate?: number; slowThresholdMs?: number }) => void;
  disable: () => void;
  reset: () => void;
  snapshot: (options?: GeometryPerfSnapshotOptions) => GeometryPerfSnapshotRow[];
  report: (options?: GeometryPerfSnapshotOptions) => GeometryPerfSnapshotRow[];
  measure: <T>(name: string, fn: () => T, options?: GeometryPerfOptions) => T;
  record: (name: string, durationMs: number) => void;
  markNextFrame: (name: string) => void;
  isEnabled: () => boolean;
};

const DEFAULT_SAMPLE_RATE = 1;
const DEFAULT_SLOW_THRESHOLD_MS = 12;
const MAX_RETAINED_SAMPLES = 300;

const statsByName: Record<string, GeometryPerfStats> = {};
let enabled = false;
let sampleRate = DEFAULT_SAMPLE_RATE;
let slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS;

const getStats = (name: string): GeometryPerfStats => {
  if (!statsByName[name]) {
    statsByName[name] = {
      calls: 0,
      samples: 0,
      totalMs: 0,
      minMs: Infinity,
      maxMs: 0,
      lastMs: 0,
      samplesMs: [],
    };
  }
  return statsByName[name];
};

const recordDuration = (name: string, durationMs: number) => {
  const stats = getStats(name);
  stats.samples += 1;
  stats.totalMs += durationMs;
  stats.minMs = Math.min(stats.minMs, durationMs);
  stats.maxMs = Math.max(stats.maxMs, durationMs);
  stats.lastMs = durationMs;
  stats.samplesMs.push(durationMs);
  if (stats.samplesMs.length > MAX_RETAINED_SAMPLES) {
    stats.samplesMs.shift();
  }

  if (durationMs >= slowThresholdMs) {
    console.info(`[GeometryPerf] ${name}: ${durationMs.toFixed(2)}ms`);
  }
};

const shouldSample = (stats: GeometryPerfStats, localSampleRate?: number) => {
  const rate = Math.max(1, Math.floor(localSampleRate ?? sampleRate));
  return stats.calls % rate === 0;
};

const percentile = (values: number[], pct: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
};

const snapshotRows = (options: GeometryPerfSnapshotOptions = {}): GeometryPerfSnapshotRow[] => {
  const minTotalMs = options.minTotalMs ?? 0;
  const minMaxMs = options.minMaxMs ?? 0;
  const sortBy = options.sortBy ?? 'total';
  return Object.entries(statsByName)
    .map(([name, stats]) => {
      const avgMs = stats.samples > 0 ? stats.totalMs / stats.samples : 0;
      return {
        name,
        calls: stats.calls,
        samples: stats.samples,
        totalMs: Number(stats.totalMs.toFixed(2)),
        avgMs: Number(avgMs.toFixed(2)),
        maxMs: Number(stats.maxMs.toFixed(2)),
        minMs: Number((Number.isFinite(stats.minMs) ? stats.minMs : 0).toFixed(2)),
        p95Ms: Number(percentile(stats.samplesMs, 95).toFixed(2)),
        lastMs: Number(stats.lastMs.toFixed(2)),
        ...(options.includeSamples
          ? { samplesMs: stats.samplesMs.map((sample) => Number(sample.toFixed(2))) }
          : {}),
      };
    })
    .filter((row) => row.totalMs >= minTotalMs && row.maxMs >= minMaxMs)
    .sort((a, b) => {
      if (sortBy === 'max') return Number(b.maxMs) - Number(a.maxMs);
      if (sortBy === 'avg') return Number(b.avgMs) - Number(a.avgMs);
      if (sortBy === 'samples') return Number(b.samples) - Number(a.samples);
      return Number(b.totalMs) - Number(a.totalMs);
    });
};

export const geometryPerf: GeometryPerfApi = {
  enable: (options = {}) => {
    enabled = true;
    sampleRate = Math.max(1, Math.floor(options.sampleRate ?? sampleRate));
    slowThresholdMs = Math.max(0, options.slowThresholdMs ?? slowThresholdMs);
    console.info(
      `[GeometryPerf] enabled sampleRate=${sampleRate} slowThresholdMs=${slowThresholdMs}`,
    );
  },

  disable: () => {
    enabled = false;
    console.info('[GeometryPerf] disabled');
  },

  reset: () => {
    for (const key of Object.keys(statsByName)) {
      delete statsByName[key];
    }
    console.info('[GeometryPerf] reset');
  },

  snapshot: (options = {}) => snapshotRows(options),

  report: (options = {}) => {
    const rows = snapshotRows(options);
    console.table(rows);
    return rows;
  },

  measure: <T>(name: string, fn: () => T, options?: GeometryPerfOptions): T => {
    if (!enabled) return fn();

    const stats = getStats(name);
    stats.calls += 1;
    if (!shouldSample(stats, options?.sampleRate)) {
      return fn();
    }

    const start = performance.now();
    try {
      return fn();
    } finally {
      recordDuration(name, performance.now() - start);
    }
  },

  record: (name: string, durationMs: number) => {
    if (!enabled) return;
    recordDuration(name, durationMs);
  },

  markNextFrame: (name: string) => {
    if (!enabled || typeof window === 'undefined') return;
    const start = performance.now();
    window.requestAnimationFrame(() => {
      recordDuration(name, performance.now() - start);
    });
  },

  isEnabled: () => enabled,
};

if (typeof window !== 'undefined') {
  (window as unknown as { __vulcanGeometryPerf?: GeometryPerfApi }).__vulcanGeometryPerf = geometryPerf;
}
