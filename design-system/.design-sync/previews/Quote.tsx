import { Answer, Quote, Shell } from "@rex/design-system";

export const FromTheDocument = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <Quote>
      The anchor resolver runs in the renderer, on the live DOM. The main process stores anchors and
      never resolves them.
    </Quote>
  </Shell>
);

export const Small = () => (
  <Shell style={{ padding: 20, width: 356 }}>
    <Quote small>Commands are ipcRenderer.invoke; agent output is webContents.send.</Quote>
  </Shell>
);

/* The card this component exists for: two voices, centimetres apart, and one of
   them is evidence. The serif is what keeps them apart. */
export const TwoVoicesInOneCard = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", flexDirection: "column", gap: 12 }}>
    <Quote>The anchor resolver runs in the renderer, on the live DOM.</Quote>
    <Answer>
      <p>
        That is still true, and it is invariant I1. The paragraph two sections below contradicts it
        — it says the main process resolves anchors before storing them, which was the design before
        commit 37ecf40.
      </p>
    </Answer>
  </Shell>
);
