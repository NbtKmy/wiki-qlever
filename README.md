# Wiki QLever — Find the Gaps in Wikimedia Commons, and Close Them

**The challenge:** Pick a large collection on Wikimedia Commons. Can we find out, with one query, which images are still missing structured data about what they show and where they were taken, suggest the missing statements, and let a human confirm them? And can we build it so that it works for the next collection too?

**Baseline**

Swiss GLAM institutions such as ETH Library and Zentralbibliothek Zürich have put large image collections on Wikimedia Commons. QLever offers a SPARQL endpoint for Commons, so we can ask questions about the structured data of millions of files and get answers quickly. We use it to measure what is missing and to prepare the statements that fill the gap. We build a **generic pipeline**, not a tool for one collection, and test it on real ones.

**Pains**

- Many images have no structured description of their content. In a random sample of 600 files from the ETH Library collection (60,449 files), about 91% have no `depicts` statement (`P180`). In the Aargau society collection (challenge #319), 10 of 2,751 indexed files have one.
- Camera position and viewing direction are almost absent. In the same ETH sample, 3 of 600 files have camera coordinates (`P1259`).
- Collections are hard to select. The *collection* statement (`P195`) lets one query pick all files of an institution, but none of the four Swiss collections we checked uses it, although about 8.2 million Commons files do, mostly from US institutions.

![Four Swiss collections we checked have no collection (P195) statement](https://raw.githubusercontent.com/NbtKmy/wiki-qlever/main/presentations/assets/p195-gap-by-collection.png)

- Suggestions from file names alone are not safe. In a small hand-checked test of 30 files, half had no Wikidata candidate at all, and of the other half the top candidate was wrong or uncertain in 4 of 15 cases. A human has to decide.

These are collections we picked, not a survey of all Swiss institutions.

**Goals**

Build the pipeline end to end for one or two collections:

**collection → QLever gap detection → suggested statements → human validation → Structured Data on Commons**

1. **Select a collection.** Preferably with `P195`, otherwise by Commons category or file-name prefix.
2. **Detect gaps with QLever.** Count and list the files without `depicts`, without coordinates, or without heading.
3. **Suggest statements** from the file name, the caption, and the image itself:
   - `depicts` (`P180`): landmarks, places, people, and objects, matched to Wikidata. This is the main part.
   - Camera position `P1259` and depicted place `P9149`, both as approximate coordinates, with the heading `P7787` as a qualifier. Phrases such as *vom Vulcan-Hôtel* or *gegen Süd* give hints. Careful: "seen from the north" means the camera points south.
4. **Validate by a human.** A reviewer accepts, rejects, or picks another candidate. Every suggestion records its source, for example "inferred from file name".
5. **Export** the accepted statements for Commons (for example as QuickStatements) instead of writing directly.

Then show what the data makes possible, for example:

- a map of a collection from the camera positions,
- the viewing direction of historic aerial photographs drawn on a map,
- a comparison of institutions by how complete their metadata is,
- all photos of the same mountain or object across institutions,
- file names that do not match the content.

Secondary goal: show institutions what is missing, and encourage them to register the collection statement (`P195`).

**Already done**

- Gap measurements with QLever for ETH Library, Zentralbibliothek Zürich, the Aargau society collection, Museum Rietberg and the UZH Ethnographic Museum (documented in `docs/qlever-commons.md`).
- A hand-checked test of matching file names and image content to Wikidata items, with its failure cases.
- A manual write test on one Commons file: approximate camera position, heading, and depicted place were saved as structured data. A heading cannot carry an uncertainty on Commons, so the pipeline has to keep it.

**Dataset**

Any Commons collection. We start with the ETH-Bibliothek files (`Category:Media contributed by the ETH-Bibliothek`) and Zentralbibliothek Zürich, which are large, bulk-uploaded and mostly unannotated. The Aargau society collection (#319) is a possible second test case: our pipeline complements that challenge, which is about place names and coordinates for the same collection.

**Possible extensions**

AI-assisted object recognition, image-region annotations, and direct upload to Commons.

**The question behind the project**

How can we turn millions of openly available cultural heritage images into a more connected, searchable, and reusable knowledge graph?

**Who we are looking for**

People interested in Wikimedia Commons, Wikidata, SPARQL/QLever, cultural heritage collections, user interfaces, or computer vision.

**Repository**

This repository contains the documents and code for the project "wiki-qlever" at the [GLAMhack 2026](https://hack.glam.opendata.ch/event/13).

- [`docs/qlever-commons.md`](docs/qlever-commons.md): guide to the QLever endpoint for Commons, with all measurements and test results mentioned above.
- [`presentations/assets/`](presentations/assets/): charts used in this description (SVG and PNG).
