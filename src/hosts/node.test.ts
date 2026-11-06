import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createNodeHost, nodeHost, parseHcReply } from "./node.ts";

// Measured on hc 0.1.18: results go to stdout, hc's own errors to stderr (exit 1 or 3).
describe("parseHcReply", () => {
  test("a result on stdout", () => {
    assert.deepEqual(parseHcReply({ code: 0, stdout: '{"text":"hi"}\n', stderr: "" }, "file"), { text: "hi" });
  });

  test("herdr-core's own error on stderr", () => {
    const stderr = '{"error":{"hint":"","kind":"not_found","message":"no file /x"}}\n';
    assert.deepEqual(parseHcReply({ code: 3, stdout: "", stderr }, "file"), {
      error: { hint: "", kind: "not_found", message: "no file /x" },
    });
  });

  test("anything else is an error naming the subcommand", () => {
    assert.throws(() => parseHcReply({ code: 2, stdout: "", stderr: "error: unexpected argument" }, "exec"), /hc exec gave no JSON \(exit 2\)/);
  });
});

// The Node host must keep herdr's `exec` contract: resolve whatever the exit code,
// reject only when the program could not run. Tools rely on it in both runtimes.
describe("nodeHost.exec", () => {
  test("resolves with the output", async () => {
    const r = await nodeHost.exec(process.execPath, ["-e", "process.stdout.write('out'); process.stderr.write('err')"]);
    assert.deepEqual(r, { code: 0, stdout: "out", stderr: "err" });
  });

  test("resolves with a failing exit code", async () => {
    const r = await nodeHost.exec(process.execPath, ["-e", "process.exit(3)"]);
    assert.equal(r.code, 3);
  });

  test("runs in the given folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "node-host-"));
    try {
      const r = await nodeHost.exec(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd: dir });
      assert.equal(r.stdout.toLowerCase(), dir.toLowerCase());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a program that does not exist", async () => {
    await assert.rejects(nodeHost.exec("no-such-program-herdr-tools"), /cannot start no-such-program-herdr-tools/);
  });

  test("rejects a folder that does not exist", async () => {
    await assert.rejects(nodeHost.exec(process.execPath, ["-v"], { cwd: join(tmpdir(), "no-such-folder-herdr-tools") }), /cannot start/);
  });

  test("rejects when the timeout elapses", async () => {
    await assert.rejects(nodeHost.exec(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeout: 300 }), /timed out after 0\.3 s/);
  });

  test("refuses a timeout that is not a positive number", async () => {
    await assert.rejects(nodeHost.exec(process.execPath, ["-v"], { timeout: 0 }), RangeError);
  });
});

describe("nodeHost.readTextFile", () => {
  test("reads a file, and null for a missing one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "node-host-"));
    try {
      const file = join(dir, "a.txt");
      writeFileSync(file, "héllo");
      assert.equal(await nodeHost.readTextFile(file), "héllo");
      assert.equal(await nodeHost.readTextFile(join(dir, "missing.txt")), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("nodeHost.listDir and removeFile", () => {
  test("names in a folder, [] for a missing one; removing twice is fine", async () => {
    const dir = mkdtempSync(join(tmpdir(), "node-host-"));
    try {
      writeFileSync(join(dir, "a.json"), "{}");
      writeFileSync(join(dir, "b.json"), "{}");
      assert.deepEqual((await nodeHost.listDir(dir)).sort(), ["a.json", "b.json"]);
      assert.deepEqual(await nodeHost.listDir(join(dir, "missing")), []);
      await nodeHost.removeFile(join(dir, "a.json"));
      await nodeHost.removeFile(join(dir, "a.json"));
      assert.deepEqual(await nodeHost.listDir(dir), ["b.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// `on: "<machine>"` goes through hc. testing/fake-hc.ts stands in for it: it answers what
// FAKE_HC_* say (shapes measured on hc 0.1.18) and logs the arguments it was given.
describe("through hc", () => {
  const fakeHc = fileURLToPath(new URL("./testing/fake-hc.ts", import.meta.url));
  const host = createNodeHost({ hc: { command: process.execPath, args: [fakeHc] } });
  let dir = "";
  let log = "";

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "fake-hc-"));
    log = join(dir, "argv.jsonl");
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
  const execReply = (over: Partial<Record<string, unknown>> = {}) => ({
    code: 0,
    ms: 1,
    signal: null,
    stdout: b64(""),
    stderr: b64(""),
    timed_out: false,
    truncated: false,
    ...over,
  });
  function answer(reply: unknown, options: { stream?: "stdout" | "stderr"; exit?: number } = {}) {
    process.env.FAKE_HC_REPLY = JSON.stringify(reply);
    process.env.FAKE_HC_STREAM = options.stream ?? "stdout";
    process.env.FAKE_HC_EXIT = String(options.exit ?? 0);
    process.env.FAKE_HC_LOG = log;
    writeFileSync(log, "");
  }
  const lastArgv = () => JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1) ?? "[]") as string[];
  const hcError = (kind: string, message: string) => ({ error: { hint: "", kind, message } });

  test("exec: hc's command line, and the output decoded", async () => {
    answer(execReply({ code: 3, stdout: b64("héllo"), stderr: b64("warn") }));
    const r = await host.exec("git", ["status", "--short"], { on: "vps", cwd: "/srv/api" });
    assert.deepEqual(r, { code: 3, stdout: "héllo", stderr: "warn" });
    assert.deepEqual(lastArgv(), ["exec", "--json", "--on", "vps", "--timeout", "30", "--cwd", "/srv/api", "--", "git", "status", "--short"]);
  });

  test("exec: no --cwd without a folder; the timeout in whole seconds, capped", async () => {
    answer(execReply());
    await host.exec("true", [], { on: "vps", timeout: 1500 });
    let argv = lastArgv();
    assert.ok(!argv.includes("--cwd"));
    assert.equal(argv[argv.indexOf("--timeout") + 1], "2");

    await host.exec("true", [], { on: "vps", timeout: 10_000_000 });
    argv = lastArgv();
    assert.equal(argv[argv.indexOf("--timeout") + 1], "600");
  });

  test("exec: timed_out and truncated reject", async () => {
    answer(execReply({ timed_out: true }));
    await assert.rejects(host.exec("sleep", ["99"], { on: "vps" }), /sleep timed out after 30 s on vps/);
    answer(execReply({ truncated: true }));
    await assert.rejects(host.exec("cat", ["big"], { on: "vps" }), /cat wrote too much output on vps/);
  });

  test("exec: hc's own error rejects with its message", async () => {
    answer(hcError("unreachable", "cannot reach vps"), { stream: "stderr", exit: 1 });
    await assert.rejects(host.exec("git", [], { on: "vps" }), { message: "cannot reach vps" });
  });

  test("exec: a reply that is not JSON", async () => {
    process.env.FAKE_HC_REPLY = "error: unexpected argument";
    process.env.FAKE_HC_STREAM = "stderr";
    process.env.FAKE_HC_EXIT = "2";
    await assert.rejects(host.exec("git", [], { on: "vps" }), /hc exec gave no JSON \(exit 2\)/);
  });

  test("readTextFile: the text", async () => {
    answer({ first: 1, last: 1, lines: 1, text: "hi\n" });
    assert.equal(await host.readTextFile("/x", { on: "vps" }), "hi\n");
    assert.deepEqual(lastArgv(), ["file", "read", "--json", "--on", "vps", "--", "/x"]);
  });

  test("readTextFile: not_found is null, any other error throws", async () => {
    answer(hcError("not_found", "no file /x"), { stream: "stderr", exit: 3 });
    assert.equal(await host.readTextFile("/x", { on: "vps" }), null);
    answer(hcError("unreachable", "cannot reach vps"), { stream: "stderr", exit: 1 });
    await assert.rejects(host.readTextFile("/x", { on: "vps" }), { message: "cannot reach vps" });
  });
});
