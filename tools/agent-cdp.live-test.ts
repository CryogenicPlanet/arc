#!/usr/bin/env bun
// Opt-in integration probe. Only creates/closes disposable localhost fixture pages
// in an explicitly named agent bundle. Start tools/agent-fixture.ts first.
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentCDP, executeCommand, parseCDPOptions } from "./agent-cdp";

const { agent, port } = parseCDPOptions([...Bun.argv.slice(2), "list"]);
const foreground = (): string => {
  const result = Bun.spawnSync(["/usr/bin/lsappinfo", "front"]);
  assert(result.success, "foreground inspection failed");
  return result.stdout.toString().trim();
};
const output = resolve(import.meta.dir, `../profiles/agent-${agent}`);
mkdirSync(output, { recursive: true });
const client = await AgentCDP.connectAgent(agent, port);
const created: string[] = [];
const before = foreground();
try {
  const create = async (page: string): Promise<string> => {
    const result = await executeCommand(client, { name: "open", args: [`http://127.0.0.1:8767/${page}`] });
    assert.equal(typeof result.targetId, "string");
    const id = result.targetId as string;
    created.push(id);
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const value = await evaluate(id, "window.agentProbe?.page");
        if (value === page.toUpperCase()) return id;
      } catch { /* Navigation may replace the initial execution context. */ }
      await Bun.sleep(100);
    }
    throw new Error(`fixture ${page} did not load`);
  };
  const evaluate = async (id: string, expression: string): Promise<unknown> => {
    const response = await executeCommand(client, { name: "evaluate", args: [id, expression] });
    return (response.result as { value?: unknown }).value;
  };
  const a = await create("a");
  const b = await create("b");
  assert.notEqual(a, b);
  const snapshot = `({page:window.agentProbe.page,count:document.querySelector('#result').textContent,text:document.querySelector('#text').value,instance:window.agentProbe.instance})`;
  const unchangedA = await evaluate(a, snapshot);
  const originalVisibility = await evaluate(b, "document.visibilityState");
  const cliInput = (name: string, args: readonly string[]): void => {
    // Fresh transports per command exercise the real one-shot CLI lifecycle.
    const result = Bun.spawnSync(["bun", resolve(import.meta.dir, "agent-cdp.ts"), "--agent", agent, "--port", String(port), name, ...args]);
    assert(result.success, result.stderr.toString());
  };
  const point = async (selector: string): Promise<{ x: number; y: number }> => await evaluate(b,
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`) as { x: number; y: number };
  await evaluate(b, `document.querySelector('#increment').addEventListener('click',e=>window.trustedClick=e.isTrusted);document.querySelector('#text').addEventListener('input',e=>window.trustedInput=e.isTrusted);document.querySelector('#text').value='';true`);
  const button = await point("#increment");
  cliInput("click", [b, String(button.x), String(button.y)]);
  const input = await point("#text");
  cliInput("click", [b, String(input.x), String(input.y)]);
  cliInput("type", [b, "background B"]);
  const resultB = await evaluate(b, `({...${snapshot},trustedClick:window.trustedClick,trustedInput:window.trustedInput})`) as Record<string, unknown>;
  assert.equal(resultB.page, "B");
  assert.equal(resultB.count, "Count: 1");
  assert.equal(resultB.text, "background B");
  assert.equal(resultB.trustedClick, true);
  assert.equal(resultB.trustedInput, true);
  assert.equal(await evaluate(b, "document.visibilityState"), originalVisibility);
  assert.deepEqual(await evaluate(a, snapshot), unchangedA);
  assert.equal(await evaluate(b, "new Promise(resolve=>setTimeout(()=>resolve('awaited'),25))"), "awaited");
  const screenshot = await executeCommand(client, { name: "screenshot", args: [b, `${output}/background-b.png`] });
  assert.equal(foreground(), before, "background operations changed the foreground app");
  await executeCommand(client, { name: "close", args: [b] });
  created.splice(created.indexOf(b), 1);
  await assert.rejects(client.targetCommand(b, "Runtime.evaluate", { expression: "1" }));
  const report = { agent, port, targetA: a, targetB: b, targetAUnchanged: true, resultB, foregroundUnchanged: true, visibilityRestored: true, freshCLIInputs: true, awaitedPromise: true, closedTargetRejected: true, screenshot };
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const id of created) await client.request("Target.closeTarget", { targetId: id }).catch(() => undefined);
  client.close();
}
