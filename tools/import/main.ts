#!/usr/bin/env node
/**
 * LOAD PRODUCTION DATA FROM CSV — through the gateway, as a principal.
 *
 *   node tools/import/main.ts --gateway https://api.acservice.systems --email you@company [--dry-run] [--verify-credentials] <dir | file.csv ...>
 *
 * A directory loads whichever of firms.csv, crews.csv, technicians.csv,
 * credentials.csv, customers.csv and agreements.csv it holds. The password is
 * asked for — hidden at a terminal, or the first line of standard input when
 * that is a pipe — and is never read from an argument, a file or the
 * environment. docs/IMPORT.md has every column and the matching rules.
 *
 * Exit status: 0 when every row landed or was already there, 1 when any row
 * was rejected, 2 when nothing could be loaded (bad arguments, sign-in, a file
 * that does not parse, the gateway gone).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { parseCsv, CsvError, type CsvFile } from "./csv.ts";
import { FILES, runImport, ImportAborted, type FileKind, type RowReport } from "./importer.ts";

const USAGE = "usage: node tools/import/main.ts --gateway <url> --email <principal email> [--dry-run] [--verify-credentials] <dir | file.csv ...>";
const fail = (msg: string): never => { console.error(msg); process.exit(2); };

const args = process.argv.slice(2);
let gateway = "", email = "", dryRun = false, verifyCredentials = false;
const paths: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--gateway") gateway = args[++i] ?? "";
  else if (a === "--email") email = args[++i] ?? "";
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--verify-credentials") verifyCredentials = true;
  else if (/^--pass/.test(a)) fail("The password is never taken on the command line — it is asked for when the import starts.");
  else if (a.startsWith("--")) fail(`unknown option ${a}\n${USAGE}`);
  else paths.push(a);
}
if (!gateway || !email || paths.length === 0) fail(USAGE);

const files = new Map<FileKind, CsvFile>();
const load = (file: string) => {
  const kind = basename(file).replace(/\.csv$/i, "").toLowerCase() as FileKind;
  if (!FILES.includes(kind)) fail(`${file}: not one of ${FILES.map((f) => `${f}.csv`).join(", ")}`);
  if (files.has(kind)) fail(`${file}: ${kind}.csv is named twice`);
  try { files.set(kind, parseCsv(readFileSync(file, "utf8"))); } catch (e) {
    if (e instanceof CsvError) fail(`${kind}.csv:${e.line}: ${e.message} — nothing was loaded`);
    throw e;
  }
};
for (const p of paths) {
  if (!existsSync(p)) fail(`${p}: no such file or directory`);
  if (statSync(p).isDirectory()) {
    const here = readdirSync(p).filter((n) => FILES.includes(n.replace(/\.csv$/i, "").toLowerCase() as FileKind) && /\.csv$/i.test(n));
    if (here.length === 0) fail(`${p}: holds none of ${FILES.map((f) => `${f}.csv`).join(", ")}`);
    for (const n of here) load(join(p, n));
  } else load(p);
}

/** Hidden at a terminal; the first line of a pipe otherwise (how the integration suite signs in). */
const askPassword = (prompt: string): Promise<string> => new Promise((resolve) => {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let buf = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (d) => { buf += d; });
    stdin.on("end", () => resolve(buf.split(/\r?\n/)[0] ?? ""));
    return;
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  let pw = "";
  const onData = (chunk: string) => {
    for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
        process.stderr.write("\n");
        resolve(pw);
        return;
      }
      if (ch === "\u0003") { process.stderr.write("\n"); process.exit(130); }
      if (ch === "\u007f" || ch === "\b") pw = pw.slice(0, -1);
      else pw += ch;
    }
  };
  stdin.on("data", onData);
});

const password = await askPassword(`Password for ${email} at ${gateway}: `);
if (!password) fail("No password given. Nothing was loaded.");

let shell: ConnectedShell;
try {
  shell = await connectShell({ surfaceId: "S2", baseUrl: gateway.replace(/\/+$/, ""), fetch, credentials: { email, password } });
} catch (e) {
  const r = (e as { refusal?: { code?: string; message?: string } }).refusal;
  if (r?.code === "password_change_required") fail("This login holds a temporary password. Sign in to the Service Manager once to choose your own, then run the import again.");
  fail(`Sign-in refused: ${r?.message ?? String(e)}`);
}
if (!shell!.principal.roles.includes("principal")) {
  await shell!.logout();
  fail(`${email} is not a principal. Loading production data is a principal's job.`);
}

const mark: Record<RowReport["outcome"], string> = { created: "created ", updated: "updated ", skipped: "skipped ", rejected: "REJECTED" };
console.log(`${dryRun ? "DRY RUN — nothing is written. " : ""}Loading ${[...files.keys()].map((k) => `${k}.csv`).join(", ")} into ${gateway} as ${email}.`);
let code = 0;
try {
  const result = await runImport(shell!, files, {
    dryRun, verifyCredentials,
    onRow: (r) => { if (r.outcome !== "skipped") console.log(`  ${r.file}.csv:${r.line}  ${mark[r.outcome]}  ${r.outcome === "rejected" ? r.message : r.what}`); },
  });
  for (const e of result.fileErrors) console.log(`  ${e}`);
  console.log("");
  for (const kind of FILES) {
    const mine = result.rows.filter((r) => r.file === kind);
    if (!files.has(kind)) continue;
    const n = (o: RowReport["outcome"]) => mine.filter((r) => r.outcome === o).length;
    console.log(`${`${kind}.csv`.padEnd(17)} ${String(mine.length).padStart(4)} rows  ${n("created")} ${dryRun ? "to create" : "created"}, ${n("updated")} ${dryRun ? "to update" : "updated"}, ${n("skipped")} already there, ${n("rejected")} rejected`);
  }
  if (result.passwords.length) {
    console.log("\nTemporary passwords — shown once, kept nowhere. Give each to the person; they choose their own at first sign-in:");
    for (const p of result.passwords) console.log(`  ${p.name.padEnd(28)} ${p.email.padEnd(36)} ${p.temporaryPassword}`);
  }
  if (result.fileErrors.length) code = 2;
  else if (result.rows.some((r) => r.outcome === "rejected")) code = 1;
} catch (e) {
  if (!(e instanceof ImportAborted)) throw e;
  console.error(`\nStopped: ${e.message}. Rows above this point were loaded; running the files again picks up where this stopped.`);
  code = 2;
} finally {
  await shell!.logout().catch(() => {});
}
process.exit(code);
