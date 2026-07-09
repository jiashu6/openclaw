import os from "node:os";
import path from "node:path";
// Signal tests cover daemon plugin behavior.
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { testApi } from "./daemon.js";

describe("signal daemon args", () => {
  it("expands home-relative configPath before passing it to signal-cli", () => {
    expect(
      testApi.buildDaemonArgs({
        cliPath: "signal-cli",
        configPath: "~/.openclaw/signal-cli",
        httpHost: "127.0.0.1",
        httpPort: 8080,
      }),
    ).toEqual([
      "--config",
      path.join(os.homedir(), ".openclaw/signal-cli"),
      "daemon",
      "--http",
      "127.0.0.1:8080",
      "--no-receive-stdout",
    ]);
  });
});

describe("signal daemon log classification", () => {
  it("keeps routine signal-cli warnings out of error state", () => {
    expect(
      testApi.classifySignalCliLogLine(
        "WARN  ManagerImpl - No profile name set. When sending a message it's recommended to set a profile name.",
      ),
    ).toBe("log");
  });

  it("keeps recoverable prekey decrypt receive failures out of error state", () => {
    expect(
      testApi.classifySignalCliLogLine(
        "receive exception: org.signal.libsignal.protocol.InvalidMessageException: invalid PreKey message: decryption failed",
      ),
    ).toBe("log");
  });

  it("still surfaces signal-cli failures as errors", () => {
    expect(testApi.classifySignalCliLogLine("ERROR DaemonCommand - startup failed")).toBe("error");
    expect(testApi.classifySignalCliLogLine("SEVERE Manager - database exception")).toBe("error");
  });
});

describe("signal daemon stream errors", () => {
  it("logs stdout stream errors via the error callback", () => {
    const stdout = new PassThrough();
    const logs: string[] = [];
    const errors: string[] = [];
    testApi.bindSignalCliOutput({
      stream: stdout,
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
    });
    const streamError = new Error("stdout pipe broken");
    stdout.emit("error", streamError);
    expect(errors).toContain("signal-cli stream error: stdout pipe broken");
    expect(logs).toEqual([]);
  });

  it("logs stderr stream errors via the error callback", () => {
    const stderr = new PassThrough();
    const logs: string[] = [];
    const errors: string[] = [];
    testApi.bindSignalCliOutput({
      stream: stderr,
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
    });
    const streamError = new Error("stderr pipe broken");
    stderr.emit("error", streamError);
    expect(errors).toContain("signal-cli stream error: stderr pipe broken");
    expect(logs).toEqual([]);
  });

  it("keeps handling data after a stream error without throwing", () => {
    const stdout = new PassThrough();
    const logs: string[] = [];
    const errors: string[] = [];
    testApi.bindSignalCliOutput({
      stream: stdout,
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
    });
    stdout.emit("error", new Error("transient pipe hiccup"));
    stdout.emit("data", Buffer.from("INFO Daemon - ready\n"));
    expect(errors).toContain("signal-cli stream error: transient pipe hiccup");
    expect(logs).toContain("signal-cli: INFO Daemon - ready");
  });

  it("tolerates a null or undefined stream without subscribing", () => {
    const errors: string[] = [];
    expect(() =>
      testApi.bindSignalCliOutput({
        stream: null,
        log: () => {},
        error: (message) => errors.push(message),
      }),
    ).not.toThrow();
    expect(errors).toEqual([]);
  });
});
