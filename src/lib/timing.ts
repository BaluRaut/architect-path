/**
 * Timing helpers for the database modules.
 *
 * The rule these encode: never report a single run. A first run pays for a cold
 * cache and a cold plan, so one number tells you almost nothing. These take the
 * median of several runs after a warm-up, which is the least you can do and
 * still make an honest claim about speed.
 */

export interface Timing {
  medianMs: number;
  minMs: number;
  maxMs: number;
  runs: number;
}

export async function time<T>(
  fn: () => Promise<T>,
  options: { runs?: number; warmup?: number } = {},
): Promise<{ result: T; timing: Timing }> {
  const runs = options.runs ?? 5;
  const warmup = options.warmup ?? 1;

  for (let i = 0; i < warmup; i++) await fn();

  const samples: number[] = [];
  let result!: T;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    result = await fn();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return {
    result,
    timing: {
      medianMs: samples[Math.floor(samples.length / 2)]!,
      minMs: samples[0]!,
      maxMs: samples[samples.length - 1]!,
      runs,
    },
  };
}

export function ms(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n < 10 ? `${n.toFixed(2)} ms` : `${n.toFixed(0)} ms`;
}

/** "42x faster", or "no meaningful change" when the difference is noise. */
export function speedup(before: number, after: number): string {
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= 0) return "—";
  const factor = before / after;
  if (factor < 1.2 && factor > 0.83) return "no meaningful change";
  return factor >= 1 ? `${factor.toFixed(1)}x faster` : `${(1 / factor).toFixed(1)}x slower`;
}
