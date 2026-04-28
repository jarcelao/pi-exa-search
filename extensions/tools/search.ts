/**
 * Exa Search tool definition
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
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

import { getApiKey } from "../api-key.ts";
import { createMissingApiKeyError } from "../errors.ts";
import { mapSearchContentType } from "../content-types.ts";
import { formatSearchResults, formatToolOutputPreview } from "../formatters.ts";
import type { SearchContentType, SearchDetails, ExaSearchResult } from "../types.ts";

// Tool parameter schema
export const ExaSearchParams = Type.Object({
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

type SearchParams = Static<typeof ExaSearchParams>;

/**
 * Create the exa_search tool definition.
 */
export function createExaSearchTool() {
  return defineTool({
    name: "exa_search",
    label: "Exa Search",
    description:
      "Search the web using Exa's neural search API. Best for factual queries, research, and finding relevant web content. Use highlights mode by default for token efficiency.",
    parameters: ExaSearchParams,

    async execute(
      _toolCallId: string,
      params: SearchParams,
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
        const tempDir = await mkdtemp(join(tmpdir(), "pi-exa-"));
        const tempFile = join(tempDir, "output.txt");
        await writeFile(tempFile, output, "utf8");
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

    renderCall(args: SearchParams, theme: Theme) {
      const preview = args.query.length > 50 ? args.query.slice(0, 50) + "..." : args.query;
      const desc = `${args.numResults ?? 10} results • ${args.contentType ?? "highlights"}`;
      const text =
        theme.fg("toolTitle", theme.bold("exa_search ")) +
        theme.fg("muted", preview) +
        theme.fg("dim", ` ${desc}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, options, theme, context) {
      const details = result.details as SearchDetails | undefined;
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);

      let header = "";
      if (details) {
        const cost = details.cost ? ` • $${details.cost.total.toFixed(6)}` : "";
        header = theme.fg("success", `✓ ${details.numResults} results${cost}`);
      }

      const preview = formatToolOutputPreview(result, options, theme);
      text.setText(preview ? `${header}\n${preview}` : header);
      return text;
    },
  });
}
