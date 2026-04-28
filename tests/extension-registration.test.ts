import { describe, it, expect } from "vitest";
import exaSearchExtension from "../extensions/index.ts";

function createMockExtensionAPI() {
  const tools: unknown[] = [];
  const commands: Map<string, unknown> = new Map();
  const eventHandlers: Map<string, unknown[]> = new Map();

  return {
    registerTool: (tool: unknown) => tools.push(tool),
    registerCommand: (name: string, command: unknown) => commands.set(name, command),
    on: (event: string, handler: unknown) => {
      const handlers = eventHandlers.get(event) || [];
      handlers.push(handler);
      eventHandlers.set(event, handlers);
    },
    getTools: () => tools,
    getCommand: (name: string) => commands.get(name),
    getEventHandlers: (event: string) => eventHandlers.get(event) || [],
    findTool: (name: string) => tools.find((t: unknown) => (t as { name: string }).name === name),
  };
}

function setup() {
  const api = createMockExtensionAPI();
  exaSearchExtension(api as unknown as import("@mariozechner/pi-coding-agent").ExtensionAPI);
  return api;
}

const mockTheme = { fg: (_name: string, text: string) => text };

describe("Extension Registration", () => {
  it("should register all three tools with correct names and labels", () => {
    const api = setup();
    const tools = api.getTools();
    expect(tools).toHaveLength(3);

    const expected = [
      { name: "exa_search", label: "Exa Search" },
      { name: "exa_fetch", label: "Exa Fetch" },
      { name: "exa_code_context", label: "Exa Code Context" },
    ];

    for (const { name, label } of expected) {
      const tool = api.findTool(name) as { name: string; label: string; execute: unknown };
      expect(tool).toBeDefined();
      expect(tool.name).toBe(name);
      expect(tool.label).toBe(label);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("should register /exa-status command", () => {
    const api = setup();
    const cmd = api.getCommand("exa-status") as { description: string; handler: Function };
    expect(cmd).toBeDefined();
    expect(cmd.description).toContain("API key");
    expect(typeof cmd.handler).toBe("function");
  });

  it("should register session_start event handler", () => {
    const api = setup();
    expect(api.getEventHandlers("session_start")).toHaveLength(1);
  });
});

describe("exa_fetch renderResult", () => {
  it("should display title and cost when both present", () => {
    const api = setup();
    const tool = api.findTool("exa_fetch") as { renderResult: Function };
    const rendered = tool.renderResult(
      {
        content: [],
        details: { url: "https://example.com", title: "Test Page", cost: { total: 0.000123 } },
      },
      { expanded: false, isPartial: false },
      mockTheme,
      { lastComponent: undefined },
    );
    expect(rendered.text).toContain("Test Page");
    expect(rendered.text).toContain("$0.000123");
  });

  it("should display Fetched when no title", () => {
    const api = setup();
    const tool = api.findTool("exa_fetch") as { renderResult: Function };
    const rendered = tool.renderResult(
      { content: [], details: { url: "https://example.com", cost: { total: 0.000456 } } },
      { expanded: false, isPartial: false },
      mockTheme,
      { lastComponent: undefined },
    );
    expect(rendered.text).toContain("Fetched");
    expect(rendered.text).toContain("$0.000456");
  });

  it("should display empty string when no details", () => {
    const api = setup();
    const tool = api.findTool("exa_fetch") as { renderResult: Function };
    const rendered = tool.renderResult(
      { content: [] },
      { expanded: false, isPartial: false },
      mockTheme,
      { lastComponent: undefined },
    );
    expect(rendered.text).toBe("");
  });
});

describe("exa_code_context renderResult", () => {
  it("should display stats and cost when details present", () => {
    const api = setup();
    const tool = api.findTool("exa_code_context") as { renderResult: Function };
    const rendered = tool.renderResult(
      {
        content: [],
        details: {
          query: "React hooks",
          resultsCount: 502,
          outputTokens: 4805,
          cost: { total: 1.0 },
        },
      },
      { expanded: false, isPartial: false },
      mockTheme,
      { lastComponent: undefined },
    );
    expect(rendered.text).toContain("502 sources");
    expect(rendered.text).toContain("4805 tokens");
    expect(rendered.text).toContain("$1.000000");
  });

  it("should display stats without cost when cost missing", () => {
    const api = setup();
    const tool = api.findTool("exa_code_context") as { renderResult: Function };
    const rendered = tool.renderResult(
      {
        content: [],
        details: { query: "Express middleware", resultsCount: 100, outputTokens: 2000 },
      },
      { expanded: false, isPartial: false },
      mockTheme,
      { lastComponent: undefined },
    );
    expect(rendered.text).toContain("100 sources");
    expect(rendered.text).toContain("2000 tokens");
    expect(rendered.text).not.toContain("$");
  });

  it("should fall back to content text when no details", () => {
    const api = setup();
    const tool = api.findTool("exa_code_context") as { renderResult: Function };
    const rendered = tool.renderResult(
      { content: [{ type: "text", text: "Some code context output here" }] },
      { expanded: false, isPartial: false },
      mockTheme,
      { lastComponent: undefined },
    );
    expect(rendered.text).toContain("Some code context");
  });
});
