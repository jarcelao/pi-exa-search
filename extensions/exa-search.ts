/**
 * exa-search Extension
 *
 * Registers two tools for web search and content fetching using the Exa API:
 * - exa_search: Natural language web search
 * - exa_fetch: Fetch and extract content from URLs
 *
 * Also registers the /exa-status command to check API key configuration.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  writeTempFile,
} from "@mariozechner/pi-coding-agent";
import Exa from "exa-js";

// API Key Management

function getApiKey(): string | undefined {
  const key = process.env.EXA_API_KEY;
  return key && key.length > 0 ? key : undefined;
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

// Error Creation

function createMissingApiKeyError(): Error {
  return new Error(
    "Exa API key not configured. Set EXA_API_KEY environment variable before starting pi.",
  );
}

// Exports

export { getApiKey, mapSearchContentType, mapFetchContentType, formatSearchResults, formatFetchResult, createMissingApiKeyError };

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
      StringEnum(["text", "highlights", "summary", "none"] as const),
    ),
    numResults: Type.Optional(
      Type.Number({
        description: "Number of results (1-100)",
      }),
    ),
  });

  pi.registerTool({
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
        const tempFile = writeTempFile(output);
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

    renderResult(result, { expanded: _expanded, isPartial: _isPartial }, theme, _context) {
      const details = result.details as SearchDetails | undefined;

      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text.slice(0, 60) : "", 0, 0);
      }

      const cost = details.cost ? ` • $${details.cost.total.toFixed(6)}` : "";
      return new Text(theme.fg("success", `✓ ${details.numResults} results${cost}`), 0, 0);
    },
  });

  // Register exa_fetch tool

  const ExaFetchParams = Type.Object({
    url: Type.String({
      description: "URL to fetch content from",
    }),
    contentType: Type.Optional(
      StringEnum(["text", "highlights", "summary"] as const),
    ),
    maxCharacters: Type.Optional(
      Type.Number({
        description: "Maximum characters to return",
      }),
    ),
  });

  pi.registerTool({
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

      const mappedContent = mapFetchContentType(params.contentType as FetchContentType | undefined);
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
          details: { url: params.url } as FetchDetails,
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
        const tempFile = writeTempFile(output);
        content += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
        content += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
        content += ` Full output saved to: ${tempFile}]`;
      }

      return {
        content: [{ type: "text", text: content }],
        details: {
          url: params.url,
          title: result.title,
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

    renderResult(result, { expanded: _expanded, isPartial: _isPartial }, theme, _context) {
      const details = result.details as FetchDetails | undefined;

      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text.slice(0, 60) : "", 0, 0);
      }

      if (details.title) {
        return new Text(theme.fg("success", "✓ ") + theme.fg("accent", details.title), 0, 0);
      }

      return new Text(theme.fg("muted", "Done"), 0, 0);
    },
  });

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
