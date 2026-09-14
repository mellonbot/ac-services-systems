/**
 * TENANCY PRIMITIVES — non-negotiable #2.
 *
 * `region_id` is the Tier 3 shard key. The capacity ladder in the master plan
 * is cheap ONLY because the column is total. One nullable instance and the
 * partition key needs a fallback, the fallback needs a home, and Tier 3 stops
 * being a routing change and becomes a migration project.
 *
 * A rule with no designed home for its awkward cases dies the first time
 * someone meets one. So there are three table kinds, two short allowlists, and
 * a designed home for the awkward case:
 *
 *   operational      — org_id + region_id, NOT NULL, appended by this module.
 *                      The caller cannot omit them or make them nullable.
 *   tenancy root     — the tables that DEFINE the boundary (organizations,
 *                      regions). They sit above it and cannot carry it without
 *                      circularity. Name-allowlisted below.
 *   global reference — genuinely tenant-free data (currencies, the part
 *                      catalog's manufacturer dictionary). Name-allowlisted.
 *
 * Pre-account rows — a lead from S1 arrives before a customer exists — are
 * NOT an exception. They are operational rows owned by the well-known PROSPECT
 * organization in the UNASSIGNED region. The invariant stays total.
 *
 * Adding an exception means editing a named constant in a reviewed diff.
 */

export const TENANCY_ROOT_TABLES = ["organizations", "regions"] as const;

export const GLOBAL_REFERENCE_TABLES = [
  "currencies",
  "part_manufacturers",
  "schema_migrations",
] as const;

/** Home for pre-account rows. Not a null, not a sentinel table — a real org. */
export const PROSPECT_ORG_ID = "00000000-0000-0000-0000-0000000000p0".replace("p", "1");
export const UNASSIGNED_REGION_ID = "00000000-0000-0000-0000-000000000002";

export type SqlType =
  | "uuid" | "text" | "bigint" | "integer" | "boolean"
  | "timestamptz" | "date" | "jsonb" | "bytea";

export type Column = {
  readonly name: string;
  readonly type: SqlType;
  readonly nullable?: boolean;
  readonly default?: string;
  readonly references?: string;
  readonly check?: string;
  readonly comment?: string;
};

export type TableKind = "operational" | "tenancy_root" | "global_reference";

export type Table = {
  readonly name: string;
  readonly kind: TableKind;
  readonly columns: readonly Column[];
  readonly primaryKey: readonly string[];
  readonly indexes: readonly (readonly string[])[];
  readonly comment?: string;
};

const RESERVED = new Set(["org_id", "region_id", "id", "created_at"]);

type TableInput = {
  columns: readonly Column[];
  primaryKey?: readonly string[];
  indexes?: readonly (readonly string[])[];
  comment?: string;
};

/**
 * The only way to declare a table that holds operational state.
 *
 * There is no `nullable` option for the tenancy columns because there is no
 * parameter for them at all — they are appended here. A caller who declares
 * their own `region_id` gets a thrown error at module load, which is to say:
 * at `pnpm guard:schema`, which is to say: in CI, before the migration exists.
 */
export const operationalTable = (name: string, input: TableInput): Table => {
  for (const c of input.columns) {
    if (RESERVED.has(c.name)) {
      throw new Error(
        `[tenancy] ${name}.${c.name} is appended by operationalTable(); declaring it ` +
        `by hand is how a nullable region_id enters the schema. Remove it.`
      );
    }
  }
  return Object.freeze({
    name,
    kind: "operational",
    primaryKey: input.primaryKey ?? ["id"],
    indexes: [["region_id"], ...(input.indexes ?? [])],
    ...(input.comment === undefined ? {} : { comment: input.comment }),
    columns: Object.freeze([
      { name: "id", type: "uuid", default: "gen_random_uuid()" },
      { name: "org_id", type: "uuid", references: "organizations(id)" },
      {
        name: "region_id",
        type: "uuid",
        references: "regions(id)",
        comment: "Tier 3 shard key. NOT NULL everywhere, no exceptions, by construction.",
      },
      ...input.columns,
      { name: "created_at", type: "timestamptz", default: "now()" },
    ] satisfies Column[]),
  });
};

export const tenancyRootTable = (name: string, input: TableInput): Table => {
  if (!(TENANCY_ROOT_TABLES as readonly string[]).includes(name)) {
    throw new Error(
      `[tenancy] "${name}" is not a tenancy root. Operational tables carry ` +
      `region_id. If this genuinely sits above the region boundary, add it to ` +
      `TENANCY_ROOT_TABLES in a reviewed diff and say why.`
    );
  }
  return Object.freeze({ name, kind: "tenancy_root", primaryKey: input.primaryKey ?? ["id"], indexes: input.indexes ?? [], ...(input.comment === undefined ? {} : { comment: input.comment }), columns: Object.freeze(input.columns) });
};

export const globalReferenceTable = (name: string, input: TableInput): Table => {
  if (!(GLOBAL_REFERENCE_TABLES as readonly string[]).includes(name)) {
    throw new Error(
      `[tenancy] "${name}" is not global reference data. If it describes anything ` +
      `a customer, crew, job or invoice touches, it is operational. Add it to ` +
      `GLOBAL_REFERENCE_TABLES in a reviewed diff and say why.`
    );
  }
  return Object.freeze({ name, kind: "global_reference", primaryKey: input.primaryKey ?? ["id"], indexes: input.indexes ?? [], ...(input.comment === undefined ? {} : { comment: input.comment }), columns: Object.freeze(input.columns) });
};

/** DDL emitter. Deterministic — migration diffs are reviewable. */
export const toDdl = (t: Table): string => {
  const cols = t.columns.map((c) => {
    const parts = [`  ${c.name} ${c.type}`];
    if (!c.nullable) parts.push("NOT NULL");
    if (c.default) parts.push(`DEFAULT ${c.default}`);
    if (c.references) parts.push(`REFERENCES ${c.references}`);
    if (c.check) parts.push(`CHECK (${c.check})`);
    return parts.join(" ");
  });
  cols.push(`  PRIMARY KEY (${t.primaryKey.join(", ")})`);
  const idx = t.indexes.map(
    (i) => `CREATE INDEX IF NOT EXISTS ${t.name}_${i.join("_")}_idx ON ${t.name} (${i.join(", ")});`
  );
  return [`CREATE TABLE IF NOT EXISTS ${t.name} (`, cols.join(",\n"), ");", ...idx].join("\n");
};
