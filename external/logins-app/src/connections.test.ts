import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCAL_DEFAULT, loadConnections, saveConnections, type Cipher } from "./connections.ts";

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

test("save then load round-trips both connection strings (no cipher: in the clear, and flagged)", () => {
  const dir = freshDir();
  try {
    const c = { production: "postgres://prod.example/ac", local: "postgres://localhost:5433/ac_dev" };
    saveConnections(dir, c);
    assert.deepEqual(loadConnections(dir), { ...c, plaintext: true });
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

// Stands in for safeStorage: reversible, and visibly not the plaintext.
const rot: Cipher = {
  encryptString: (s) => Buffer.from([...s].reverse().join(""), "utf8"),
  decryptString: (b) => [...b.toString("utf8")].reverse().join(""),
};

test("with a cipher, the production string is sealed on disk and round-trips", () => {
  const dir = freshDir();
  try {
    const c = { production: "postgres://user:s3cret@prod.example/ac", local: LOCAL_DEFAULT };
    saveConnections(dir, c, rot);
    const raw = fs.readFileSync(fileIn(dir), "utf8");
    assert.ok(!raw.includes("s3cret"), "the password is not on disk in the clear");
    assert.ok(JSON.parse(raw).productionSealed);
    assert.deepEqual(loadConnections(dir, rot), c);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a sealed string without the cipher loads as production not configured", () => {
  const dir = freshDir();
  try {
    saveConnections(dir, { production: "postgres://prod.example/ac", local: LOCAL_DEFAULT }, rot);
    assert.deepEqual(loadConnections(dir), { local: LOCAL_DEFAULT });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a plaintext production string still loads, and says so, so it can be re-sealed", () => {
  const dir = freshDir();
  try {
    saveConnections(dir, { production: "postgres://prod.example/ac", local: LOCAL_DEFAULT });
    assert.deepEqual(loadConnections(dir, rot), { production: "postgres://prod.example/ac", local: LOCAL_DEFAULT, plaintext: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
