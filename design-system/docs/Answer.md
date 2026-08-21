---
category: Thread
---

# Answer

One turn of the conversation about a comment.

**The answer outranks the machinery**, and this component is where that rule is spent: the agent's turn gets 13px body text at full contrast with no border, no card and no avatar. Your own question is a step dimmer behind a rule, because you already know what you asked.

## Rules

- **Nothing about the run appears here.** The cost, the duration and the profile go in a `Meta` strip above; the tool calls collapse into `ToolSteps` below; the thinking is drawn in the trace sheet and nowhere else. An answer with its machinery threaded through it is how a reviewer stops reading answers.
- `error` takes the write red — a failed run is something to look at.
- Text is `pre-wrap` and breaks anywhere. An agent's answer contains paths and identifiers, and a path that overflows its column takes the layout with it.

## Examples

```tsx
<Answer role="user"><p>Is 40ms still the target here?</p></Answer>
<Answer><p>No. The budget moved to 25ms in commit 1785be6, and this paragraph was not updated.</p></Answer>
<Answer role="error"><p>The run stopped: the model returned no content.</p></Answer>
```
