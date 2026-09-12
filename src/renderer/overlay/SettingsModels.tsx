// Spec 46 §8 tab 2 — the providers behind the built-in gateway, and their models.
//
// **This file names no provider.** The "Add a provider" menu is the descriptor
// table, the fields under each one are that descriptor's `fields`, and whether
// models may be ticked freely is its `local` flag. That is criterion A8: a
// seventh provider is a row in `providers.py` plus at most one probe function,
// and nothing here changes.
//
// Four rules the screen keeps (§8):
//
//   1. **A ticked model is a model REX will offer.** Nothing else reaches the
//      composer.
//   2. **Every string a provider supplied is drawn as data, never as markup.**
//      Spec 42 §10's warning applies here with more force, because these come
//      from a remote server rather than from a table REX wrote. React escapes
//      by default and nothing here uses `dangerouslySetInnerHTML`.
//   3. **A change restarts the gateway**, and the screen says when it is waiting.
//   4. **The screen never shows a key**, not even masked-with-a-reveal. It shows
//      `set` or `not set`, and offers replace and remove.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GatewayDiscovery,
  GatewayProviderDraft,
  GatewayProviderView,
  GatewayStorageHealth,
  ProviderDescriptor,
} from "../../shared/channels.ts";
import { Cross, Plus } from "./Icons.tsx";
import {
  askedAgo,
  type ModelRow,
  mayTickAll,
  missingFields,
  modelRows,
  moneyNotice,
  tickedModels,
  toggled,
  windowLabel,
} from "./providers.ts";

interface Props {
  catalogue: readonly ProviderDescriptor[];
  providers: readonly GatewayProviderView[];
  health: GatewayStorageHealth | null;
  onSave: (draft: GatewayProviderDraft) => Promise<void>;
  onRemove: (providerId: string) => Promise<void>;
  onDiscover: (providerId: string) => Promise<GatewayDiscovery>;
  onModels: (
    providerId: string,
    models: Array<{ model: string; context: number | null; tools: boolean | null }>,
  ) => Promise<void>;
  onSecret: (providerId: string, value: string) => Promise<void>;
  onSecretClear: (providerId: string) => Promise<void>;
  busy: boolean;
}

export function SettingsModels(props: Props): React.JSX.Element {
  const [adding, setAdding] = useState<ProviderDescriptor | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <div className="rex-page-actions">
        <button
          type="button"
          className="rex-button rex-primary"
          disabled={props.busy}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Plus size={12} />
          Add a provider
        </button>
      </div>

      {/*
        The picker, as a PANEL IN THE FLOW.
        
        It was an absolutely-positioned menu, and inside a scrolling dialog it
        clipped — the reviewer hit it on 2026-09-06. A panel cannot be clipped
        by anything, and it has room for the sentence that says what each
        provider is, which a menu row never did.
      */}
      {menuOpen ? (
        <section className="rex-set-card rex-set-picking">
          <div className="rex-set-head">
            <div className="rex-set-name">
              <strong>Add a provider</strong>
            </div>
            <button
              type="button"
              className="rex-icon-button"
              aria-label="Close the provider list"
              onClick={() => setMenuOpen(false)}
            >
              <Cross size={12} />
            </button>
          </div>
          <div className="rex-set-picker">
            {props.catalogue.map((descriptor) => (
              <button
                key={descriptor.id}
                type="button"
                className="rex-set-picker-row"
                onClick={() => {
                  setAdding(descriptor);
                  // Pre-fill from the descriptor's own defaults and
                  // placeholders, so a local engine on its usual port is one
                  // click rather than a URL somebody has to look up.
                  const start: Record<string, string> = {};
                  for (const field of descriptor.fields) {
                    start[field.key] = field.default ?? field.placeholder ?? "";
                  }
                  setValues(start);
                  setMenuOpen(false);
                }}
              >
                <span className="rex-set-picker-name">
                  {descriptor.label}
                  {/*
                    §5.4 — money is never discovered. A person should know a
                    provider bills them BEFORE they click, not after.
                  */}
                  {descriptor.local ? null : (
                    <span className="rex-set-tag rex-set-tag-cost">costs money</span>
                  )}
                </span>
                <span className="rex-set-picker-note">{descriptor.note}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {adding ? (
        <AddProvider
          descriptor={adding}
          values={values}
          health={props.health}
          onChange={(key, value) => setValues((was) => ({ ...was, [key]: value }))}
          onCancel={() => setAdding(null)}
          onAdd={async () => {
            await props.onSave({
              provider: adding.id,
              label: adding.label,
              baseUrl: adding.defaultUrl ? null : (values.url?.trim() ?? null),
            });
            setAdding(null);
            setValues({});
          }}
        />
      ) : null}

      {props.providers.length === 0 && !adding && !menuOpen ? (
        <section className="rex-set-card">
          <div className="rex-set-body">
            <p className="rex-set-dim">
              No providers yet. Add one and the built-in gateway will have something to serve.
            </p>
          </div>
        </section>
      ) : null}

      {props.providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          descriptor={props.catalogue.find((row) => row.id === provider.provider) ?? null}
          busy={props.busy}
          onRemove={() => props.onRemove(provider.id)}
          onDiscover={() => props.onDiscover(provider.id)}
          onModels={(models) => props.onModels(provider.id, models)}
          onSecret={(value) => props.onSecret(provider.id, value)}
          onSecretClear={() => props.onSecretClear(provider.id)}
        />
      ))}
    </>
  );
}

/**
 * The form for one new provider, drawn entirely from its descriptor.
 *
 * §7.3's warning is shown **here, before a key is typed**, and not after it is
 * stored. "Your key will not really be protected" is only useful while there is
 * still a decision to make.
 */
function AddProvider(props: {
  descriptor: ProviderDescriptor;
  values: Record<string, string>;
  health: GatewayStorageHealth | null;
  onChange: (key: string, value: string) => void;
  onCancel: () => void;
  onAdd: () => Promise<void>;
}): React.JSX.Element {
  const missing = missingFields(props.descriptor, props.values);
  const wantsKey = props.descriptor.fields.some((field) => field.kind === "password");
  const warning = wantsKey ? props.health?.warning : null;

  return (
    <div className="rex-set-card rex-set-picking">
      <div className="rex-set-head">
        <div className="rex-set-name">
          <strong>{props.descriptor.label}</strong>
          <span className="rex-set-dim">{props.descriptor.note}</span>
        </div>
      </div>

      {warning ? <p className="rex-set-warn">{warning}</p> : null}

      {props.descriptor.fields.map((field) => (
        <label key={field.key} className="rex-set-field">
          <span className="rex-set-field-label">
            {field.label}
            {field.required ? <span className="rex-set-field-need"> required</span> : null}
          </span>
          <input
            type={field.kind === "password" ? "password" : "text"}
            className="rex-input"
            placeholder={field.placeholder ?? ""}
            value={props.values[field.key] ?? ""}
            onChange={(event) => props.onChange(field.key, event.target.value)}
          />
          {field.help ? <span className="rex-set-dim">{field.help}</span> : null}
        </label>
      ))}

      <div className="rex-set-acts">
        <button type="button" className="rex-button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="rex-button rex-button-go"
          disabled={missing.length > 0 || props.health?.available === false}
          title={
            missing.length > 0
              ? `Still needed: ${missing.map((field) => field.label).join(", ")}`
              : undefined
          }
          onClick={() => void props.onAdd()}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * How long "Saved" stays up.
 *
 * `CopyText`'s number, for `CopyText`'s job: long enough to be seen, short
 * enough that it is gone before the next thing is touched.
 */
const SAVED_FLASH_MS = 1400;

/** One provider, its key state, and the models it offers. */
function ProviderCard(props: {
  provider: GatewayProviderView;
  descriptor: ProviderDescriptor | null;
  busy: boolean;
  onRemove: () => Promise<void>;
  onDiscover: () => Promise<GatewayDiscovery>;
  onModels: (
    models: Array<{ model: string; context: number | null; tools: boolean | null }>,
  ) => Promise<void>;
  onSecret: (value: string) => Promise<void>;
  onSecretClear: () => Promise<void>;
}): React.JSX.Element {
  const [discovery, setDiscovery] = useState<GatewayDiscovery | null>(null);
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  /**
   * What the save is doing, and what it did.
   *
   * Reported 2026-09-09: *"clicking on save models does nothing"*. It did
   * everything — the models reached `gateway_model`, all four routes and
   * `config.yaml`, and LiteLLM restarted with them three times, which the log
   * shows. **The screen said nothing**, so a click that rewrote the config and
   * restarted a server was indistinguishable from a click that missed.
   *
   * `props.busy` was the only feedback and it merely greys the button. A save
   * takes about 1.6 seconds — long enough to doubt, short enough that a
   * greyed-out button is the only thing you could have noticed.
   */
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);

  /**
   * The live props, without them being the reason to ask again.
   *
   * This is not ceremony. The parent hands `onDiscover` as a fresh arrow every
   * render, so an effect that depended on it would fire on every render — and
   * each firing sets state, which renders, which fires it again. Against a
   * local engine that is a busy loop; against a paid provider it is a busy loop
   * that spends money. Keeping the callbacks in a ref makes the ONE thing that
   * should cause a fresh ask — a different provider — the only thing that does.
   */
  const live = useRef({ onDiscover: props.onDiscover, provider: props.provider });
  live.current = { onDiscover: props.onDiscover, provider: props.provider };

  const ask = useCallback(async () => {
    setAsking(true);
    try {
      const found = await live.current.onDiscover();
      setDiscovery(found);
      setRows(modelRows(live.current.provider, found));
    } finally {
      setAsking(false);
    }
  }, []);

  /**
   * Save the ticks, and say so.
   *
   * The `finally` is what makes "Saving…" honest: a save that throws — a
   * provider removed underneath it, a gateway that will not restart — must
   * still put the button back. The error itself is the parent's to show;
   * `settingsWork` already catches it into the notice bar.
   */
  const save = useCallback(async (): Promise<void> => {
    const picked = tickedModels(rows);
    setSaving(true);
    setSaved(null);
    try {
      await props.onModels(picked);
      setSaved(picked.length);
    } finally {
      setSaving(false);
    }
  }, [rows, props.onModels]);

  // The confirmation is a flash, not a state. It answers "did that click do
  // anything" and then gets out of the way, which is the same job — and the
  // same 1400ms — as the copy tick everywhere else in REX.
  useEffect(() => {
    if (saved === null) return;
    const timer = window.setTimeout(() => setSaved(null), SAVED_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);

  // A tick changed after a save, so the "Saved" flash is about a list that no
  // longer matches the screen. It goes at once rather than waiting out its
  // timer and confirming the wrong thing.
  useEffect(() => setSaved(null), [rows]);

  // Asked once when the card appears, so a person opening Models sees a list
  // rather than a button they have to find. A paid provider is only LISTED by
  // this — §5.4's rule is about adding, and nothing is added without a click.
  const providerId = props.provider.id;
  useEffect(() => {
    void ask();
  }, [ask, providerId]);

  const wantsKey = props.descriptor?.fields.some((field) => field.kind === "password") ?? false;
  const money = moneyNotice(props.descriptor);
  const canTick = mayTickAll(props.descriptor);

  return (
    <div className="rex-set-card">
      <div className="rex-set-head">
        <div className="rex-set-name">
          <strong>{props.provider.label}</strong>
          <span className="rex-set-mono">
            {props.provider.baseUrl ?? props.descriptor?.defaultUrl ?? ""}
          </span>
        </div>
        {wantsKey ? (
          <span
            className={
              props.provider.hasKey ? "rex-set-tag rex-set-tag-ok" : "rex-set-tag rex-set-tag-off"
            }
          >
            {/* §8 rule 4 — `set` or `not set`, and never the value. */}
            {props.provider.hasKey ? "key set ✓" : "no key"}
          </span>
        ) : null}
        <span className="rex-spacer" />
        <button type="button" className="rex-button" onClick={() => void props.onRemove()}>
          Remove
        </button>
      </div>

      {wantsKey ? (
        <div className="rex-set-acts rex-set-key">
          {showKey ? (
            <>
              <input
                type="password"
                className="rex-input"
                placeholder="Paste the key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <button
                type="button"
                className="rex-button"
                disabled={!key.trim()}
                onClick={() =>
                  void (async () => {
                    await props.onSecret(key);
                    setKey("");
                    setShowKey(false);
                  })()
                }
              >
                Save
              </button>
              <button type="button" className="rex-button" onClick={() => setShowKey(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="rex-button" onClick={() => setShowKey(true)}>
                {props.provider.hasKey ? "Replace the key" : "Add a key"}
              </button>
              {props.provider.hasKey ? (
                <button
                  type="button"
                  className="rex-button"
                  onClick={() => void props.onSecretClear()}
                >
                  Remove the key
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {discovery?.error ? (
        <p className="rex-set-warn">
          {/* The provider's own words, drawn as text. §14 rule 6. */}
          {discovery.error}
        </p>
      ) : null}

      {money ? <p className="rex-set-warn rex-set-warn-cost">{money}</p> : null}

      <ul className="rex-set-models">
        {rows.map((row) => (
          <li key={row.id} className={row.blocked ? "rex-set-model-off" : undefined}>
            <label>
              <input
                type="checkbox"
                checked={row.ticked}
                disabled={row.blocked !== null || props.busy}
                onChange={() => setRows((was) => toggled(was, row.id))}
              />
              {/*
                The id on its own line and the reason under it. Inline, the
                reason pushed the row to two ragged lines and knocked the
                window and tools columns out of line with every other row —
                and a list you cannot scan down is not a list.
              */}
              <span className="rex-set-model-label">
                <span className="rex-set-mono">{row.id}</span>
                {row.blocked ? (
                  <span className="rex-set-model-why">{row.blocked}</span>
                ) : row.gone ? (
                  <span className="rex-set-tag rex-set-tag-gone">not offered when last asked</span>
                ) : null}
              </span>
            </label>
            <span className="rex-set-model-window">{windowLabel(row.context)}</span>
            <span className="rex-set-model-tools">
              {/* Null says nothing, because the provider said nothing (§5.5). */}
              {row.tools === true ? "tools" : row.tools === false ? "no tools" : ""}
            </span>
          </li>
        ))}
      </ul>

      <div className="rex-set-foot">
        <span className="rex-set-dim">
          {/*
            One line, three states, and the save's is the one that was missing.
            It says what the gateway now SERVES rather than "Saved", because the
            number is the thing a person came here to change and a bare word
            would not tell them the ticks they meant were the ticks that went.
          */}
          {saving
            ? "Saving — the gateway restarts to pick the models up…"
            : saved !== null
              ? `Saved. The gateway now serves ${saved} model${saved === 1 ? "" : "s"}.`
              : asking
                ? "Asking…"
                : askedAgo(props.provider.listedAt)}
        </span>
        <button
          type="button"
          className="rex-button"
          disabled={asking || saving}
          onClick={() => void ask()}
        >
          Refresh
        </button>
        {canTick && rows.length > 0 ? (
          <button
            type="button"
            className="rex-button"
            onClick={() =>
              setRows((was) => was.map((row) => (row.blocked ? row : { ...row, ticked: true })))
            }
          >
            Tick all
          </button>
        ) : null}
        <span className="rex-spacer" />
        <button
          type="button"
          className={saved !== null ? "rex-button rex-button-done" : "rex-button rex-button-go"}
          disabled={props.busy || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : saved !== null ? "Saved" : "Save models"}
        </button>
      </div>
    </div>
  );
}
