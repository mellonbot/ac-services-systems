/**
 * Money is integer minor units as bigint, end to end, enforced by lint.
 * Quantities are integer thousandths. There is no float in this path.
 *
 * allocate() exists because non-negotiable #7 — consolidated parent invoicing
 * with per-location itemization — is a rounding problem wearing a billing
 * costume. Split $1000.00 across three locations by usage and the naive answer
 * produces lines summing to $999.99. On an enterprise invoice, that one cent is
 * a dispute, a credit memo, and an hour of somebody's month, every month.
 *
 * Largest-remainder, with a TOTAL tiebreak: remainder desc, then weight desc,
 * then line order. Total matters more than clever here — a comparator that
 * returns the same value for two elements makes Array.prototype.sort's output
 * implementation-defined, which means the same invoice allocates differently on
 * two machines. Nobody loses more than one minor unit, and the sum is exact by
 * construction rather than by luck.
 */
export const allocate = (total: bigint, weights: readonly bigint[]): readonly bigint[] => {
  if (weights.length === 0) throw new Error("[money] cannot allocate across zero targets");
  if (weights.some((w) => w < 0n)) throw new Error("[money] negative weight");

  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    // Equal split of an unweighted total, remainder to the earliest lines.
    const base = total / BigInt(weights.length);
    const rem = total - base * BigInt(weights.length);
    return weights.map((_, i) => base + (BigInt(i) < rem ? 1n : 0n));
  }

  const floors = weights.map((w) => (total * w) / sum);
  const remainders = weights.map((w, i) => (total * w) - floors[i]! * sum);
  let leftover = total - floors.reduce((a, b) => a + b, 0n);

  const order = remainders
    .map((r, i) => ({ r, i, w: weights[i]! }))
    .sort((a, b) => {
      if (a.r !== b.r) return b.r > a.r ? 1 : -1;
      if (a.w !== b.w) return b.w > a.w ? 1 : -1;
      return a.i - b.i;
    });

  const out = [...floors];
  for (const { i } of order) {
    if (leftover <= 0n) break;
    out[i] = out[i]! + 1n;
    leftover -= 1n;
  }
  return out;
};

/** The invariant, callable. The invoice builder asserts it before persisting. */
export const sumsExactly = (total: bigint, lines: readonly bigint[]): boolean =>
  lines.reduce((a, b) => a + b, 0n) === total;
