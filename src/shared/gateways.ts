// Spec 42 §10 and spec 43 §4.5 — the descriptor, rendered without a round trip.
//
// > **The library describes the configuration. The host renders it.**
//
// These are `bridge.ts`'s twins of `describe.py`'s two pure functions, written
// over the catalogue the generator inlined into `agent-protocol.ts`. They live
// in `shared/` rather than in main because **both processes need them**: the
// `Manage gateways…` sheet previews a route as the reviewer types, with no IPC
// round trip, and main rebuilds that same route before it saves one.
//
// `test/protocol.spec.ts` feeds these and the Python originals the same
// fixtures and fails if they disagree, so the two cannot drift.
//
// Invariant: nothing here imports from `main/` or `renderer/`.

import type {
  AgentSdk,
  ConfigField,
  FieldError,
  GatewayRoute,
  KindDescriptor,
} from "./agent-protocol.ts";
import { CATALOGUE } from "./agent-protocol.ts";

function substitute(template: string | null, values: Record<string, string>): string | null {
  if (template === null) return null;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_whole, key: string) => values[key] ?? "");
}

/**
 * The host's answers, with each field's own default filled in where it said
 * nothing. Mirrors `answers` in `describe.py`.
 *
 * Trimmed here and only here, so a pasted URL with a trailing space builds the
 * same route as a typed one — and a URL loses its trailing slash, exactly as
 * `validate_base_url` would. `http://host/` and `http://host` are the same
 * address, and a route built from one that a validator approved as the other is
 * a difference spec 43 §5.2 case 2b reads as "the gateway moved" and answers by
 * throwing away a live session.
 */
function answers(
  descriptor: KindDescriptor,
  values: Record<string, string>,
): Record<string, string> {
  const filled: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) filled[key] = (value ?? "").trim();
  for (const field of descriptor.fields) {
    if (!filled[field.key] && field.default !== null && field.default !== undefined) {
      filled[field.key] = field.default;
    }
    if (field.kind === "url" && filled[field.key]) {
      filled[field.key] = filled[field.key].replace(/\/+$/, "");
    }
  }
  return filled;
}

/**
 * The routes a kind gives each SDK, for these answers. Mirrors `build_routes`.
 *
 * **A route whose URL template resolved to nothing is left out.** A kind that
 * means to give an SDK a URL and got no answer for it describes an SDK the
 * reviewer has not configured — `custom` with one of its four filled in is the
 * ordinary case. `baseUrl: null` is the opposite and IS a route: it means "this
 * SDK's own endpoint", which is the whole `original` kind.
 */
export function buildRoutes(
  kind: string,
  values: Record<string, string>,
): Partial<Record<AgentSdk, GatewayRoute>> {
  const descriptor = CATALOGUE.kinds.find((entry) => entry.id === kind);
  if (!descriptor) return {};
  const filled = answers(descriptor, values);

  const routes: Partial<Record<AgentSdk, GatewayRoute>> = {};
  for (const [sdk, note] of Object.entries(descriptor.routes)) {
    if (!note) continue;
    const baseUrl = substitute(note.baseUrl, filled) || null;
    if (note.baseUrl !== null && note.baseUrl !== undefined && baseUrl === null) continue;
    routes[sdk as AgentSdk] = {
      baseUrl,
      auth: note.auth,
      credentialEnv: substitute(note.credentialEnv, filled) || null,
      models: [],
    };
  }
  return routes;
}

/**
 * Spec 43 §4.5 — the answers that would rebuild these routes, or null.
 *
 * **A saved gateway stores its routes, not the host that produced them**, so a
 * reviewer reopening one had nothing to edit: the sheet could only show what the
 * routes are, and changing the address meant deleting the gateway and making it
 * again. This runs the templates backwards.
 *
 * The method is a guess and a proof, in that order:
 *
 *  1. Start every field at its own default.
 *  2. For each URL field, read a candidate off any route whose template mentions
 *     it — substitute the other fields, then strip the literal text that sits
 *     around the placeholder.
 *  3. **Feed the candidates back through `buildRoutes` and compare.** Only an
 *     exact match is returned.
 *
 * Step 3 is the whole honesty of it. A route edited by hand is not something a
 * host and a prefix can describe any more, so no answer is claimed for it, and
 * the caller keeps showing what was stored rather than quietly rebuilding it
 * into something else.
 */
export function recoverValues(
  kind: string,
  routes: Partial<Record<AgentSdk, GatewayRoute>>,
): Record<string, string> | null {
  const descriptor = CATALOGUE.kinds.find((entry) => entry.id === kind);
  if (!descriptor) return null;

  const guess: Record<string, string> = {};
  for (const field of descriptor.fields) {
    if (field.default !== null && field.default !== undefined) guess[field.key] = field.default;
  }

  // A placeholder no URL can contain, so the collapsed template can be split on
  // it without a regex and without escaping anything.
  const HOLE = "\u0000";

  // Twice, because one field can only be read once the others around it are
  // known: Envoy's `{url}{anthropicPrefix}` gives up the host from the OpenAI
  // route on the first pass and the prefix from the Anthropic one on the second.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const field of descriptor.fields) {
      for (const [sdk, note] of Object.entries(descriptor.routes)) {
        const template = note?.baseUrl;
        const saved = routes[sdk as AgentSdk]?.baseUrl;
        if (!template || !saved || !template.includes(`{${field.key}}`)) continue;
        // Every other field is known, so the template collapses to literal text
        // with one hole in it.
        const collapsed = substitute(template, { ...guess, [field.key]: HOLE }) ?? "";
        const [before, after] = collapsed.split(HOLE);
        if (before === undefined || after === undefined) continue;
        if (!saved.startsWith(before) || !saved.endsWith(after)) continue;
        const found = saved.slice(before.length, saved.length - after.length);
        if (found) {
          guess[field.key] = found;
          break;
        }
      }
    }
  }

  const rebuilt = buildRoutes(kind, guess);
  const same =
    Object.keys(rebuilt).length === Object.keys(routes).length &&
    Object.entries(rebuilt).every(([sdk, route]) => {
      const saved = routes[sdk as AgentSdk];
      return (
        saved !== undefined &&
        saved.baseUrl === route?.baseUrl &&
        saved.auth === route?.auth &&
        (saved.credentialEnv ?? null) === (route?.credentialEnv ?? null)
      );
    });
  return same ? guess : null;
}

/**
 * What the reviewer must fix. Mirrors `validate_gateway`; empty means it is good.
 *
 * Field by field first, then the whole gateway: a kind whose fields are all good
 * can still describe a gateway that offers nothing, and "Host is required" is
 * not the sentence for that.
 */
export function validateGateway(kind: string, values: Record<string, string>): FieldError[] {
  const descriptor = CATALOGUE.kinds.find((entry) => entry.id === kind);
  if (!descriptor) return [{ key: "kind", message: `There is no gateway kind called '${kind}'.` }];

  const filled = answers(descriptor, values);
  const errors: FieldError[] = [];
  for (const field of descriptor.fields) {
    const value = filled[field.key] ?? "";
    if (field.required && !value) {
      errors.push({ key: field.key, message: `${field.label} is required.` });
      continue;
    }
    if (!value) continue;
    const problem = fieldProblem(field, value);
    if (problem) errors.push({ key: field.key, message: problem });
  }
  if (errors.length > 0) return errors;

  // Spec 43 §2.2's two CHECK constraints, said in the reviewer's words before
  // the database says them in SQLite's. A row that cannot run must not be
  // creatable by any route, and a refusal that arrives as a constraint error
  // names a column rather than a field.
  const routes = buildRoutes(kind, values);
  if (Object.keys(routes).length === 0) {
    errors.push({
      key: "kind",
      message: `${descriptor.label} needs at least one URL before it can be saved.`,
    });
  }
  for (const [sdk, route] of Object.entries(routes)) {
    if (!route) continue;
    if (route.auth === "environment" && !route.credentialEnv) {
      errors.push({
        key: "tokenEnv",
        message: `The ${sdk} route needs a credential but names no variable.`,
      });
    }
    if (route.auth === "none" && !route.baseUrl) {
      errors.push({
        key: "url",
        message: `The ${sdk} route has no authentication, so it needs a URL.`,
      });
    }
  }
  return errors;
}

function fieldProblem(field: ConfigField, value: string): string | null {
  if (field.kind === "url") return baseUrlProblem(value);
  if (field.kind === "select" && field.options) {
    const allowed = field.options.map((option) => option.value);
    if (!allowed.includes(value)) {
      return `${field.label} must be one of ${JSON.stringify(allowed)}.`;
    }
  }
  return null;
}

/**
 * The mirror of `validate_base_url`, as a refusal rather than a throw.
 *
 * A username, a password, a query or a fragment is refused: each is a way for a
 * stored gateway to carry something that is not an address, and appending a
 * path is spec 43's job, done from the catalogue rather than guessed here.
 */
export function baseUrlProblem(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "A gateway URL cannot be empty.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return `A gateway URL must start with http:// or https:// — got '${url}'.`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `A gateway URL must start with http:// or https:// — got '${url}'.`;
  }
  if (!parsed.hostname) return `A gateway URL must name a host — got '${url}'.`;
  if (parsed.username || parsed.password) {
    return "A gateway URL must not carry a username or a password.";
  }
  if (parsed.search || parsed.hash) return "A gateway URL must not carry a query or a fragment.";
  return null;
}
