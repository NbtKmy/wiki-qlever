# QLever and Wikimedia Commons: the basics

QLever's SPARQL endpoint for Wikimedia Commons is new (the endpoint was added to the Wikidata Query Service federation allowlist in June 2026, see [phab:T429807](https://phabricator.wikimedia.org/T429807)). This page collects the official links and a short, tested introduction for the hackathon. Topics have their own pages, see [`README.md`](README.md).

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

## Lookup pitfalls (Wikidata endpoint)

- A plain `VALUES ?l { "term"@en "term"@de … } ?item rdfs:label ?l` lookup answers in milliseconds. Adding `skos:altLabel` and more languages made 30 lookups run for more than 30 minutes, with `429 Too Many Requests` from the gateway. Keep the lookup minimal, run it sequentially with a pause, and use an explicit client timeout (the first attempt had none).
- When the gateway returns 429, other queries from the same client are rejected too. Do not run a long lookup loop and ad-hoc queries in parallel.

## Open questions

- How up to date is the index relative to live Commons?
