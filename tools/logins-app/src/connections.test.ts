import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCAL_DEFAULT, loadConnections, saveConnections } from "./connections.ts";

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ac-logins-"));
const fileIn = (dir: string) => path.join(dir, "connections.json");

test("a missing file loads as the local default only", () => {
  const dir = freshDir();
  try {
    assert.deepEqual(loadConnections(dir), { local: LOCAL_DEFAULT });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("save then load round-trips both connection strings", () => {
  const dir = freshDir();
  try {
    const c = { production: "postgres://prod.example/ac", local: "postgres://localhost:5433/ac_dev" };
    saveConnections(dir, c);
    assert.deepEqual(loadConnections(dir), c);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("save creates the file with mode 0600", () => {
  const dir = freshDir();
  try {
    saveConnections(dir, { local: LOCAL_DEFAULT });
    assert.equal(fs.statSync(fileIn(dir)).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saving over an existing 0644 file leaves it 0600", () => {
  const dir = freshDir();
  try {
    fs.writeFileSync(fileIn(dir), "{}", { mode: 0o644 });
    fs.chmodSync(fileIn(dir), 0o644);
    saveConnections(dir, { local: LOCAL_DEFAULT });
    assert.equal(fs.statSync(fileIn(dir)).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
