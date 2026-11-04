# Documentation: where to start

This project asks how to turn openly available cultural heritage images on Wikimedia Commons into connected, searchable data. The documents here are split by topic, so you can read only the part you care about.

New to the project? Read the [main README](../README.md) first, then pick a path below.

## What do you want to do?

| I want to… | Read | Where we stand |
|---|---|---|
| **Mark objects inside an image** with a rectangle and say what they are (training data, annotation tools) | [`depicts.md`](depicts.md) | Rectangles exist on Commons, but only on about 8,000 files, and almost none from Swiss institutions. |
| **Put photos on a map or in 3D** (camera position, viewing direction, depicted place) | [Viewpoint and direction](qlever-commons.md#beyond-depicts-viewpoint-and-direction) in `qlever-commons.md` | We have a [3D viewer](../viewer/) and a manual write test. Most collections have no coordinates. |
| **Work with a whole institution** at once (collection statement `P195`, gaps per collection) | [Candidate collections](qlever-commons.md#candidate-collections-measured-october-2026) in `qlever-commons.md` | `P195` works for Zentralbibliothek Zürich, but is missing for most other Swiss collections we checked. |
| **Just start querying** Commons with SPARQL | [How to query](qlever-commons.md#how-to-query) and [Tips and pitfalls](qlever-commons.md#tips-and-pitfalls) in `qlever-commons.md` | The endpoint is new, rate-limited and sometimes slow. |

## Planned split

`qlever-commons.md` is long. The plan is to cut it into the files below and keep this page as the entry point. Until then the table above links to its sections.

- `qlever-basics.md`: endpoint, data model, how to query, pitfalls.
- `depicts.md`: done.
- `geocode.md`: camera position, heading, depicted place.
- `collections.md`: `P195`, gaps per collection, selecting files without `P195`.

## Conventions

- Numbers in these documents carry the date they were measured. The endpoint changes daily, so re-run a query before you quote it.
- Every query shown here was run against `https://qlever.dev/api/wikimedia-commons`.
