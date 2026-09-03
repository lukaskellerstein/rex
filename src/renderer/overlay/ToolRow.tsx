// Spec 36 §3.1 — a row of tool glyphs between two turns, and the glyph itself.
//
// One icon per call, in order, no words: the row says THAT something ran and
// what kind of thing it was. The trace, one click away, has the rest.

import { Blocked, FileGlyph, Pencil, TableGlyph, Terminal, Warning } from "./Icons.tsx";
import type { ToolGlyph, ToolMark } from "./toolRows.ts";

/**
 * One glyph, drawn by what the tool does. Shared with the trace sheet's
 * gutter, so a change is a pencil in both places and a refusal the same barred
 * circle.
 */
export function ToolIcon({ glyph }: { glyph: ToolGlyph }): React.JSX.Element {
  if (glyph === "denied") return <Blocked />;
  if (glyph === "failed") return <Warning size={13} />;
  if (glyph === "read") return <FileGlyph />;
  if (glyph === "change") return <Pencil size={12} />;
  if (glyph === "diff") return <TableGlyph />;
  return <Terminal />;
}

const BAD: ReadonlySet<ToolGlyph> = new Set(["failed", "denied"]);

/**
 * `live` is the trailing row of a run still going: its last icon pulses, so
 * the reviewer sees calls land without a word being printed for each.
 */
export function ToolRow({
  tools,
  live,
  onShowTrace,
}: {
  tools: ToolMark[];
  live: boolean;
  onShowTrace: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="rex-turn-tools"
      title={`${tools.length} tool call${tools.length === 1 ? "" : "s"} — open the trace`}
      onClick={onShowTrace}
    >
      {tools.map((tool, position) => (
        <span
          key={tool.id}
          className={[
            "rex-tool",
            BAD.has(tool.glyph) ? "rex-tool-bad" : "",
            live && position === tools.length - 1 ? "rex-tool-live" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title={tool.detail ? `${tool.name} · ${tool.detail}` : tool.name}
        >
          <ToolIcon glyph={tool.glyph} />
        </span>
      ))}
    </button>
  );
}
