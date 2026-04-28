/**
 * Exa Code Context tool definition
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "typebox";

import { getApiKey } from "../api-key.ts";
import { createMissingApiKeyError } from "../errors.ts";
import {
  formatCodeContextResult,
  formatToolOutputPreview,
  parseCostDollars,
} from "../formatters.ts";
import type { CodeContextDetails, CodeContextResponse } from "../types.ts";

// Tool parameter schema
export const ExaCodeContextParams = Type.Object({
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

type CodeContextParams = Static<typeof ExaCodeContextParams>;

/**
 * Create the exa_code_context tool definition.
 */
export function createExaCodeContextTool() {
  return defineTool({
    name: "exa_code_context",
    label: "Exa Code Context",
    description:
      "Search for code snippets and examples from open source libraries and repositories. Use this to find working code examples that help understand how libraries, frameworks, or concepts are implemented.",
    parameters: ExaCodeContextParams,

    async execute(
      _toolCallId: string,
      params: CodeContextParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
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

      let response: CodeContextResponse;
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
        const tempDir = await mkdtemp(join(tmpdir(), "pi-exa-"));
        const tempFile = join(tempDir, "output.txt");
        await writeFile(tempFile, output, "utf8");
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

    renderCall(args: CodeContextParams, theme: Theme) {
      const preview = args.query.length > 50 ? args.query.slice(0, 50) + "..." : args.query;
      const desc = `${args.tokensNum ?? "dynamic"} tokens`;
      const text =
        theme.fg("toolTitle", theme.bold("exa_code_context ")) +
        theme.fg("muted", preview) +
        theme.fg("dim", ` ${desc}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, options, theme, context) {
      const details = result.details as CodeContextDetails | undefined;
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);

      let header = "";
      if (details) {
        const cost = details.cost ? ` • $${details.cost.total.toFixed(6)}` : "";
        header = theme.fg(
          "success",
          `✓ ${details.resultsCount} sources • ${details.outputTokens} tokens${cost}`,
        );
      }

      const preview = formatToolOutputPreview(result, options, theme);
      text.setText(preview ? `${header}\n${preview}` : header);
      return text;
    },
  });
}
