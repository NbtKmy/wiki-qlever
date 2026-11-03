# Camera position correction tool — design

Date: 2026-11-03
Status: approved by the user on 2026-11-03

## Intent and why

Many Wikimedia Commons photos have a geocode for the depicted place (`P9149`) but no camera position (`P1259`). On the QLever Commons endpoint, about 2.82 million files have `P9149` and no `P1259` (queried 2026-11-03).

The tool lets a hackathon participant who is not a programmer find where a photo was taken. They look at one photo, fade it over a 3D model of the real buildings, and move a virtual camera until the two line up. The tool then shows the camera position and viewing direction as numbers. The participant types those numbers into Commons by hand.

Why: it lowers the barrier to joining the GLAMhack project (people can contribute by looking at photos), and it shows what Structured Data on Commons makes possible once location data is present.

The existing prototype in `viewer/` already shows one hard-coded photo (Zürich Escher monument, M155155057) with swisstopo buildings and terrain. This design turns it into the tool described here.

## Goals

1. **Photo picker.** A list of candidate photos, loaded live from QLever. A candidate has `P9149` and no `P1259`, and lies in the chosen region.
   - Regions: Winterthur (default, the hackathon venue), Zürich, all of Switzerland.
   - Counts on 2026-11-03, using rough latitude/longitude boxes: Winterthur 94, Zürich 514, Switzerland 42,209. The Swiss box also catches some border areas of neighbouring countries.
   - For Switzerland, show a random sample of a few dozen, not the whole set.
   - Exclude files whose collection (`P195`) is the Federal Office of Topography (`Q685592`). They may be aerial photos, which do not suit this tool. The user decided not to include them this time.
   - Layout (chosen by the user): rows of thumbnail and title on the left, a small map on the right with one dot per subject.
2. **Adjust screen.** Opened by choosing a photo. Layout (chosen by the user): the 3D view on the left, a control panel on the right.
   - The right panel can be minimised, so the 3D view fills the window and the photo can be compared at full size.
   - The photo is fixed on screen and semi-transparent. The user moves the camera, not the photo.
   - Mouse and keyboard move the camera directly: drag to look around, arrow keys or WASD to walk, scroll to change the field of view.
   - The panel has sliders for fine tuning: photo opacity, east–west, north–south, height above ground, heading, field of view.
   - Height above ground starts at 1.6 m (terrain height plus eye height) and the user can change it.
3. **Result.** The panel shows, computed from the current camera:
   - `P1259` latitude and longitude;
   - `P7787` heading in degrees, to be entered together with `P1480 = circa (Q5727902)`;
   - a copy button.
4. **Subject marker.** The `P9149` position from Commons is drawn in the 3D view and does not move. It is the fixed reference the user lines the photo up against.

## Non-goals

- Writing to Commons (no login, no QuickStatements, no API edits). The user enters values by hand.
- Editing `P9149`.
- Correcting many photos in one session or in batch.
- Recording pitch and roll. Commons has no place for them; the tool may use them on screen only.
- Storing the field of view in Commons. `P4036` exists but is not part of the Commons location model; the tool shows the field of view for the user's use only.
- Anything outside Switzerland (swisstopo data covers Switzerland only).
- Mobile layout.

## Anti-goals

- Numbers that look more exact than they are. The heading stays marked `circa`, because it is estimated by eye. Do not display more precision than about 5 decimals for coordinates (about 1 m) and whole degrees for heading.
- Losing the user's work silently, for example when they return to the list. Warn before leaving an adjusted photo.

## Constraints

- Static site, published on GitHub Pages. No server of our own.
- QLever's Commons endpoint answers cross-origin requests (`access-control-allow-origin: *`), so the page can query it directly.
- Build on `viewer/`: Vite, TypeScript, CesiumJS 1.147.
- Buildings: swisstopo 3D Tiles `ch.swisstopo.swissbuildings3d.3d`. Terrain: swisstopo `ch.swisstopo.terrain.3d`. Both need no token and share one height reference (verified: terrain at the test location is about 408 m, and buildings sit on it). Mixing in Cesium World Terrain put points about 50 m above the buildings, so do not mix them.
- The Cesium ion token is still used for the default imagery. Its allowed-URL list already includes the GitHub Pages domain (done by the user).
- Heights in Cesium are above the ellipsoid. The user-facing "height above ground" must be converted from them.
- The repository language is English, including all text in the tool.

## Facts and unknowns

- In the Swiss box, about 6,200 of the 42,209 candidates have a collection (`P195`), and 6,145 of those are the Federal Office of Topography (swisstopo). Other collections have 17 files or fewer each. Filtering by institution is not useful today.
- Unverified: what the swisstopo-collection photos show. They may be aerial photos, which suit this tool poorly. They are excluded from the picker (see Goals).
- Unverified: how accurate existing `P9149` values are. A coarse value (for example a village centre) makes the fixed subject marker less useful.
- Decision not yet made: whether to enter the elevation (`P2044`) in Commons.
- The existing test statement stores heading with amount `+0` and no uncertainty bounds, with `P1480 = circa` as a qualifier of `P1259`.

## Left to the builder

- Exact controls, key bindings and visual style.
- The SPARQL query details, paging and sampling method, and how thumbnails and titles are fetched.
- The starting camera position and heading when a photo is opened.
- Whether to offer an "aim at subject" toggle that keeps the camera pointing at the `P9149` marker.
