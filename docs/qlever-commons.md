# QLever and Wikimedia Commons — Quick Guide

QLever's SPARQL endpoint for Wikimedia Commons is new (the endpoint was added to the Wikidata Query Service federation allowlist in June 2026, see [phab:T429807](https://phabricator.wikimedia.org/T429807)). This page collects the official links and a short, tested introduction for the hackathon.

## Official links

| What | URL |
|---|---|
| QLever UI for Commons (autocompletion, example queries) | <https://qlever.dev/wikimedia-commons> |
| SPARQL endpoint | <https://qlever.dev/api/wikimedia-commons> |
| QLever documentation | <https://docs.qlever.dev/> |
| QLever source code (Apache 2.0) | <https://github.com/ad-freiburg/qlever> |
| Federation allowlist task (Commons endpoint) | <https://phabricator.wikimedia.org/T429807> |
| Structured Data on Commons (SDC) help | <https://commons.wikimedia.org/wiki/Commons:Structured_data> |
| Wikidata Query Service federation endpoints | <https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual/SPARQL_Federation_endpoints> |
| GLAMhack 2026 event | <https://hack.glam.opendata.ch/event/13> |

Notes:

- The UI page lists these built-in example queries: *All predicates and their relative and absolute frequency*, *Updates complete until …*, *All pictures of Douglas Adams*, *All pictures of hummingbirds*, *Files from the Biodiversity Heritage Library depicting birds*, *Files depicting Brazilian taxa without page in the Portuguese Wikipedia*. Start there.
- The older university-hosted address `qlever.cs.uni-freiburg.de/api/wikimedia-commons` currently answers with a `308` redirect to `qlever.dev`, so use `qlever.dev` directly.
- The Commons data is CC0 (see the Commons footer).

## Data model (as observed)

- A file on Commons is a *MediaInfo* entity: `https://commons.wikimedia.org/entity/M<page id>`.
- SDC statements use Wikidata properties and items. Simple "direct" statements are available with the `wdt:` prefix, e.g. `wdt:P180` (depicts), `wdt:P195` (collection), and point to Wikidata items (`http://www.wikidata.org/entity/Q…`).
- Wikibase value nodes live under `https://commons.wikimedia.org/value/…`.
- Prefixes you will need:

```sparql
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd:  <http://www.wikidata.org/entity/>
```

The qlever.dev UI fills in known prefixes automatically.

## How to query

1. **Web UI** — open <https://qlever.dev/wikimedia-commons>, type a query, use autocompletion.
2. **HTTP** — plain GET/POST with a `query` parameter:

```bash
curl -G -H 'Accept: application/sparql-results+json' \
  --data-urlencode 'query=SELECT * WHERE { ?s ?p ?o } LIMIT 5' \
  https://qlever.dev/api/wikimedia-commons
```

3. **From Wikidata Query Service** — the endpoint is allowlisted for `SERVICE <…>` federation.

## Tested example queries

All queries below were run against the endpoint in October 2026.

**Sample of files with a `depicts` statement**

```sparql
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
SELECT ?m ?o WHERE { ?m wdt:P180 ?o } LIMIT 3
```

**Which collections (P195) have the most files?**

```sparql
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
SELECT ?coll (COUNT(?m) AS ?n) WHERE { ?m wdt:P195 ?coll }
GROUP BY ?coll ORDER BY DESC(?n) LIMIT 15
```

**Files of Zentralbibliothek Zürich (Q190260) without any `depicts` statement**

```sparql
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd:  <http://www.wikidata.org/entity/>
SELECT ?m WHERE {
  ?m wdt:P195 wd:Q190260 .
  FILTER NOT EXISTS { ?m wdt:P180 ?d }
} LIMIT 100
```

At the time of testing this collection had 7,224 files tagged with `P195 = Q190260`, of which 685 had no `depicts` statement.

## Tips and pitfalls

- **Count with `DISTINCT`.** A file with several `depicts` values yields several rows after an `OPTIONAL` join. Use `FILTER NOT EXISTS` and `COUNT(DISTINCT ?m)`.
- **Avoid full scans.** `GROUP BY ?p` over all triples timed out (HTTP 504). Always restrict by a property or a collection first.
- **The response body may repeat.** The endpoint's raw HTTP response appeared with the JSON duplicated after the headers when using `curl`; parse only the first JSON document (e.g. Python's `json.JSONDecoder().raw_decode`).
- **Collection tagging is not uniform.** `P195` (collection) works for Zentralbibliothek Zürich, but not for the others we tried:
  - ETH Library (Q684773) and Image Archive of ETH Library (Q40236085): only a handful of files via `P195` or `P7482` (source of file). Two sampled ETH files carried no collection or source statement at all.
  - Museum Rietberg (Q668300): 721 files via `P170` (creator), all with `depicts` already; `P195` gives 0.
  - Swiss National Museum (Q691896): used as a `depicts` value (172 files), not as a collection.
  - `P7482 = Q87402110` ("own work by the original uploader") is a generic value shared by 1,946 files across uploaders, so it does not identify an institution.
- **Selecting files by file name works, with a catch.** QLever has no Commons categories in this index, but `schema:url` contains the file name. For ETH Image Archive, files named `ETH Bildarchiv …` / `ETH-Bibliothek Zürich, Bildarchiv - …` can be selected like this (about 20 s with `LIMIT`):

  ```sparql
  PREFIX schema: <http://schema.org/>
  PREFIX wdt:    <http://www.wikidata.org/prop/direct/>
  SELECT ?m ?u WHERE {
    ?m schema:url ?u .
    FILTER(STRSTARTS(STR(?u), "http://commons.wikimedia.org/wiki/Special:FilePath/ETH%20Bildarchiv"))
    FILTER NOT EXISTS { ?m wdt:P180 ?d }
  } LIMIT 10
  ```

  Without `LIMIT`, or with `COUNT`, the filter scans every file and hits the 60 s gateway timeout (HTTP 504), so exact totals are not available this way. Page through results with `LIMIT`/`OFFSET`, or cache them locally.
- **Commons categories need the MediaWiki API.** For example `Category:Photographs_in_the_Collection_of_Museum_Rietberg` (358 files, 2 subcategories) can be listed with `action=query&list=categorymembers`; the page IDs map directly to `M<pageid>` entities in QLever, which can then be checked for `depicts`. In a sample of three files from that category, one had no `depicts` statement.
- **Data freshness.** The UI has an example query *Updates complete until …* that shows how current the index is. Check it before trusting "missing" results, since recently added `depicts` statements may not be indexed yet.

## Wikidata is moving to QLever too

Wikidata Query Service (WDQS) is replacing Blazegraph with QLever. Details: [WDQS backend update](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/WDQS_backend_update) and its [Migrate guide](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/WDQS_backend_update/Migrate).

- Announced timeline (page last edited 17 Oct 2026): new **v2** endpoints open to the community around **1 Nov 2026**, i.e. just before GLAMhack (12–14 Nov); Blazegraph endpoints may degrade from Feb 2027.
- v2 endpoints: `query-next.wikidata.org` and `query-scholarly-next.wikidata.org` ([phab:T429150](https://phabricator.wikimedia.org/T429150)). On 23 Oct 2026 `query-next.wikidata.org/sparql` still answered `403 Unauthorized User-Agent`, as the Migrate guide says it would until launch.
- Differences that matter for us (from the Migrate guide): `SERVICE wikibase:label` is removed (use `OPTIONAL { ?item rdfs:label ?l FILTER(LANG(?l)="en") }`); `wikibase:mwapi` / EntitySearch is not supported (call the MediaWiki or Wikidata REST API separately); `hint:*` is ignored; `wikibase:decodeURI()` and the binary results format are not supported.
- **Consequence:** do not build the prototype on `wikibase:label` or `mwapi` against `query.wikidata.org`. Use QLever's own Wikidata endpoint, `https://qlever.dev/api/wikidata`, for entity candidates. Note it needs explicit `PREFIX rdfs:` and `PREFIX schema:` declarations.

Tested entity-candidate lookup (13 ms), e.g. for an ETH portrait titled "Simon Stevin":

```sparql
PREFIX rdfs:   <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
SELECT ?item ?d WHERE {
  ?item rdfs:label "Simon Stevin"@en .
  OPTIONAL { ?item schema:description ?d FILTER(LANG(?d) = "en") }
} LIMIT 5
```

It returns Q23696 ("Flemish mathematician, physicist and engineer (1548–1620)") among other items such as a statue and a ship, so candidates still need ranking and human validation.

## Candidate collections (measured October 2026)

Method: file lists come from the Commons API (`list=categorymembers`) or a `P195` query; the page IDs are then checked in QLever (`VALUES ?m { <…/entity/M<pageid>> … }` with `FILTER NOT EXISTS { ?m wdt:P180 ?d }`; use POST for long queries).

| Collection | How selected | Files | Without `depicts` |
|---|---|---|---|
| Zentralbibliothek Zürich | `wdt:P195 wd:Q190260` | 7,224 | 685 (9.5%) |
| Museum Rietberg | `Category:Collection of Museum Rietberg, Zürich` | 359 | 31 (8.6%) |
| Sevruguin photos, Rietberg | `Category:Photographs by Antoin Sevruguin in the collection of Museum Rietberg` | 271 | 2 |
| Sevruguin photos, Ethnographic Museum UZH | `Category:Photographs by Antoin Sevruguin in the collection of Völkerkundemuseum der Universität Zürich` | 160 | 0 |
| ETH-Bibliothek (all media) | `Category:Media contributed by the ETH-Bibliothek` via the Commons API, uniform random sample of 600 | 60,449 | 546 of 600 sampled (91%, 95% CI 88.7–93.3%), i.e. about 55,000 extrapolated |

Observations:

- All files in the checked Commons categories were present in the QLever index, so the index is current enough for these.
- Hand-curated small collections (Rietberg, UZH Sevruguin) are mostly annotated already. The remaining gap is concentrated in the large, bulk-uploaded archives (ZB, ETH), which makes those the better targets for a prototype. ETH-Bibliothek is by far the largest gap measured so far (see below).
- The Commons category search for "in the collection of" with Swiss place names only found a few categories, so a full list of Swiss GLAM collections will need a better source (for example the GLAM institutions' Wikidata items and their upload templates).

## ETH-Bibliothek: sampled `depicts` gap (23 Oct 2026)

`Category:Media contributed by the ETH-Bibliothek` holds 60,449 files (31 subcategories, not followed). We listed all of them with `list=categorymembers&cmtype=file` (about 120 requests of 500), drew a uniform random sample of 600 page IDs and checked them in QLever.

- All 600 were in the QLever index.
- 54 had a `wdt:P180` statement, 546 did not: **91% without `depicts`** (95% CI 88.7–93.3%), roughly **55,000 files** (53,600–56,400).
- Only the direct property `P180` was counted. A file may describe its content through other statements instead.
- 174 of the 546 are not aerial photographs (the aerial series `LBS` / `Inlandflüge` / `Nordafrikaflug` make up the rest). The non-aerial files are mostly glass slides (`Dia 247`, a Leo Wehrli collection), portraits (`Portr`), building photos (`Ans`) and photos of people and events (`Com`).
- Pitfall: starting the category listing at random sort keys (`cmstarthexsortkey`) gave a heavily clustered sample (65 distinct files from 25 starts), because file names do not spread evenly over hex keys. Enumerate the whole category first, then sample.
- Existing viewpoint statements are rare: in the same 600 files, `P1259` appears on 3 files and `P625` on none. `P9149`, `P7787` and `P4036` were not measured.

## Candidate matching experiments

Both experiments below are small and judged by hand. They show what is feasible, not a benchmark.

### 1. File name → Wikidata label (30 random files without `depicts`)

Method: strip `ETH-BIB-` and the inventory suffix, take the text before the first comma, look it up with `rdfs:label` (de/en/fr/it) on `qlever.dev/api/wikidata`, rank by `wikibase:sitelinks`.

- 15 of 30 got candidates; 15 got none.
- Of the 15 with candidates, the top candidate looked correct for 11 (Amden, Montreux, Rapperswil-Jona, Steingletscher, Stansstad, Küsnacht, Rheinfelden AG, Carouge, Davos, Eriswil, Zürich), wrong for 2, uncertain for 2. Judged from the Wikidata descriptions only; the images were not checked.
- Wrong: `Koblenz` ranks the German city above the Aargau municipality shown in the photo, and `Piano, di, Magadino` is cut at the comma and matches a Corsican commune.
- No candidate for most free-text titles (`Stierkampf in Sevilla-Nordafrikaflug 1932`), titles with `=` (`Genf = Genève`) and hyphenated compounds (`Allalingletscher-Tor`). Substring or n-gram matching would likely recover some of these; not tried.
- Many matches are municipalities, which is a coarse `depicts` value for an aerial photograph.

### 2. Looking at the image (20 random non-aerial files)

Method: download the 960 px thumbnail from the Commons API, view it, note what is visible, then look the nouns up on Wikidata (27 terms). The labelling was done by hand, with Claude acting as the vision model; there is no automated pipeline yet. People were not identified from faces, only from captions and file names.

Things the image adds over the file name:

- Objects, e.g. pier, steamboat and truck (Nahuel Huapi), a bicycle and the inscription *Bagni di Santa Filomena* (Stabio), the Swiss outline drawn next to Morocco on a map, a steam locomotive whose `150 X 29` is legible on the smokebox (the file name only says Belfort).
- Text on the glass slides: the handwritten caption on the slide often repeats the file name, but sometimes adds the scientific name (*Acer Pseudoplatanus*, *Berg-Ahorn*).
- Embedded metadata: the TIFF EXIF description of one portrait file reads "ETH Maschineningenieur Kurs II Gruppenaufnahme … mit Aurel Stodola, 1894", which is not in the file name.

Cases where the file name would give a wrong or misleading `depicts`:

- `Bob Marley & The Wailers Zürich …` shows only the audience, not the band. The band fits the event or main subject, not `depicts`.
- `Schröter, Carl (1855-1939)-Portrait` shows three men hiking in a forest, not a portrait; which one is Schröter is not visible.
- `Jungfraujoch, Mönch, NW-Flanke` shows the Mönch. Jungfraujoch is where the photo was taken.

Wikidata lookup of the 27 terms (top candidate by sitelinks):

- Correct: 13 (Santorini, Tutankhamun, leopard, El Greco, Aurel Stodola, Morocco, Medan, Stabio, crowd, steam locomotive, donkey, bicycle, Jungfraujoch).
- Wrong: 6. `Mönch` returns the monk (Q733786) before the mountain (Q16525); `Carl Schröter` returns a German politician and not the botanist; `panther` returns a legendary creature (use `leopard`); `camel` returns a colour, a chess piece and a heraldic animal; `Acer pseudoplatanus` returns only a single tree (the taxon item may carry its label under language `mul`, which we dropped for speed; not re-checked); `Lago Nahuel Huapi` was a bad search term.
- No candidate: 5 (`Souk el Arba`, `Bob Marley and the Wailers`, `Île-Rousse`, `SNCF 150 X`, `woolly mammoth`). Spelling variants such as `L'Île-Rousse` or `Bob Marley & the Wailers` may explain some; not tried.
- Unclear: 2 (`Elephas primigenius` returns a fossil species item with no sitelinks, probably an old name for *Mammuthus primigenius*; `Collonges` returns both the French commune and the Valais municipality).

Takeaways:

- Ranking by sitelinks is not enough for common names, generic nouns and homonymous people. Constrain by type (`P31` / `P279*`: taxon, mountain, person…) and let a person or a model with the caption and image make the final choice.
- A review step (accept / reject / pick another candidate) is needed anyway; the sampled precision is too low for automatic writing.

## Beyond `depicts`: viewpoint and direction

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

Sources (checked 1 Nov 2026): [Commons:Structured data/Modeling/Location](https://commons.wikimedia.org/wiki/Commons:Structured_data/Modeling/Location), [Commons:Structured data/Modeling](https://commons.wikimedia.org/wiki/Commons:Structured_data/Modeling), [Wikidata P7787](https://www.wikidata.org/wiki/Property:P7787).

### Writing to Commons

- Existing users of the properties: AliciaFagervingWMSE-bot adds `P1259` for Wiki Loves Monuments files; XRayBot adds `P9149` to its operator's own photographs.
- Ways to add statements: the "Structured data" tab of a file, QuickStatements in Commons mode (batch only, `M` IDs instead of `Q` IDs), OpenRefine 3.6 or later, Cat2Data, Depictor and others (list on [Commons:Structured data](https://commons.wikimedia.org/wiki/Commons:Structured_data)).
- QuickStatements cannot set the precision or the globe of a coordinate, cannot set ranks, and does not honour `maxlag`. This matters for approximate camera positions, because a precision that is too fine claims accuracy we do not have. Options: set the precision through the API or OpenRefine, or have the reviewer check it after the import.
- The QuickStatements help only shows a coordinate example for `P625` (`@LAT/LON`). Whether `P1259` with a `P7787` qualifier is accepted on Commons has to be tested on one file first.
- We did not find a Commons page that lists allowed or forbidden properties, nor one that states bot approval rules. Check [Commons:Bots](https://commons.wikimedia.org/wiki/Commons:Bots) before any mass edit.

### Hand-picked coordinates

A reviewer who reads a position off a map (OpenStreetMap, swisstopo, Google Maps) gets a plausible position, not an exact one:

- Historic photographs: the exact standpoint is usually unknown, the place may have changed or disappeared, and the caption often names a building or a hotel, not a spot.
- Map clicks have an error of several metres; zoom and the reviewer's judgement set the real accuracy.
- Use a coordinate precision that matches this (for example about 0.0001° for a named building, 0.01° for a village) and record how the value was obtained (for example "read from map by reviewer, approximate").
- Licence of the map source: coordinates are facts, but we have not checked what the Commons community expects for Google Maps. Prefer OpenStreetMap or swisstopo, and verify before the first import.

ETH file names often contain this information in words: `gegen Süd`, `vom Vulcan-Hôtel`, `von N.`, `v. N. aus 1900 m` (aerial: direction and altitude). Caution with `von N.` ("seen from the north"): the camera then looks south, so `P7787` would be about 180°, not 0°. Define the convention before extracting. The place name before the first comma is sometimes the viewpoint and not the subject (see Jungfraujoch / Mönch above).

## Lookup pitfalls (Wikidata endpoint)

- A plain `VALUES ?l { "term"@en "term"@de … } ?item rdfs:label ?l` lookup answers in milliseconds. Adding `skos:altLabel` and more languages made 30 lookups run for more than 30 minutes, with `429 Too Many Requests` from the gateway. Keep the lookup minimal, run it sequentially with a pause, and use an explicit client timeout (the first attempt had none).
- When the gateway returns 429, other queries from the same client are rejected too. Do not run a long lookup loop and ad-hoc queries in parallel.

## Open questions

- Which Swiss GLAM collections can be reliably selected with SPARQL on QLever (`P195`, file-name patterns), and which need the Commons API for category membership?
- Is the ETH figure (about 91% without `depicts`) typical for other bulk-uploaded archives, and how much of it is covered by other statements (for example `P180` on a parent work, `P921`, or depicted-place `P9149`)?
- How well does a type-constrained lookup (with `@mul` labels, spelling variants and substring matching) do on the same 30 + 20 files? Only the plain lookup was measured.
- Can heading (`P7787`, a qualifier) and camera position (`P1259`) be extracted from the file names reliably, and how often are `P1259`, `P9149` and `P7787` already present on Commons?
- Does Commons accept a `P1259` statement with a `P7787` qualifier written through QuickStatements, and with which coordinate precision?
- How up to date is the index relative to live Commons?
