# Suggesting `depicts` values: matching experiments

Can we propose `depicts` statements for files that have none? Two small experiments, October 2026. For regions inside an image see [`depicts.md`](depicts.md).

Both experiments below are small and judged by hand. They show what is feasible, not a benchmark.

## 1. File name → Wikidata label (30 random files without `depicts`)

Method: strip `ETH-BIB-` and the inventory suffix, take the text before the first comma, look it up with `rdfs:label` (de/en/fr/it) on `qlever.dev/api/wikidata`, rank by `wikibase:sitelinks`.

- 15 of 30 got candidates; 15 got none.
- Of the 15 with candidates, the top candidate looked correct for 11 (Amden, Montreux, Rapperswil-Jona, Steingletscher, Stansstad, Küsnacht, Rheinfelden AG, Carouge, Davos, Eriswil, Zürich), wrong for 2, uncertain for 2. Judged from the Wikidata descriptions only; the images were not checked.
- Wrong: `Koblenz` ranks the German city above the Aargau municipality shown in the photo, and `Piano, di, Magadino` is cut at the comma and matches a Corsican commune.
- No candidate for most free-text titles (`Stierkampf in Sevilla-Nordafrikaflug 1932`), titles with `=` (`Genf = Genève`) and hyphenated compounds (`Allalingletscher-Tor`). Substring or n-gram matching would likely recover some of these; not tried.
- Many matches are municipalities, which is a coarse `depicts` value for an aerial photograph.

## 2. Looking at the image (20 random non-aerial files)

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

## Open questions

- How well does a type-constrained lookup (with `@mul` labels, spelling variants and substring matching) do on the same 30 + 20 files? Only the plain lookup was measured.
