// Agent-facing, exact-page browser control. No macOS activation or first-tab fallback.
import { AgentCDP, executeCommand, withTargetFocus, type CDPResult } from "./agent-cdp";
export class BrowserError extends Error {
  constructor(readonly code: string, message: string, readonly hint = "Read fresh page state before retrying.") { super(message); }
}
export const record = (value: unknown): CDPResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BrowserError("invalid_response", "Expected an object");
  return value as CDPResult;
};
const number = (value: unknown): number => { if (typeof value !== "number" || !Number.isFinite(value)) throw new BrowserError("invalid_response", "Expected a finite number"); return value; };
const string = (value: unknown): string => { if (typeof value !== "string") throw new BrowserError("invalid_response", "Expected text"); return value; };
const url = (value: string): string => { const parsed = new URL(value); if (!["http:", "https:"].includes(parsed.protocol) && value !== "about:blank") throw new BrowserError("invalid_url", "Use an HTTP(S) URL or about:blank"); return value; };
export interface Page { readonly handle: string; readonly target: string; frame: string; loader: string; epoch: number }
interface Element { readonly page: string; readonly epoch: number; readonly node: number; readonly snapshot: string }
export interface ElementState { readonly handle: string; readonly role: string; readonly name: string; readonly value?: unknown; readonly states: CDPResult; readonly bounds?: CDPResult; readonly actionable: boolean; readonly axId: string; readonly parent?: string; readonly children: readonly string[] }
export interface PageState { readonly page: string; readonly snapshot: string; readonly url: string; readonly title: string; readonly text: string; readonly textTruncated: boolean; readonly elementsTruncated: boolean; readonly viewport: CDPResult; readonly elements: readonly ElementState[] }
export class AgentBrowser {
  readonly pages = new Map<string, Page>();
  private readonly elements = new Map<string, Element>();
  private disconnected = false;
  private readonly dispose: () => void;
  constructor(readonly client: AgentCDP) {
    this.dispose = client.onEvent((event) => {
      if (event.method === "ArcMod.disconnected") { this.disconnected = true; this.pages.clear(); this.elements.clear(); }
      if (event.method === "Target.targetDestroyed") for (const page of this.pages.values()) if (page.target === event.params.targetId) this.forget(page);
      if (event.method === "Page.frameNavigated") {
        const frame = record(event.params.frame);
        if (frame.parentId === undefined) for (const page of this.pages.values()) if (page.frame === frame.id) { page.epoch++; this.invalidate(page.handle); }
      }
    });
  }
  private invalidate(page: string): void { for (const [handle, element] of this.elements) if (element.page === page) this.elements.delete(handle); }
  private forget(page: Page): void { this.pages.delete(page.handle); this.invalidate(page.handle); }
  private page(handle: string): Page {
    if (this.disconnected) throw new BrowserError("disconnected", "Browser connection closed", "Open a new session.");
    const page = this.pages.get(handle);
    if (!page) throw new BrowserError("stale_page", "Page handle is closed, foreign or belongs to an earlier server", "Use list_tabs or open_tab in this session.");
    return page;
  }
  private async frame(page: Page): Promise<CDPResult> {
    const response = await this.client.targetCommand(page.target, "Page.getFrameTree");
    const frame = record(record(response.frameTree).frame);
    const loader = string(frame.loaderId);
    if (page.loader !== loader || page.frame !== frame.id) { page.epoch++; this.invalidate(page.handle); }
    page.frame = string(frame.id); page.loader = loader;
    return frame;
  }
  async evaluate(handle: string, expression: string): Promise<unknown> {
    const result = await executeCommand(this.client, { name: "evaluate", args: [this.page(handle).target, expression] });
    return record(result.result).value;
  }
  private async adopt(target: string): Promise<Page> {
    const old = [...this.pages.values()].find((page) => page.target === target);
    if (old) return old;
    const page: Page = { handle: `page-${crypto.randomUUID()}`, target, frame: "", loader: "", epoch: 0 };
    await this.client.targetCommand(target, "Page.enable");
    await this.client.targetCommand(target, "Network.enable");
    await this.client.targetCommand(target, "DOM.enable");
    await this.client.targetCommand(target, "Accessibility.enable");
    await this.frame(page); this.pages.set(page.handle, page);
    return page;
  }
  async list(): Promise<readonly CDPResult[]> {
    const result = await this.client.request("Target.getTargets");
    if (!Array.isArray(result.targetInfos)) throw new BrowserError("invalid_response", "Missing target list");
    const list: CDPResult[] = []; const live = new Set<string>();
    for (const info of result.targetInfos.map(record)) if (info.type === "page") {
      const target = string(info.targetId); live.add(target);
      const page = await this.adopt(target);
      list.push({ page: page.handle, title: info.title, url: info.url });
    }
    for (const page of this.pages.values()) if (!live.has(page.target)) this.forget(page);
    return list;
  }
  async open(destination: string, timeoutMs = 10000): Promise<PageState> {
    url(destination);
    const response = await this.client.request("Target.createTarget", { url: "about:blank", background: true });
    const target = string(response.targetId);
    let page: Page | undefined;
    try { page = await this.adopt(target); return await this.navigate(page.handle, destination, timeoutMs); }
    catch (error) { if (page) this.forget(page); await this.client.request("Target.closeTarget", { targetId: target }).catch(() => undefined); throw error; }
  }
  async navigate(handle: string, destination: string, timeoutMs = 10000): Promise<PageState> {
    const page = this.page(handle); url(destination);
    this.invalidate(handle);
    const result = await this.client.targetCommand(page.target, "Page.navigate", { url: destination });
    if (result.errorText) throw new BrowserError("navigation_failed", String(result.errorText));
    await this.ready(page, timeoutMs, typeof result.loaderId === "string" ? result.loaderId : undefined, destination);
    return this.read(handle);
  }
  // Poll an explicit new loader + matching execution context, never the departing
  // document's readyState. Redirects use the current main frame's URL.
  private async ready(page: Page, timeoutMs: number, expectedLoader?: string, sameDocumentURL?: string): Promise<void> {
    const end = Date.now() + boundedTimeout(timeoutMs); let last = "loading";
    while (Date.now() < end) {
      try {
        const frame = await this.frame(page);
        const state = record(await this.evaluate(page.handle, "({ready:document.readyState,url:location.href})"));
        if ((expectedLoader === undefined || frame.loaderId === expectedLoader) && state.url === frame.url && (expectedLoader !== undefined || sameDocumentURL === undefined || state.url === sameDocumentURL) && ["interactive", "complete"].includes(String(state.ready))) {
          if (String(frame.url).startsWith("chrome-error:")) throw new BrowserError("navigation_failed", "Browser error page");
          return;
        }
        last = `${String(state.ready)} at ${String(state.url)}`;
      } catch (error) { if (this.disconnected) throw new BrowserError("disconnected", "Browser connection closed"); if (error instanceof BrowserError && error.code === "navigation_failed") throw error; last = String(error); }
      await Bun.sleep(50);
    }
    throw new BrowserError("timeout", `Page readiness timed out: ${last}`, "Inspect the page; do not replay a consequential action automatically.");
  }
  async history(handle: string, direction: "back" | "forward", timeoutMs = 10000): Promise<PageState> {
    const page = this.page(handle); const response = await this.client.targetCommand(page.target, "Page.getNavigationHistory");
    const entries = response.entries as CDPResult[];
    const entry = entries[number(response.currentIndex) + (direction === "back" ? -1 : 1)];
    if (!entry) throw new BrowserError("no_history", `No ${direction} entry`);
    const oldLoader = (await this.frame(page)).loaderId; let navigationStarted = false;
    const dispose = this.client.onEvent((event) => { if (event.method === "Page.frameStartedLoading" && event.params.frameId === page.frame) navigationStarted = true; });
    this.invalidate(handle);
    try {
      await this.client.targetCommand(page.target, "Page.navigateToHistoryEntry", { entryId: entry.id });
      const end = Date.now() + boundedTimeout(timeoutMs);
      while (Date.now() < end) {
        const current = await this.frame(page);
        const history = await this.client.targetCommand(page.target, "Page.getNavigationHistory");
        const selected = (history.entries as CDPResult[])[number(history.currentIndex)];
        if (selected?.id === entry.id && current.url === entry.url && (!navigationStarted || current.loaderId !== oldLoader)) { await this.ready(page, Math.max(1, end - Date.now())); return this.read(handle); }
        await Bun.sleep(50);
      }
      throw new BrowserError("timeout", `History ${direction} did not complete`);
    } finally { dispose(); }
  }

  private async node(page: Page, backendNodeId: number, functionDeclaration: string, args: readonly unknown[] = []): Promise<unknown> {
    const resolved = await this.client.targetCommand(page.target, "DOM.resolveNode", { backendNodeId });
    const objectId = string(record(resolved.object).objectId);
    try {
      const result = await this.client.targetCommand(page.target, "Runtime.callFunctionOn", { objectId, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new BrowserError("stale_element", "Element no longer resolves in this document");
      return record(result.result).value;
    } finally { await this.client.targetCommand(page.target, "Runtime.releaseObject", { objectId }).catch(() => undefined); }
  }
  async read(handle: string): Promise<PageState> {
    const page = this.page(handle); await this.frame(page);
    const epoch = page.epoch; this.invalidate(handle); const snapshot = crypto.randomUUID();
    const meta = record(await this.evaluate(handle, `({url:location.href,title:document.title,text:(document.body?.innerText??'').slice(0,16000),textTruncated:(document.body?.innerText??'').length>16000,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio:devicePixelRatio,scrollX,scrollY}})`));
    const response = await this.client.targetCommand(page.target, "Accessibility.getFullAXTree");
    const nodes = (response.nodes as CDPResult[]).filter((node) => !node.ignored);
    const elements: ElementState[] = [];
    for (const ax of nodes.slice(0, 500)) {
      const role = String(record(ax.role ?? {}).value ?? ""); const name = String(record(ax.name ?? {}).value ?? "");
      const properties = Array.isArray(ax.properties) ? ax.properties.map(record) : [];
      const states = Object.fromEntries(properties.map((property) => [String(property.name), record(property.value).value]));
      const actionable = ["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "spinbutton", "slider", "menuitem", "tab"].includes(role) || states.focusable === true;
      let bounds: CDPResult | undefined; let value: unknown = record(ax.value ?? {}).value;
      const elementHandle = `element-${crypto.randomUUID()}`;
      if (typeof ax.backendDOMNodeId === "number" && actionable) {
        try {
          const details = record(await this.node(page, ax.backendDOMNodeId, `function(){const r=this.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,connected:this.isConnected,password:this.type==='password',value:this.type==='password'?undefined:this.value}}`));
          if (details.password === true) value = "[redacted]";
          else if (details.value !== undefined) value = details.value;
          bounds = { x: details.x, y: details.y, width: details.width, height: details.height };
          if (details.connected) this.elements.set(elementHandle, { page: handle, epoch, node: ax.backendDOMNodeId, snapshot });
        } catch { /* AX-only or detached nodes remain readable, not actionable. */ }
      }
      elements.push({ handle: elementHandle, role, name, states, actionable: this.elements.has(elementHandle), axId: String(ax.nodeId), ...(ax.parentId === undefined ? {} : { parent: String(ax.parentId) }), children: Array.isArray(ax.childIds) ? ax.childIds.map(String) : [], ...(value === undefined ? {} : { value }), ...(bounds === undefined ? {} : { bounds }) });
    }
    await this.frame(page);
    if (page.epoch !== epoch) { this.invalidate(handle); throw new BrowserError("page_changed", "Page navigated while reading state"); }
    return { page: handle, snapshot, url: string(meta.url), title: string(meta.title), text: string(meta.text), textTruncated: meta.textTruncated === true, elementsTruncated: nodes.length > 500, viewport: record(meta.viewport), elements };
  }
  private async resolve(handle: string, elementHandle: string): Promise<{ page: Page; element: Element }> {
    const page = this.page(handle); await this.frame(page); const element = this.elements.get(elementHandle);
    if (!element || element.page !== handle || element.epoch !== page.epoch) throw new BrowserError("stale_element", "Element is foreign, stale or from an earlier snapshot");
    return { page, element };
  }
  private async point(page: Page, element: Element): Promise<CDPResult> {
    await this.client.targetCommand(page.target, "DOM.scrollIntoViewIfNeeded", { backendNodeId: element.node });
    const details = record(await this.node(page, element.node, `function(){const r=this.getBoundingClientRect();const x=Math.max(0,r.left)+Math.min(r.right,innerWidth)-Math.max(0,r.left);const cx=(Math.max(0,r.left)+Math.min(r.right,innerWidth))/2,cy=(Math.max(0,r.top)+Math.min(r.bottom,innerHeight))/2;const root=this.getRootNode();const hit=(root.elementFromPoint?root:document).elementFromPoint(cx,cy);return {x:cx,y:cy,width:r.width,height:r.height,connected:this.isConnected,disabled:!!this.disabled||this.getAttribute('aria-disabled')==='true',hit:hit===this||this.contains(hit),editable:this.isContentEditable||this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement,readonly:!!this.readOnly,password:this.type==='password'}}`));
    if (!details.connected || details.disabled || !details.hit || number(details.width) <= 0 || number(details.height) <= 0) throw new BrowserError("element_unavailable", "Element is detached, disabled, hidden or obscured");
    return details;
  }
  async click(handle: string, elementHandle: string): Promise<PageState> {
    const { page, element } = await this.resolve(handle, elementHandle); const point = await this.point(page, element);
    const oldLoader = page.loader; let navigationStarted = false;
    const dispose = this.client.onEvent((event) => {
      if ((event.method === "Page.frameStartedLoading" && event.params.frameId === page.frame) || (event.method === "Network.requestWillBeSent" && event.params.frameId === page.frame && event.params.type === "Document")) navigationStarted = true;
    });
    try {
      await executeCommand(this.client, { name: "click", args: [page.target, String(point.x), String(point.y)] });
      if (navigationStarted) {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && (await this.frame(page)).loaderId === oldLoader) await Bun.sleep(50);
        if (page.loader === oldLoader) throw new BrowserError("timeout", "Click was dispatched but navigation did not reach a new document", "Read current state; do not replay the click automatically.");
      }
      await this.ready(page, 10000); return this.read(handle);
    } finally { dispose(); }
  }
  async type(handle: string, elementHandle: string, text: string, replace = true): Promise<PageState> {
    if (text.length > 32000) throw new BrowserError("invalid_arguments", "Text exceeds 32000 characters");
    if (text === "" && !replace) { await this.resolve(handle, elementHandle); return this.read(handle); }
    const { page, element } = await this.resolve(handle, elementHandle); const point = await this.point(page, element);
    if (!point.editable || point.readonly) throw new BrowserError("not_editable", "Element is not an editable text control");
    // Browser selection only; value changes and input events come from trusted
    // Input.insertText, rather than setting DOM values or synthetic input.
    await withTargetFocus(this.client, page.target, async () => {
      await this.node(page, element.node, `function(replace){this.focus();if(replace){if(typeof this.select==='function')this.select();else {const r=document.createRange();r.selectNodeContents(this);const s=getSelection();s.removeAllRanges();s.addRange(r)}}}`, [replace]);
      if (text !== "") await this.client.targetCommand(page.target, "Input.insertText", { text });
      else {
        const key = { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 };
        await this.client.targetCommand(page.target, "Input.dispatchKeyEvent", { ...key, type: "keyDown" });
        try { await this.client.targetCommand(page.target, "Input.dispatchKeyEvent", { ...key, type: "keyUp" }); }
        catch (error) { await this.client.targetCommand(page.target, "Input.dispatchKeyEvent", { ...key, type: "keyUp" }).catch(() => undefined); throw error; }
      }
    });
    const actual = await this.node(page, element.node, "function(){return this.value??this.textContent}");
    if (replace && actual !== text) throw new BrowserError("value_mismatch", "Input was delivered but the field value differs", "Read the field; the site may have formatted or rejected the input.");
    return this.read(handle);
  }
  async wait(handle: string, condition: { text?: string; url?: string; role?: string; name?: string }, timeoutMs = 10000): Promise<PageState> {
    if (Object.keys(condition).length === 0) throw new BrowserError("invalid_arguments", "Provide a text, URL or role/name condition");
    const end = Date.now() + boundedTimeout(timeoutMs);
    while (Date.now() < end) {
      const state = await this.read(handle);
      if ((condition.text === undefined || state.text.includes(condition.text)) && (condition.url === undefined || state.url === condition.url) && (condition.role === undefined && condition.name === undefined || state.elements.some((element) => (condition.role === undefined || element.role === condition.role) && (condition.name === undefined || element.name === condition.name) && element.states.hidden !== true))) return state;
      await Bun.sleep(100);
    }
    throw new BrowserError("timeout", "Expected page condition did not appear", "Inspect current state before deciding whether to retry.");
  }
  async screenshot(handle: string): Promise<CDPResult> {
    const page = this.page(handle); const viewport = record(await this.evaluate(handle, "({width:innerWidth,height:innerHeight,devicePixelRatio})"));
    const response = await this.client.targetCommand(page.target, "Page.captureScreenshot", { format: "png" });
    const data = string(response.data); const png = Buffer.from(data, "base64");
    if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new BrowserError("invalid_image", "Screenshot was not PNG");
    return { page: handle, data, viewport, image: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
  }
  async close(handle: string): Promise<CDPResult> { const page = this.page(handle); await executeCommand(this.client, { name: "close", args: [page.target] }); this.forget(page); return { page: handle, closed: true }; }
  disposeConnection(): void { this.dispose(); this.client.close(); this.pages.clear(); this.elements.clear(); }
}
export const boundedTimeout = (ms: number): number => { if (!Number.isInteger(ms) || ms < 1 || ms > 30000) throw new BrowserError("invalid_arguments", "timeout_ms must be 1..30000"); return ms; };
