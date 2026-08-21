import { Label, PlaceRow, Shell } from "@rex/design-system";

export const ThreePlacesTwoDocuments = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", flexDirection: "column", gap: 8 }}>
    <Label>PLACES</Label>
    <ol className="rex-places">
      <li>
        <PlaceRow index={1} document="components.md">
          the resolver
        </PlaceRow>
      </li>
      <li>
        <PlaceRow index={2} document="components.md">
          invariant I1
        </PlaceRow>
      </li>
      <li>
        <PlaceRow index={3} document="architecture-explained.html">
          §6.5
        </PlaceRow>
      </li>
    </ol>
  </Shell>
);

export const PointingAtOneLightsIt = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", flexDirection: "column", gap: 8 }}>
    <Label>PLACES</Label>
    <ol className="rex-places">
      <li>
        <PlaceRow index={1} document="components.md">
          the resolver
        </PlaceRow>
      </li>
      <li>
        <PlaceRow index={2} document="components.md" lit>
          invariant I1
        </PlaceRow>
      </li>
    </ol>
  </Shell>
);

export const TheOpenCommentTakesViolet = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", flexDirection: "column", gap: 8 }}>
    <Label>PLACES</Label>
    <ol className="rex-places">
      <li>
        <PlaceRow index={1} document="components.md" active>
          the resolver
        </PlaceRow>
      </li>
      <li>
        <PlaceRow index={2} document="components.md" active>
          invariant I1
        </PlaceRow>
      </li>
    </ol>
  </Shell>
);

/* `not checked here` is grey, never red. An orphan means the text is gone;
   this means nobody has opened the file yet. */
export const NotCheckedHereIsNotAnOrphan = () => (
  <Shell style={{ padding: 20, width: 356, display: "flex", flexDirection: "column", gap: 8 }}>
    <Label>PLACES</Label>
    <ol className="rex-places">
      <li>
        <PlaceRow index={1} document="components.md">
          the resolver
        </PlaceRow>
      </li>
      <li>
        <PlaceRow index={2} document="SPEC.md · not opened yet" unchecked>
          §6.5
        </PlaceRow>
      </li>
    </ol>
  </Shell>
);
