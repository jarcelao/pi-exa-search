/**
 * exa-search Extension
 *
 * Registers three tools for web search, content fetching, and code context using the Exa API:
 * - exa_search: Natural language web search
 * - exa_fetch: Fetch and extract content from URLs
 * - exa_code_context: Search for code snippets and examples from open source repos
 *
 * Also registers the /exa-status command to check API key configuration.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "typebox";
import Exa from "exa-js";

// API Key Management

function getApiKey(): string | undefined {
  const key = process.env.EXA_API_KEY;
  return key && key.length > 0 ? key : undefined;
}

// Temp File Helper

async function writeTempFile(content: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-exa-"));
  const tempFile = join(tempDir, "output.txt");
  await writeFile(tempFile, content, "utf8");
  return tempFile;
}

// Type Definitions

type SearchContentType = "text" | "highlights" | "summary" | "none";
type FetchContentType = "text" | "highlights" | "summary";

interface SearchDetails {
  query: string;
  numResults: number;
  cost?: { total: number };
}

interface FetchDetails {
  url: string;
  title?: string;
  cost?: { total: number };
}

interface CodeContextDetails {
  query: string;
  resultsCount: number;
  outputTokens: number;
  cost?: { total: number };
}

interface CodeContextResponse {
  requestId: string;
  query: string;
  response: string;
  resultsCount: number;
  costDollars: string | { total: number };
  searchTime: number;
  outputTokens: number;
}

// Content Type Mapping

function mapSearchContentType(
  contentType?: SearchContentType,
): { text?: true; highlights?: true; summary?: true } | undefined {
  switch (contentType) {
    case "text":
      return { text: true };
    case "highlights":
      return { highlights: true };
    case "summary":
      return { summary: true };
    case "none":
      return undefined;
    default:
      return { highlights: true };
  }
}

function mapFetchContentType(
  contentType?: FetchContentType,
): { text?: true; highlights?: true; summary?: true } | undefined {
  switch (contentType) {
    case "text":
      return { text: true };
    case "highlights":
      return { highlights: true };
    case "summary":
      return { summary: true };
    default:
      return { text: true };
  }
}

// Result Formatting

interface ExaSearchResult {
  title: string;
  url: string;
  publishedDate?: string | null;
  author?: string | null;
  text?: string;
  highlights?: string[];
  summary?: string;
}

interface ExaSearchResponse {
  results: ExaSearchResult[];
  costDollars?: { total: number };
}

function formatSearchResults(response: ExaSearchResponse): string {
  const { results, costDollars } = response;
  const lines: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    lines.push(`--- Result ${i + 1} ---`);
    lines.push(`Title: ${result.title}`);
    lines.push(`URL: ${result.url}`);

    if (result.publishedDate) {
      lines.push(`Published: ${result.publishedDate}`);
    }
    if (result.author) {
      lines.push(`Author: ${result.author}`);
    }

    if (result.highlights && result.highlights.length > 0) {
      lines.push("Highlights:");
      for (const highlight of result.highlights) {
        lines.push(`  • ${highlight}`);
      }
    }

    if (result.text) {
      const preview = result.text.slice(0, 500);
      lines.push(`Text: ${preview}${result.text.length > 500 ? "..." : ""}`);
    }

    if (result.summary) {
      lines.push(`Summary: ${result.summary}`);
    }

    lines.push("");
  }

  if (costDollars) {
    lines.push(`Cost: $${costDollars.total.toFixed(6)}`);
  }

  return lines.join("\n");
}

function formatFetchResult(result: ExaSearchResult, contentType: FetchContentType): string {
  const lines: string[] = [];

  if (result.title) {
    lines.push(`Title: ${result.title}`);
  }
  lines.push(`URL: ${result.url}`);
  lines.push("");

  switch (contentType) {
    case "text":
      if (result.text) {
        lines.push(result.text);
      }
      break;
    case "highlights":
      if (result.highlights && result.highlights.length > 0) {
        lines.push("Highlights:");
        for (const h of result.highlights) {
          lines.push(`  • ${h}`);
        }
      }
      break;
    case "summary":
      if (result.summary) {
        lines.push("Summary:");
        lines.push(result.summary);
      }
      break;
  }

  return lines.join("\n");
}

function parseCostDollars(costDollars: string | { total: number }): { total: number } {
  if (typeof costDollars === "string") {
    return JSON.parse(costDollars);
  }
  return costDollars;
}

function formatCodeContextResult(response: CodeContextResponse): string {
  const lines: string[] = [];

  lines.push(`Query: ${response.query}`);
  lines.push(`Results: ${response.resultsCount} sources`);
  lines.push(`Output tokens: ${response.outputTokens}`);
  lines.push("");
  lines.push("--- Code Context ---");
  lines.push("");
  lines.push(response.response);
  lines.push("");

  const cost = parseCostDollars(response.costDollars);
  lines.push(`Cost: $${cost.total.toFixed(6)}`);

  return lines.join("\n");
}

// Error Creation

function createMissingApiKeyError(): Error {
  return new Error(
    "Exa API key not configured. Set EXA_API_KEY environment variable before starting pi.",
  );
}

// Exports

export {
  getApiKey,
  mapSearchContentType,
  mapFetchContentType,
  formatSearchResults,
  formatFetchResult,
  formatCodeContextResult,
  parseCostDollars,
  createMissingApiKeyError,
};

export default function exaSearchExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    const hasKey = !!getApiKey();
    if (!hasKey) {
      ctx.ui.notify("Exa API key not configured. Set EXA_API_KEY to enable search.", "warning");
    }
  });

  // Register exa_search tool

  const ExaSearchParams = Type.Object({
    query: Type.String({
      description: "Natural language search query",
    }),
    contentType: Type.Optional(
      Type.Union([
        Type.Literal("text"),
        Type.Literal("highlights"),
        Type.Literal("summary"),
        Type.Literal("none"),
      ]),
    ),
    numResults: Type.Optional(
      Type.Number({
        description: "Number of results (1-100)",
      }),
    ),
  });

  pi.registerTool(
    defineTool({
      name: "exa_search",
      label: "Exa Search",
      description:
        "Search the web using Exa's neural search API. Best for factual queries, research, and finding relevant web content. Use highlights mode by default for token efficiency.",
      parameters: ExaSearchParams,

      async execute(
        _toolCallId: string,
        params: Static<typeof ExaSearchParams>,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        _ctx: ExtensionContext,
      ) {
        const apiKey = getApiKey();
        if (!apiKey) {
          throw createMissingApiKeyError();
        }

        const numResults = Math.max(1, Math.min(100, params.numResults ?? 10));
        const exa = new Exa(apiKey);

        const contents = mapSearchContentType(params.contentType as SearchContentType | undefined);
        const searchOptions: {
          numResults: number;
          contents?: { text?: true; highlights?: true; summary?: true };
        } = { numResults };

        if (contents) {
          searchOptions.contents = contents;
        }

        let response;
        try {
          response = await exa.search(params.query, searchOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Exa API error: ${message}`);
        }

        let output = formatSearchResults({
          results: response.results as ExaSearchResult[],
          costDollars: response.costDollars as { total: number } | undefined,
        });

        const truncation = truncateHead(output, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let result = truncation.content;

        if (truncation.truncated) {
          const tempFile = await writeTempFile(output);
          result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
          result += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
          result += ` Full output saved to: ${tempFile}]`;
        }

        return {
          content: [{ type: "text", text: result }],
          details: {
            query: params.query,
            numResults: response.results.length,
            cost: response.costDollars,
          } as SearchDetails,
        };
      },

      renderCall(args, theme) {
        const preview = args.query.length > 50 ? args.query.slice(0, 50) + "..." : args.query;
        const desc = `${args.numResults ?? 10} results • ${args.contentType ?? "highlights"}`;
        const text =
          theme.fg("toolTitle", theme.bold("exa_search ")) +
          theme.fg("muted", preview) +
          theme.fg("dim", ` ${desc}`);
        return new Text(text, 0, 0);
      },

      renderResult(result, _options, theme) {
        const details = result.details as SearchDetails | undefined;

        if (!details) {
          const text = result.content[0];
          return new Text(text?.type === "text" ? text.text.slice(0, 60) : "", 0, 0);
        }

        const cost = details.cost ? ` • $${details.cost.total.toFixed(6)}` : "";
        return new Text(theme.fg("success", `✓ ${details.numResults} results${cost}`), 0, 0);
      },
    }),
  );

  // Register exa_fetch tool

  const ExaFetchParams = Type.Object({
    url: Type.String({
      description: "URL to fetch content from",
    }),
    contentType: Type.Optional(
      Type.Union([Type.Literal("text"), Type.Literal("highlights"), Type.Literal("summary")]),
    ),
    maxCharacters: Type.Optional(
      Type.Number({
        description: "Maximum characters to return",
      }),
    ),
  });

  pi.registerTool(
    defineTool({
      name: "exa_fetch",
      label: "Exa Fetch",
      description:
        "Fetch and extract content from a specific URL using Exa. Can return full text, highlights, or AI-generated summary.",
      parameters: ExaFetchParams,

      async execute(
        _toolCallId: string,
        params: Static<typeof ExaFetchParams>,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        _ctx: ExtensionContext,
      ) {
        const apiKey = getApiKey();
        if (!apiKey) {
          throw createMissingApiKeyError();
        }

        const exa = new Exa(apiKey);

        const contentsOptions: {
          text?: true;
          highlights?: true;
          summary?: true;
          maxCharacters?: number;
        } = {};

        const mappedContent = mapFetchContentType(
          params.contentType as FetchContentType | undefined,
        );
        if (mappedContent?.text) contentsOptions.text = true;
        if (mappedContent?.highlights) contentsOptions.highlights = true;
        if (mappedContent?.summary) contentsOptions.summary = true;
        if (params.maxCharacters) {
          contentsOptions.maxCharacters = Math.max(1000, Math.min(100000, params.maxCharacters));
        }

        let response;
        try {
          response = await exa.getContents(params.url, contentsOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Exa API error: ${message}`);
        }

        if (!response.results || response.results.length === 0) {
          return {
            content: [{ type: "text", text: "No content found at this URL." }],
            details: { url: params.url, cost: response.costDollars } as FetchDetails,
          };
        }

        const result = response.results[0] as ExaSearchResult;
        let output = formatFetchResult(result, (params.contentType ?? "text") as FetchContentType);

        const truncation = truncateHead(output, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let content = truncation.content;

        if (truncation.truncated) {
          const tempFile = await writeTempFile(output);
          content += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
          content += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
          content += ` Full output saved to: ${tempFile}]`;
        }

        return {
          content: [{ type: "text", text: content }],
          details: {
            url: params.url,
            title: result.title,
            cost: response.costDollars,
          } as FetchDetails,
        };
      },

      renderCall(args, theme) {
        const urlPreview = args.url.length > 40 ? args.url.slice(0, 40) + "..." : args.url;
        const desc = args.contentType ?? "text";
        const text =
          theme.fg("toolTitle", theme.bold("exa_fetch ")) +
          theme.fg("muted", urlPreview) +
          theme.fg("dim", ` ${desc}`);
        return new Text(text, 0, 0);
      },

      renderResult(result, _options, theme) {
        const details = result.details as FetchDetails | undefined;

        if (!details) {
          const text = result.content[0];
          return new Text(text?.type === "text" ? text.text.slice(0, 60) : "", 0, 0);
        }

        const cost = details.cost ? ` • $${details.cost.total.toFixed(6)}` : "";

        if (details.title) {
          return new Text(theme.fg("success", `✓ ${details.title}${cost}`), 0, 0);
        }

        return new Text(theme.fg("success", `✓ Fetched${cost}`), 0, 0);
      },
    }),
  );

  // Register exa_code_context tool

  const ExaCodeContextParams = Type.Object({
    query: Type.String({
      description: "Search query to find relevant code snippets and examples",
    }),
    tokensNum: Type.Optional(
      Type.Union([
        Type.String({
          description: 'Token limit: "dynamic" for automatic sizing',
        }),
        Type.Number({
          description: "Token limit: 50-100000 (5000 is a good default)",
        }),
      ]),
    ),
  });

  pi.registerTool(
    defineTool({
      name: "exa_code_context",
      label: "Exa Code Context",
      description:
        "Search for code snippets and examples from open source libraries and repositories. Use this to find working code examples that help understand how libraries, frameworks, or concepts are implemented.",
      parameters: ExaCodeContextParams,

      async execute(
        _toolCallId: string,
        params: Static<typeof ExaCodeContextParams>,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        _ctx: ExtensionContext,
      ) {
        const apiKey = getApiKey();
        if (!apiKey) {
          throw createMissingApiKeyError();
        }

        // Ensure tokensNum is the correct type: number or "dynamic"
        // The schema accepts both string and number, but the Exa API requires:
        // - A number (e.g., 5000)
        // - The literal string "dynamic"
        let tokensNum: string | number = params.tokensNum ?? "dynamic";
        if (typeof tokensNum === "string" && tokensNum !== "dynamic") {
          tokensNum = Number(tokensNum);
        }

        let response;
        try {
          const httpResponse = await fetch("https://api.exa.ai/context", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify({
              query: params.query,
              tokensNum,
            }),
          });

          if (!httpResponse.ok) {
            const errorText = await httpResponse.text();
            throw new Error(`HTTP ${httpResponse.status}: ${errorText}`);
          }

          response = (await httpResponse.json()) as CodeContextResponse;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Exa Context API error: ${message}`);
        }

        let output = formatCodeContextResult(response);

        const truncation = truncateHead(output, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let result = truncation.content;

        if (truncation.truncated) {
          const tempFile = await writeTempFile(output);
          result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
          result += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
          result += ` Full output saved to: ${tempFile}]`;
        }

        const cost = parseCostDollars(response.costDollars);

        return {
          content: [{ type: "text", text: result }],
          details: {
            query: params.query,
            resultsCount: response.resultsCount,
            outputTokens: response.outputTokens,
            cost,
          } as CodeContextDetails,
        };
      },

      renderCall(args, theme) {
        const preview = args.query.length > 50 ? args.query.slice(0, 50) + "..." : args.query;
        const desc = `${args.tokensNum ?? "dynamic"} tokens`;
        const text =
          theme.fg("toolTitle", theme.bold("exa_code_context ")) +
          theme.fg("muted", preview) +
          theme.fg("dim", ` ${desc}`);
        return new Text(text, 0, 0);
      },

      renderResult(result, _options, theme) {
        const details = result.details as CodeContextDetails | undefined;

        if (!details) {
          const text = result.content[0];
          return new Text(text?.type === "text" ? text.text.slice(0, 60) : "", 0, 0);
        }

        const cost = details.cost ? ` • $${details.cost.total.toFixed(6)}` : "";
        return new Text(
          theme.fg(
            "success",
            `✓ ${details.resultsCount} sources • ${details.outputTokens} tokens${cost}`,
          ),
          0,
          0,
        );
      },
    }),
  );

  // Register /exa-status command

  pi.registerCommand("exa-status", {
    description: "Check Exa API key configuration status",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const configured = !!getApiKey();
      ctx.ui.notify(
        configured
          ? "Exa API key: configured via EXA_API_KEY"
          : "Exa API key: not configured. Set EXA_API_KEY environment variable.",
        configured ? "info" : "warning",
      );
    },
  });
}
