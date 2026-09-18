import { createPool, beginTx } from "../../gateway/src/pg-tx.ts";
import { relayOnce, notifyPublisher } from "./relay.ts";
import { sweepCredentialExpiry, sweepSlaCascade, workerScope } from "./sweeps.ts";

/**
 * THE WORKER. Runs as ac_worker. Three loops, each its own transaction, each
 * tolerant of a second worker running beside it (SKIP LOCKED, idempotent
 * emits). Region-pinnable with AC_REGION_ID for Tier 3.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = createPool(DATABASE_URL, "ac-worker");
const REGION = process.env.AC_REGION_ID;
const SCOPE = workerScope(REGION);
/** One transaction as the worker, bound as the worker — RLS has its inputs before the first statement, or it answers zero rows. */
const bound = async () => { const tx = await beginTx(pool, "ac_worker"); await tx.setLocal(SCOPE); return tx; };

const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const out = await fn();
      if (out && typeof out === "object" && Object.values(out).some((v) => v)) console.log(`${name}:`, out);
      else if (typeof out === "number" && out > 0) console.log(`${name}: ${out}`);
    } catch (e) {
      console.error(`${name} failed:`, (e as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
};

every(1_000, "relay", async () => {
  const tx = await bound();
  try { return await relayOnce(tx, notifyPublisher(tx), 200, REGION); } catch (e) { await tx.rollback().catch(() => {}); throw e; }
});
every(60_000, "sla-cascade", async () => {
  const tx = await bound();
  try { return await sweepSlaCascade(tx, new Date()); } catch (e) { await tx.rollback().catch(() => {}); throw e; }
});
every(3_600_000, "credential-expiry", async () => {
  const tx = await bound();
  try { return await sweepCredentialExpiry(tx, new Date()); } catch (e) { await tx.rollback().catch(() => {}); throw e; }
});

console.log(`worker up${REGION ? ` (region ${REGION})` : ""}`);
