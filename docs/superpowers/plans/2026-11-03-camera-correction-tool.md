# Camera Position Correction Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `viewer/` prototype into a tool where a participant picks a Commons photo (`P9149` set, `P1259` missing), fades it over swisstopo 3D buildings, moves a camera until they line up, and reads off `P1259` and `P7787` to type into Commons.

**Architecture:** Two screens (picker, adjust) switched by `main.ts`. Pure logic (geo maths, SPARQL building and parsing, Commons API parsing, pose store) lives in small modules covered by Vitest. DOM and Cesium code is checked by hand against stated expectations. The camera pose lives in one store; the Cesium camera, the mouse and keyboard handlers, and the panel sliders all read and write it.

**Tech Stack:** Vite 8, TypeScript, CesiumJS 1.147, Leaflet (new, for the picker map), Vitest (new, dev only). Run all commands in `viewer/`.

**Spec:** `docs/superpowers/specs/2026-11-03-camera-correction-tool-design.md`

## Global Constraints

- Static site on GitHub Pages; no server of our own.
- QLever endpoint `https://qlever.dev/api/wikimedia-commons` and the Commons API (`origin=*`) are called straight from the browser.
- Buildings `https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json`, terrain `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1`. Never mix in Cesium World Terrain (about 50 m height mismatch).
- Cesium heights are above the ellipsoid; the UI shows "height above ground". Default eye height 1.6 m.
- Exclude files with `P195 = Q685592` from the picker.
- Regions: Winterthur (default), Zürich, Switzerland (random sample of a few dozen).
- Output: `P1259` as `lat, lon` with 5 decimals; `P7787` as a whole number of degrees in [0, 360), always shown with "circa" (`P1480 = Q5727902`).
- No writing to Commons, no login, no editing of `P9149`. Pitch, roll and field of view are never stored, only used on screen.
- All user-visible text and code comments are English.

## Review Focus

1. A region with no candidates shows "No photos found in this region." (Task 4).
2. A failed QLever or Commons request shows an error with a retry, never a blank screen (Task 4).
3. A file that is deleted or has no thumbnail still gets a row, with a placeholder (Tasks 3 and 4).
4. A subject outside swisstopo coverage (the Swiss box catches border areas) shows a warning and does not put the camera underground (Tasks 1 and 5).
5. Heading never shows as negative or 360 (Task 1).

---

### Task 1: Test tooling, config and geo helpers

**Files:**
- Modify: `viewer/package.json`, `viewer/vite.config.ts`
- Create: `viewer/src/config.ts`, `viewer/src/geo.ts`, `viewer/src/geo.test.ts`

**Interfaces:**
- Produces (`geo.ts`): `type LonLat = { lon: number; lat: number }`;
  `normalizeDegrees(deg: number): number` (result in [0, 360));
  `bearingDeg(from: LonLat, to: LonLat): number`;
  `offsetByMeters(origin: LonLat, eastM: number, northM: number): LonLat`;
  `walk(origin: LonLat, headingDeg: number, forwardM: number, rightM: number): LonLat`;
  `resolveGroundHeight(sampled: number | undefined | null): number | null` (valid ellipsoid heights are 150–4800 m; anything else is no data);
  `formatResult(position: LonLat, headingDeg: number): { p1259: string; p7787: string; text: string }`.
- Produces (`config.ts`): `type Region = { id: string; label: string; bbox: { west: number; south: number; east: number; north: number }; limit: number }`; `REGIONS: Region[]` (Winterthur first); `EXCLUDED_COLLECTION = 'Q685592'`; `EYE_HEIGHT_M = 1.6`; `SWISSTOPO_BUILDINGS_URL`; `SWISSTOPO_TERRAIN_URL`.

- [ ] **Step 1: Add Vitest.** `npm i -D vitest`; add script `"test": "vitest run"`; in `vite.config.ts` import `defineConfig` from `vitest/config` and add `test: { environment: 'node' }`.
- [ ] **Step 2: Write the failing tests** in `src/geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bearingDeg, formatResult, normalizeDegrees, offsetByMeters, resolveGroundHeight, walk } from './geo'

const camera = { lon: 8.5399621, lat: 47.3769854 }
const subject = { lon: 8.539965, lat: 47.377135 }

describe('geo', () => {
  it('wraps degrees into [0, 360)', () => {
    expect(normalizeDegrees(-1)).toBe(359)
    expect(normalizeDegrees(360)).toBe(0)
    expect(normalizeDegrees(725)).toBe(5)
  })
  it('computes the bearing from the Escher test camera to its subject', () => {
    expect(bearingDeg(camera, subject)).toBeCloseTo(0.75, 1)
  })
  it('offsets east and north by metres', () => {
    const p = offsetByMeters({ lon: 8.54, lat: 47.377 }, 100, 111.32)
    expect(p.lat).toBeCloseTo(47.378, 4)
    expect(p.lon).toBeCloseTo(8.5413264, 4)
  })
  it('walks relative to the heading', () => {
    const east = walk(camera, 90, 10, 0)
    expect(east.lon).toBeGreaterThan(camera.lon)
    expect(east.lat).toBeCloseTo(camera.lat, 6)
    const right = walk(camera, 0, 0, 10)
    expect(right.lon).toBeGreaterThan(camera.lon)
  })
  it('treats implausible ground heights as no data', () => {
    expect(resolveGroundHeight(407.8)).toBe(407.8)
    for (const bad of [undefined, null, NaN, 0, 9000]) expect(resolveGroundHeight(bad)).toBeNull()
  })
  it('formats the result', () => {
    const r = formatResult(camera, 359.6)
    expect(r.p1259).toBe('47.37699, 8.53996')
    expect(r.p7787).toBe('0')
    expect(formatResult(camera, -0.4).p7787).toBe('0')
  })
})
```

- [ ] **Step 3: Run `npx vitest run src/geo.test.ts`.** Expected: FAIL (module `./geo` not found).
- [ ] **Step 4: Implement `geo.ts` and `config.ts`** with the signatures above. Use 111,320 m per degree of latitude and scale longitude by cos(latitude). `formatResult` rounds heading to a whole number then normalises (so 359.6 gives `0`); `text` is `P1259: <p1259>\nP7787: <p7787> (circa)`. Region boxes: Switzerland west 5.95, south 45.8, east 10.5, north 47.85, limit 40; Zürich west 8.45, south 47.32, east 8.62, north 47.44, limit 600; Winterthur west 8.66, south 47.45, east 8.82, north 47.56, limit 100.
- [ ] **Step 5: Run `npx vitest run`.** Expected: all pass.
- [ ] **Step 6: Commit** `git add viewer/package.json viewer/package-lock.json viewer/vite.config.ts viewer/src/geo.ts viewer/src/geo.test.ts viewer/src/config.ts && git commit -m "Add geo helpers, config and Vitest"`.

### Task 2: Candidate query

**Files:**
- Create: `viewer/src/candidates.ts`, `viewer/src/candidates.test.ts`

**Interfaces:**
- Consumes: `Region`, `EXCLUDED_COLLECTION` (`config.ts`), `LonLat` (`geo.ts`).
- Produces: `type Candidate = { pageId: number; subject: LonLat }`;
  `buildCandidatesQuery(region: Region): string`;
  `parseCandidates(json: unknown): Candidate[]`;
  `fetchCandidates(region: Region, signal?: AbortSignal): Promise<Candidate[]>` (throws `Error` with the HTTP status on a non-OK response).

- [ ] **Step 1: Write the failing tests:**

```ts
it('builds the query for a region', () => {
  const q = buildCandidatesQuery(REGIONS[0])
  expect(q).toContain('wdt:P9149')
  expect(q).toContain('FILTER NOT EXISTS { ?m wdt:P1259 ?x }')
  expect(q).toContain('Q685592')
  expect(q).toContain('8.66')
  expect(q).toContain('ORDER BY RAND()')
  expect(q).toContain(`LIMIT ${REGIONS[0].limit}`)
})
it('parses bindings into candidates and skips non-point values', () => {
  const json = { results: { bindings: [
    { m: { value: 'https://commons.wikimedia.org/entity/M19413018' }, c: { value: 'POINT(8.763100 47.504700)' } },
    { m: { value: 'https://commons.wikimedia.org/entity/M5' }, c: { value: 'POLYGON((1 2,3 4,5 6,1 2))' } },
  ] } }
  expect(parseCandidates(json)).toEqual([{ pageId: 19413018, subject: { lon: 8.7631, lat: 47.5047 } }])
  expect(parseCandidates({ results: { bindings: [] } })).toEqual([])
})
```

- [ ] **Step 2: Run `npx vitest run src/candidates.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** The query selects `?m ?c`, takes longitude and latitude from the WKT with `STRBEFORE`/`STRAFTER` as in `docs/qlever-commons.md`, and filters on the region box. `fetchCandidates` GETs the endpoint with `Accept: application/sparql-results+json`.
- [ ] **Step 4: Run `npx vitest run`.** Expected: pass.
- [ ] **Step 5: Verify against the live endpoint** with a throwaway script run by `npx tsx` or in the browser console: `fetchCandidates(REGIONS[0])` returns between 1 and 100 candidates in about 4 seconds.
- [ ] **Step 6: Commit** `git commit -m "Add candidate query for the photo picker"` (add both files).

### Task 3: Commons file info

**Files:**
- Create: `viewer/src/commons.ts`, `viewer/src/commons.test.ts`

**Interfaces:**
- Produces: `type FileInfo = { title: string; thumbUrl: string | null }`;
  `buildFileInfoUrl(pageIds: number[], thumbWidth: number): string` (at most 50 ids);
  `parseFileInfo(json: unknown): Map<number, FileInfo>` (title without the `File:` prefix; a missing page or one without `imageinfo` is simply absent from the map);
  `fetchFileInfo(pageIds: number[]): Promise<Map<number, FileInfo>>` (batches of 50);
  `commonsPageUrl(title: string): string`; `commonsImageUrl(title: string, width: number): string` (via `Special:FilePath`).

- [ ] **Step 1: Write the failing tests:**

```ts
it('builds a pageids query', () => {
  const u = new URL(buildFileInfoUrl([1, 2], 120))
  expect(u.searchParams.get('pageids')).toBe('1|2')
  expect(u.searchParams.get('origin')).toBe('*')
  expect(u.searchParams.get('iiurlwidth')).toBe('120')
})
it('parses titles and thumbnails, tolerating missing pages', () => {
  const json = { query: { pages: {
    '1': { pageid: 1, title: 'File:A & B.jpg', imageinfo: [{ thumburl: 'https://t/1.jpg' }] },
    '2': { pageid: 2, title: 'File:C.jpg', imageinfo: [{}] },
    '3': { pageid: 3, title: 'File:D.jpg' },
    '-1': { missing: '' },
  } } }
  const m = parseFileInfo(json)
  expect(m.get(1)).toEqual({ title: 'A & B.jpg', thumbUrl: 'https://t/1.jpg' })
  expect(m.get(2)).toEqual({ title: 'C.jpg', thumbUrl: null })
  expect(m.get(3)).toEqual({ title: 'D.jpg', thumbUrl: null })
  expect(m.size).toBe(3)
})
it('builds Commons URLs with underscores and encoding', () => {
  expect(commonsPageUrl('A & B.jpg')).toBe('https://commons.wikimedia.org/wiki/File:A_%26_B.jpg')
})
```

- [ ] **Step 2: Run `npx vitest run src/commons.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** The request is `action=query&prop=imageinfo&iiprop=url&iiurlwidth=<w>&format=json&origin=*`.
- [ ] **Step 4: Run `npx vitest run`.** Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Add Commons file info lookup"`.

### Task 4: Picker screen and app shell

**Files:**
- Create: `viewer/src/pickerScreen.ts`, `viewer/src/listStatus.ts`, `viewer/src/listStatus.test.ts`
- Modify: `viewer/src/main.ts` (replace the prototype; the adjust screen arrives in Task 5), `viewer/src/style.css`, `viewer/package.json` (`leaflet`, `@types/leaflet`)

**Interfaces:**
- Consumes: `REGIONS`, `fetchCandidates`, `fetchFileInfo`, `Candidate`, `FileInfo`.
- Produces: `type PickedPhoto = Candidate & { title: string }`;
  `mountPicker(root: HTMLElement, onPick: (photo: PickedPhoto) => void): () => void` (returns a dispose function);
  `listStatus(state: 'loading' | { error: string } | Candidate[]): string`.
  `main.ts` owns `showPicker()` and `showAdjust(photo: PickedPhoto)`; Task 5 supplies `mountAdjust`.

- [ ] **Step 1: Write the failing test** in `listStatus.test.ts`:

```ts
expect(listStatus('loading')).toBe('Loading photos…')
expect(listStatus([])).toBe('No photos found in this region.')
expect(listStatus([{ pageId: 1, subject: { lon: 8, lat: 47 } }])).toBe('1 photo')
expect(listStatus({ error: 'HTTP 429' })).toBe('Could not load photos: HTTP 429. Try again.')
```

- [ ] **Step 2: Run `npx vitest run src/listStatus.test.ts`.** Expected: FAIL. Implement `listStatus` (plural `N photos`); expected: pass.
- [ ] **Step 3: Implement `mountPicker`.** Layout from the spec: left, a region dropdown (Winterthur default), the status text, a Shuffle button (re-runs the query) and rows of thumbnail plus title; right, a Leaflet map with swisstopo grey tiles (`https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg`) and one dot per subject. Rows render as soon as candidates arrive, then fill in titles and thumbnails as each 50-id batch of `fetchFileInfo` returns. A row without file info shows the page id and a grey placeholder. Titles go in with `textContent`, never `innerHTML`. On a failed request show the error and a Retry button. Clicking a row or dot calls `onPick`.
- [ ] **Step 4: Verify by hand** with `npm run dev`:
  - Winterthur opens by default and shows up to 100 rows with dots on the map.
  - Switching to Zürich shows rows (up to 600), switching to Switzerland shows 40.
  - With DevTools Network set to Offline, switching region shows "Could not load photos: …" and a Retry button; after going Online, Retry loads the list.
  - A row whose title contains `&` displays it literally.
- [ ] **Step 5: Run `npx vitest run` and `npx tsc --noEmit`.** Expected: pass, no errors.
- [ ] **Step 6: Commit** `git commit -m "Add the photo picker screen"`.

### Task 5: Adjust screen — 3D scene and photo overlay

**Files:**
- Create: `viewer/src/adjustScreen.ts`, `viewer/src/poseStore.ts`, `viewer/src/poseStore.test.ts`
- Modify: `viewer/src/main.ts`, `viewer/src/style.css`

**Interfaces:**
- Consumes: `PickedPhoto`, `walk`, `bearingDeg`, `resolveGroundHeight`, `EYE_HEIGHT_M`, `SWISSTOPO_*`, `commonsImageUrl`.
- Produces (`poseStore.ts`): `type CameraPose = { position: LonLat; heightAboveGroundM: number; headingDeg: number; pitchDeg: number; fovDeg: number }`;
  `createPoseStore(initial: CameraPose): { get(): CameraPose; set(patch: Partial<CameraPose>): void; reset(): void; isDirty(): boolean; subscribe(fn: (pose: CameraPose) => void): () => void }` (`set` normalises `headingDeg` to [0, 360) and clamps `pitchDeg` to [-89, 89] and `fovDeg` to [10, 120]).
  Also exports `type PoseStore = ReturnType<typeof createPoseStore>`.
- Produces (`adjustScreen.ts`): `mountAdjust(root: HTMLElement, photo: PickedPhoto, onBack: () => void): Promise<{ dispose(): void; store: PoseStore; viewer: Cesium.Viewer; photoImg: HTMLImageElement }>`.

- [ ] **Step 1: Write the failing tests** for the store: `set({ headingDeg: -1 })` gives 359; `set({ pitchDeg: 120 })` gives 89; `isDirty()` is false at start, true after a change, false after `reset()`; a subscriber is called once per `set` and stops after unsubscribing.
- [ ] **Step 2: Run `npx vitest run src/poseStore.test.ts`.** Expected: FAIL. Implement the store; expected: pass.
- [ ] **Step 3: Implement `mountAdjust`.** Creates a Cesium viewer in the left area with swisstopo terrain and buildings (as in the prototype), `animation` and `timeline` off. Draws the cyan subject marker at the `P9149` position. Samples ground height at the subject with `sampleTerrainMostDetailed`; if `resolveGroundHeight` gives `null`, show a banner "No 3D data here: this photo is outside the swisstopo coverage." and do not fly there. The start pose is 30 m south of the subject (`walk` with heading 0), heading `bearingDeg` towards the subject, pitch 0, height `EYE_HEIGHT_M`, field of view 60°. A store subscriber applies the pose with `camera.setView` (height = ground + `heightAboveGroundM`) and sets `camera.frustum.fov`. The photo is an `<img>` using `commonsImageUrl(title, 1600)`, `object-fit: contain`, `pointer-events: none`, over the 3D view; opacity starts at 50%.
- [ ] **Step 4: Wire `main.ts`** so picking a row calls `showAdjust`, with a "← Back to list" button that calls `dispose()` and shows the picker again.
- [ ] **Step 5: Verify by hand.** Pick a Winterthur photo: buildings and terrain load, the cyan marker sits on the ground, the photo is faded over the 3D view and the camera faces the marker. Pick a photo near the border (use the Switzerland region and look for one outside Switzerland) and confirm the warning appears.
- [ ] **Step 6: Run `npx vitest run` and `npx tsc --noEmit`.** Expected: pass.
- [ ] **Step 7: Commit** `git commit -m "Add the adjust screen with 3D scene and photo overlay"`.

### Task 6: Camera controls and panel

**Files:**
- Create: `viewer/src/cameraControls.ts`, `viewer/src/panel.ts`
- Modify: `viewer/src/adjustScreen.ts`, `viewer/src/style.css`

**Interfaces:**
- Consumes: `createPoseStore`, `walk`, `offsetByMeters`, `normalizeDegrees`.
- Produces: `attachCameraControls(viewer: Cesium.Viewer, store: PoseStore): () => void` (returns a detach function; drag looks around, arrow keys or WASD walk at 2 m/s while held, wheel changes `fovDeg`);
  `mountPanel(root: HTMLElement, store: PoseStore, photoImg: HTMLImageElement): void` (right panel with sliders and a minimise button; Task 7 adds the result box).
- `adjustScreen.ts` calls both after the scene is ready and calls the detach function in `dispose()`.

- [ ] **Step 1: Implement `attachCameraControls`.** Disable Cesium's own camera inputs with `viewer.scene.screenSpaceCameraController.enableInputs = false`. Left-drag changes `headingDeg` and `pitchDeg` (0.1° per pixel). Walking uses `walk(position, headingDeg, forward, right)`. Ground height is re-sampled, throttled to 5 times a second, after position changes; until a sample returns, keep the last ground height.
- [ ] **Step 2: Implement `mountPanel`.** Sliders: photo opacity 0–100%, east–west ±100 m and north–south ±100 m (both relative to the start pose, applied with `offsetByMeters`), height above ground 0–50 m (step 0.1, start 1.6), heading 0–359°, field of view 10–120°. Each slider writes to the store and each store change updates the sliders, so dragging the mouse moves the sliders. A "–" button minimises the panel to a thin tab so the 3D view fills the window; clicking the tab restores it.
- [ ] **Step 3: Verify by hand.** Drag looks around smoothly; W moves towards where you look and the E–W/N–S sliders follow; moving a slider moves the camera; the height slider lifts the camera above the ground; the panel minimises and restores and the 3D view resizes; heading never reads below 0 or 360 while dragging a full circle.
- [ ] **Step 4: Run `npx tsc --noEmit`.** Expected: no errors. Commit `git commit -m "Add camera controls and the adjust panel"`.

### Task 7: Result box, copy and leave warning

**Files:**
- Modify: `viewer/src/panel.ts`, `viewer/src/adjustScreen.ts`, `viewer/src/main.ts`

**Interfaces:**
- Consumes: `formatResult`, `store.isDirty`.
- Produces: a result box in the panel showing `P1259: <lat>, <lon>`, `P7787: <deg> (circa)`, a "Copy values" button (writes `formatResult(...).text` to the clipboard), and a link "Open on Commons" (`commonsPageUrl`). Leaving with unsaved changes asks `window.confirm('Discard your adjustments?')`; a `beforeunload` handler warns the same way while `isDirty()` is true.

- [ ] **Step 1: Implement the result box**, updated on every store change.
- [ ] **Step 2: Implement the leave warning** for the Back button and for closing the tab.
- [ ] **Step 3: Verify by hand.** The numbers change as you move; Copy puts `P1259: …` and `P7787: … (circa)` on the clipboard (paste it somewhere); Back with no changes goes straight to the list; Back after moving asks for confirmation and Cancel keeps you on the screen.
- [ ] **Step 4: Check against the known photo.** Open the Escher file (M155155057; it has `P1259` so it is not in the picker, so temporarily call `showAdjust` with its page id 155155057 and subject 8.539965, 47.377135) and confirm you can line it up with the buildings and that the result lands near the stored `47.3769854, 8.5399621`. Remove the temporary call.
- [ ] **Step 5: Run `npx vitest run`, `npx tsc --noEmit`.** Commit `git commit -m "Add the result box and the leave warning"`.

### Task 8: Publish on GitHub Pages

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md` (one short section: what the viewer is, how to run it, `.env.local` token)

- [ ] **Step 1: Write the workflow.** On push to `main`: `actions/checkout`, `actions/setup-node` (Node 24), `npm ci` in `viewer/`, `npm run build` with `VITE_BASE=/wiki-qlever/` and `VITE_CESIUM_ION_TOKEN: ${{ secrets.VITE_CESIUM_ION_TOKEN }}`, then `actions/upload-pages-artifact` (path `viewer/dist`) and `actions/deploy-pages`. Permissions `pages: write`, `id-token: write`.
- [ ] **Step 2: Tell the user** to add the repository secret `VITE_CESIUM_ION_TOKEN` and set Pages source to "GitHub Actions". The Pages domain is already in the token's allowed URLs.
- [ ] **Step 3: Verify locally** with `VITE_BASE=/wiki-qlever/ npm run build && npx vite preview`; open `http://localhost:4173/wiki-qlever/` and confirm the picker loads and the Cesium assets resolve (no 404 in the Network tab for `/wiki-qlever/cesium/...`).
- [ ] **Step 4: After the first deploy**, open `https://nbtkmy.github.io/wiki-qlever/` and repeat the Task 5 hand check.
- [ ] **Step 5: Commit** `git commit -m "Publish the viewer on GitHub Pages"`.
