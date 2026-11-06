import OpenAI from "openai";
import type { z } from "zod";
import type { RiskVerdict } from "@/core";
import {
  EXTRACT_SYSTEM,
  extractUser,
  JUDGE_SYSTEM,
  judgeUser,
} from "./prompts";
import {
  type Evidence,
  type Extraction,
  extractionSchema,
  modelVerdictSchema,
  type PaymentInput,
  type Traced,
  type ZeroG,
  ZeroGError,
} from "./types";
import { applyEvidenceFloor } from "./verdict";

export interface ZeroGClientConfig {
  baseUrl: string;
  apiKey: string | undefined;
  modelText: string | undefined;
  modelVision: string | undefined;
  trustMode: "private" | "verified";
  /** Vision models on 0G are not private. Off unless the operator opts in. */
  allowNonPrivateVision?: boolean;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/** First JSON object in a model reply (models sometimes wrap it in prose or fences). */
export function parseJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start)
    throw new ZeroGError("INVALID_OUTPUT", "no JSON object in model reply");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ZeroGError("INVALID_OUTPUT", "model reply is not valid JSON");
  }
}

function validate<T extends z.ZodType>(schema: T, raw: string): z.output<T> {
  const parsed = schema.safeParse(parseJsonObject(raw));
  if (!parsed.success)
    throw new ZeroGError(
      "INVALID_OUTPUT",
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    );
  return parsed.data;
}

function mapHttpError(e: unknown): ZeroGError {
  if (e instanceof ZeroGError) return e;
  if (e instanceof OpenAI.APIError) {
    const body = JSON.stringify(e.error ?? "");
    if (e.status === 402 || /insufficient_balance/i.test(body))
      return new ZeroGError(
        "INSUFFICIENT_BALANCE",
        "0G account balance is empty: fund it in the Private Computer dashboard",
      );
    return new ZeroGError(
      "HTTP",
      `0G request failed (${e.status ?? "network"})`,
    );
  }
  return new ZeroGError("HTTP", e instanceof Error ? e.message : String(e));
}

export function createZeroG(config: ZeroGClientConfig): ZeroG {
  const { apiKey, modelText } = config;
  if (!apiKey || !modelText)
    throw new ZeroGError(
      "NOT_CONFIGURED",
      "ZG_API_KEY and ZG_MODEL_TEXT are required",
    );

  const sdk = new OpenAI({
    apiKey,
    baseURL: config.baseUrl,
    maxRetries: 1,
    timeout: 60_000,
    defaultHeaders: { "X-0G-Provider-Trust-Mode": config.trustMode },
    ...(config.fetch && { fetch: config.fetch }),
  });

  async function chat(
    model: string,
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): Promise<{ text: string; requestId: string }> {
    try {
      const res = await sdk.chat.completions.create({
        model,
        messages,
        temperature: 0,
        max_tokens: 800,
      });
      const text = res.choices[0]?.message?.content;
      if (!text)
        throw new ZeroGError("EMPTY_RESPONSE", "model returned no content");
      return { text, requestId: res.id };
    } catch (e) {
      throw mapHttpError(e);
    }
  }

  return {
    async extract(input: PaymentInput): Promise<Traced<Extraction>> {
      if (input.kind === "image") {
        const vision = config.modelVision;
        if (config.trustMode === "private" && !config.allowNonPrivateVision)
          throw new ZeroGError(
            "VISION_NOT_PRIVATE",
            "no private vision model on 0G: OCR the image locally and send text instead",
          );
        if (!vision)
          throw new ZeroGError(
            "NOT_CONFIGURED",
            "ZG_MODEL_VISION is required for images",
          );
        const { text, requestId } = await chat(vision, [
          { role: "system", content: EXTRACT_SYSTEM },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${input.mimeType};base64,${input.base64}`,
                },
              },
            ],
          },
        ]);
        return {
          value: validate(extractionSchema, text),
          requestId,
          model: vision,
        };
      }
      const { text, requestId } = await chat(modelText as string, [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: extractUser(input.text) },
      ]);
      return {
        value: validate(extractionSchema, text),
        requestId,
        model: modelText as string,
      };
    },

    async judge(
      extraction: Extraction,
      evidence: readonly Evidence[],
    ): Promise<Traced<RiskVerdict>> {
      const { text, requestId } = await chat(modelText as string, [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: judgeUser(extraction, evidence) },
      ]);
      const model = validate(modelVerdictSchema, text);
      return {
        value: applyEvidenceFloor(model, evidence),
        requestId,
        model: modelText as string,
      };
    },
  };
}
