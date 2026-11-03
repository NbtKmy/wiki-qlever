# Camera position viewer

A browser tool for finding where a Wikimedia Commons photo was taken. It lists photos that have a depicted-place geocode (`P9149`) but no camera position (`P1259`), shows one photo faded over swisstopo 3D buildings, and lets you move a virtual camera until the two line up. The panel then shows `P1259` and `P7787` (heading, always "circa") to type into Commons by hand.

Design: [`../docs/superpowers/specs/2026-11-03-camera-correction-tool-design.md`](../docs/superpowers/specs/2026-11-03-camera-correction-tool-design.md)

## Run it

```bash
cd viewer
npm install
echo 'VITE_CESIUM_ION_TOKEN=<your Cesium ion token>' > .env.local
npm run dev        # http://localhost:5173
npm test           # unit tests
```

The Cesium ion token is only used for the satellite imagery. It ends up in the published JavaScript, so treat it as public: give it the `assets:read` scope only and restrict its allowed URLs. Create it at <https://ion.cesium.com>, and allow `http://localhost:5173` and the GitHub Pages domain as URLs. `.env.local` is git-ignored.

## Controls

- Drag: look around. Arrow keys or WASD: walk. Wheel: field of view.
- Panel sliders: fine tuning (photo opacity, east–west, north–south, height above ground, heading, field of view). The "–" button minimises the panel.

## Publish

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/pages.yml`). Once per repository: add the secret `VITE_CESIUM_ION_TOKEN` and set Pages source to "GitHub Actions".
