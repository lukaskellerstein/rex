/**
 * @rex/design-system — the Workbench vocabulary.
 *
 * REX is a desktop app for commenting on documents and discussing each comment
 * with an AI agent. This package is the design system that app is drawn in,
 * lifted out of `src/renderer/overlay/overlay.css` and `src/shared/tokens.ts`
 * with every value intact.
 *
 * Four rules hold the whole thing together:
 *
 *   1. **Colour means state.** Steel ok, amber moved, red orphaned, green
 *      resolved. Red is spent on exactly two things — a lost anchor and the
 *      write-capable agent — so it never stops meaning "look at this".
 *   2. **Selection is a change of intensity, never a second mark.** A card
 *      deepens its own wash and brightens its own border. It never changes hue.
 *   3. **The answer outranks the machinery.** The agent's reply gets body text
 *      at full contrast; the tool calls fold into one row.
 *   4. **A quote never speaks in REX's voice.** Newsreader appears in exactly
 *      one place — text taken out of the document — and nowhere else.
 *
 * Import the stylesheet once at the root of the app, and wrap everything in a
 * `Shell` — the palette is scoped to it:
 *   import '@rex/design-system/styles.css';
 */

/* --- Foundations ---------------------------------------------------------- */

export { Panel, type PanelProps, type PanelTone } from "./components/Panel";
export { Shell, type ShellProps } from "./components/Shell";
export { Swatch, type SwatchProps } from "./components/Swatch";

/* --- Type ----------------------------------------------------------------- */

export { Label, type LabelProps } from "./components/Label";
export { Meta, type MetaProps } from "./components/Meta";
export { Quote, type QuoteProps } from "./components/Quote";

/* --- Controls ------------------------------------------------------------- */

export { Button, type ButtonProps, type ButtonVariant } from "./components/Button";
export { Chip, type ChipProps, type ChipTone } from "./components/Chip";
export { NoteInput, type NoteInputProps } from "./components/NoteInput";
export { ScopeChip, type ScopeChipProps } from "./components/ScopeChip";
export {
  Segmented,
  type SegmentedOption,
  type SegmentedProps,
} from "./components/Segmented";
export {
  type Strength,
  StrengthMeter,
  type StrengthMeterProps,
} from "./components/StrengthMeter";
export { TextButton, type TextButtonProps } from "./components/TextButton";

/* --- Anchor --------------------------------------------------------------- */

export { AnchorKind, type AnchorKindProps } from "./components/AnchorKind";
export { GutterMarker, type GutterMarkerProps } from "./components/GutterMarker";
export { PlaceRow, type PlaceRowProps } from "./components/PlaceRow";
export { type PillTone, StatePill, type StatePillProps } from "./components/StatePill";
export { Token, type TokenProps } from "./components/Token";

/* --- Thread --------------------------------------------------------------- */

export { AnchorCard, type AnchorCardProps } from "./components/AnchorCard";
export { Answer, type AnswerProps, type AnswerRole } from "./components/Answer";
export { OrphanTray, type OrphanTrayProps } from "./components/OrphanTray";
export { ReviewBar, type ReviewBarProps, type ReviewFile } from "./components/ReviewBar";
export { ThreadCard, type ThreadCardProps } from "./components/ThreadCard";
export { type ToolStep, ToolSteps, type ToolStepsProps } from "./components/ToolSteps";

/* --- Shared vocabulary ---------------------------------------------------- */

export { type AnchorState, STATE_SUFFIX, STATE_WORD } from "./internal/state";
