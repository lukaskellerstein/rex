# Showing absence

A review tool spends most of its life saying that something is not there. Getting the four kinds of "not there" apart from each other is most of this design's work.

## The four

| Kind | Looks like | Means |
|---|---|---|
| **Resolved** | green wash, token drained of colour but still numbered | The comment is finished. You can still find what it was about. |
| **Moved** | amber wash, `text moved` | The anchor was re-found after the text around it changed. Nothing is missing. |
| **Orphaned** | red wash, `anchor lost`, marker pinned to the foot of the gutter with `LOST` | The text is gone. The comment and its quote are kept — this is recoverable work, not a deletion. |
| **Not checked here** | `--faint` grey, `not opened yet` | Nobody has opened that document, so nothing has been resolved in it. |

## The rule that is easiest to get wrong

**`not checked here` is not `orphaned`.** A target in a document that has never been on screen gets the grey this design uses for absence, never red, and is never counted as an orphan.

An orphan means the text is gone. Unchecked means nobody looked. Painting the second one red turns a quiet backlog into a false alarm, and after the third false alarm the reviewer stops reading red.

## Never fill a gap with a guess

- A figure has no words to quote. `AnchorKind` says what the anchor **is** and gives its geometry. It never carries a description REX invented — REX does not describe a picture it cannot read.
- An orphan keeps its original quote. It does not get a new one.
- A count that cannot be complete says so in words. Where REX offers candidates rather than findings, the strip says `candidates`, and names what it skipped.

## An empty control still occupies its place

An empty `Selection` tab dims and reads `0`. It does not disappear. A control that comes and goes is its own kind of confusing, and hunting for a control that was there a moment ago is worse than reading a zero.
