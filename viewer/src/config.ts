export type Region = {
  id: string
  label: string
  bbox: { west: number; south: number; east: number; north: number }
  limit: number
}

// Rough latitude/longitude boxes. The Swiss box also catches border areas of neighbouring countries.
export const REGIONS: Region[] = [
  { id: 'winterthur', label: 'Winterthur', bbox: { west: 8.66, south: 47.45, east: 8.82, north: 47.56 }, limit: 100 },
  { id: 'zurich', label: 'Zürich', bbox: { west: 8.45, south: 47.32, east: 8.62, north: 47.44 }, limit: 600 },
  { id: 'switzerland', label: 'Switzerland (random sample)', bbox: { west: 5.95, south: 45.8, east: 10.5, north: 47.85 }, limit: 40 },
]

// Federal Office of Topography: may be aerial photos, which do not suit this tool.
export const EXCLUDED_COLLECTION = 'Q685592'

export const EYE_HEIGHT_M = 1.6

// swisstopo terrain and buildings share one height reference. Do not mix in Cesium World Terrain.
export const SWISSTOPO_BUILDINGS_URL =
  'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json'
export const SWISSTOPO_TERRAIN_URL = 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1'
