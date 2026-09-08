// Spec 46 §7 — every credential REX is given is stored encrypted.
//
// > **No plaintext, anywhere, ever.**
//
// That is the reviewer's instruction of 2026-09-06 and it **reverses spec 43
// §6.1**, which stored the NAME of an environment variable and deliberately
// added no keychain. The reversal is forced by distribution: a person
// installing REX has no `~/.secrets/secrets.enc.yaml` and no `direnv`, and
// telling them to create a shell variable is not a product.
//
// | Secret | Where it lives |
// |:--|:--|
// | a provider key (OpenAI, OpenRouter, Anthropic, …) | encrypted, in `~/.rex/rex.db`, decrypted in main only |
// | an external LiteLLM's master key | the same |
// | the built-in gateway's master key | **nowhere.** Random per launch, environment only |
// | `claude login`, the Codex subscription | the SDK's own store. Not REX's business |
//
// **The key that decrypts it belongs to the OS keystore, not to REX**, so
// copying `rex.db` to another machine carries no secrets — which is correct.
//
// `electron` is imported here and only here in `gateway/`, which is why this is
// its own file: `local.ts` and `lifecycle.ts` stay drivable by `node --test`.

import { app, safeStorage } from "electron";
import { record as logLine } from "../log.ts";

/**
 * §7.3 — what this machine will do with a key, asked before one is stored.
 *
 * On macOS the answer is the Keychain, and `isEncryptionAvailable()` is still
 * asked rather than assumed: a machine that says no gets a sentence and no
 * stored key. Displaying a padlock REX has not earned would be worse than
 * either.
 *
 * This check once carried a second case. On Linux `safeStorage` falls back to a
 * `basic_text` backend that Electron's own docs call *"unprotected … encrypted
 * via hardcoded plaintext password"*, and REX warned about it. Spec 50 removed
 * Linux, and the warning with it.
 */
export interface StorageHealth {
  available: boolean;
  /** What to tell the person, or null when there is nothing to say. */
  warning: string | null;
}

/**
 * Is encryption real on this machine, and does the person need to be told?
 *
 * `isEncryptionAvailable()` is only meaningful **after the app's `ready` event**,
 * so this is never called at module load — every caller reaches it through an
 * IPC handler, which is by definition after ready.
 *
 * On macOS the answer is the Keychain and it is available; the check stays
 * because a machine can still refuse it, and a key REX cannot encrypt is a key
 * REX will not store.
 */
export function storageHealth(): StorageHealth {
  if (!app.isReady()) {
    // Asked too early. Saying "unavailable" here would be a lie that turns into
    // a refusal to store a key the machine can perfectly well protect.
    return {
      available: false,
      warning: "REX has not finished starting, so it cannot check how keys will be protected yet.",
    };
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return {
      available: false,
      warning:
        "This machine offers no way to encrypt a key, so REX will not store one. " +
        "The macOS Keychain is what provides it.",
    };
  }
  return { available: true, warning: null };
}

/**
 * Encrypt one credential for storage. **Refuses rather than storing plaintext.**
 *
 * The refusal is the point. A machine with no encryption available gets an
 * error a person can read, not a database row that looks encrypted and is not.
 */
export function seal(value: string): Buffer {
  const health = storageHealth();
  if (!health.available) {
    throw new Error(
      health.warning ?? "This machine cannot encrypt a key, so REX will not store one.",
    );
  }
  return safeStorage.encryptString(value);
}

/**
 * Decrypt one credential, in main, at the moment it is needed.
 *
 * Returns null rather than throwing on a ciphertext this machine cannot read —
 * which happens for real, when `rex.db` is copied between machines or the OS
 * keystore is reset. The caller then behaves as if no key were set, which is
 * the honest outcome: REX genuinely cannot read it, and the fix is to enter it
 * again rather than to see a crash.
 */
export function unseal(cipher: Buffer | Uint8Array | null): string | null {
  if (!cipher || cipher.length === 0) return null;
  try {
    return safeStorage.decryptString(Buffer.from(cipher));
  } catch (error) {
    logLine(
      "warn",
      "gateway-secrets",
      `a stored credential could not be decrypted on this machine: ${String(error)}`,
    );
    return null;
  }
}
