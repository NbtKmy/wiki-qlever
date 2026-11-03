import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { attachCameraControls } from './cameraControls'
import { commonsImageUrl } from './commons'
import { EYE_HEIGHT_M, SWISSTOPO_BUILDINGS_URL, SWISSTOPO_TERRAIN_URL } from './config'
import { bearingDeg, resolveGroundHeight, walk, type LonLat } from './geo'
import { mountPanel } from './panel'
import type { PickedPhoto } from './pickerScreen'
import { createPoseStore, type CameraPose, type PoseStore } from './poseStore'

Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN

const START_DISTANCE_M = 30
const PHOTO_WIDTH_PX = 1600

export type AdjustHandle = {
  dispose(): void
  store: PoseStore
  viewer: Cesium.Viewer
  photoImg: HTMLImageElement
  /** Ground height (above the ellipsoid) under the camera; updated by the camera controls. */
  ground: { heightM: number }
  /** Terrain height at a position, or null when swisstopo has no data there. */
  sampleGround(position: LonLat): Promise<number | null>
  /** False when the subject is outside the swisstopo coverage; the camera is then not controllable. */
  hasCoverage: boolean
}

export async function mountAdjust(
  root: HTMLElement,
  photo: PickedPhoto,
  onBack: () => void,
): Promise<AdjustHandle> {
  const view = document.createElement('div')
  view.className = 'adjust-view'
  const cesiumEl = document.createElement('div')
  cesiumEl.className = 'adjust-cesium'
  const photoImg = document.createElement('img')
  photoImg.className = 'adjust-photo'
  photoImg.alt = ''
  photoImg.src = commonsImageUrl(photo.title, PHOTO_WIDTH_PX)
  photoImg.style.opacity = '0.5'
  const toolbar = document.createElement('div')
  toolbar.className = 'toolbar'
  const back = document.createElement('button')
  back.textContent = '← Back to list'
  back.onclick = onBack
  toolbar.append(back)
  view.append(cesiumEl, photoImg, toolbar)
  const adjust = document.createElement('div')
  adjust.className = 'adjust'
  adjust.append(view)
  root.replaceChildren(adjust)

  const terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(SWISSTOPO_TERRAIN_URL)
  const viewer = new Cesium.Viewer(cesiumEl, {
    terrainProvider,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  })
  viewer.scene.primitives.add(await Cesium.Cesium3DTileset.fromUrl(SWISSTOPO_BUILDINGS_URL))

  const sampleGround = async (position: LonLat): Promise<number | null> => {
    const [sampled] = await Cesium.sampleTerrainMostDetailed(terrainProvider, [
      Cesium.Cartographic.fromDegrees(position.lon, position.lat),
    ])
    return resolveGroundHeight(sampled?.height)
  }

  const start: LonLat = walk(photo.subject, 0, -START_DISTANCE_M, 0)
  const subjectGround = await sampleGround(photo.subject)
  const startGround = await sampleGround(start)
  const hasCoverage = subjectGround !== null
  const ground = { heightM: startGround ?? subjectGround ?? 0 }

  const initial: CameraPose = {
    position: start,
    heightAboveGroundM: EYE_HEIGHT_M,
    headingDeg: bearingDeg(start, photo.subject),
    pitchDeg: 0,
    fovDeg: 60,
  }
  const store = createPoseStore(initial)

  let detachControls = () => {}
  if (hasCoverage) {
    viewer.entities.add({
      name: 'Depicted place (P9149)',
      position: Cesium.Cartesian3.fromDegrees(photo.subject.lon, photo.subject.lat, subjectGround),
      point: { pixelSize: 10, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    })
    const applyPose = (pose: CameraPose) => {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          pose.position.lon,
          pose.position.lat,
          ground.heightM + pose.heightAboveGroundM,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(pose.headingDeg),
          pitch: Cesium.Math.toRadians(pose.pitchDeg),
          roll: 0,
        },
      })
      ;(viewer.camera.frustum as Cesium.PerspectiveFrustum).fov = Cesium.Math.toRadians(pose.fovDeg)
    }
    store.subscribe(applyPose)
    applyPose(store.get())
    mountPanel(adjust, store, photoImg)
    detachControls = attachCameraControls({ viewer, store, ground, sampleGround })
  } else {
    const banner = document.createElement('div')
    banner.className = 'adjust-banner'
    banner.textContent = 'No 3D data here: this photo is outside the swisstopo coverage.'
    view.append(banner)
  }

  return {
    dispose() {
      detachControls()
      viewer.destroy()
      root.replaceChildren()
    },
    store,
    viewer,
    photoImg,
    ground,
    sampleGround,
    hasCoverage,
  }
}
