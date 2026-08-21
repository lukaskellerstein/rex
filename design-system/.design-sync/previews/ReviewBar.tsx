import { Button, ReviewBar, Shell, TextButton } from "@rex/design-system";

const ACTIONS = (
  <>
    <Button variant="primary">OK</Button>
    <Button>Undo</Button>
    <TextButton>show diff ⌄</TextButton>
  </>
);

export const AfterAnApply = () => (
  <Shell style={{ padding: 20, width: 720 }}>
    <ReviewBar
      heading="Apply changed 2 files"
      actions={ACTIONS}
      files={[
        {
          path: "docs/architecture/components.md",
          added: 12,
          removed: 4,
          open: true,
        },
        { path: "docs/README.md", added: 1 },
      ]}
    />
  </Shell>
);

export const SomethingWasSkipped = () => (
  <Shell style={{ padding: 20, width: 720 }}>
    <ReviewBar
      heading="Apply changed 1 file"
      note="1 skipped — spec.pdf has no source line to write back to"
      actions={ACTIONS}
      files={[{ path: "docs/architecture/components.md", added: 8, removed: 2, open: true }]}
    />
  </Shell>
);

export const WithTheDiffOpen = () => (
  <Shell style={{ padding: 20, width: 720 }}>
    <ReviewBar
      heading="Apply changed 1 file"
      actions={ACTIONS}
      files={[{ path: "docs/architecture/components.md", added: 2, removed: 2, open: true }]}
    >
      <pre className="rex-diff">
        <span className="rex-diff-file">docs/architecture/components.md</span>
        <span className="rex-diff-hunk">@@ -212,7 +212,7 @@</span>
        <span> The renderer paints a resolved highlight</span>
        <span className="rex-diff-del">-within 40ms of the document settling.</span>
        <span className="rex-diff-add">+within 25ms of the document settling.</span>
        <span> Anything slower reads as a redraw.</span>
      </pre>
    </ReviewBar>
  </Shell>
);
