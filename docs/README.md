# Documentation: where to start

This project asks how to turn openly available cultural heritage images on Wikimedia Commons into connected, searchable data. The documents here are split by topic, so you can read only the part you care about.

New to the project? Read the [main README](../README.md) first, then pick a path below.

## What do you want to do?

| I want to… | Read | Where we stand |
|---|---|---|
| **Mark objects inside an image** with a rectangle and say what they are (training data, annotation tools) | [`depicts.md`](depicts.md) | Rectangles exist on Commons, but only on about 8,000 files, and almost none from Swiss institutions. A [one-file tool](https://nbtkmy.github.io/wiki-qlever/box-annotator.html) measures a rectangle on any Commons image. |
| **Suggest what a file shows** when it has no `depicts` statement (from the file name, caption or the image) | [`depicts-suggestions.md`](depicts-suggestions.md) | Two small hand-judged experiments: file names give a usable candidate for about a third of the files, the image adds objects and text. A human must review. |
| **Put photos on a map or in 3D** (camera position, viewing direction, depicted place) | [`geocode.md`](geocode.md) | We have a [3D viewer](../viewer/) and a manual write test. Most collections have no coordinates. |
| **Work with a whole institution** at once (collection statement `P195`, gaps per collection) | [`collections.md`](collections.md) | `P195` works for Zentralbibliothek Zürich, but is missing for most other Swiss collections we checked. |
| **Just start querying** Commons with SPARQL | [`qlever-basics.md`](qlever-basics.md) | The endpoint is new, rate-limited and sometimes slow. |

## Conventions

- Numbers in these documents carry the date they were measured. The endpoint changes daily, so re-run a query before you quote it.
- Every query shown here was run against `https://qlever.dev/api/wikimedia-commons`, unless it names the Wikidata endpoint.
- Each page ends with its own open questions.
