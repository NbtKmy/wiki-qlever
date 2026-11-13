import { defineConfig } from 'vitest/config'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// VITE_BASE is set for GitHub Pages builds, e.g. "/wiki-qlever/".
const base = process.env.VITE_BASE ?? '/'
const cesiumSource = 'node_modules/cesium/Build/Cesium'

export default defineConfig({
  base,
  define: {
    // Tells CesiumJS where to load Workers, Assets, Widgets and ThirdParty from.
    CESIUM_BASE_URL: JSON.stringify(`${base}cesium`),
  },
  test: { environment: 'node' },
  build: {
    // Two pages: the camera position viewer and the depicts review.
    rollupOptions: { input: { main: 'index.html', review: 'review.html' } },
  },
  plugins: [
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((dir) => ({
        src: `${cesiumSource}/${dir}`,
        dest: 'cesium',
        // Drop "node_modules/cesium/Build/Cesium" so files land in /cesium/<dir>/.
        rename: { stripBase: 4 },
      })),
    }),
  ],
})
