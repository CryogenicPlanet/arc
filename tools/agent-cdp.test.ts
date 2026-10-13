import { describe, expect, test } from "bun:test";
import { AgentCDP, executeCommand, parseCDPOptions, validateDebugSocket, verifyListener } from "./agent-cdp";

describe("CDP input and agent ownership", () => {
  test("strictly parses explicit commands, quoted expressions and target IDs", () => {
    expect(parseCDPOptions(["--port", "9223", "--agent", "scout", "evaluate", "PAGE-1", "Promise.resolve('two words')"])).toEqual({ agent: "scout", port: 9223, command: { name: "evaluate", args: ["PAGE-1", "Promise.resolve('two words')"] } });
    for (const tail of [["list", "extra"], ["navigate", "PAGE-1"], ["evaluate", "https://example.com", "1"], ["click", "PAGE-1", "NaN", "0"], ["click", "PAGE-1", "0", "-1"], ["open", "javascript:alert(1)"], ["unknown"]]) {
      expect(() => parseCDPOptions(["--agent", "scout", "--port", "9223", ...tail])).toThrow();
    }
    for (const args of [["--agent", "scout", "list"], ["--agent", "scout", "--agent", "scout", "--port", "9223", "list"], ["--agent", "../Arc", "--port", "9223", "list"], ["--agent", "scout", "--port", "65536", "list"], ["--agent", "scout", "--port", "9223", "--unknown", "list"]]) expect(() => parseCDPOptions(args)).toThrow();
  });

  test("requires exactly one loopback listener owned by the exact requested agent executable", () => {
    const executable = "/tmp/arc/build/ArcModAgent-scout.app/Contents/MacOS/Arc";
    expect(verifyListener("p42\nf10\nn127.0.0.1:9223\n", `${executable} --remote-debugging-port=9223`, executable, 9223)).toBe(42);
    expect(verifyListener("p42\nn[::1]:9223\n", executable, executable, 9223)).toBe(42);
    for (const [listener, command] of [
      ["", executable], ["p42\nn*:9223", executable], ["p42\nn0.0.0.0:9223", executable], ["p42\nn127.0.0.1:9224", executable],
      ["p42\nn127.0.0.1:9223\nn[::1]:9223", executable], ["p42\nn127.0.0.1:9223\np43\nn127.0.0.1:9223", executable],
      ["p42\nn127.0.0.1:9223", executable.replace("Agent-scout", "Agent-other")], ["p42\nn127.0.0.1:9223", executable.replace("ArcModAgent-scout", "ArcMod")],
      ["p42\nn127.0.0.1:9223", "/Applications/Arc.app/Contents/MacOS/Arc"], ["p42\nn127.0.0.1:9223", `${executable}Fake`], ["n127.0.0.1:9223", executable],
    ]) expect(() => verifyListener(listener!, command!, executable, 9223)).toThrow();
  });

  test("rejects remote, redirected, malformed and mismatched websocket addresses", () => {
    expect(validateDebugSocket("ws://127.0.0.1:9223/devtools/browser/ABC-1", 9223, "browser")).toBe("ws://127.0.0.1:9223/devtools/browser/ABC-1");
    for (const address of ["ws://evil.example:9223/devtools/browser/ABC", "ws://localhost:9223/devtools/browser/ABC", "ws://127.0.0.1:9224/devtools/browser/ABC", "wss://127.0.0.1:9223/devtools/browser/ABC", "ws://user@127.0.0.1:9223/devtools/browser/ABC", "ws://127.0.0.1:9223/devtools/page/ABC", "ws://127.0.0.1:9223/devtools/browser/ABC?x=1", "ws://127.0.0.1:9223/devtools/browser/ABC#x", "ws://127.0.0.01:9223/devtools/browser/ABC", "ws://127.0.0.1:9223/devtools/page/../browser/ABC", "not a url"]) expect(() => validateDebugSocket(address, 9223, "browser")).toThrow();
    expect(() => validateDebugSocket("ws://127.0.0.1:9223/devtools/page/PAGE-2", 9223, "page", "PAGE-1")).toThrow();
  });
});

interface WireCommand { id: number; method: string; params: Record<string, unknown>; sessionId?: string }
const fakeBrowser = async (run: (client: AgentCDP, messages: WireCommand[]) => Promise<void>, responder?: (command: WireCommand) => unknown) => {
  const messages: WireCommand[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request, endpoint) { if (endpoint.upgrade(request)) return; return new Response("expected websocket", { status: 400 }); },
    websocket: {
      message(socket, message) {
        const command = JSON.parse(String(message)) as WireCommand;
        messages.push(command);
        if (command.method === "test.disconnect") { socket.close(); return; }
        if (command.method === "test.timeout") return;
        let result: unknown;
        if (responder) result = responder(command);
        if (result === undefined) {
          if (command.method === "Target.getTargetInfo") result = { targetInfo: { targetId: command.params.targetId, type: "page" } };
          else if (command.method === "Target.attachToTarget") result = { sessionId: `session-${String(command.params.targetId)}` };
          else if (command.method === "Target.createTarget") result = { targetId: "PAGE-NEW" };
          else if (command.method === "Target.closeTarget") result = { success: true };
          else result = { result: { value: "ok" } };
        }
        if (command.method === "test.reverse") {
          setTimeout(() => socket.send(JSON.stringify({ id: command.id, result: { value: command.params.value } })), command.params.value === "first" ? 20 : 0);
        } else socket.send(JSON.stringify({ id: command.id, ...(command.sessionId ? { sessionId: command.sessionId } : {}), ...result !== null && typeof result === "object" && "error" in result ? result : { result } }));
      },
    },
  });
  let client: AgentCDP | undefined;
  try {
    client = await AgentCDP.connectSocket(`ws://127.0.0.1:${server.port}/devtools/browser/FAKE`, server.port!, 200);
    await run(client, messages);
  } finally { client?.close(); server.stop(true); }
};

describe("CDP transport and explicit target control", () => {
  test("routes commands only to the requested flattened target and matches out-of-order replies", async () => {
    await fakeBrowser(async (client, messages) => {
      const results = await Promise.all([client.request("test.reverse", { value: "first" }), client.request("test.reverse", { value: "second" })]);
      expect(results).toEqual([{ value: "first" }, { value: "second" }]);
      await executeCommand(client, { name: "evaluate", args: ["PAGE-1", "Promise.resolve(42)"] });
      const evaluate = messages.find((message) => message.method === "Runtime.evaluate")!;
      expect(evaluate.sessionId).toBe("session-PAGE-1");
      expect(evaluate.params).toEqual({ expression: "Promise.resolve(42)", awaitPromise: true, returnByValue: true });
      expect(messages.find((message) => message.method === "Target.attachToTarget")!.params).toEqual({ targetId: "PAGE-1", flatten: true });
      await executeCommand(client, { name: "open", args: ["https://example.com"] });
      expect(messages.at(-1)!.params).toEqual({ url: "https://example.com", background: true });
      await executeCommand(client, { name: "click", args: ["PAGE-1", "12.5", "20"] });
      const mouse = messages.filter((message) => message.method === "Input.dispatchMouseEvent");
      expect(mouse.map((message) => message.params.type)).toEqual(["mousePressed", "mouseReleased"]);
      expect(mouse.every((message) => message.sessionId === "session-PAGE-1" && message.params.button === "left")).toBe(true);
      await executeCommand(client, { name: "type", args: ["PAGE-1", "two words"] });
      expect(messages.find((message) => message.method === "Input.insertText")!.params).toEqual({ text: "two words" });
      expect(messages.at(-1)!.method).toBe("Emulation.setFocusEmulationEnabled");
      expect(messages.at(-1)!.params).toEqual({ enabled: false });
      expect(messages.some((message) => /activate|bringToFront/i.test(message.method))).toBe(false);
    });
  });

  test("missing/closed targets reject without any fallback page command", async () => {
    await fakeBrowser(async (client, messages) => {
      await expect(client.targetCommand("GONE", "Runtime.evaluate", { expression: "1" })).rejects.toThrow("CDP error");
      expect(messages.map((message) => message.method)).toEqual(["Target.getTargetInfo"]);
    }, (command) => command.method === "Target.getTargetInfo" ? { error: { code: -32602, message: "No target with given id found" } } : undefined);
  });

  test("timeouts, disconnects, malformed replies and close reject pending requests", async () => {
    await fakeBrowser(async (client) => { await expect(client.request("test.timeout")).rejects.toThrow("timed out"); });
    await fakeBrowser(async (client) => {
      await expect(client.request("test.disconnect")).rejects.toThrow("disconnected");
      await expect(client.request("Runtime.enable")).rejects.toThrow("closed");
    });
    await fakeBrowser(async (client) => { await expect(client.request("test.malformed")).rejects.toThrow("malformed CDP response"); }, () => null);
    await fakeBrowser(async (client) => {
      const pending = client.request("test.timeout");
      client.close();
      await expect(pending).rejects.toThrow("connection closed");
    });
  });

  test("script exceptions produce errors rather than successful evaluation output", async () => {
    await fakeBrowser(async (client) => {
      await expect(executeCommand(client, { name: "evaluate", args: ["PAGE-1", "throw new Error('boom')"] })).rejects.toThrow("page evaluation failed");
    }, (command) => command.method === "Runtime.evaluate" ? { exceptionDetails: { text: "boom" } } : undefined);
  });

  test("trusted inputs enable focus only on their target and always reset it", async () => {
    for (const name of ["click", "type"]) {
      const command = { name, args: name === "click" ? ["PAGE-1", "12", "20"] : ["PAGE-1", "words"] };
      for (const failInput of [false, true]) {
        await fakeBrowser(async (client, messages) => {
          const action = executeCommand(client, command);
          if (failInput) await expect(action).rejects.toThrow("input rejected");
          else await action;
          const operations = messages.filter((message) => message.sessionId !== undefined);
          expect(operations[0]!.method).toBe("Emulation.setFocusEmulationEnabled");
          expect(operations[0]!.params).toEqual({ enabled: true });
          expect(operations.at(-1)!.method).toBe("Emulation.setFocusEmulationEnabled");
          expect(operations.at(-1)!.params).toEqual({ enabled: false });
          expect(operations.every((message) => message.sessionId === "session-PAGE-1")).toBe(true);
          const beforeFrame = operations[1]!;
          expect(beforeFrame.method).toBe("Runtime.evaluate");
          expect(beforeFrame.params).toEqual({ expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", awaitPromise: true });
          if (!failInput) {
            const afterFrame = operations.at(-2)!;
            expect(afterFrame.method).toBe("Runtime.evaluate");
            expect(afterFrame.params).toEqual({ expression: "new Promise(resolve => requestAnimationFrame(resolve))", awaitPromise: true });
          }
        }, (message) => failInput && message.method.startsWith("Input.") ? { error: { code: -32000, message: "input rejected" } } : undefined);
      }
    }
  });

  test("failed release gets one cleanup release and never replays a successful press", async () => {
    for (const failCleanup of [false, true]) {
      let releases = 0;
      await fakeBrowser(async (client, messages) => {
        await expect(executeCommand(client, { name: "click", args: ["PAGE-1", "12", "20"] })).rejects.toThrow("release rejected");
        const mouse = messages.filter((message) => message.method === "Input.dispatchMouseEvent");
        expect(mouse.map((message) => message.params.type)).toEqual(["mousePressed", "mouseReleased", "mouseReleased"]);
        expect(mouse.every((message) => message.sessionId === "session-PAGE-1")).toBe(true);
        expect(mouse.slice(1).every((message) => message.params.buttons === 0)).toBe(true);
        expect(messages.at(-1)!.method).toBe("Emulation.setFocusEmulationEnabled");
        expect(messages.at(-1)!.params).toEqual({ enabled: false });
      }, (message) => {
        if (message.method === "Input.dispatchMouseEvent" && message.params.type === "mouseReleased") {
          releases++;
          if (releases === 1 || failCleanup) return { error: { code: -32000, message: "release rejected" } };
        }
        return undefined;
      });
    }
  });

  test("a failed readiness barrier resets focus and dispatches no input", async () => {
    await fakeBrowser(async (client, messages) => {
      await expect(executeCommand(client, { name: "click", args: ["PAGE-1", "12", "20"] })).rejects.toThrow("frame failed");
      expect(messages.some((message) => message.method.startsWith("Input."))).toBe(false);
      expect(messages.at(-1)!.method).toBe("Emulation.setFocusEmulationEnabled");
      expect(messages.at(-1)!.params).toEqual({ enabled: false });
    }, (message) => message.method === "Runtime.evaluate" ? { error: { code: -32000, message: "frame failed" } } : undefined);
  });

  test("readiness and drain script exceptions surface errors and reset target focus", async () => {
    for (const failBarrier of [1, 2]) {
      let barriers = 0;
      await fakeBrowser(async (client, messages) => {
        await expect(executeCommand(client, { name: "click", args: ["PAGE-1", "12", "20"] })).rejects.toThrow("input frame synchronization failed");
        const input = messages.filter((message) => message.method.startsWith("Input."));
        expect(input.map((message) => message.params.type)).toEqual(failBarrier === 1 ? [] : ["mousePressed", "mouseReleased"]);
        expect(messages.at(-1)!.method).toBe("Emulation.setFocusEmulationEnabled");
        expect(messages.at(-1)!.params).toEqual({ enabled: false });
      }, (message) => {
        if (message.method === "Runtime.evaluate" && ++barriers === failBarrier) return { exceptionDetails: { text: "requestAnimationFrame failed" } };
        return undefined;
      });
    }
  });
});
