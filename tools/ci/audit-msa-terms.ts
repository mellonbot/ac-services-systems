/**
 * Which accounts would refuse a job today for want of a contract term.
 *
 * An MSA activated before the activation gate (REQUIRED_AT_ACTIVATION) can be
 * live with nothing above its sites, and the first job under it is refused
 * `no_value` at the dispatch console. This lists:
 *
 *   1. every active MSA that does not state, at its parent node and in effect
 *      on the as-of date, each term the gate requires — by any agreement;
 *   2. every customer with sites and no MSA in effect at all.
 *
 * Read-only. `node tools/ci/audit-msa-terms.ts [YYYY-MM-DD]`, as-of defaults
 * to today. Exits 1 when anything is listed, so a run reads green or red.
 *
 * With defaults on every parent-authorable non-attach term, the first list is
 * empty by construction.
 */
import { execFileSync } from "node:child_process";
import { REQUIRED_AT_ACTIVATION } from "../../packages/contracts/src/terms.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error(`as-of must be an ISO date (YYYY-MM-DD), got ${asOf}`);
  process.exit(2);
}

const psql = (sql: string): string =>
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-P", "pager=off", "-P", "footer=off", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

const noMsa = `
  SELECT o.name AS organization, o.id AS org_id, o.segment, count(*) AS sites
    FROM organizations o JOIN accounts a ON a.org_id = o.id AND a.tier = 'site'
   WHERE o.kind = 'customer'
     AND NOT EXISTS (
       SELECT 1 FROM contracts c
        WHERE c.org_id = o.id AND c.kind = 'msa' AND c.state = 'active' AND c.effective @> DATE '${asOf}')
   GROUP BY o.name, o.id, o.segment
   ORDER BY o.name`;

const rows = (out: string): number => Math.max(0, out.trim().split("\n").length - 2);

console.log(`as of ${asOf}; required at the parent: ${REQUIRED_AT_ACTIVATION.join(", ") || "(none)"}\n`);

let missingCount = 0;
if (REQUIRED_AT_ACTIVATION.length === 0) {
  console.log("Active MSAs missing required terms (0):\n(no terms require an explicit statement)\n");
} else {
  const required = REQUIRED_AT_ACTIVATION.map((k) => `('${k}')`).join(", ");
  const missingTerms = `
    WITH req(term_key) AS (VALUES ${required}),
    msa AS (
      SELECT c.id, c.org_id, c.scope_id, o.name
        FROM contracts c JOIN organizations o ON o.id = c.org_id
       WHERE c.kind = 'msa' AND c.state = 'active' AND c.effective @> DATE '${asOf}'
    )
    SELECT m.name AS organization, m.org_id, m.id AS msa_id, string_agg(r.term_key, ', ' ORDER BY r.term_key) AS missing_at_parent
      FROM msa m CROSS JOIN req r
     WHERE NOT EXISTS (
       SELECT 1 FROM contract_term_overrides t
        WHERE t.org_id = m.org_id AND t.scope_tier = 'parent' AND t.scope_id = m.scope_id
          AND t.term_key = r.term_key AND t.effective @> DATE '${asOf}')
     GROUP BY m.name, m.org_id, m.id
     ORDER BY m.name`;
  const a = psql(missingTerms);
  missingCount = rows(a);
  console.log(`Active MSAs missing required terms (${missingCount}):\n${a}`);
}

const b = psql(noMsa);
const noMsaCount = rows(b);
console.log(`Customers with sites and no MSA in effect (${noMsaCount}):\n${b}`);
process.exit(missingCount + noMsaCount > 0 ? 1 : 0);
