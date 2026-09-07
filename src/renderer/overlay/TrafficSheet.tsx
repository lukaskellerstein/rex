// Spec 46 §4.6 — this comment's requests and responses, in REX.
//
// The comment card's `traffic` button keeps its glyph, its row and its IPC.
// **Only its destination changes**, from a Grafana URL to this — which is a
// smaller change than deleting it, and a control that vanishes looks like a bug.
//
// It opens in REX rather than a browser now, because there is no longer a
// dashboard with its own filters and its own time range to defer to. There is a
// file, and one comment's rows out of it.
//
// > **Failures are recorded too**, which is more than the Grafana stack gave: a
// > request that never reached a model still leaves a row saying why.

import { useState } from "react";
import type { GatewayTrafficResult, GatewayTrafficRow } from "../../shared/channels.ts";

interface Props {
  title: string;
  result: GatewayTrafficResult | null;
  onClose: () => void;
}

export function TrafficSheet(props: Props): React.JSX.Element {
  const result = props.result;
  return (
    <div className="rex-modal" role="dialog" aria-modal="true" aria-label="This comment's traffic">
      <div className="rex-dialog rex-settings">
        <header className="rex-dialog-head">
          <div className="rex-dialog-title">
            <h2>Traffic</h2>
            <p>{props.title}</p>
          </div>
          <button type="button" className="rex-button" onClick={props.onClose}>
            Close
          </button>
        </header>

        <div className="rex-dialog-body">
          {result === null ? (
            <p className="rex-settings-note">Reading…</p>
          ) : !result.available ? (
            // Criterion A16 — the button is present and says why it has nothing
            // to show. Only the built-in gateway keeps a log, because REX writes
            // only its config and will not ask somebody else's server to load
            // code.
            <p className="rex-settings-note">{result.reason}</p>
          ) : result.rows.length === 0 ? (
            <p className="rex-settings-note">
              Nothing recorded for this comment yet. A request appears here as soon as one is
              answered.
            </p>
          ) : (
            <>
              {!result.bodies ? (
                <p className="rex-settings-note">
                  Body capture is off, so these rows carry timings, tokens and cost but not the
                  questions or the answers. Settings → Gateways turns it back on.
                </p>
              ) : null}
              <ul className="rex-traffic">
                {result.rows.map((row, index) => (
                  <TrafficRow key={`${row.at}-${index}`} row={row} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TrafficRow(props: { row: GatewayTrafficRow }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const row = props.row;
  const has = row.requestBody !== undefined || row.response !== undefined;

  return (
    <li className={row.error ? "rex-traffic-row rex-traffic-failed" : "rex-traffic-row"}>
      <div className="rex-traffic-head">
        {/* The ENGINE's own id, not the alias — which is what says what answered. */}
        <span className="rex-traffic-model">{row.model ?? "no model"}</span>
        <span className="rex-traffic-when">{new Date(row.at).toLocaleTimeString()}</span>
        <span className="rex-traffic-ms">{row.ms === null ? "—" : `${row.ms} ms`}</span>
        <span className="rex-traffic-tokens">
          {row.tokensIn ?? "—"} in · {row.tokensOut ?? "—"} out
        </span>
        <span className="rex-traffic-cost">
          {/* `0` is a real answer for a local model and is drawn as one. */}
          {row.cost === null ? "—" : row.cost === 0 ? "free" : `$${row.cost.toFixed(4)}`}
        </span>
        {row.profile ? <span className="rex-traffic-profile">{row.profile}</span> : null}
        {has ? (
          <button type="button" className="rex-link" onClick={() => setOpen((was) => !was)}>
            {open ? "hide" : "show"}
          </button>
        ) : null}
      </div>

      {row.error ? <p className="rex-traffic-error">{row.error}</p> : null}

      {open ? (
        <div className="rex-traffic-bodies">
          {/*
            Both are drawn as TEXT inside a <pre>. They came from a model and
            from a document, and §14 rule 6 is that a remote string is data —
            nothing here uses `dangerouslySetInnerHTML`.
          */}
          <pre className="rex-traffic-body">{stringify(row.requestBody)}</pre>
          <pre className="rex-traffic-body">{stringify(row.response)}</pre>
        </div>
      ) : null}
    </li>
  );
}

function stringify(value: unknown): string {
  if (value === undefined) return "(not recorded)";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
