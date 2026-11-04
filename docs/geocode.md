# Geocode: camera position, heading and depicted place

How a photograph says where it was taken, what it looks at and in which direction. For endpoint basics see [`qlever-basics.md`](qlever-basics.md).

## Properties

Photographs can also carry statements about how they were taken. Properties checked on Wikidata (23 Oct 2026):

| Property | Meaning | On Commons files |
|---|---|---|
| `P1259` | coordinates of the point of view (camera) | yes, "Done" in the location model |
| `P9149` | coordinates of the depicted place | yes, "Done"; replaces `P625` on files |
| `P7787` | heading: direction (yaw) of the camera; Wikidata datatype quantity, unit degree or radian, range 0–360, clockwise from north | as a qualifier of `P1259` / `P9149`, not a statement of its own |
| `P2044` | elevation above sea level | optional qualifier of `P1259` / `P9149` |
| `P7108` | location of the point of view (an item) | not mentioned on the Commons modeling pages; not checked |
| `P4036` | field of view | not part of the Commons location model |

`P2061` is *aspect ratio (W:H)*, not a view direction.

ETH file names often contain this information in words: `gegen Süd`, `vom Vulcan-Hôtel`, `von N.`, `v. N. aus 1900 m` (aerial: direction and altitude). Caution with `von N.` ("seen from the north"): the camera then looks south, so `P7787` would be about 180°, not 0°. Define the convention before extracting. The place name before the first comma is sometimes the viewpoint and not the subject (see the Jungfraujoch / Mönch case in [`depicts-suggestions.md`](depicts-suggestions.md)).

Sources (checked 1 Nov 2026): [Commons:Structured data/Modeling/Location](https://commons.wikimedia.org/wiki/Commons:Structured_data/Modeling/Location), [Commons:Structured data/Modeling](https://commons.wikimedia.org/wiki/Commons:Structured_data/Modeling), [Wikidata P7787](https://www.wikidata.org/wiki/Property:P7787).

### Writing to Commons

- Existing users of the properties: AliciaFagervingWMSE-bot adds `P1259` for Wiki Loves Monuments files; XRayBot adds `P9149` to its operator's own photographs.
- Ways to add statements: the "Structured data" tab of a file, QuickStatements in Commons mode (batch only, `M` IDs instead of `Q` IDs), OpenRefine 3.6 or later, Cat2Data, Depictor and others (list on [Commons:Structured data](https://commons.wikimedia.org/wiki/Commons:Structured_data)).
- QuickStatements cannot set the precision or the globe of a coordinate, cannot set ranks, and does not honour `maxlag`. This matters for approximate camera positions, because a precision that is too fine claims accuracy we do not have. Options: set the precision through the API or OpenRefine, or have the reviewer check it after the import.
- The QuickStatements help only shows a coordinate example for `P625` (`@LAT/LON`). QuickStatements has not been tested on Commons by us; only the manual route below was.
- We did not find a Commons page that lists allowed or forbidden properties, nor one that states bot approval rules. Check [Commons:Bots](https://commons.wikimedia.org/wiki/Commons:Bots) before any mass edit.

### Manual test on one file (1 Nov 2026)

File: `Zentralbibliothek Zürich - Escherdenkmal - 991028231679705501.jpg` (`M155155057`, [link](https://commons.wikimedia.org/wiki/File:Zentralbibliothek_Z%C3%BCrich_-_Escherdenkmal_-_991028231679705501.jpg)), a 1889 photograph of the Alfred Escher fountain at Zürich Hauptbahnhof. Before the test it had no `P1259`, `P9149`, `P625` or `P7787`. We added the statements by hand in the "Structured data" tab and read them back with `wbgetentities` (final revision 1294652756):

- `P1259` = 47.3769854, 8.5399621 (reviewer's estimate of the photographer's position), precision 0.0001° (about 11 m).
  - Qualifier `P7787` = 0 degree (unit Q28390). The photo shows the fountain in the middle of the frame and the station facade almost head-on, and the fountain lies about 1° (north) from the position.
  - Qualifier `P1480` (sourcing circumstances) = `Q5727902` (circa), to mark the whole coordinate as approximate.
- `P9149` = 47.377135, 8.539965 (position of the fountain), precision 2.78e-5° (0.1 arcsecond, about 3 m).

What this showed:

- The coordinate input offers a precision choice, and the chosen value is stored as entered. This is the route for approximate positions (QuickStatements cannot set it).
- `P7787` is accepted as a qualifier of `P1259`, with the unit degree and no warning.
- The input has no field for an uncertainty of the heading. Entering `0 ± 30` was not saved; only `+0` is stored, without lower and upper bound. A heading from a photograph is therefore stored as a point value, and its uncertainty has to be carried by the pipeline (the suggestion record and the review interface), not by Commons.
- `P1480` = circa is stored as a qualifier of the `P1259` statement. Entered as a reference it is stored as a reference, which is a different statement ("the source says circa"). It applies to the whole coordinate, not only to the heading.
- With an estimated standpoint about 17 m from the subject, a position error of 10 m already changes the bearing to the subject by tens of degrees. Heading values should be coarse (north, north-east…) unless the standpoint is known well.
- A viewer direction taken from a map viewer URL (Google Earth `…h`, Street View `…h`) is the direction the viewer was looking at that moment, not the direction of the photograph. It only helps if the view is rotated until it matches the photo.

### Hand-picked coordinates

A reviewer who reads a position off a map (OpenStreetMap, swisstopo, Google Maps) gets a plausible position, not an exact one:

- Historic photographs: the exact standpoint is usually unknown, the place may have changed or disappeared, and the caption often names a building or a hotel, not a spot.
- Map clicks have an error of several metres; zoom and the reviewer's judgement set the real accuracy.
- Use a coordinate precision that matches this (for example about 0.0001° for a named building, 0.01° for a village) and record how the value was obtained (for example "read from map by reviewer, approximate").
- Licence of the map source: coordinates are facts, but we have not checked what the Commons community expects for Google Maps. Prefer OpenStreetMap or swisstopo, and verify before the first import.

## Open questions

- Can heading (`P7787`, a qualifier) and camera position (`P1259`) be extracted from the file names reliably, and how often are `P1259`, `P9149` and `P7787` already present on Commons?
- Does QuickStatements (or the API / OpenRefine) write a `P1259` statement with `P7787` and `P1480` qualifiers on Commons, and with which coordinate precision? The manual input works (see above).
- Can the heading be given an uncertainty (lower and upper bound) on Commons by any route other than the web form, for example the API?
