# Depicts and regions inside an image

Commons can say not only *what* a file shows (`depicts`, `P180`) but also *where in the picture* it is. This page explains how, what exists today, and what is missing for Swiss collections. All numbers were measured on 4 November 2026.

Background: [Structured data on Commons](https://commons.wikimedia.org/wiki/Commons:Structured_data) and its [depiction modelling guide](https://commons.wikimedia.org/wiki/Commons:Structured_data/Modeling/Depiction). The modelling guide recommends the qualifier below but does not document its value format.

## How a rectangle is stored

A `depicts` statement can carry the qualifier `relative position within image` ([`P2677`](https://www.wikidata.org/wiki/Property:P2677), datatype string). The value is a rectangle in percent of the whole image:

```
pct:<x>,<y>,<width>,<height>
```

`x` and `y` are the offsets of the top-left corner from the left and top edge. Example: `pct:32.4,42.9,16.5,45.6` is a box that starts 32.4 % from the left and 42.9 % from the top, and is 16.5 % wide and 45.6 % high. The syntax is borrowed from the IIIF image API region parameter, but no IIIF server is involved. Because the numbers are percentages, they stay valid at any image size.

A file can have many boxes, one per `depicts` statement. A box is a qualifier of a statement, so the same depicted item can appear twice with two boxes (two coats of arms in one photo).

Related property: `region within image` ([`P8276`](https://www.wikidata.org/wiki/Property:P8276)). On Commons it appears on only 3 files.

## Query it

Qualifiers are not reachable through the simple `wdt:` prefix. Use the full statement form:

```sparql
PREFIX p:  <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
SELECT ?m ?d ?pos WHERE {
  ?m p:P180 ?st .
  ?st ps:P180 ?d .
  ?st pq:P2677 ?pos
} LIMIT 10
```

All boxes of one file (replace the `M…` id with the page id of the file):

```sparql
PREFIX p:  <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
SELECT ?d ?pos WHERE {
  <https://commons.wikimedia.org/entity/M29931469> p:P180 ?st .
  ?st ps:P180 ?d .
  ?st pq:P2677 ?pos
}
```

Files with the most boxes: `SELECT ?m (COUNT(*) AS ?boxes) … GROUP BY ?m ORDER BY DESC(?boxes) LIMIT 8` over the same pattern.

Tips from running these:

- **Run counting queries one at a time.** Several in parallel got HTTP 429 (too many requests) from the endpoint.
- **To find the file name** of an `M…` id, ask the Commons API: `action=query&pageids=<id>` on `commons.wikimedia.org/w/api.php`. The QLever index also has `schema:url`.
- **To read the label** of a depicted item (`Q…`), use the Wikidata API (`wbgetentities`). The Commons index has no labels.

## How much exists

| What | Count |
|---|---|
| `depicts` statements with a `P2677` box | 23,632 |
| Files with at least one box | 7,951 |
| Different depicted items | 10,292 |
| Files with any `depicts` (for scale) | 29,748,195 |
| Box values that do not start with `pct:` | 102 (for example `left`, `right`, or a sentence) |

So about 0.03 % of the files with `depicts` also say where. The largest file has 66 boxes ([Archipel des Tuamotu.jpg](https://commons.wikimedia.org/wiki/File:Archipel_des_Tuamotu.jpg)), a group portrait has 58 ([Rektor Szkoły Głównej…](https://commons.wikimedia.org/wiki/File:Rektor_Szkoły_Głównej_i_profesorowie_wszystkich_jej_wydziałów_(55005).jpg)).

## Swiss institutions

Short answer: almost nothing.

- Among the 7,951 files with a box, only 264 have a collection statement (`P195`). The largest collections are the British Museum (112 files), the US National Archives (35) and the Met (23). Of the 25 collections with the most such files, none is Swiss. A direct check of Zentralbibliothek Zürich, ETH Library, ETH Library Image Archive, Museum Rietberg and the Swiss National Museum, by their `P195` value, returns no file with a box.
- Matching file names against Swiss institutions and places (a rough filter, not a complete search) finds three ETH-Bibliothek files, each with one or two boxes: `ETH-BIB-Heilig-Kreuz-Kirche, Berlin-Weitere-LBS MH02-15-0027.tif` and two more `ETH-BIB-…Berlin-Weitere-LBS…` files.
- Swiss subjects photographed by individuals do exist, and they show what the data can look like:
  - [Zürich (Schweiz), Bahnhof -- 2011 -- 1386.jpg](https://commons.wikimedia.org/wiki/File:Zürich_(Schweiz),_Bahnhof_--_2011_--_1386.jpg): five boxes, among them the Alfred Escher memorial fountain (`Q27229673`), Helvetia (`Q15317`), a statue and two coats of arms.
  - [Freienhof mit Jesuitenkirche Luzern.jpg](https://commons.wikimedia.org/wiki/File:Freienhof_mit_Jesuitenkirche_Luzern.jpg): three boxes (Chapel Bridge, Jesuit Church, Freienhof).

So labelled regions for Swiss heritage images are an open field. The training-data idea in the main README has no Swiss precedent to copy.

## Two things with similar names

- **Boxes in structured data** (this page): `depicts` plus `P2677`, queryable in QLever.
- **The ImageAnnotator gadget** ([Help:Image-Annotator](https://commons.wikimedia.org/wiki/Help:Image-Annotator)): notes with a rectangle, like Flickr photo notes. It stores them as text on the file description page, not as structured data. QLever does not see them. Only rectangles are supported.

The depiction guide also lists tools "with depicts capabilities" without saying how any of them stores a region. We have not checked which one writes `P2677`.

## Getting a rectangle without IIIF

The IIIF proxy that [iiif.io documents for Commons](https://iiif.io/guides/guides/wikipedia.org/) no longer works (checked 4 November 2026): `tools.wmflabs.org/zoomviewer/…` redirects to `zoomviewer.toolforge.org`, which answers `404`. You do not need it.

- Load the image from `https://commons.wikimedia.org/wiki/Special:FilePath/<file name>?width=1600`.
- To **draw** existing boxes, put an absolutely positioned element over the image with `left`, `top`, `width` and `height` set to the four numbers in percent.
- To **capture** a box, let the user drag on the image and compute `(left, top, width, height) ÷ displayed size × 100`.

## See also

[`depicts-suggestions.md`](depicts-suggestions.md): how to propose `depicts` values for files that have none.

## Open questions

- Does `P2677` refer to the image as stored or as displayed when the file has an EXIF rotation? Test with a rotated file before building on it.
- Which of the 102 non-`pct:` values are errors, and who writes them?
- Which tool, if any, writes `P2677` on Commons today?
- Can a polygon be stored? The documentation we found only shows rectangles.
