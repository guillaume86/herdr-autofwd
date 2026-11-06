import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExecOptions, ExecResult, Host } from "../../host.ts";
import { formatInfo, info } from "./core.ts";

/** A Host whose `exec` answers from a script and remembers what it was asked. */
function fakeHost(reply: ExecResult) {
  const calls: { command: string; args: string[]; options: ExecOptions | undefined }[] = [];
  const host: Host = {
    exec: async (command, args = [], options) => {
      calls.push({ command, args, options });
      return reply;
    },
    fetch: () => Promise.reject(new Error("no network in tests")),
    readTextFile: async () => null,
    listDir: async () => [],
    removeFile: async () => {},
    home: () => "/home/me",
  };
  return { host, calls };
}

describe("info", () => {
  test("asks hc for its version, where it is told to", async () => {
    const { host, calls } = fakeHost({ code: 0, stdout: "hc 0.1.18\n", stderr: "" });
    assert.deepEqual(await info(host, { on: "vps" }), { core: "hc 0.1.18", home: "/home/me" });
    assert.deepEqual(calls, [{ command: "hc", args: ["--version"], options: { on: "vps" } }]);
  });

  test("a failing hc is an error with its message", async () => {
    const { host } = fakeHost({ code: 1, stdout: "", stderr: "error: no core\n" });
    await assert.rejects(info(host), { message: "error: no core" });
  });
});

test("formatInfo", () => {
  assert.deepEqual(formatInfo({ core: "hc 0.1.18", home: "/home/me" }), ["hc 0.1.18", "home: /home/me"]);
});
