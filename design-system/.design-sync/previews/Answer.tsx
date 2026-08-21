import { Answer, Shell } from "@rex/design-system";

export const TheAnswer = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <Answer>
      <p>
        No. The budget moved to 25ms in commit 1785be6, and this paragraph was not updated. Two
        other documents still quote 40ms.
      </p>
    </Answer>
  </Shell>
);

export const AWholeTurn = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", flexDirection: "column", gap: 12 }}>
    <Answer role="user">
      <p>Is 40ms still the target here?</p>
    </Answer>
    <Answer>
      <p>No. The budget moved to 25ms in commit 1785be6, and this paragraph was not updated.</p>
      <p>
        The same number appears in docs/README.md and in SPEC.md §3. Only this one is stale — the
        other two were changed in the same commit.
      </p>
    </Answer>
  </Shell>
);

export const WhenTheRunFails = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <Answer role="error">
      <p>The run stopped: the model returned no content after 3 tool calls.</p>
    </Answer>
  </Shell>
);
