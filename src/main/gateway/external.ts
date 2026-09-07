// Spec 46 §6 — an existing LiteLLM is a URL and a key, and REX asks it what it serves.
//
// > **REX configures no models for it**, and that is the whole point: its models
// > are already configured, inside it.
//
// `GET /v1/models` on a LiteLLM carries `max_input_tokens` and
// `max_output_tokens` per model — measured 2026-09-06 — so one call fills the
// picker and the limits together. That is why this is a plain fetch in main
// rather than a provider descriptor: the Models tab does not apply to a gateway
// somebody else configured.
//
// .. warning::
//    **An external LiteLLM needs its master key before it will say anything.**
//    The reviewer's own on 24000 answers `401` at `/v1/models` and at
//    `/model/info`. So an empty list must say *"add the key"*, never *"no
//    models"* — a person told "no models" goes and edits a config file that was
//    already correct.

/** One model an external gateway said it serves. */
export interface RemoteModel {
  id: string;
  maxInput: number | null;
  maxOutput: number | null;
}

export interface RemoteModels {
  models: RemoteModel[];
  /** Null when it answered. A sentence a person can act on when it did not. */
  error: string | null;
  /** True when the refusal was about the key, so the screen can say which. */
  needsKey: boolean;
}

/** Long enough for a gateway that is starting, short enough to fail while looking. */
const TIMEOUT_MS = 15_000;

/**
 * What this gateway serves, now.
 *
 * `baseUrl` is the Claude route's, which is the ROOT (§4.5) — so `/v1/models`
 * is appended here rather than assumed to be in it. A gateway with no Claude
 * route has nothing this can ask.
 */
export async function remoteModels(
  baseUrl: string | null,
  key: string | null,
): Promise<RemoteModels> {
  if (!baseUrl) {
    return { models: [], error: "This gateway has no address.", needsKey: false };
  }
  if (!key) {
    return {
      models: [],
      error:
        "Add this gateway's master key. It answers 401 to everything without one, including its own model list.",
      needsKey: true,
    };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return {
        models: [],
        error: "That key was refused. Check it against the gateway's own configuration.",
        needsKey: true,
      };
    }
    if (!response.ok) {
      return {
        models: [],
        error: `${baseUrl} answered ${response.status}.`,
        needsKey: false,
      };
    }
    const body = (await response.json()) as { data?: unknown };
    const rows = Array.isArray(body.data) ? body.data : [];
    return {
      models: rows.flatMap((row) => {
        if (typeof row !== "object" || row === null) return [];
        const model = row as Record<string, unknown>;
        const id = typeof model.id === "string" ? model.id : null;
        if (!id) return [];
        return [
          {
            id,
            // Present on a LiteLLM and absent elsewhere. Null stays null: §17 —
            // REX writes no limit it was not told.
            maxInput: typeof model.max_input_tokens === "number" ? model.max_input_tokens : null,
            maxOutput: typeof model.max_output_tokens === "number" ? model.max_output_tokens : null,
          },
        ];
      }),
      error: null,
      needsKey: false,
    };
  } catch (error) {
    return {
      models: [],
      error: `Could not reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      needsKey: false,
    };
  }
}
