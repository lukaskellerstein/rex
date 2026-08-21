// Spec 07 §5 — the client for the machine's local LiteLLM gateway.
//
// WORKER (§10.2). This is the **only** file that may issue a model call, which
// is what makes §5.6's concurrency one number in one place rather than a
// convention nobody can check.
//
// REX calls `http://localhost:24000` and never a model provider directly, so it
// holds no provider key — only one capped LiteLLM key, read from the
// environment. This is REX's first outbound network call (§0), and its boundary
// is this file.

import { request as httpRequest } from "node:http";
import type { ExtractedClaim } from "../../shared/types.ts";

export const GATEWAY_URL = "http://localhost:24000";

/** §5.1 — the three aliases, each chosen for a reason. */
export type Alias = "local" | "local-31b" | "embed" | "cheap" | "standard";

/** §4.4 — `embed` is `text-embedding-nomic-embed-text-v1.5`. */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * §5.6 — how many calls run at once, per alias.
 *
 * LMStudio serves few requests at a time (§5.3). Beyond its own limit extra
 * requests queue *inside* LMStudio rather than finishing sooner, and a queued
 * request still counts against the 3,600-second route timeout — so too much
 * concurrency turns a slow build into a failing one.
 *
 * **`local-31b` is 1, not §5.6's 2, and that is a measurement.** §12 milestone 1
 * asks for these tuned against this machine, so on 2026-08-21 they were:
 *
 *   - With 2 extraction calls in flight, no chunk of `components.md` finished in
 *     15 minutes. During that window a bare "Say OK" sent *straight to LMStudio*,
 *     bypassing the gateway entirely, also timed out — at 120 s, for two tokens.
 *   - With 1 in flight, the same chunks answered in about three minutes each.
 *
 * The reason is in the first observation, not the second: LMStudio queues
 * internally and decodes one request at a time on this hardware. A second
 * in-flight request therefore buys no throughput at all — it only adds a second
 * long-lived context for a 31B model to hold, and pushes every queued request
 * closer to the route timeout. §5.6's own sentence predicted exactly this; the
 * number beside it was simply one too high.
 *
 * `local` keeps 4 because it is a mixture-of-experts model with ~4B active
 * parameters (§5.1) and is a different machine-shaped problem — but it is
 * untested here, because §5.4's local-only default never selects it.
 */
const IN_FLIGHT: Record<string, number> = {
  local: 4,
  "local-31b": 1,
  embed: 8,
  // §5.6 — no local hardware limit; the gateway's own key ceiling is the bound.
  cheap: 16,
  standard: 16,
};

const DEFAULT_IN_FLIGHT = 4;

/** §5.6 — embedding is cheap; the batch matters more than the concurrency. */
export const EMBED_BATCH = 64;

/**
 * §5.3 — LiteLLM's per-route timeout is 3,600 s for the local aliases, raised
 * after prompts were measured being cancelled at 576 s and 590 s under the old
 * 600 s default. The client must not be the thing that gives up first, or a
 * build fails for a reason that is not in any log it wrote.
 */
const CALL_TIMEOUT_MS = 3_600_000;

/**
 * The key, from the environment and nowhere else.
 *
 * `AI_GATEWAY_KEY` is the capped key the gateway's own NOTES.md mints and tells
 * you to keep in your shell; `LITELLM_MASTER_KEY` is the admin credential and is
 * the fallback only because a machine that has not minted a capped key yet still
 * has that one. Never a literal, never a file in the repo: rules/12-security.md.
 */
export function gatewayKey(): string {
  const key = process.env.AI_GATEWAY_KEY ?? process.env.LITELLM_MASTER_KEY;
  if (!key) {
    throw new Error(
      "No gateway key. Export AI_GATEWAY_KEY (see ai-gateway/NOTES.md) before building the fact graph.",
    );
  }
  return key;
}

/** One in-flight cap per alias, applied where the call is made. */
class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((release) => this.waiting.push(release));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export class GatewayError extends Error {
  readonly alias: string;
  readonly status: number | null;

  constructor(message: string, alias: string, status: number | null) {
    super(message);
    this.name = "GatewayError";
    this.alias = alias;
    this.status = status;
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatChoice {
  finish_reason?: string;
  message?: { content?: string | null; reasoning_content?: string | null };
}

interface ChatResponse {
  model?: string;
  id?: string;
  choices?: ChatChoice[];
  usage?: { completion_tokens?: number; prompt_tokens?: number };
}

export interface CallStats {
  /** Wall-clock for the whole call, including any retry. §5.3 wants measurements. */
  durationMs: number;
  /** What actually answered — `local` falling through to OpenRouter shows here. */
  model: string | null;
  completionTokens: number | null;
  /** How many attempts it took. > 1 means a schema or transport retry fired. */
  attempts: number;
}

export interface ChatRequest<T> {
  alias: string;
  system: string;
  user: string;
  /** JSON Schema. §5.5 — every model call uses structured output. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  /** Validates and narrows the parsed reply, or throws with what was wrong. */
  parse: (value: unknown) => T;
}

export interface ChatResult<T> {
  value: T;
  stats: CallStats;
}

export interface Preflight {
  healthy: boolean;
  /** Every alias `/v1/models` lists. */
  models: string[];
  missing: string[];
}

/**
 * A reasoning model puts its thinking in `reasoning_content`, which LiteLLM
 * passes through — but not every build does, and some emit `<think>…</think>`
 * inline instead. Measured on 2026-08-21 against `local-31b`
 * (`google/gemma-4-31b`): it returned 893 completion tokens of reasoning for a
 * three-sentence passage, with clean JSON in `content`. Stripping the inline
 * form costs one regular expression and covers the build that does not split
 * them.
 */
function contentOf(choice: ChatChoice | undefined): string {
  const raw = choice?.message?.content ?? "";
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * The JSON object in a reply, tolerating a model that wrapped it in a fence.
 *
 * Structured output should make this unnecessary; §5.5 says a local model is
 * less reliable at it than a frontier one, and a fenced reply is a schema-valid
 * answer wearing a hat rather than a failure worth a second minute.
 */
function parseJson(content: string): unknown {
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : content);
}

export class Gateway {
  private readonly limiters = new Map<string, Limiter>();
  private readonly baseUrl: string;
  private readonly key: string;

  constructor(baseUrl: string = GATEWAY_URL, key?: string) {
    this.baseUrl = baseUrl;
    this.key = key ?? gatewayKey();
  }

  private limiter(alias: string): Limiter {
    let found = this.limiters.get(alias);
    if (!found) {
      found = new Limiter(IN_FLIGHT[alias] ?? DEFAULT_IN_FLIGHT);
      this.limiters.set(alias, found);
    }
    return found;
  }

  /**
   * `node:http` and not `fetch`, for one measured reason.
   *
   * Node's `fetch` is undici, and undici applies a **300-second
   * `headersTimeout`** that no `AbortSignal` widens and no option on `fetch`
   * exposes. A non-streaming completion sends no headers until generation has
   * finished, so any call that thinks for more than five minutes is destroyed by
   * the client with the message `fetch failed` — nothing about a timeout, and
   * nothing in the gateway's log, because the gateway was still working.
   *
   * Measured on 2026-08-21: chunk 1 of `components.md` on `local-31b` died that
   * way at about seven minutes, while LiteLLM's own route timeout for the local
   * aliases is 3,600 s (§5.3) and the gateway stayed healthy throughout. A local
   * model answering in "seconds to minutes" makes five minutes an ordinary call,
   * not an outlier, so this is the difference between a build that finishes and
   * one that fails a fifth of its chunks for no visible reason.
   *
   * `node:http` has no such default: the only timeout is the one set here.
   */
  private post(path: string, body: unknown, alias: string): Promise<unknown> {
    const payload = JSON.stringify(body);
    const url = new URL(`${this.baseUrl}${path}`);

    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            Authorization: `Bearer ${this.key}`,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const status = response.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(
                new GatewayError(
                  `${alias}: gateway answered ${status}. ${text.slice(0, 400)}`,
                  alias,
                  status,
                ),
              );
              return;
            }
            try {
              resolve(JSON.parse(text));
            } catch (error) {
              reject(
                new GatewayError(
                  `${alias}: reply was not JSON. ${error instanceof Error ? error.message : ""}`,
                  alias,
                  status,
                ),
              );
            }
          });
        },
      );

      request.setTimeout(CALL_TIMEOUT_MS, () => {
        request.destroy(
          new GatewayError(`${alias}: no answer in ${CALL_TIMEOUT_MS} ms`, alias, null),
        );
      });
      request.on("error", (error) => {
        reject(
          error instanceof GatewayError
            ? error
            : new GatewayError(`${alias}: ${error.message}`, alias, null),
        );
      });
      request.end(payload);
    });
  }

  /**
   * §5.1 — the preflight every build runs before it starts.
   *
   * A build that starts against a half-configured gateway wastes hours before it
   * fails, and on a local model "hours" is not a figure of speech.
   */
  async preflight(required: readonly string[]): Promise<Preflight> {
    let healthy = false;
    try {
      const response = await fetch(`${this.baseUrl}/health/readiness`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as { status?: string };
      healthy = response.ok && body.status === "healthy";
    } catch {
      healthy = false;
    }

    let models: string[] = [];
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      models = (body.data ?? []).map((entry) => entry.id ?? "").filter(Boolean);
    } catch {
      models = [];
    }

    return { healthy, models, missing: required.filter((alias) => !models.includes(alias)) };
  }

  /**
   * One structured-output call. §5.5 — parse and validate every reply; on
   * failure retry **once** with the validation error appended to the prompt,
   * then give up and let the caller count it.
   *
   * The retry deliberately happens inside `limiter.run`, because §5.6 says a
   * retry does not take a new slot — otherwise a stage that is being retried
   * heavily silently doubles its concurrency, which is how a slow build becomes
   * a failing one.
   */
  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    return await this.limiter(request.alias).run(async () => {
      const started = Date.now();
      let complaint: string | null = null;
      let lastError: Error | null = null;
      let model: string | null = null;
      let completionTokens: number | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        const messages: ChatMessage[] = [
          { role: "system", content: request.system },
          {
            role: "user",
            content: complaint
              ? `${request.user}\n\nYour previous reply was rejected: ${complaint}\nReturn only JSON matching the schema.`
              : request.user,
          },
        ];

        try {
          const body = (await this.post(
            "/v1/chat/completions",
            {
              model: request.alias,
              messages,
              max_tokens: request.maxTokens,
              // Extraction and judging are not creative tasks. The same passage
              // must give the same claims, or an incremental rebuild reports
              // findings that only moved because the sampler did.
              temperature: 0,
              response_format: {
                type: "json_schema",
                json_schema: { name: request.schemaName, strict: true, schema: request.schema },
              },
            },
            request.alias,
          )) as ChatResponse;

          model = body.model ?? null;
          completionTokens = body.usage?.completion_tokens ?? null;
          const choice = body.choices?.[0];

          if (choice?.finish_reason === "length") {
            throw new Error(
              `reply hit the ${request.maxTokens}-token cap and is truncated JSON (§4.2)`,
            );
          }

          const value = request.parse(parseJson(contentOf(choice)));
          return {
            value,
            stats: { durationMs: Date.now() - started, model, completionTokens, attempts: attempt },
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          // A transport failure is not something the model can fix by being
          // told about it, and re-sending the complaint would only confuse the
          // second attempt.
          complaint = lastError instanceof GatewayError ? null : lastError.message;
        }
      }

      throw new GatewayError(
        `${request.alias}: ${lastError?.message ?? "failed twice"}`,
        request.alias,
        lastError instanceof GatewayError ? lastError.status : null,
      );
    });
  }

  /**
   * §4.4 — embeddings, batched. `embed` is terminal (§5.1): it has no fallback,
   * so a stopped LMStudio fails here rather than sending the documents anywhere.
   */
  async embed(inputs: string[], alias = "embed"): Promise<number[][]> {
    if (inputs.length === 0) return [];
    const batches: string[][] = [];
    for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
      batches.push(inputs.slice(i, i + EMBED_BATCH));
    }

    const results = await Promise.all(
      batches.map((batch) =>
        this.limiter(alias).run(async () => {
          const body = (await this.post(
            "/v1/embeddings",
            { model: alias, input: batch },
            alias,
          )) as { data?: Array<{ embedding?: number[]; index?: number }> };

          const rows = body.data ?? [];
          if (rows.length !== batch.length) {
            throw new GatewayError(
              `${alias}: asked for ${batch.length} embeddings and got ${rows.length}`,
              alias,
              null,
            );
          }
          // The API is allowed to return them out of order, and does under
          // concurrency. Sorting by `index` costs nothing; trusting the order
          // silently pairs every claim with its neighbour's vector, which would
          // look like a bad similarity threshold rather than a bug.
          return rows
            .slice()
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
            .map((row) => {
              const vector = row.embedding ?? [];
              if (vector.length !== EMBEDDING_DIMENSIONS) {
                throw new GatewayError(
                  `${alias}: expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}`,
                  alias,
                  null,
                );
              }
              return vector;
            });
        }),
      ),
    );

    return results.flat();
  }
}

// ── The extraction schema (§3.2) ────────────────────────────

export const MODALITIES: ReadonlyArray<ExtractedClaim["modality"]> = [
  "decided",
  "proposed",
  "rejected",
  "observed",
];

/**
 * §5.5 — LiteLLM passes `response_format` through to LMStudio, which constrains
 * generation against this. Verified against `local-31b` on 2026-08-21: the reply
 * was schema-valid on the first attempt, with the model's reasoning kept out in
 * `reasoning_content`.
 */
export const CLAIMS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "value", "quote", "modality", "statedAt"],
        properties: {
          subject: { type: "string" },
          value: { type: "string" },
          quote: { type: "string" },
          modality: { type: "string", enum: MODALITIES },
          statedAt: { type: ["string", "null"] },
        },
      },
    },
  },
};

/**
 * Validates a parsed reply into `ExtractedClaim[]`, or throws saying what was
 * wrong — the message goes back to the model on the one retry §5.5 allows.
 *
 * Hand-written rather than a schema library: this is the only shape that needs
 * validating, and §12 of spec 01 asks for the simplest thing that works rather
 * than a dependency.
 */
export function parseClaims(value: unknown): ExtractedClaim[] {
  if (typeof value !== "object" || value === null) throw new Error("reply was not an object");
  const claims = (value as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) throw new Error("`claims` was missing or not an array");

  return claims.map((entry, index) => {
    const where = `claims[${index}]`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${where} was not an object`);
    const row = entry as Record<string, unknown>;

    for (const field of ["subject", "value", "quote"] as const) {
      if (typeof row[field] !== "string" || (row[field] as string).trim().length === 0) {
        throw new Error(`${where}.${field} must be a non-empty string`);
      }
    }
    if (!MODALITIES.includes(row.modality as ExtractedClaim["modality"])) {
      throw new Error(`${where}.modality must be one of ${MODALITIES.join(", ")}`);
    }
    if (row.statedAt !== null && typeof row.statedAt !== "string") {
      throw new Error(`${where}.statedAt must be an ISO 8601 date or null`);
    }

    return {
      subject: (row.subject as string).trim(),
      value: (row.value as string).trim(),
      // Never trimmed. The quote is checked verbatim against the chunk (§4.3),
      // and trimming here would make a quote that does not match look as if it
      // did — the exact hallucination this guard exists to catch.
      quote: row.quote as string,
      modality: row.modality as ExtractedClaim["modality"],
      statedAt: (row.statedAt as string | null) || null,
    };
  });
}
