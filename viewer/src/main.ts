import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'

Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN

// Values of https://commons.wikimedia.org/wiki/File:Zentralbibliothek_Z%C3%BCrich_-_Escherdenkmal_-_991028231679705501.jpg
// (M155155057), copied by hand for now. Later they come from a QLever query.
const photo = {
  fileName: 'Zentralbibliothek_Zürich_-_Escherdenkmal_-_991028231679705501.jpg',
  camera: { lon: 8.5399621, lat: 47.3769854 }, // P1259
  headingDeg: 0, // P7787 (qualifier of P1259), marked "circa" by P1480
  subject: { lon: 8.539965, lat: 47.377135 }, // P9149
}
const headingUncertaintyDeg = 15 // heading is only approximate (circa)
const eyeHeight = 1.6 // metres above ground, assumed

// swisstopo terrain, so that terrain and swissBUILDINGS3D share one height reference.
const terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
  'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1',
)

const viewer = new Cesium.Viewer('app', {
  terrainProvider,
  animation: false,
  timeline: false,
})

// swissBUILDINGS3D from swisstopo (3D Tiles, no token needed).
// https://docs.geo.admin.ch/visualize-data/3d-tiles.html
viewer.scene.primitives.add(
  await Cesium.Cesium3DTileset.fromUrl(
    'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json',
  ),
)

const [cameraGround, subjectGround] = await Cesium.sampleTerrainMostDetailed(
  terrainProvider,
  [photo.camera, photo.subject].map((p) =>
    Cesium.Cartographic.fromDegrees(p.lon, p.lat),
  ),
)
console.log('terrain height [m] camera / subject:', cameraGround.height, subjectGround.height)
const cameraPosition = Cesium.Cartesian3.fromRadians(
  cameraGround.longitude,
  cameraGround.latitude,
  cameraGround.height + eyeHeight,
)
const subjectPosition = Cesium.Cartesian3.fromRadians(
  subjectGround.longitude,
  subjectGround.latitude,
  subjectGround.height,
)

// Sector in front of the camera, to show the approximate viewing direction.
function sector(
  origin: Cesium.Cartesian3,
  headingDeg: number,
  halfWidthDeg: number,
  radius: number,
): Cesium.Cartesian3[] {
  const toWorld = Cesium.Transforms.eastNorthUpToFixedFrame(origin)
  const points = [origin]
  for (let a = -halfWidthDeg; a <= halfWidthDeg; a += 3) {
    const h = Cesium.Math.toRadians(headingDeg + a)
    const local = new Cesium.Cartesian3(
      Math.sin(h) * radius, // east
      Math.cos(h) * radius, // north
      0,
    )
    points.push(Cesium.Matrix4.multiplyByPoint(toWorld, local, new Cesium.Cartesian3()))
  }
  return points
}

const thumbnail = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(photo.fileName)}?width=400`
const commonsPage = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(photo.fileName)}`

viewer.entities.add({
  name: 'Camera position (P1259)',
  position: cameraPosition,
  point: { pixelSize: 12, color: Cesium.Color.ORANGE, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
  description: `<a href="${commonsPage}" target="_blank"><img src="${thumbnail}" style="width:100%"></a>
    <p>heading ${photo.headingDeg}° (circa)</p>`,
})
viewer.entities.add({
  name: 'Depicted place (P9149)',
  position: subjectPosition,
  point: { pixelSize: 10, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
})
viewer.entities.add({
  name: 'Line of sight',
  polyline: {
    positions: [cameraPosition, subjectPosition],
    width: 2,
    material: Cesium.Color.YELLOW,
  },
})
viewer.entities.add({
  name: 'Viewing direction (heading ± uncertainty)',
  polygon: {
    hierarchy: sector(cameraPosition, photo.headingDeg, headingUncertaintyDeg, 40),
    perPositionHeight: true,
    material: Cesium.Color.ORANGE.withAlpha(0.35),
  },
})

const overview = {
  // ~130 m south of the camera and 90 m above the ground (heights are above the ellipsoid).
  destination: Cesium.Cartesian3.fromDegrees(
    photo.camera.lon,
    photo.camera.lat - 0.00117,
    cameraGround.height + 90,
  ),
  orientation: {
    heading: Cesium.Math.toRadians(photo.headingDeg),
    pitch: Cesium.Math.toRadians(-35),
    roll: 0,
  },
}
const photoView = {
  destination: cameraPosition,
  orientation: {
    heading: Cesium.Math.toRadians(photo.headingDeg),
    pitch: 0,
    roll: 0,
  },
}

viewer.camera.setView(overview)

// Two buttons: jump into the photographer's position, and back out.
const bar = document.createElement('div')
bar.className = 'toolbar'
for (const [label, view] of [['Photo view', photoView], ['Overview', overview]] as const) {
  const button = document.createElement('button')
  button.textContent = label
  button.onclick = () => viewer.camera.flyTo({ ...view, duration: 2 })
  bar.append(button)
}
document.body.append(bar)
