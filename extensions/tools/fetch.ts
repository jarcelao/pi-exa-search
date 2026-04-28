/**
 * Exa Fetch tool definition
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
import { mapFetchContentType } from "../content-types.ts";
import { formatFetchResult, formatToolOutputPreview } from "../formatters.ts";
import type { FetchContentType, FetchDetails, ExaSearchResult } from "../types.ts";

// Tool parameter schema
export const ExaFetchParams = Type.Object({
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

type FetchParams = Static<typeof ExaFetchParams>;

/**
 * Create the exa_fetch tool definition.
 */
export function createExaFetchTool() {
  return defineTool({
    name: "exa_fetch",
    label: "Exa Fetch",
    description:
      "Fetch and extract content from a specific URL using Exa. Can return full text, highlights, or AI-generated summary.",
    parameters: ExaFetchParams,

    async execute(
      _toolCallId: string,
      params: FetchParams,
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
        const tempDir = await mkdtemp(join(tmpdir(), "pi-exa-"));
        const tempFile = join(tempDir, "output.txt");
        await writeFile(tempFile, output, "utf8");
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

    renderCall(args: FetchParams, theme: Theme) {
      const urlPreview = args.url.length > 40 ? args.url.slice(0, 40) + "..." : args.url;
      const desc = args.contentType ?? "text";
      const text =
        theme.fg("toolTitle", theme.bold("exa_fetch ")) +
        theme.fg("muted", urlPreview) +
        theme.fg("dim", ` ${desc}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, options, theme, context) {
      const details = result.details as FetchDetails | undefined;
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);

      let header = "";
      if (details) {
        const cost = details.cost ? ` • $${details.cost.total.toFixed(6)}` : "";
        header = details.title
          ? theme.fg("success", `✓ ${details.title}${cost}`)
          : theme.fg("success", `✓ Fetched${cost}`);
      }

      const preview = formatToolOutputPreview(result, options, theme);
      text.setText(preview ? `${header}\n${preview}` : header);
      return text;
    },
  });
}
