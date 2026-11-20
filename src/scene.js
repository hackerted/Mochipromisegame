import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildAuditionStage } from './audition-stage.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const sooAhStandSpeed = 4;
const sooAhSitSpeed = 2;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

async function gltf(loader, url) {
  return loader.loadAsync(url);
}

async function loadGltfClip(loader, url) {
  const asset = await loader.loadAsync(url);
  return asset.animations?.[0]?.clone();
}

function disposeFbxAsset(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

async function loadFbxClip(loader, url) {
  const root = await loader.loadAsync(url);
  const clip = root.animations?.[0]?.clone();
  disposeFbxAsset(root);
  return clip;
}

// Animation-only clips pre-extracted from the FBX files (assets/clips): same tracks, no 40 MB mesh.
async function loadJsonClip(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return THREE.AnimationClip.parse(await response.json());
}

function fitToHeight(root, height) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(height / Math.max(size.y, 0.001));
  root.updateMatrixWorld(true);
  root.position.y -= new THREE.Box3().setFromObject(root).min.y;
}

function applyCharacterTexture(root, texture, maxAnisotropy, flipY = false) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = flipY;
  texture.anisotropy = Math.min(16, maxAnisotropy);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  root.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const replacements = materials.map((source) => new THREE.MeshStandardMaterial({
      color: '#ffffff', map: texture, roughness: 0.78, metalness: 0,
      side: source.side, transparent: source.transparent, opacity: source.opacity,
    }));
    node.material = Array.isArray(node.material) ? replacements : replacements[0];
  });
}

function setShadows(root, receive = true) {
  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = receive;
    }
  });
}

function inPlaceWalk(clip) {
  if (!clip) return clip;
  const adjusted = clip.clone();
  adjusted.tracks = adjusted.tracks.filter((track) => {
    const name = track.name.toLowerCase();
    const [node, property] = name.split('.');
    const bone = node.replace(/[^a-z]/g, '');
    if (bone.endsWith('mixamorighips')) return false;
    if (property === 'quaternion' && /mixamorig(spine|spine1|spine2|neck|head|headtopend)$/.test(bone)) return false;
    return true;
  });
  return adjusted;
}

function inPlaceSit(clip, verticalOffset = 0) {
  if (!clip) return clip;
  const adjusted = clip.clone();
  for (const track of adjusted.tracks) {
    if (!track.name.toLowerCase().endsWith('.position')
      || !track.name.slice(0, -'.position'.length).toLowerCase().replace(/[^a-z]/g, '').endsWith('mixamorighips')) continue;
    const x = track.values[0];
    const y = track.values[1];
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = x;
      track.values[i + 1] = y;
      track.values[i + 2] += verticalOffset;
    }
  }
  return adjusted;
}

function inPlaceStandTransition(clip, verticalOffset = 0, keepHipsPosition = true) {
  if (!clip) return clip;
  const adjusted = clip.clone();
  if (!keepHipsPosition) {
    adjusted.tracks = adjusted.tracks.filter((track) => !track.name.toLowerCase().endsWith('.position')
      || !track.name.slice(0, -'.position'.length).toLowerCase().replace(/[^a-z]/g, '').endsWith('mixamorighips'));
  }
  for (const track of adjusted.tracks) {
    if (!track.name.toLowerCase().endsWith('.position')
      || !track.name.slice(0, -'.position'.length).toLowerCase().replace(/[^a-z]/g, '').endsWith('mixamorighips')) continue;
    const x = track.values[0];
    const z = track.values[2];
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = x;
      track.values[i + 1] += verticalOffset;
      track.values[i + 2] = z;
    }
  }
  return adjusted;
}

function makeStandingIdle(THREE, sourceClip) {
  if (!sourceClip) return null;
  const duration = 3.2;
  const times = new Float32Array([0, duration / 2, duration]);
  const tracks = sourceClip.tracks.map((track) => {
    const pose = Array.from(track.createInterpolant().evaluate(sourceClip.duration));
    const values = new Float32Array(pose.length * times.length);
    values.set(pose);
    values.set(pose, pose.length * 2);
    if (track.name.toLowerCase().includes('spine') && track.name.endsWith('.quaternion') && pose.length === 4) {
      const breathing = new THREE.Quaternion().fromArray(pose)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.015));
      values.set(breathing.toArray(), pose.length);
    } else {
      values.set(pose, pose.length);
    }
    return new track.constructor(track.name, times, values);
  });
  return new THREE.AnimationClip('TedStandingIdle', duration, tracks);
}

function inPlaceSitDown(clip) {
  if (!clip) return clip;
  const adjusted = clip.clone();
  for (const track of adjusted.tracks) {
    if (!track.name.toLowerCase().endsWith('.position')
      || !track.name.slice(0, -'.position'.length).toLowerCase().replace(/[^a-z]/g, '').endsWith('mixamorighips')) continue;
    // Pin X and Z to the standing pose: the raw clip dives the hips back into the bench and the
    // seated idle then snaps them forward. Keeping depth fixed lowers her straight onto the seat.
    const x = track.values[0];
    const z = track.values[2];
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = x;
      track.values[i + 2] = z;
    }
  }
  return adjusted;
}

function inPlaceFbxWalk(clip) {
  if (!clip) return clip;
  const adjusted = clip.clone();
  adjusted.tracks = adjusted.tracks.filter((track) => {
    const name = track.name.toLowerCase();
    if (!name.endsWith('.position')) return true;
    return !name.slice(0, -'.position'.length).replace(/[^a-z]/g, '').endsWith('mixamorighips');
  });
  return adjusted;
}

// Mirror a Mixamo clip left↔right: swap Left/Right bone tracks and reflect across the X axis
// (quaternion y,z and position x flip sign). Relies on the rig's symmetric bind pose.
function mirrorClip(clip) {
  if (!clip) return clip;
  const mirrored = clip.clone();
  for (const track of mirrored.tracks) {
    const [node, property] = track.name.split('.');
    track.name = `${node.replace(/Left|Right/g, (side) => (side === 'Left' ? 'Right' : 'Left'))}.${property}`;
    const values = track.values;
    if (property === 'quaternion') {
      for (let i = 0; i < values.length; i += 4) {
        values[i + 1] = -values[i + 1];
        values[i + 2] = -values[i + 2];
      }
    } else if (property === 'position') {
      for (let i = 0; i < values.length; i += 3) values[i] = -values[i];
    }
  }
  return mirrored;
}

function inPlaceTurn(clip, standingIdle = null) {
  if (!clip) return clip;
  const adjusted = clip.clone();
  // The controller owns pelvis yaw; hold the standing height so turns do not fall back to bind pose.
  adjusted.tracks = adjusted.tracks.filter((track) =>
    !track.name.toLowerCase().split('.')[0].replace(/[^a-z]/g, '').endsWith('mixamorighips'));
  const hipsPosition = standingIdle?.tracks.find((track) => track.name.toLowerCase().endsWith('.position')
    && track.name.slice(0, -'.position'.length).toLowerCase().replace(/[^a-z]/g, '').endsWith('mixamorighips'));
  if (hipsPosition) {
    const size = hipsPosition.getValueSize();
    const pose = hipsPosition.values.slice(hipsPosition.values.length - size);
    adjusted.tracks.push(new THREE.VectorKeyframeTrack(
      hipsPosition.name,
      new Float32Array([0, adjusted.duration]),
      new Float32Array([...pose, ...pose]),
    ));
  }
  return adjusted;
}

function measuredTurnAngle(clip) {
  const track = clip?.tracks.find((item) => {
    const name = item.name.toLowerCase();
    return name.endsWith('.quaternion')
      && name.slice(0, -'.quaternion'.length).replace(/[^a-z]/g, '').endsWith('mixamorighips');
  });
  if (!track || track.getValueSize() !== 4) return Math.PI / 2;
  const size = track.getValueSize();
  const start = new THREE.Quaternion().fromArray(track.values.slice(0, size));
  const end = new THREE.Quaternion().fromArray(track.values.slice(-size));
  const delta = start.invert().multiply(end);
  const yaw = new THREE.Euler().setFromQuaternion(delta, 'YXZ').y;
  return Math.max(0.2, Math.abs(yaw));
}

export async function createScene({ THREE: T = THREE, renderer, loaders = {} }) {
  const scene = new T.Scene();
  scene.background = new T.Color('#d9e9f2');
  scene.fog = new T.Fog('#d9e9f2', 45, 160);
  const auditionScene = new T.Scene();
  auditionScene.background = new T.Color('#111a2c');
  auditionScene.fog = new T.Fog('#111a2c', 35, 90);
  const schoolScene = new T.Scene();
  schoolScene.background = new T.Color('#d9e9f2');
  schoolScene.fog = new T.Fog('#d9e9f2', 55, 180);
  schoolScene.add(new T.HemisphereLight('#fff7e8', '#716b60', 2));
  const schoolSun = new T.DirectionalLight('#fff1db', 2.2);
  schoolSun.position.set(-5, 10, 8);
  schoolScene.add(schoolSun);
  const familyScene = new T.Scene();
  familyScene.background = new T.Color('#d9e9f2');
  familyScene.fog = new T.Fog('#d9e9f2', 55, 180);
  familyScene.add(new T.HemisphereLight('#fff7e8', '#716b60', 2));
  const familySun = new T.DirectionalLight('#fff1db', 2.2);
  familySun.position.set(-5, 10, 8);
  familyScene.add(familySun);
  const { root: auditionStage, figure: tedAuditionFigure } = buildAuditionStage(T);
  auditionStage.position.set(0, 0, 0);
  auditionStage.visible = false;
  auditionScene.add(auditionStage);

  const hemi = new T.HemisphereLight('#fff5e9', '#77736c', 2.2);
  scene.add(hemi);
  const sun = new T.DirectionalLight('#fff4e6', 2.4);
  sun.position.set(-3, 5, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  scene.add(sun, sun.target); // the shadow box follows the player (see update)

  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = grassCanvas.height = 512;
  const grassContext = grassCanvas.getContext('2d');
  grassContext.fillStyle = '#9fbe72';
  grassContext.fillRect(0, 0, 512, 512);
  const grassTextureRandom = seededRandom(73);
  const grassStrokes = ['rgba(49, 104, 48, .16)', 'rgba(205, 220, 129, .22)', 'rgba(78, 132, 55, .2)'];
  for (let i = 0; i < 1500; i++) {
    const x = grassTextureRandom() * 512;
    const y = grassTextureRandom() * 512;
    grassContext.strokeStyle = grassStrokes[i % grassStrokes.length];
    grassContext.lineWidth = 1 + grassTextureRandom() * 1.5;
    grassContext.beginPath();
    grassContext.moveTo(x, y);
    grassContext.lineTo(x + (grassTextureRandom() - 0.5) * 3, y - 2 - grassTextureRandom() * 5);
    grassContext.stroke();
  }
  const grassTexture = new T.CanvasTexture(grassCanvas);
  grassTexture.colorSpace = T.SRGBColorSpace;
  grassTexture.wrapS = grassTexture.wrapT = T.RepeatWrapping;
  grassTexture.repeat.set(10, 10);
  grassTexture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  const parkHeightAt = (x, z) => {
    const distance = Math.hypot(x, z);
    const hill = T.MathUtils.smoothstep(distance, 52, 90);
    const waves = 1.5 + 0.45 * Math.sin(x * 0.19) + 0.35 * Math.cos(z * 0.22) + 0.2 * Math.sin((x + z) * 0.31);
    return -0.012 + hill * waves;
  };
  const groundGeometry = new T.PlaneGeometry(240, 240, 160, 160);
  const groundPositions = groundGeometry.attributes.position;
  const groundColors = new Float32Array(groundPositions.count * 3);
  const grassBase = new T.Color('#6f9f55');
  for (let i = 0; i < groundPositions.count; i++) {
    const x = groundPositions.getX(i);
    const z = -groundPositions.getY(i);
    groundPositions.setZ(i, parkHeightAt(x, z));
    const tint = 0.94 + 0.045 * Math.sin(x * 0.8) * Math.cos(z * 0.67) + 0.02 * Math.sin((x - z) * 1.4);
    const color = grassBase.clone().multiplyScalar(tint);
    groundColors[i * 3] = color.r;
    groundColors[i * 3 + 1] = color.g;
    groundColors[i * 3 + 2] = color.b;
  }
  groundGeometry.setAttribute('color', new T.Float32BufferAttribute(groundColors, 3));
  groundGeometry.computeVertexNormals();
  const floor = new T.Mesh(groundGeometry, new T.MeshStandardMaterial({ color: '#ffffff', map: grassTexture, vertexColors: true, roughness: 1 }));
  floor.name = 'ParkGrassTerrain';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);


  const gltfLoader = loaders.gltf ?? new GLTFLoader(loaders.manager);
  // Props in assets/props/opt are meshopt-compressed (WebP textures, max 2048 px).
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  const fbxLoader = new FBXLoader(loaders.manager);
  const textureLoader = new T.TextureLoader(loaders.manager);
  const [chairAsset, mrLeeAsset, tedAsset, sooAh, mrLeeTexture, tedTexture, sooAhTexture, cafeAsset, cherryTreeAsset, houseAsset, apartmentAsset, gateAsset, sakuraAsset, hydrantAsset, mochiAsset, mochiHeldAsset, mochiSkewerAsset, kiaCarAsset, mrLeeIdleClip, sooAhSittingClip, schoolAsset] = await Promise.all([
    gltf(gltfLoader, './assets/park-chair-stage.glb'),
    gltf(gltfLoader, './assets/mr-lee-model.glb').then((asset) => asset.scene),
    gltf(gltfLoader, './assets/ted-stage-lite.glb'),
    gltf(gltfLoader, './assets/soo-ah-model.glb').then((asset) => asset.scene),
    textureLoader.loadAsync('./assets/textures/mr-lee-2k.jpg'),
    textureLoader.loadAsync('./assets/textures/ted-2k.jpg'),
    textureLoader.loadAsync('./assets/textures/soo-ah-2k.jpg'),
    gltf(gltfLoader, './assets/props/opt/korean_cafe.glb'),
    gltf(gltfLoader, './assets/props/opt/cherry_tree.glb'),
    gltf(gltfLoader, './assets/props/opt/korean_house.glb'),
    gltf(gltfLoader, './assets/props/opt/korean_apartment.glb'),
    gltf(gltfLoader, './assets/props/opt/seoulgate.glb'),
    gltf(gltfLoader, './assets/props/opt/sakura_tree_01_-_low_poly_model.glb'),
    gltf(gltfLoader, './assets/props/korean_hydrant.glb'),
    gltf(gltfLoader, './assets/mochi.glb'),
    gltf(gltfLoader, './assets/mochi-held.glb'),
    gltf(gltfLoader, './assets/mochi-skewer-held.glb'),
    gltf(gltfLoader, './assets/cars/kia_forte_hatchback_2022.glb'),
    loadJsonClip('./assets/clips/MrLeeIdle.json'),
    loadJsonClip('./assets/clips/SooAhSitting.json'),
    gltf(gltfLoader, './assets/school/school_building/scene.gltf'),
  ]);
  const schoolMapZ = -40;
  const schoolGround = new T.Mesh(new T.PlaneGeometry(70, 70), new T.MeshStandardMaterial({ color: '#81915e', roughness: 1 }));
  schoolGround.name = 'SchoolGround';
  schoolGround.rotation.x = -Math.PI / 2;
  schoolGround.position.set(0, -0.035, schoolMapZ);
  schoolGround.receiveShadow = true;
  schoolScene.add(schoolGround);
  const schoolCourtyard = new T.Mesh(new T.PlaneGeometry(38, 30), new T.MeshStandardMaterial({ color: '#aaa99f', roughness: 0.95 }));
  schoolCourtyard.name = 'SchoolCourtyard';
  schoolCourtyard.rotation.x = -Math.PI / 2;
  schoolCourtyard.position.set(0, -0.02, schoolMapZ + 5);
  schoolCourtyard.receiveShadow = true;
  schoolScene.add(schoolCourtyard);
  const schoolBuilding = schoolAsset.scene;
  schoolBuilding.name = 'SeoulSchoolBuilding';
  const schoolBounds = new T.Box3().setFromObject(schoolBuilding);
  const schoolCenter = schoolBounds.getCenter(new T.Vector3());
  const schoolScale = 8;
  schoolBuilding.scale.setScalar(schoolScale);
  schoolBuilding.position.set(-schoolCenter.x * schoolScale, -schoolBounds.min.y * schoolScale, schoolMapZ - 10 - schoolCenter.z * schoolScale);
  setShadows(schoolBuilding);
  schoolScene.add(schoolBuilding);
  const familyGround = new T.Mesh(new T.PlaneGeometry(28, 28), new T.MeshStandardMaterial({ color: '#91a16f', roughness: 1 }));
  familyGround.name = 'LeeHomeGarden';
  familyGround.rotation.x = -Math.PI / 2;
  familyGround.position.y = -0.02;
  familyGround.receiveShadow = true;
  familyScene.add(familyGround);
  const familyPath = new T.Mesh(new T.PlaneGeometry(5.5, 10), new T.MeshStandardMaterial({ color: '#b7b2a4', roughness: 0.95 }));
  familyPath.name = 'LeeHomePath';
  familyPath.rotation.x = -Math.PI / 2;
  familyPath.position.set(0, -0.006, 2.4);
  familyPath.receiveShadow = true;
  familyScene.add(familyPath);
  const familyHouse = houseAsset.scene.clone(true);
  familyHouse.name = 'LeeFamilyKoreanHouse';
  const familyHouseBounds = new T.Box3().setFromObject(familyHouse);
  const familyHouseCenter = familyHouseBounds.getCenter(new T.Vector3());
  const familyHouseScale = 1.4;
  familyHouse.scale.setScalar(familyHouseScale);
  familyHouse.position.set(
    -familyHouseCenter.x * familyHouseScale,
    -familyHouseBounds.min.y * familyHouseScale,
    -3.8 - familyHouseCenter.z * familyHouseScale,
  );
  setShadows(familyHouse);
  familyScene.add(familyHouse);
  const clips = {};
  const clipLoads = {};
  const animationFiles = {
    SooAhWalk: { url: './assets/clips/SooAhWalk.json', type: 'json' },
    SooAhRun: { url: './assets/clips/SooAhRun.json', type: 'json' },
    SooAhLookBehindRun: { url: './assets/clips/SooAhLookBehindRun.json', type: 'json' },
    SooAhTurnLeft: { url: './assets/clips/SooAhTurnLeft.json', type: 'json' },
    SooAhTurnRight: { url: './assets/clips/SooAhTurnRight.json', type: 'json' },
    SooAhSitToStand: { url: './assets/clips/SooAhSitToStand.json', type: 'json' },
    SooAhStandToSit: { url: './assets/clips/SooAhStandToSit.json', type: 'json' },
    SooAhSittingTalk: { url: './assets/clips/SooAhSittingTalk.json', type: 'json' },
    SooAhNervous: { url: './assets/clips/SooAhNervous.json', type: 'json' },
    SooAhTerrified: { url: './assets/clips/SooAhTerrified.json', type: 'json' },
    TedWalk: { url: './assets/animations/ted/ted-walking.glb', type: 'gltf' },
    TedWalkAlternative: { url: './assets/animations/ted/ted-walking-alternative.glb', type: 'gltf' },
    TedRun: { url: './assets/animations/ted/ted-fast-run.glb', type: 'gltf' },
    TedTurnLeft: { url: './assets/animations/ted/ted-left-turn.glb', type: 'gltf' },
    TedTurnRight: { url: './assets/animations/ted/ted-right-turn.glb', type: 'gltf' },
    TedSitting: { url: './assets/animations/ted/ted-sitting-idle.glb', type: 'gltf' },
    TedSittingTalk: { url: './assets/animations/ted/ted-sitting-talking.glb', type: 'gltf' },
    TedSitToStand: { url: './assets/animations/ted/ted-sit-to-stand.glb', type: 'gltf' },
    TedStandToSit: { url: './assets/animations/ted/ted-stand-to-sit.glb', type: 'gltf' },
    TedNervous: { url: './assets/animations/ted/ted-nervous-look-around.glb', type: 'gltf' },
    TedTerrified: { url: './assets/animations/ted/ted-terrified.glb', type: 'gltf' },
    TedAuditionWalk: { url: './assets/animations/audition/ted/ted-walk.glb', type: 'gltf' },
    TedAuditionSinging: { url: './assets/animations/audition/ted/ted-singing.glb', type: 'gltf' },
    TedGangnamStyle: { url: './assets/animations/audition/ted/ted-gangnam-style.glb', type: 'gltf' },
    TedThumbsUp: { url: './assets/animations/audition/ted/ted-thumbs-up.glb', type: 'gltf' },
    TedHappyGesture: { url: './assets/animations/audition/ted/ted-happy-gesture.glb', type: 'gltf' },
    SooAhAuditionTerrified: { url: './assets/animations/audition/soo-ah/sooah-terrified.glb', type: 'gltf' },
    SooAhAuditionHappy: { url: './assets/animations/audition/soo-ah/sooah-happy.glb', type: 'gltf' },
    SooAhHipHop: { url: './assets/animations/audition/soo-ah/sooah-hip-hop.glb', type: 'gltf' },
    SooAhJazz: { url: './assets/animations/audition/soo-ah/sooah-jazz.glb', type: 'gltf' },
    SooAhStepHipHop: { url: './assets/animations/audition/soo-ah/sooah-step-hip-hop.glb', type: 'gltf' },
    SooAhAuditionSinging: { url: './assets/animations/audition/soo-ah/sooah-singing.glb', type: 'gltf' },
    SooAhAuditionWalk: { url: './assets/animations/audition/soo-ah/sooah-walk.glb', type: 'gltf' },
    SooAhAuditionIdle: { url: './assets/animations/audition/soo-ah/sooah-idle.glb', type: 'gltf' },
    SooAhVictory: { url: './assets/animations/audition/soo-ah/sooah-victory.glb', type: 'gltf' },
    MrLeeWalk: { url: './assets/clips/MrLeeWalk.json', type: 'json' },
    MrLeeRun: { url: './assets/clips/MrLeeRun.json', type: 'json' },
    MrLeePointing: { url: './assets/clips/MrLeePointing.json', type: 'json' },
    MrLeeTalking: { url: './assets/clips/MrLeeTalking.json', type: 'json' },
    MrsLeeTalking: { url: './assets/characters/mrs-lee-talking.fbx', type: 'fbx' },
  };
  const ted = tedAsset.scene;
  ted.traverse((node) => {
    if (node.isBone) node.name = T.PropertyBinding.sanitizeNodeName(node.name);
  });
  let tedStandingIdle = null;
  let tedHips = null;
  let tedRightHand = null;
  let tedHead = null;
  ted.traverse((node) => {
    if (!node.isBone) return;
    const boneName = node.name.toLowerCase().replace(/[^a-z]/g, '');
    if (boneName.endsWith('mixamorigHips'.toLowerCase())) tedHips = node;
    if (boneName.endsWith('mixamorigrighthand')) tedRightHand = node;
    if (boneName.endsWith('mixamorighead')) tedHead = node;
  });
  const mrLee = mrLeeAsset;
  mrLee.traverse((node) => {
    if (node.isBone) node.name = T.PropertyBinding.sanitizeNodeName(node.name);
  });
  const bench = chairAsset.scene;
  // Ted's stage GLB is +40.107° from his base rig; undo it at the visual pivot.
  const tedBenchYaw = T.MathUtils.degToRad(40.107);
  const mrLeeRoot = new T.Group();
  const tedRoot = new T.Group();
  const tedVisualPivot = new T.Group();
  const maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;

  bench.name = 'WoodenParkChair';
  setShadows(bench);
  bench.traverse((node) => {
    if (node.isMesh) node.receiveShadow = false;
  });
  scene.add(bench);
  const cafeRoot = new T.Group();
  const cafe = cafeAsset.scene.clone(true);
  const cafeX = -5.0;
  const cafeZ = 35.0;
  cafe.rotation.y = Math.PI;
  const cafeBounds = new T.Box3().setFromObject(cafe);
  const cafeCenter = cafeBounds.getCenter(new T.Vector3());
  const cafeScale = 0.43;
  cafe.scale.setScalar(cafeScale);
  cafe.position.set(-cafeCenter.x * cafeScale, -cafeBounds.min.y * cafeScale, -cafeCenter.z * cafeScale);
  cafe.name = 'KoreanCafeModel';
  cafeRoot.name = 'KoreanCafe';
  cafeRoot.position.set(cafeX, -1.15 + parkHeightAt(cafeX, cafeZ), cafeZ);
  cafeRoot.add(cafe);
  setShadows(cafeRoot);
  scene.add(cafeRoot);
  const cafeStreetTransform = {
    position: cafeRoot.position.clone(),
    rotation: cafeRoot.rotation.clone(),
    scale: cafeRoot.scale.clone(),
  };
  const cafeExteriorNodes = ['particles_2', 'bike_front_3', 'bike_back_4', 'foilage_base_21', 'foilage_leafs_22',
    'bakery_door_23', 'bakery_tent_26', 'pots_43', 'sidewalk_44', 'street_board_45'];
  let cafeExteriorVisibility = [];
  const setCafeInterior = (inside) => {
    if (inside) {
      cafeExteriorVisibility = cafeExteriorNodes.map((name) => cafeRoot.getObjectByName(name))
        .filter(Boolean).map((node) => [node, node.visible]);
      for (const [node] of cafeExteriorVisibility) node.visible = false;
      cafeRoot.position.set(0, 0, 0);
      cafeRoot.rotation.set(0, 0, 0);
      cafeRoot.scale.setScalar(3);
      familyGround.visible = false;
      familyPath.visible = false;
      familyHouse.visible = false;
      familyScene.background.set('#e8ddd0');
      familyScene.fog.color.set('#e8ddd0');
      return;
    }
    for (const [node, visible] of cafeExteriorVisibility) node.visible = visible;
    cafeExteriorVisibility = [];
    cafeRoot.position.copy(cafeStreetTransform.position);
    cafeRoot.rotation.copy(cafeStreetTransform.rotation);
    cafeRoot.scale.copy(cafeStreetTransform.scale);
    familyGround.visible = true;
    familyPath.visible = true;
    familyPath.position.y = -0.006;
    familyHouse.visible = true;
    familyScene.background.set('#d9e9f2');
    familyScene.fog.color.set('#d9e9f2');
  };
  const cafeInteriorFloor = new T.Mesh(
    new T.PlaneGeometry(5.8, 4.9),
    new T.MeshStandardMaterial({ color: '#b2936d', roughness: 0.88 }),
  );
  cafeInteriorFloor.name = 'LeeCafeInteriorFloor';
  cafeInteriorFloor.rotation.x = -Math.PI / 2;
  cafeInteriorFloor.position.y = -0.012;
  cafeInteriorFloor.receiveShadow = true;
  familyScene.add(cafeInteriorFloor);
  const cafeCounter = new T.Group();
  cafeCounter.name = 'LeeCafeCounter';
  const cafeCounterBody = new T.Mesh(new T.BoxGeometry(2.35, 0.86, 0.64), new T.MeshStandardMaterial({ color: '#765039', roughness: 0.82 }));
  cafeCounterBody.position.set(0, 0.43, 0.34);
  cafeCounterBody.name = 'LeeCafeCounterBody';
  const cafeCounterTop = new T.Mesh(new T.BoxGeometry(2.48, 0.1, 0.72), new T.MeshStandardMaterial({ color: '#b88759', roughness: 0.7 }));
  cafeCounterTop.position.set(0, 0.91, 0.34);
  cafeCounterTop.name = 'LeeCafeCounterTop';
  const cafeCupMaterial = new T.MeshStandardMaterial({ color: '#f0e7d6', roughness: 0.38 });
  for (const x of [-0.7, 0.7]) {
    const cup = new T.Mesh(new T.CylinderGeometry(0.055, 0.045, 0.12, 12), cafeCupMaterial);
    cup.position.set(x, 1.02, 0.34);
    cup.name = `LeeCafeCup${x < 0 ? 'Left' : 'Right'}`;
    cafeCounter.add(cup);
  }
  cafeCounter.add(cafeCounterBody, cafeCounterTop);
  cafeCounter.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
  cafeCounter.position.z = 0.18;
  familyScene.add(cafeCounter);
  const cafeWarmLight = new T.PointLight('#ffd29c', 8, 8, 2);
  cafeWarmLight.name = 'LeeCafeWarmLight';
  cafeWarmLight.position.set(0, 3.1, 0.4);
  familyScene.add(cafeWarmLight);

  function addParkAsset(asset, name, x, z, scale, yaw = 0) {
    const root = new T.Group();
    const model = asset.scene.clone(true);
    model.rotation.y = yaw;
    const bounds = new T.Box3().setFromObject(model);
    const center = bounds.getCenter(new T.Vector3());
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    model.name = `${name}Model`;
    root.name = name;
    root.position.set(x, parkHeightAt(x, z), z);
    root.add(model);
    setShadows(root);
    scene.add(root);
    return root;
  }

  function addRoadVehicle(asset, name, targetLength = 4.4) {
    const root = new T.Group();
    const model = asset.scene.clone(true);
    const bounds = new T.Box3().setFromObject(model);
    const size = bounds.getSize(new T.Vector3());
    const center = bounds.getCenter(new T.Vector3());
    const scale = targetLength / Math.max(size.x, size.z);
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    model.name = `${name}Model`;
    root.name = name;
    root.add(model);
    setShadows(root);
    scene.add(root);
    return root;
  }

  // ---- Park ---------------------------------------------------------------------------------------
  // Sized for the 1 m tall characters. The story bench stays at the origin facing +Z (north); the park
  // is a 45 m square around it inside a hedge, with the city to go outside the hedge.
  const parkHalf = 22.6;
  let parkLimit = parkHalf - 0.9;
  const reserved = []; // { x, z, r }: trees and decor keep off these
  const obstacles = []; // { x, z, r }: solid for walkers
  const pathLines = []; // { points, halfWidth }
  const pathMaterial = new T.MeshStandardMaterial({ color: '#c8b892', roughness: 0.95, side: T.DoubleSide });

  function addPath(name, points, { closed = false, width = 1.8, lift = 0.012, material = pathMaterial, trackClearance = true } = {}) {
    const curve = new T.CatmullRomCurve3(points.map(([x, z]) => new T.Vector3(x, 0, z)), closed, 'centripetal');
    const segments = Math.max(2, Math.ceil(curve.getLength() * 2));
    const positions = [];
    const indices = [];
    const samples = [];
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const point = curve.getPointAt(u);
      const tangent = curve.getTangentAt(u);
      samples.push(point);
      for (const side of [-1, 1]) {
        const x = point.x - tangent.z * side * width / 2;
        const z = point.z + tangent.x * side * width / 2;
        positions.push(x, parkHeightAt(x, z) + lift, z);
      }
      if (i < segments) indices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (trackClearance) pathLines.push({ points: samples, halfWidth: width / 2 });
    return curve;
  }
  // Distance from a point to the nearest path edge (negative = on the path).
  const distanceToPaths = (x, z) => Math.min(...pathLines.map(({ points, halfWidth }) =>
    Math.min(...points.map((p) => Math.hypot(p.x - x, p.z - z))) - halfWidth));
  const isClear = (x, z, r) => reserved.every((spot) => Math.hypot(spot.x - x, spot.z - z) >= spot.r + r);

  // A loop passes just in front of the bench; spokes lead to the four entrances.
  const loopCenter = { x: 0, z: 10 };
  const roadHalf = 28.6;
  const loopPath = addPath('ParkLoopPath', [
    [0, 2.3], [6.5, 3.2], [11, 7], [11.5, 12.5], [7, 16.5], [0, 17.5], [-7, 16.5], [-11.5, 12.5], [-11, 7], [-6.5, 3.2],
  ], { closed: true });
  addPath('ParkNorthPath', [[0, 17.5], [0, 20], [0, parkHalf + 2.1], [0, roadHalf - 2.6], [0, roadHalf + 2.6], [0, roadHalf + 4.5]], { lift: 0.018 });
  addPath('MochiStoolPath', [[0, 20], [2.8, 19.8]], { width: 1.2, lift: 0.018 });
  addPath('ParkGatePath', [[0, -roadHalf - 4.5], [0, -roadHalf - 2.6], [0, -roadHalf + 2.6], [0, -parkHalf - 2.1], [0, -16], [-3, -9], [-7, -3], [-9.4, 4.8]], { lift: 0.018 });
  addPath('SchoolSouthConnectorPath', [[0, schoolMapZ + 4.5], [0, -33.1]], { width: 1.8, lift: 0.018 });
  addPath('CafeEntrancePath', [[0, 33.1], [-2, 32.9], [-4, 32.45], [-5, 32.2]], { width: 1.8, lift: 0.018 });
  addPath('ParkEastPath', [[11.5, 12.5], [17, 12.5], [parkHalf + 2.1, 12.5], [roadHalf - 2.6, 12.5], [roadHalf + 2.6, 12.5], [roadHalf + 4.5, 12.5]], { lift: 0.018 });
  addPath('ParkWestPath', [[-11.5, 12.5], [-17, 12.5], [-parkHalf - 2.1, 12.5], [-roadHalf + 2.6, 12.5], [-roadHalf - 2.6, 12.5], [-roadHalf - 4.5, 12.5]], { lift: 0.018 });

  const ringPoints = (half, corner) => [
    [-half + corner, -half], [half - corner, -half], [half, -half + corner], [half, half - corner],
    [half - corner, half], [-half + corner, half], [-half, half - corner], [-half, -half + corner],
  ];
  const asphaltMaterial = new T.MeshStandardMaterial({ color: '#45494b', roughness: 0.97, side: T.DoubleSide });
  const sidewalkMaterial = new T.MeshStandardMaterial({ color: '#b4aa98', roughness: 0.94, side: T.DoubleSide });
  const curbMaterial = new T.MeshStandardMaterial({ color: '#d2cabb', roughness: 0.92, side: T.DoubleSide });
  const lanePaintMaterial = new T.MeshStandardMaterial({ color: '#e5c76c', roughness: 0.9 });
  const crosswalkMaterial = new T.MeshStandardMaterial({ color: '#f4eee0', roughness: 0.9 });
  const roadWidth = 5.6;
  const roadCurve = addPath('ParkPerimeterRoad', ringPoints(roadHalf, 9), {
    closed: true, width: roadWidth, lift: 0.026, material: asphaltMaterial, trackClearance: false,
  });
  const roadLength = roadCurve.getLength();
  addPath('ParkInnerSidewalk', ringPoints(24.8, 7.5), {
    closed: true, width: 1.8, lift: 0.022, material: sidewalkMaterial, trackClearance: false,
  });
  addPath('ParkOuterSidewalk', ringPoints(32.3, 9.5), {
    closed: true, width: 1.6, lift: 0.02, material: sidewalkMaterial, trackClearance: false,
  });
  addPath('ParkInnerCurb', ringPoints(25.72, 7.5), {
    closed: true, width: 0.14, lift: 0.032, material: curbMaterial, trackClearance: false,
  });
  addPath('ParkOuterCurb', ringPoints(31.48, 9.5), {
    closed: true, width: 0.14, lift: 0.032, material: curbMaterial, trackClearance: false,
  });

  const dashCount = Math.floor(roadLength / 7.5);
  const laneDashes = new T.InstancedMesh(new T.BoxGeometry(1.35, 0.012, 0.07), lanePaintMaterial, dashCount);
  const roadMarker = new T.Object3D();
  const roadMarkerPoint = new T.Vector3();
  const roadMarkerTangent = new T.Vector3();
  for (let i = 0; i < dashCount; i++) {
    const u = (i + 0.5) / dashCount;
    roadCurve.getPointAt(u, roadMarkerPoint);
    roadCurve.getTangentAt(u, roadMarkerTangent);
    roadMarker.position.set(roadMarkerPoint.x, parkHeightAt(roadMarkerPoint.x, roadMarkerPoint.z) + 0.041, roadMarkerPoint.z);
    roadMarker.rotation.y = Math.atan2(-roadMarkerTangent.z, roadMarkerTangent.x);
    roadMarker.updateMatrix();
    laneDashes.setMatrixAt(i, roadMarker.matrix);
  }
  laneDashes.name = 'PerimeterRoadCenterMarks';
  laneDashes.instanceMatrix.needsUpdate = true;
  laneDashes.receiveShadow = true;
  scene.add(laneDashes);

  const zebraCount = 4 * 7;
  const zebraStripes = new T.InstancedMesh(new T.BoxGeometry(0.42, 0.014, 5.1), crosswalkMaterial, zebraCount);
  const crossings = [
    { x: 0, z: -roadHalf, alongX: true }, { x: 0, z: roadHalf, alongX: true },
    { x: -roadHalf, z: 12.5, alongX: false }, { x: roadHalf, z: 12.5, alongX: false },
  ];
  let zebraIndex = 0;
  for (const crossing of crossings) for (let stripe = 0; stripe < 7; stripe++) {
    const offset = (stripe - 3) * 0.76;
    const x = crossing.x + (crossing.alongX ? offset : 0);
    const z = crossing.z + (crossing.alongX ? 0 : offset);
    roadMarker.position.set(x, parkHeightAt(x, z) + 0.046, z);
    roadMarker.rotation.y = crossing.alongX ? 0 : Math.PI / 2;
    roadMarker.updateMatrix();
    zebraStripes.setMatrixAt(zebraIndex++, roadMarker.matrix);
  }
  zebraStripes.name = 'ParkRoadCrosswalks';
  zebraStripes.instanceMatrix.needsUpdate = true;
  zebraStripes.receiveShadow = true;
  scene.add(zebraStripes);

  const busStop = new T.Group();
  busStop.name = 'CafeBusStop';
  const busStopMetal = new T.MeshStandardMaterial({ color: '#45575a', roughness: 0.72, metalness: 0.35 });
  const busStopSign = new T.Mesh(new T.BoxGeometry(0.42, 0.58, 0.06), new T.MeshStandardMaterial({ color: '#3b7180', roughness: 0.72 }));
  busStopSign.position.set(0, 1.78, 0);
  busStopSign.name = 'BusStopSign';
  const busStopPost = new T.Mesh(new T.CylinderGeometry(0.025, 0.035, 2.15, 8), busStopMetal);
  busStopPost.position.y = 1.075;
  busStopPost.name = 'BusStopPost';
  const busStopBench = new T.Mesh(new T.BoxGeometry(1.25, 0.08, 0.34), new T.MeshStandardMaterial({ color: '#805033', roughness: 0.86 }));
  busStopBench.position.set(-0.75, 0.23, 0.25);
  busStopBench.name = 'BusStopBench';
  busStop.add(busStopSign, busStopPost, busStopBench);
  busStop.position.set(-8.5, parkHeightAt(-8.5, 32.7), 32.7);
  setShadows(busStop);
  scene.add(busStop);
  obstacles.push({ x: -8.5, z: 32.7, r: 0.25 });

  const hydrantSize = new T.Box3().setFromObject(hydrantAsset.scene).getSize(new T.Vector3());
  const hydrantScale = 0.68 / Math.max(hydrantSize.y, 0.01);
  addParkAsset(hydrantAsset, 'RoadHydrantWest', -32.3, 10.3, hydrantScale, Math.PI / 2);
  addParkAsset(hydrantAsset, 'RoadHydrantEast', 32.3, 14.7, hydrantScale, -Math.PI / 2);

  const streetBin = new T.Group();
  streetBin.name = 'CafeStreetBin';
  const binBody = new T.Mesh(new T.BoxGeometry(0.34, 0.52, 0.34), new T.MeshStandardMaterial({ color: '#4e635d', roughness: 0.88 }));
  binBody.position.y = 0.26;
  const binLid = new T.Mesh(new T.BoxGeometry(0.38, 0.045, 0.38), new T.MeshStandardMaterial({ color: '#313c38', roughness: 0.78 }));
  binLid.position.y = 0.54;
  streetBin.add(binBody, binLid);
  streetBin.position.set(-6.9, parkHeightAt(-6.9, 32.7), 32.7);
  setShadows(streetBin);
  scene.add(streetBin);

  const addParkingBay = (name, x, z) => {
    const bay = new T.Mesh(new T.BoxGeometry(6.1, 0.024, 2.5), asphaltMaterial);
    bay.name = `${name}Pad`;
    bay.position.set(x, parkHeightAt(x, z) + 0.034, z);
    bay.receiveShadow = true;
    scene.add(bay);
    const lineMaterial = new T.MeshStandardMaterial({ color: '#e9e1cf', roughness: 0.9 });
    for (const dx of [-2.85, 2.85]) {
      const line = new T.Mesh(new T.BoxGeometry(0.07, 0.012, 2.25), lineMaterial);
      line.name = `${name}Marking`;
      line.position.set(x + dx, parkHeightAt(x + dx, z) + 0.052, z);
      scene.add(line);
    }
  };
  addParkingBay('CafeParkingBay', 7, 33.25);
  addParkingBay('SouthParkingBay', 4, -33.25);
  const parkedKia = addRoadVehicle(kiaCarAsset, 'ParkedKiaForte');
  parkedKia.position.set(7, parkHeightAt(7, 33.25) + 0.02, 33.25);
  parkedKia.rotation.y = 0;
  const southKia = addRoadVehicle(kiaCarAsset, 'SouthKiaForte');
  southKia.position.set(4, parkHeightAt(4, -33.25) + 0.02, -33.25);
  southKia.rotation.y = Math.PI;
  const movingKia = addRoadVehicle(kiaCarAsset, 'MovingKiaForte');
  const trafficPoint = new T.Vector3();
  const trafficTangent = new T.Vector3();
  const trafficQuat = new T.Quaternion();
  const trafficUp = new T.Vector3(0, 1, 0);
  const trafficForward = new T.Vector3(-1, 0, 0);
  const trafficLength = roadCurve.getLength();
  const trafficSpeed = 3.6;
  movingKia.userData.traffic = true;
  movingKia.userData.trafficPhase = 0.08;

  const mochiStoolPosition = { x: 0.5, z: 18.3 };
  const mochiStool = new T.Group();
  mochiStool.name = 'MochiStool';
  const stoolWood = new T.MeshStandardMaterial({ color: '#805033', roughness: 0.82 });
  const stoolSeat = new T.Mesh(new T.CylinderGeometry(0.21, 0.22, 0.07, 20), stoolWood);
  stoolSeat.position.y = 0.385;
  stoolSeat.name = 'MochiStoolSeat';
  mochiStool.add(stoolSeat);
  for (const x of [-0.145, 0.145]) for (const z of [-0.135, 0.135]) {
    const leg = new T.Mesh(new T.BoxGeometry(0.052, 0.38, 0.052), stoolWood);
    leg.position.set(x, 0.19, z);
    leg.name = 'MochiStoolLeg';
    mochiStool.add(leg);
  }
  for (const z of [-0.115, 0.115]) {
    const brace = new T.Mesh(new T.BoxGeometry(0.26, 0.035, 0.035), stoolWood);
    brace.position.set(0, 0.16, z);
    brace.name = 'MochiStoolBrace';
    mochiStool.add(brace);
  }
  for (const x of [-0.13, 0.13]) {
    const brace = new T.Mesh(new T.BoxGeometry(0.035, 0.035, 0.22), stoolWood);
    brace.position.set(x, 0.16, 0);
    brace.name = 'MochiStoolBrace';
    mochiStool.add(brace);
  }
  const mochiPlate = new T.Mesh(new T.CylinderGeometry(0.13, 0.14, 0.014, 20), new T.MeshStandardMaterial({ color: '#eadfce', roughness: 0.55 }));
  mochiPlate.position.y = 0.427;
  mochiPlate.name = 'MochiPlate';
  mochiStool.add(mochiPlate);
  const mochiItem = mochiAsset.scene.clone(true);
  const rawMochiBounds = new T.Box3().setFromObject(mochiItem);
  const rawMochiSize = rawMochiBounds.getSize(new T.Vector3());
  const mochiScale = new T.Vector3().setScalar(0.3 / rawMochiSize.y);
  mochiItem.scale.copy(mochiScale);
  const mochiOnStoolPosition = new T.Vector3(
    -rawMochiBounds.getCenter(new T.Vector3()).x * mochiScale.x,
    0.435 - rawMochiBounds.min.y * mochiScale.y,
    -rawMochiBounds.getCenter(new T.Vector3()).z * mochiScale.z,
  );
  mochiItem.position.set(
    mochiOnStoolPosition.x,
    mochiOnStoolPosition.y,
    mochiOnStoolPosition.z,
  );
  mochiItem.name = 'MochiItem';
  mochiItem.visible = true;
  mochiStool.add(mochiItem);
  const stoolMochiStick = mochiSkewerAsset.scene.getObjectByName('DangoStick').clone(true);
  stoolMochiStick.name = 'StoolMochiStick';
  stoolMochiStick.scale.setScalar(1.7);
  stoolMochiStick.position.y = 0.434;
  mochiStool.add(stoolMochiStick);
  const heldMochi = mochiHeldAsset.scene.clone(true);
  heldMochi.name = 'HeldMochiBite';
  heldMochi.visible = false;
  const heldMochiSkewer = mochiSkewerAsset.scene.clone(true);
  heldMochiSkewer.name = 'HeldMochiSkewer';
  heldMochiSkewer.visible = false;
  setShadows(heldMochi);
  setShadows(heldMochiSkewer);
  mochiStool.position.set(
    mochiStoolPosition.x,
    parkHeightAt(mochiStoolPosition.x, mochiStoolPosition.z),
    mochiStoolPosition.z,
  );
  setShadows(mochiStool);
  scene.add(mochiStool);
  obstacles.push({ ...mochiStoolPosition, r: 0.28 });
  reserved.push({ ...mochiStoolPosition, r: 0.75 });
  let mochiHolder = null;
  let mochiShared = false;
  let mochiEating = null;
  let mochiConsumed = false;

  // The story bench sits on its own paved patch on the grass, facing the loop.
  const benchPad = new T.Mesh(new T.BoxGeometry(2.4, 0.04, 1.9), new T.MeshStandardMaterial({ color: '#b3aa98', roughness: 0.9 }));
  benchPad.name = 'BenchPad';
  benchPad.position.set(0, parkHeightAt(0, 0.45), 0.45);
  benchPad.receiveShadow = true;
  scene.add(benchPad);
  reserved.push({ x: 0, z: 0.3, r: 3.2 });

  // Pond in the middle of the loop lawn.
  const pondRadius = 3.4;
  const pond = new T.Mesh(new T.CircleGeometry(pondRadius, 48), new T.MeshStandardMaterial({ color: '#5d8fa6', roughness: 0.12, metalness: 0.1 }));
  pond.name = 'ParkPond';
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(loopCenter.x, parkHeightAt(loopCenter.x, loopCenter.z) + 0.03, loopCenter.z);
  scene.add(pond);
  const pondRim = new T.Mesh(new T.TorusGeometry(pondRadius + 0.08, 0.16, 8, 64), new T.MeshStandardMaterial({ color: '#a69e90', roughness: 0.9 }));
  pondRim.name = 'ParkPondRim';
  pondRim.rotation.x = Math.PI / 2;
  pondRim.position.copy(pond.position);
  pondRim.receiveShadow = true;
  scene.add(pondRim);
  obstacles.push({ x: loopCenter.x, z: loopCenter.z, r: pondRadius + 0.2 });
  reserved.push({ x: loopCenter.x, z: loopCenter.z, r: pondRadius + 1.2 });

  // Hedge round the edge with gaps at the entrances (the south gap fits the Seoul gate).
  const hedgeMaterial = new T.MeshStandardMaterial({ color: '#3d6a34', roughness: 1 });
  const hedgeRuns = [
    ['z', parkHalf, -parkHalf, -1.4], ['z', parkHalf, 1.4, parkHalf],
    ['z', -parkHalf, -parkHalf, -4.8], ['z', -parkHalf, 4.8, parkHalf],
    ['x', parkHalf, -parkHalf, 11.1], ['x', parkHalf, 13.9, parkHalf],
    ['x', -parkHalf, -parkHalf, 11.1], ['x', -parkHalf, 13.9, parkHalf],
  ];
  for (const [axis, fixed, from, to] of hedgeRuns) {
    const length = to - from;
    const hedge = new T.Mesh(new T.BoxGeometry(axis === 'z' ? length : 0.7, 0.9, axis === 'z' ? 0.7 : length), hedgeMaterial);
    const mid = (from + to) / 2;
    const [x, z] = axis === 'z' ? [mid, fixed] : [fixed, mid];
    hedge.position.set(x, parkHeightAt(x, z) + 0.45, z);
    hedge.castShadow = hedge.receiveShadow = true;
    hedge.name = 'ParkHedge';
    scene.add(hedge);
  }
  reserved.push({ x: 0, z: -parkHalf, r: 5.5 }); // gate

  // Decor benches on the outside of the loop, facing the path.
  const benchModel = chairAsset.scene.clone(true); // cloned before the story bench gets its colliders
  for (const u of [0.2, 0.42, 0.58, 0.8]) {
    const p = loopPath.getPointAt(u);
    const out = new T.Vector2(p.x - loopCenter.x, p.z - loopCenter.z).normalize();
    const x = p.x + out.x * 1.75;
    const z = p.z + out.y * 1.75;
    const seat = benchModel.clone(true);
    seat.name = 'ParkBench';
    seat.position.set(x, parkHeightAt(x, z), z);
    seat.rotation.y = Math.atan2(-out.x, -out.y);
    setShadows(seat, false);
    scene.add(seat);
    obstacles.push({ x, z, r: 0.75 });
    reserved.push({ x, z, r: 1.4 });
  }

  // Lamp posts on the outside of the loop (none right beside the story bench).
  const lampSpots = [];
  for (let i = 0; i < 8; i++) {
    const p = loopPath.getPointAt((i + 0.5) / 8);
    if (Math.hypot(p.x, p.z) < 4) continue;
    const out = new T.Vector2(p.x - loopCenter.x, p.z - loopCenter.z).normalize();
    lampSpots.push([p.x + out.x * 1.25, p.z + out.y * 1.25]);
  }
  lampSpots.push([1.3, -12], [-1.4, 21], [1.4, 21]);
  const lampPoles = new T.InstancedMesh(new T.CylinderGeometry(0.035, 0.05, 1.9, 8), new T.MeshStandardMaterial({ color: '#2f3432', roughness: 0.6, metalness: 0.4 }), lampSpots.length);
  const lampHeads = new T.InstancedMesh(new T.SphereGeometry(0.13, 12, 8), new T.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffd99a', emissiveIntensity: 0.7 }), lampSpots.length);
  const lampMatrix = new T.Matrix4();
  lampSpots.forEach(([x, z], i) => {
    lampMatrix.makeTranslation(x, parkHeightAt(x, z) + 0.95, z);
    lampPoles.setMatrixAt(i, lampMatrix);
    lampMatrix.makeTranslation(x, parkHeightAt(x, z) + 1.95, z);
    lampHeads.setMatrixAt(i, lampMatrix);
    obstacles.push({ x, z, r: 0.12 });
    reserved.push({ x, z, r: 0.8 });
  });
  lampPoles.castShadow = true;
  lampPoles.name = 'ParkLampPoles';
  lampHeads.name = 'ParkLampHeads';
  scene.add(lampPoles, lampHeads);

  // Flower beds wherever they fit clear of the paths.
  const flowerColors = ['#f4a7c0', '#ffd75e', '#ffffff', '#e8505b', '#c99be8'].map((c) => new T.Color(c));
  const bedSpots = [[5.6, 10.5], [-5.6, 10.5], [4.3, -2.8], [17.5, 18.5], [-17.5, 18.5], [18, -18], [-18, -18], [14, 5], [-15, 5]]
    .filter(([x, z]) => distanceToPaths(x, z) > 1.6 && isClear(x, z, 1.3));
  const flowerRandom = seededRandom(5150);
  const flowersPerBed = 40;
  const flowers = new T.InstancedMesh(new T.SphereGeometry(0.075, 6, 4), new T.MeshStandardMaterial({ roughness: 0.8 }), bedSpots.length * flowersPerBed);
  const soilMaterial = new T.MeshStandardMaterial({ color: '#5b4434', roughness: 1 });
  bedSpots.forEach(([x, z], bed) => {
    const soil = new T.Mesh(new T.CylinderGeometry(1.2, 1.28, 0.14, 24), soilMaterial);
    soil.position.set(x, parkHeightAt(x, z) + 0.05, z);
    soil.receiveShadow = true;
    soil.name = 'FlowerBed';
    scene.add(soil);
    for (let i = 0; i < flowersPerBed; i++) {
      const angle = flowerRandom() * Math.PI * 2;
      const radius = Math.sqrt(flowerRandom()) * 1.05;
      const fx = x + Math.cos(angle) * radius;
      const fz = z + Math.sin(angle) * radius;
      lampMatrix.makeTranslation(fx, parkHeightAt(fx, fz) + 0.17 + flowerRandom() * 0.06, fz);
      flowers.setMatrixAt(bed * flowersPerBed + i, lampMatrix);
      flowers.setColorAt(bed * flowersPerBed + i, flowerColors[Math.floor(flowerRandom() * flowerColors.length)]);
    }
    obstacles.push({ x, z, r: 1.25 });
    reserved.push({ x, z, r: 1.8 });
  });
  flowers.name = 'ParkFlowers';
  scene.add(flowers);

  // Trees in groves, never overhanging a path, the bench, the pond or each other.
  function addCherryTree(x, z, grow, index) {
    const tree = new T.Group();
    const model = cherryTreeAsset.scene.clone(true);
    model.traverse((node) => {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (node.isMesh && materials.some((material) => material?.name === 'Material.003')) node.parent.remove(node);
    });
    model.rotation.y = (treeRandom() - 0.5) * 0.38;
    const bounds = new T.Box3().setFromObject(model);
    const center = bounds.getCenter(new T.Vector3());
    const scale = 0.12 * grow;
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    model.name = `CherryTreeModel_${index}`;
    tree.name = `CherryTree_${index}`;
    tree.position.set(x, parkHeightAt(x, z) - 0.02, z);
    tree.add(model);
    setShadows(tree, false);
    scene.add(tree);
  }
  const treeRandom = seededRandom(20261116);
  const groves = [[-15, -14], [14, -13], [-16, 1], [16, 0], [-16, 19], [16, 19], [-7, -18], [8, -19], [-4, 13], [4, 7]];
  const trees = [];
  let cherryCount = 0;
  let sakuraCount = 0;
  for (let attempt = 0; attempt < 3000 && trees.length < 36; attempt++) {
    const [gx, gz] = groves[attempt % groves.length];
    const angle = treeRandom() * Math.PI * 2;
    const spread = treeRandom() * 6.5;
    const x = gx + Math.cos(angle) * spread;
    const z = gz + Math.sin(angle) * spread;
    const grow = 1.7 + treeRandom() * 0.7;
    const canopy = 1.1 * grow; // both tree models are ~2.1 m across at their base scale
    const sakura = treeRandom() < 0.4;
    if (Math.abs(x) > parkHalf - canopy || Math.abs(z) > parkHalf - canopy) continue;
    if (distanceToPaths(x, z) < canopy + 0.2 || !isClear(x, z, canopy)) continue;
    if (trees.some((tree) => Math.hypot(tree.x - x, tree.z - z) < (tree.canopy + canopy) * 0.8)) continue;
    trees.push({ x, z, canopy });
    obstacles.push({ x, z, r: 0.28 * grow });
    if (sakura) addParkAsset(sakuraAsset, `SakuraTree_${sakuraCount++}`, x, z, 5.2 * grow, treeRandom() * Math.PI * 2);
    else addCherryTree(x, z, grow, cherryCount++);
  }

  // Buildings and the gate sit outside the hedge, where the roads will go.
  addParkAsset(houseAsset, 'KoreanHouse_West', -37, 0, 1.05, Math.PI / 2);
  addParkAsset(houseAsset, 'KoreanHouse_East', 37, 0, 1.05, -Math.PI / 2);
  addParkAsset(houseAsset, 'KoreanHouse_SouthWest', -14, -37, 1, 0);
  addParkAsset(houseAsset, 'KoreanHouse_SouthEast', 14, -37, 1, 0);
  addParkAsset(houseAsset, 'KoreanHouse_NorthWest', -18, 37, 1, Math.PI);
  addParkAsset(apartmentAsset, 'KoreanApartment_NorthEast', 18, 37, 1.2, -Math.PI / 2);
  addParkAsset(gateAsset, 'SeoulParkGate', 0, -parkHalf - 0.3, 8);
  const benchColliders = [];
  const addBenchCollider = (name, part, center, size) => {
    const collider = new T.Mesh(new T.BoxGeometry(...size), new T.MeshBasicMaterial());
    collider.name = name;
    collider.visible = false;
    collider.position.set(...center);
    collider.userData.collisionPart = part;
    collider.userData.halfExtents = size.map((value) => value / 2);
    bench.add(collider);
    benchColliders.push(collider);
  };
  addBenchCollider('BenchSeatCollider', 'seat', [0, 0.35, 0.02], [1.30, 0.08, 0.44]);
  addBenchCollider('BenchBackrestCollider', 'backrest', [0, 0.55, -0.235], [1.25, 0.30, 0.12]);
  addBenchCollider('BenchLeftSupportCollider', 'support', [-0.61, 0.28, 0.02], [0.14, 0.56, 0.50]);
  addBenchCollider('BenchRightSupportCollider', 'support', [0.61, 0.28, 0.02], [0.14, 0.56, 0.50]);

  applyCharacterTexture(sooAh, sooAhTexture, maxAnisotropy, true);
  fitToHeight(sooAh, 1.0);
  let sooAhHips = null;
  let sooAhLeftHand = null;
  let sooAhHead = null;
  sooAh.traverse((node) => {
    if (!node.isBone) return;
    const boneName = node.name.toLowerCase().replace(/[^a-z]/g, '');
    if (boneName.endsWith('mixamorighips')) sooAhHips = node;
    if (boneName.endsWith('mixamoriglefthand')) sooAhLeftHand = node;
    if (boneName.endsWith('mixamorighead')) sooAhHead = node;
  });
  sooAh.name = 'SooAh';
  sooAh.position.set(0.24, 0.175, 0.15);
  sooAh.rotation.y = 0;
  setShadows(sooAh, false);
  scene.add(sooAh);

  applyCharacterTexture(ted, tedTexture, maxAnisotropy);
  fitToHeight(ted, 1.0);
  ted.name = 'TedVisual';
  ted.position.x = 0;
  ted.position.z = 0;
  tedVisualPivot.name = 'TedVisualPivot';
  tedVisualPivot.rotation.y = -tedBenchYaw;
  tedVisualPivot.add(ted);
  tedRoot.name = 'TedMovementRoot';
  tedRoot.position.set(-0.16, parkHeightAt(-0.16, 0.21), 0.21);
  tedRoot.rotation.y = 0;
  tedRoot.add(tedVisualPivot);
  setShadows(ted, false);
  scene.add(tedRoot);
  const tedSeatCollider = benchColliders.find((collider) => collider.userData.collisionPart === 'seat');
  const tedHipsWorld = new T.Vector3();
  const tedSeatedPelvis = new T.Vector3();
  const tedSeatPointLocal = new T.Vector3();
  const tedSeatPointWorld = new T.Vector3();
  const tedSitPositionLocal = new T.Vector3();
  let tedSeatedPelvisReady = false;
  const tedSeatTopLocalY = () => tedSeatCollider.position.y + tedSeatCollider.userData.halfExtents[1] + 0.10;
  const tedSeatTargetWorldY = () => {
    bench.updateMatrixWorld(true);
    tedSeatPointLocal.set(tedSeatCollider.position.x, tedSeatTopLocalY(), tedSeatCollider.position.z);
    return bench.localToWorld(tedSeatPointLocal).y;
  };
  const getTedSeatState = () => {
    tedRoot.updateMatrixWorld(true);
    bench.updateMatrixWorld(true);
    const hipsWorld = tedHips.getWorldPosition(new T.Vector3());
    const hipsBench = bench.worldToLocal(hipsWorld.clone());
    return {
      rootY: tedRoot.position.y,
      hipsWorldY: hipsWorld.y,
      hipsBenchLocalY: hipsBench.y,
      seatTargetBenchLocalY: tedSeatTopLocalY(),
      seatTargetWorldY: tedSeatTargetWorldY(),
      mode: characterMode.Ted,
      sittingDown: sittingDown.has('Ted'),
      actionTime: characterActions.Ted?.time ?? null,
    };
  };
  const alignTedPelvisToSeat = ({ horizontal = false } = {}) => {
    if (!tedHips || !tedSeatCollider) return;
    tedRoot.updateMatrixWorld(true);
    bench.updateMatrixWorld(true);
    tedHips.getWorldPosition(tedHipsWorld);
    const pinXZ = horizontal && tedSeatedPelvisReady;
    tedSeatPointLocal.set(
      pinXZ ? tedSeatedPelvis.x : tedSeatCollider.position.x,
      tedSeatTopLocalY(),
      pinXZ ? tedSeatedPelvis.z : tedSeatCollider.position.z,
    );
    tedSeatPointWorld.copy(bench.localToWorld(tedSeatPointLocal));
    const dx = pinXZ ? tedSeatPointWorld.x - tedHipsWorld.x : 0;
    const dz = pinXZ ? tedSeatPointWorld.z - tedHipsWorld.z : 0;
    tedRoot.position.x += dx;
    tedRoot.position.y += tedSeatPointWorld.y - tedHipsWorld.y;
    tedRoot.position.z += dz;
    if (pinXZ) {
      player.x += dx;
      player.z += dz;
    }
    tedRoot.updateMatrixWorld(true);
  };
  const applyTedSitHeight = (progress) => {
    if (!tedSitTransition || !tedHips || !tedSeatCollider) return;
    const s = tedSitTransition;
    const ease = (value) => {
      const t = clamp(value, 0, 1);
      return t * t * (3 - 2 * t);
    };
    const t = clamp(progress, 0, 1);
    const back = ease(t / 0.6);
    const down = ease((t - 0.3) / 0.7);
    tedSitPositionLocal.set(
      s.startHip.x + (tedSeatedPelvis.x - s.startHip.x) * back,
      s.startHip.y + (tedSeatTopLocalY() - s.startHip.y) * down,
      s.startHip.z + (tedSeatedPelvis.z - s.startHip.z) * back,
    );
    tedRoot.updateMatrixWorld(true);
    bench.updateMatrixWorld(true);
    tedHips.getWorldPosition(tedHipsWorld);
    tedSeatPointLocal.copy(tedSitPositionLocal);
    tedSeatPointWorld.copy(bench.localToWorld(tedSeatPointLocal));
    const dx = tedSeatPointWorld.x - tedHipsWorld.x;
    const dy = tedSeatPointWorld.y - tedHipsWorld.y;
    const dz = tedSeatPointWorld.z - tedHipsWorld.z;
    tedRoot.position.x += dx;
    tedRoot.position.y += dy;
    tedRoot.position.z += dz;
    player.x += dx;
    player.z += dz;
    tedRoot.updateMatrixWorld(true);
  };

  // Seat sits at bench-local Y 0.49 but the Mixamo sit/stand clips bake the pelvis ~0.15 lower,
  // so a seated or mid-transition character sinks into the bench. Ted's sit-down and rest already
  // pin the pelvis to the seat; this floors every seated/transitioning pelvis at seat height so the
  // uncorrected paths (Soo-ah sit/stand, Ted stand-up) can't drop through the slats.
  const clampSeatedPelvisHip = new T.Vector3();
  const clampSeatedPelvis = (name) => {
    const root = characterRoots[name];
    const hips = name === 'Ted' ? tedHips : name === 'SooAh' ? sooAhHips : null;
    if (!root || !hips) return;
    root.updateMatrixWorld(true);
    const seatY = tedSeatTargetWorldY();
    const hipY = hips.getWorldPosition(clampSeatedPelvisHip).y;
    if (hipY < seatY - 0.0005) {
      root.position.y += seatY - hipY;
      root.updateMatrixWorld(true);
    }
  };

  applyCharacterTexture(mrLee, mrLeeTexture, maxAnisotropy, true);
  fitToHeight(mrLee, 1.6);
  mrLee.name = 'MrLeeVisual';
  mrLee.position.set(0, 0, 0);
  mrLee.rotation.y = 0;
  mrLeeRoot.name = 'MrLeeMovementRoot';
  mrLeeRoot.add(mrLee);
  setShadows(mrLee, false);
  scene.add(mrLeeRoot);

  const mixers = [];
  const characterMixers = {};
  const characterActions = {};
  const sittingClips = { SooAh: sooAhSittingClip, Ted: null };
  const walkingClips = { SooAh: null, Ted: null };
  const walkingVariants = { Ted: null };
  const runningClips = { SooAh: null, Ted: null };
  let lookBehindRunClip = null;
  const turnClips = {
    SooAh: { left: null, right: null },
    Ted: { left: null, right: null },
  };
  const turnAngles = {
    SooAh: { left: Math.PI / 2, right: Math.PI / 2 },
    Ted: { left: Math.PI / 2, right: Math.PI / 2 },
  };
  const sittingTalkClips = { SooAh: null, Ted: null };
  const eatingClips = { SooAh: null };
  const nervousClips = { SooAh: null, Ted: null };
  const terrifiedClips = { SooAh: null, Ted: null };
  const sitToStandClips = { SooAh: null, Ted: null };
  const standToSitClips = { SooAh: null, Ted: null };
  const mrLeeClips = { idle: inPlaceStandTransition(mrLeeIdleClip), walk: null, talking: null };
  const setLoadedClip = (name, clip) => {
    clips[name] = clip;
    if (name === 'SooAhWalk') walkingClips.SooAh = inPlaceFbxWalk(clip);
    if (name === 'TedWalk') walkingClips.Ted = inPlaceFbxWalk(clip);
    if (name === 'TedWalkAlternative') walkingVariants.Ted = inPlaceFbxWalk(clip);
    if (name === 'SooAhRun') runningClips.SooAh = inPlaceFbxWalk(clip);
    if (name === 'TedRun') runningClips.Ted = inPlaceFbxWalk(clip);
    if (name === 'SooAhLookBehindRun') lookBehindRunClip = inPlaceFbxWalk(clip);
    if (name === 'SooAhTurnLeft') { turnClips.SooAh.left = inPlaceTurn(clip); turnAngles.SooAh.left = measuredTurnAngle(clip); }
    if (name === 'SooAhTurnRight') { turnClips.SooAh.right = inPlaceTurn(clip); turnAngles.SooAh.right = measuredTurnAngle(clip); }
    if (name === 'TedTurnLeft') { turnClips.Ted.left = inPlaceTurn(clip, tedStandingIdle); turnAngles.Ted.left = measuredTurnAngle(clip); }
    if (name === 'TedTurnRight') { turnClips.Ted.right = inPlaceTurn(clip, tedStandingIdle); turnAngles.Ted.right = measuredTurnAngle(clip); }
    if (name === 'TedSitting') sittingClips.Ted = clip;
    // Pin hip drift but keep its seated height (stripping the hips track floated her to standing
    // height). Processed once here so repeated F presses reuse the same clip.
    // Both talking clips turn toward the character's left (+X); Soo-ah sits on the +X side, so she
    // is mirrored to turn toward Ted instead of away from him.
    if (name === 'SooAhSittingTalk') {
      sittingTalkClips.SooAh = mirrorClip(inPlaceStandTransition(clip));
      eatingClips.SooAh = T.AnimationUtils.subclip(sittingTalkClips.SooAh, 'SooAhEating', 990, 1050, 30);
    }
    if (name === 'TedSittingTalk') sittingTalkClips.Ted = inPlaceSit(clip);
    if (name === 'SooAhNervous') nervousClips.SooAh = clip;
    if (name === 'TedNervous') nervousClips.Ted = clip;
    if (name === 'SooAhTerrified') terrifiedClips.SooAh = clip;
    if (name === 'TedTerrified') terrifiedClips.Ted = clip;
    if (name === 'SooAhSitToStand') sitToStandClips.SooAh = inPlaceStandTransition(clip);
    if (name === 'TedSitToStand') sitToStandClips.Ted = inPlaceStandTransition(clip);
    if (name === 'SooAhStandToSit') standToSitClips.SooAh = inPlaceSitDown(clip);
    if (name === 'TedStandToSit') standToSitClips.Ted = inPlaceStandTransition(clip, 0, false);
    if (name === 'MrLeeWalk') {
      mrLeeClips.walk = inPlaceStandTransition(clip);
    }
    if (name === 'MrLeeTalking') mrLeeClips.talking = inPlaceStandTransition(clip);
    return clip;
  };
  const ensureClip = (name) => {
    if (clips[name]) return Promise.resolve(clips[name]);
    if (!clipLoads[name]) {
      const source = animationFiles[name];
      const load = source.type === 'json' ? loadJsonClip(source.url)
        : source.type === 'fbx' ? loadFbxClip(fbxLoader, source.url) : loadGltfClip(gltfLoader, source.url);
      clipLoads[name] = load.then((clip) => {
        if (!clip) throw new Error(`No animation clip in ${source.url}`);
        return setLoadedClip(name, clip);
      }).finally(() => { delete clipLoads[name]; });
    }
    return clipLoads[name];
  };
  let auditionLoadPromise = null;
  const auditionClipNames = [
    'TedAuditionWalk', 'TedAuditionSinging', 'TedGangnamStyle', 'TedThumbsUp', 'TedHappyGesture',
    'SooAhAuditionTerrified', 'SooAhAuditionHappy', 'SooAhHipHop', 'SooAhJazz',
    'SooAhStepHipHop', 'SooAhAuditionSinging', 'SooAhAuditionWalk', 'SooAhAuditionIdle', 'SooAhVictory',
  ];
  const auditionJudgeSources = [
    { title: 'Gen-1 Idol', file: './assets/characters/audition/judges/nova-judge-gen1-sitting-idle.fbx', texture: './assets/textures/audition/nova-judge-gen1-idol.png' },
    { title: 'Age 22 Judge', file: './assets/characters/audition/judges/nova-judge-22-sitting-idle.fbx', texture: './assets/textures/audition/nova-judge-age22.png' },
    { title: 'Senior Judge', file: './assets/characters/audition/judges/nova-judge-senior-sitting-idle.fbx', texture: './assets/textures/audition/nova-judge-senior.png' },
  ];
  async function loadAuditionAssets() {
    if (auditionLoadPromise) return auditionLoadPromise;
    auditionLoadPromise = (async () => {
      const clipsReady = Promise.all(auditionClipNames.map(ensureClip));
      const [performers, judgeAssets, judgeTextures] = await Promise.all([
        Promise.all([
          gltf(gltfLoader, './assets/characters/audition/ted-kpop-stage.glb'),
          gltf(gltfLoader, './assets/characters/audition/soo-ah-kpop-stage.glb'),
        ]),
        Promise.all(auditionJudgeSources.map(({ file }) => fbxLoader.loadAsync(file))),
        Promise.all(auditionJudgeSources.map(({ texture }) => textureLoader.loadAsync(texture))),
        clipsReady,
      ]);
      const [tedAsset, sooAhAsset] = performers;
      const roots = { Ted: tedAsset.scene, SooAh: sooAhAsset.scene };
      for (const [name, root] of Object.entries(roots)) {
        fitToHeight(root, 1.52);
        root.name = `${name}KpopAudition`;
        root.visible = false;
        setShadows(root);
        auditionScene.add(root);
        auditionRoots[name] = root;
        auditionMixers[name] = new T.AnimationMixer(root);
        mixers.push(auditionMixers[name]);
      }
      const judgeXs = camera.aspect < 0.8 ? [-1.1, 0, 1.1] : [-3.2, 0, 3.2];
      if (camera.aspect < 0.8) {
        for (let index = 0; index < judgeXs.length; index++) {
          auditionStage.getObjectByName(`Audition_JudgeChairSeat_${index + 1}`).position.x = judgeXs[index];
          auditionStage.getObjectByName(`Audition_JudgeChairBack_${index + 1}`).position.x = judgeXs[index];
        }
        auditionStage.getObjectByName('Audition_JudgeDeskTop').scale.x = 0.58;
        auditionStage.getObjectByName('Audition_JudgeDeskFront').scale.x = 0.58;
      }
      for (const [index, asset] of judgeAssets.entries()) {
        const source = auditionJudgeSources[index];
        const clip = asset.animations?.[0];
        if (!clip) throw new Error(`No seated animation in ${source.file}`);
        applyCharacterTexture(asset, judgeTextures[index], maxAnisotropy, true);
        fitToHeight(asset, 1.48);
        asset.name = `NOVAJudge_${source.title.replaceAll(' ', '')}`;
        asset.visible = false;
        asset.position.set(judgeXs[index], 0, 8.55);
        asset.rotation.y = Math.PI;
        setShadows(asset);
        auditionScene.add(asset);
        const mixer = new T.AnimationMixer(asset);
        const action = mixer.clipAction(clip);
        action.setLoop(T.LoopRepeat, Infinity).play();
        mixers.push(mixer);
        auditionJudges.push({ root: asset, title: source.title });
      }
      for (const name of auditionClipNames) auditionClips[name] = inPlaceFbxWalk(clips[name]);
      characterRoots.Ted = auditionRoots.Ted;
      characterRoots.SooAh = auditionRoots.SooAh;
      return true;
    })().catch((error) => {
      auditionLoadPromise = null;
      throw error;
    });
    return auditionLoadPromise;
  }
  function playAuditionClip(actor, name, { loop = false, speed = 1, fade = 0.24 } = {}) {
    const mixer = auditionMixers[actor];
    const clip = auditionClips[name];
    if (!mixer || !clip) return null;
    const previous = auditionActions[actor];
    if (auditionCurrentClip[actor] === name && previous?.isRunning() && loop) {
      return { action: previous, duration: Math.max(clip.duration / Math.max(speed, 0.01), 0.25) };
    }
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? T.LoopRepeat : T.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    if (previous && previous !== action) previous.fadeOut(fade);
    action.timeScale = speed;
    action.fadeIn(fade).play();
    auditionActions[actor] = action;
    auditionCurrentClip[actor] = name;
    return { action, duration: Math.max(clip.duration / Math.max(speed, 0.01), 0.25) };
  }
  // Ted's model only embeds a seated clip; derive his standing idle from the sit-to-stand endpoint.
  await Promise.all(['TedSitting', 'SooAhSitToStand', 'TedSitToStand'].map(ensureClip));
  tedStandingIdle = makeStandingIdle(T, sitToStandClips.Ted);
  const activeWalkVariant = { Ted: 'folder' };
  const walkClipFor = (name) => name === 'Ted' && activeWalkVariant.Ted === 'alternative'
    ? walkingVariants.Ted : walkingClips[name];
  const emotionalStates = {};
  const sittingTalkTimers = { SooAh: 0, Ted: 0 };
  let lookBehindRun = false;
  const sittingCharacters = new Set(['SooAh']);
  const playClip = (name, clip, { loop = false, fade = 0.16 } = {}) => {
    const mixer = characterMixers[name];
    if (!mixer || !clip) return null;
    delete fadingMovement[name];
    const previous = characterActions[name];
    if (previous?.getClip() === clip && previous.isRunning()) return previous;
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? T.LoopRepeat : T.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    if (previous && previous !== action) previous.fadeOut(fade);
    action.fadeIn(fade).play();
    characterActions[name] = action;
    return action;
  };
  const playTedStandingIdle = (fade = 0.16) => {
    if (!tedStandingIdle || !characterMixers.Ted) return null;
    const action = playClip('Ted', tedStandingIdle, { loop: true, fade });
    action?.setEffectiveWeight(1);
    if (action) {
      action.timeScale = 1;
      characterMode.Ted = 'standingIdle';
    }
    return action;
  };
  const restoreIdle = (name) => {
    const mixer = characterMixers[name];
    if (!mixer) return;
    if (sittingCharacters.has(name)) {
      playClip(name, sittingClips[name], { loop: true, fade: 0.2 });
      characterMode[name] = 'sitting';
      if (name === 'Ted') {
        mixer.update(0);
        alignTedPelvisToSeat({ horizontal: true });
      }
      return;
    }
    if (name === 'Ted' && standingCharacters.has(name)) {
      playTedStandingIdle(0.16);
      return;
    }
    mixer.stopAllAction();
    mixer.update(0);
    restoreStandingPose(name);
    characterActions[name] = null;
    characterMode[name] = standingCharacters.has(name) ? 'standingIdle' : 'sitting';
  };
  for (const [actor, actorClips] of [[sooAh, [sooAhSittingClip]], [ted, tedAsset.animations]]) {
    if (actorClips?.length) {
      const mixer = new T.AnimationMixer(actor);
      const name = actor === sooAh ? 'SooAh' : actor === ted ? 'Ted' : null;
      const idleClip = name === 'Ted' ? null : name ? sittingClips[name] : actorClips[0];
      const action = idleClip ? mixer.clipAction(idleClip) : null;
      if (action) {
        action.setLoop(T.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.setEffectiveWeight(1);
        action.play();
      }
      mixers.push(mixer);
      if (name) {
        characterMixers[name] = mixer;
        characterActions[name] = action;
      }
    }
  }
  const tedSeatPoseMixer = new T.AnimationMixer(ted);
  const tedSeatPoseAction = tedSeatPoseMixer.clipAction(sittingClips.Ted);
  tedSeatPoseAction.setLoop(T.LoopOnce, 1);
  tedSeatPoseAction.clampWhenFinished = true;
  tedSeatPoseAction.play();
  tedSeatPoseMixer.update(0);
  alignTedPelvisToSeat();
  tedHips.getWorldPosition(tedSeatedPelvis);
  bench.worldToLocal(tedSeatedPelvis);
  // The load-pose pelvis sits too far back for Ted's deformed legs to clear the seat.
  tedSeatedPelvis.z += 0.12;
  tedSeatedPelvisReady = true;
  tedSeatPoseMixer.stopAllAction();
  tedSeatPoseMixer.uncacheRoot(ted);
  const mrLeeMixer = new T.AnimationMixer(mrLee);
  mixers.push(mrLeeMixer);
  let mrLeeAction = null;
  function setMrLeeMode(mode) {
    const clip = mrLeeClips[mode];
    if (!clip) return false;
    const action = mrLeeMixer.clipAction(clip);
    if (action === mrLeeAction && action.isRunning()) return true;
    action.reset();
    action.setLoop(T.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    if (mrLeeAction) mrLeeAction.fadeOut(0.2);
    action.fadeIn(0.2).play();
    mrLeeAction = action;
    return true;
  }
  setMrLeeMode('idle');

  const camera = new T.PerspectiveCamera(50, 1, 0.08, 170);
  const player = { x: 0, z: 2.7, yaw: 0, pitch: -0.18 };
  const focus = new T.Vector3();
  // Third-person camera that orbits the selected character. 'free' keeps the old first-person rig
  // (the debug side views use it). Angles say where the camera sits around the character.
  const cameraViewOffsets = { front: 0, left: Math.PI / 2, right: -Math.PI / 2, back: Math.PI };
  const followCamera = { mode: 'front', angle: 0, targetAngle: 0, pitch: 0.28, distance: 2.4 };
  const followTarget = new T.Vector3();
  const wrapAngle = (value) => Math.atan2(Math.sin(value), Math.cos(value));
  const routeSpawn = { x: 0, z: 20.5 }; // north entrance, across the road from Lee's Cafe
  // Mr. Lee guards the bench: a loop across the approach between the spawn and Soo-ah/Ted,
  // starting beside the bench on the far side from the player (~8.7 m from the spawn).
  const mrLeeRoute = [
    { x: 2.6, z: 2.5 }, { x: 2.6, z: 5.5 }, { x: -2.6, z: 5.5 }, { x: -2.6, z: 2.5 },
  ];
  mrLeeRoot.position.set(mrLeeRoute[0].x, parkHeightAt(mrLeeRoute[0].x, mrLeeRoute[0].z), mrLeeRoute[0].z);
  mrLeeRoot.rotation.y = Math.atan2(routeSpawn.x - mrLeeRoute[0].x, routeSpawn.z - mrLeeRoute[0].z);
  let routeStarted = false;
  let routeDialogueIndex = 0;
  let auditionAccepted = false;
  let mrLeePatrolling = false;
  let mrLeeAware = false;
  let mrLeePatrolIndex = 1;
  let mrLeePatrolWait = 0;
  let selectedCharacter = 'SooAh';
  let mochiCameraTarget = null;
  const standingCharacters = new Set();
  const characterRoots = { SooAh: sooAh, Ted: tedRoot };
  const parkCharacterRoots = { SooAh: sooAh, Ted: tedRoot };
  const homeDestinations = {
    Ted: { x: -18, z: 33.8, label: 'Ted’s home', marker: 'T' },
    SooAh: { x: 18, z: 33.8, label: 'Soo-ah’s home', marker: 'S' },
  };
  const homeRouteNodes = {
    Ted: [
      { x: 0, z: 2.3 }, { x: -6.5, z: 3.2 }, { x: -11, z: 7 }, { x: -11.5, z: 12.5 },
      { x: -7, z: 16.5 }, { x: 0, z: 17.5 }, { x: 0, z: 20.5 }, { x: 0, z: 24.7 },
      { x: 0, z: 31.2 }, { x: 0, z: 33.1 }, homeDestinations.Ted,
    ],
    SooAh: [
      { x: 0, z: 2.3 }, { x: 6.5, z: 3.2 }, { x: 11, z: 7 }, { x: 11.5, z: 12.5 },
      { x: 7, z: 16.5 }, { x: 0, z: 17.5 }, { x: 0, z: 20.5 }, { x: 0, z: 24.7 },
      { x: 0, z: 31.2 }, { x: 0, z: 33.1 }, homeDestinations.SooAh,
    ],
  };
  const journey = { active: false, phase: 'none', destination: null };
  const school = { active: false, phase: 'inactive', dialogueIndex: 0, auditionPassed: false, arrived: 0 };
  const cafeJourney = {
    active: false,
    phase: 'inactive',
    destination: { x: -5, z: 32.2, label: "Lee's Cafe" },
    talks: [false, false],
    talking: null,
    runRequested: false,
  };
  const cafeRouteNodes = [
    { x: 0, z: -33.1 }, { x: 0, z: -28.6 }, { x: 0, z: -24.7 }, { x: 0, z: -16 },
    { x: -3, z: -9 }, { x: -7, z: -3 }, { x: -9.4, z: 4.8 }, { x: -11, z: 7 },
    { x: -11.5, z: 12.5 }, { x: -7, z: 16.5 }, { x: 0, z: 17.5 }, { x: 0, z: 24.7 },
    { x: 0, z: 31.2 }, { x: 0, z: 33.1 }, { x: -2, z: 32.9 }, { x: -4, z: 32.45 },
    { x: -5, z: 32.2 },
  ];
  const cafeTalkStops = [
    { x: 0, z: -16, lines: [
      'Soo-ah: I keep imagining Dad saying no. I am more nervous than I expected.',
      'Ted: We can listen to what worries him and explain why this matters to you.',
    ] },
    { x: -8, z: 3, lines: [
      'Ted: Passing the audition is something to be proud of, Soo-ah. You worked hard for it.',
      'Soo-ah: Thank you. It helps knowing you are coming with me.',
    ] },
  ];
  const family = {
    active: false,
    pending: false,
    phase: 'inactive',
    dialogueIndex: 0,
    auditionResultTold: false,
    responseChoice: null,
    pendingChoiceResponse: null,
    pauseRemaining: 0,
    entry: null,
    mrsApproach: null,
  };
  let familyAssetsPromise = null;
  let mrLeeHomeRoot = null;
  let mrLeeHomeMixer = null;
  let mrLeeHomeTalkClip = null;
  let mrLeeHomeAction = null;
  let mrsLeeRoot = null;
  let mrsLeeMixer = null;
  let mrsLeeGestureAction = null;
  let mrsLeeTalkingAction = null;
  let mrsLeeTalkingClip = null;
  const schoolDialogue = {
    Ted: [
      'The next school day, Ted and Soo-ah meet at the school entrance.',
      'Soo-ah: The judges selected me. I should be happy, but I’m nervous about telling Mr. and Mrs. Lee.',
      'Ted: I’m so happy for you. You earned this. We can talk to them together after school.',
      'Soo-ah: Dad might say no. He wants me to focus on exams.',
      'Ted: Then we’ll make a plan that shows you can train and keep up with your studies.',
      'Soo-ah: I want to try, even if I’m scared.',
      'Ted: I’ll be there with you. You can tell them what you want.',
      'Soo-ah: Okay. We’ll talk to them after school.',
    ],
    SooAh: [
      'The next school day, Ted and Soo-ah meet at the school entrance.',
      'Soo-ah: I got in. I’m excited, but I keep thinking about telling Mr. and Mrs. Lee.',
      'Soo-ah: What if Dad thinks I’m choosing training instead of school?',
      'Ted: I’m so proud of you. We can show them the offer and schedule, and I’ll listen with you.',
      'Soo-ah: I want to go to the trainee school. I just need them to understand why it matters to me.',
      'Ted: You should tell them that yourself. I’ll be right beside you.',
      'Soo-ah: After class, let’s go tell them together.',
    ],
  };
  const familyDialogue = [
    'Soo-ah: Appa, Eomma, there’s something I need to tell you.',
    'Mr. Lee: What is it, Soo-ah? Is something wrong?',
    'Soo-ah: No. Well… not exactly.',
    'Ted: Soo-ah has something important to tell you.',
    'Soo-ah: I went to the NOVA audition.',
    'Mr. Lee: You did what?',
    'Soo-ah: I auditioned for NOVA. And… I passed.',
    'Mrs. Lee: You passed? Soo-ah! That’s wonderful!',
    'Soo-ah: Thank you, Eomma. I was afraid you might say no.',
    'Mr. Lee: You went to an audition without telling us?',
    'Soo-ah: I was afraid you would say no.',
    'Soo-ah: Singing and dancing mean so much to me. I worked hard to prepare for the audition.',
    'Soo-ah: I practiced after my homework. I still intend to take my studies seriously.',
    'Mrs. Lee: We want to understand what the training involves and how you’ll balance school.',
    'Ted: I’m proud of Soo-ah for telling you. I’ll support her, but I want her to explain what she wants.',
    'Soo-ah: I really want to try. I promise I’ll keep working hard at school too.',
    'Mrs. Lee: I’m proud of you for telling us, Soo-ah. We’ll work through this together.',
    'Mr. Lee: I need some time to think about this, Soo-ah. But I can see how much it means to you.',
    'Soo-ah: Thank you. I feel relieved that I finally told you.',
    'Ted: Whatever happens next, you did something brave today.',
  ];
  const familyChoices = [
    {
      text: 'I know you want me to do well at school, Appa. But I want to try this too.',
      reply: 'Mr. Lee: I do want you to do well. We’ll need to understand how this fits with school.',
    },
    {
      text: 'I didn’t tell you because I was scared you wouldn’t understand.',
      reply: 'Mrs. Lee: I’m sorry you felt too scared to tell us. I want you to be able to talk to us.',
    },
    {
      text: 'I passed the audition. I just wanted you to be proud of me.',
      reply: 'Mr. Lee: I am proud of how hard you worked. I still need time to think about what comes next.',
    },
  ];
  const auditionRoots = { SooAh: null, Ted: null };
  const auditionJudges = [];
  const auditionMixers = { SooAh: null, Ted: null };
  const auditionActions = { SooAh: null, Ted: null };
  const auditionCurrentClip = { SooAh: null, Ted: null };
  const auditionClips = {};
  const audition = {
    active: false,
    pending: false,
    phase: 'park',
    elapsed: 0,
    phaseDuration: 0,
    sequence: [],
    cueIndex: 0,
    cueTimer: 0,
    cueInterval: 1.45,
    cueAnswered: false,
    score: 0,
    section: -1,
    run: 0,
    autoSection: 0,
    walking: false,
    figureTransition: null,
    tedExit: null,
    tedReturn: null,
    cameraFocus: null,
    passed: false,
    message: '',
  };
  const auditionStageTop = 0.38;
  const auditionStageZ = 0;
  let auditionTime = 0;
  const mochiMouthWorld = new T.Vector3();
  const mochiMouthLocal = new T.Vector3();
  const heldMochiWorld = new T.Vector3();
  const heldMochiParentScale = new T.Vector3();
  const heldMochiForward = new T.Vector3(0, 0, 1);
  const heldMochiHandQuaternion = new T.Quaternion();
  const heldMochiRootQuaternion = new T.Quaternion();
  const mochiMouthOffset = new T.Vector3(0, -0.045, 0.085);
  const mochiNodAxis = new T.Vector3(1, 0, 0);
  const mochiNodRotation = new T.Quaternion();
  const updateMochiEating = (dt) => {
    if (!mochiEating) return;
    const state = mochiEating;
    state.elapsed = Math.min(state.duration, state.elapsed + dt);
    const hand = state.recipient === 'SooAh' ? sooAhLeftHand : tedRightHand;
    const head = state.recipient === 'SooAh' ? sooAhHead : tedHead;
    if (!hand || !head) return;
    if (state.handAnimation) {
      if (state.elapsed >= state.biteAt && !state.biteTaken) {
        state.biteTaken = true;
        heldMochi.visible = false;
        heldMochiSkewer.visible = false;
        mochiItem.visible = false;
        mochiConsumed = true;
        message = 'Soo-ah takes a bite.';
      }
      if (state.elapsed >= state.duration) {
        heldMochi.visible = false;
        heldMochiSkewer.visible = false;
        mochiItem.visible = false;
        mochiItem.scale.copy(mochiScale);
        mochiEating = null;
        message = 'Soo-ah: "That was yummy! Thank you, Ted!"';
        if (!startSittingTalk('SooAh')) restoreIdle('SooAh');
      }
      return;
    }
    const progress = clamp((state.elapsed - 1.85) / 0.95, 0, 1);
    if (progress > 0) {
      characterRoots[state.recipient].updateMatrixWorld(true);
      head.updateMatrixWorld(true);
      hand.updateMatrixWorld(true);
      mochiMouthWorld.copy(mochiMouthOffset).applyMatrix4(head.matrixWorld);
      mochiMouthWorld.y -= 0.022;
      mochiMouthLocal.copy(hand.worldToLocal(mochiMouthWorld));
      const eased = progress * progress * (3 - 2 * progress);
      heldMochi.position.lerpVectors(state.startPosition, mochiMouthLocal, eased);
      const bite = clamp((progress - 0.75) / 0.25, 0, 1);
      heldMochi.scale.copy(state.startScale).multiplyScalar(1 - bite);
    }
    if (state.startHeadQuaternion) {
      const nodProgress = clamp((state.elapsed - 1.9) / 0.6, 0, 1);
      const nodAngle = Math.sin(Math.PI * nodProgress) * 0.2;
      head.quaternion.copy(state.startHeadQuaternion)
        .multiply(mochiNodRotation.setFromAxisAngle(mochiNodAxis, nodAngle));
    }
    if (state.elapsed >= state.duration) {
      heldMochi.visible = false;
      mochiItem.visible = false;
      mochiItem.scale.copy(mochiScale);
      heldMochi.scale.setScalar(1);
      if (state.startHeadQuaternion) head.quaternion.copy(state.startHeadQuaternion);
      mochiConsumed = true;
      mochiEating = null;
      message = state.recipient === 'SooAh' ? 'Soo-ah eats the mochi.' : 'Ted eats the mochi.';
    }
  };
  const sitClearance = { SooAh: { y: 0.04, z: 0 }, Ted: { y: 0, z: 0.12 } };
  const characterMode = { SooAh: 'sitting', Ted: 'standingIdle' };
  const standingReady = new Set();
  const walkingCharacters = new Set();
  const movementModes = {};
  const fadingMovement = {};
  // Root-motion stride distances are scaled to the game characters' one-metre height.
  const walkSpeeds = { SooAh: 0.52, Ted: 1.01 };
  const runSpeeds = { SooAh: 1.54, Ted: 3.21 };
  const currentSpeeds = { ...walkSpeeds };
  const turningCharacters = new Set();
  const turningDirection = {};
  const turnStates = {};
  const turnConsumed = {};
  const walkingDirection = {};
  const walkingYaw = {};
  const pendingMoves = {};
  const standingPoses = {};
  const standFinishHandlers = {};
  const standRootTransitions = {};
  const facingTargets = {};
  const seatAnchors = { SooAh: { x: 0.24, z: 0.15 }, Ted: { x: -0.16, z: 0.11 } };
  const standingAnchors = { SooAh: { x: 0.24, z: 0.32 }, Ted: { x: -0.16, z: 0.44 } };
  const characterBodies = { SooAh: { radius: 0.32, height: 1.0 }, Ted: { radius: 0.32, height: 1.0 }, MrLee: { radius: 0.22, height: 1.6 } };
  const benchScale = new T.Vector3();
  const sooAhStandBounds = new T.Box3();
  const sooAhStandMeshes = [];
  sooAh.traverse((node) => { if (node.isSkinnedMesh) sooAhStandMeshes.push(node); });
  const groundSooAhDuringStand = () => {
    sooAh.updateMatrixWorld(true);
    for (const mesh of sooAhStandMeshes) mesh.skeleton.update();
    const groundY = family.active ? familyPath.position.y : school.active ? 0 : parkHeightAt(sooAh.position.x, sooAh.position.z);
    sooAh.position.y += groundY - sooAhStandBounds.setFromObject(sooAh, true).min.y;
    sooAh.updateMatrixWorld(true);
  };
  const tedStandBounds = new T.Box3();
  const tedStandMeshes = [];
  ted.traverse((node) => { if (node.isSkinnedMesh) tedStandMeshes.push(node); });
  const groundTedDuringStand = () => {
    tedRoot.updateMatrixWorld(true);
    for (const mesh of tedStandMeshes) mesh.skeleton.update();
    const groundY = family.active ? familyPath.position.y : school.active ? 0 : parkHeightAt(tedRoot.position.x, tedRoot.position.z);
    tedRoot.position.y += groundY - tedStandBounds.setFromObject(tedRoot, true).min.y;
    tedRoot.updateMatrixWorld(true);
  };
  sittingCharacters.delete('Ted');
  standingCharacters.add('Ted');
  standingReady.add('Ted');
  tedRoot.position.set(-1.05, parkHeightAt(-1.05, 0.2), 0.2);
  tedRoot.rotation.y = Math.atan2(sooAh.position.x - tedRoot.position.x, sooAh.position.z - tedRoot.position.z);
  if (playTedStandingIdle(0)) {
    characterMixers.Ted.update(0);
    groundTedDuringStand();
    saveStandingPose('Ted');
  }
  const sittingDown = new Set();
  const sitFinishHandlers = {};
  let debugRecording = false;
  let debugRecordingName = 'Ted';
  let debugSamples = [];
  let debugFrame = 0;
  let tedSitTransition = null;
  let message = 'Select a character. Use E to stand and Q to sit at the bench.';

  const dist = (x, z, point) => Math.hypot(x - point.x, z - point.z);
  function placeAtBenchAnchor(name, anchor) {
    const root = characterRoots[name];
    const localY = bench.worldToLocal(root.position.clone()).y;
    const position = bench.localToWorld(new T.Vector3(anchor.x, localY, anchor.z));
    player.x += position.x - root.position.x;
    player.z += position.z - root.position.z;
    root.position.x = position.x;
    root.position.z = position.z;
  }

  function benchPenetration(name, localX, localZ, localBottomY, collider, radius, height) {
    const [halfX, halfY, halfZ] = collider.userData.halfExtents;
    const center = collider.position;
    if (localBottomY + height <= center.y - halfY || localBottomY >= center.y + halfY) return 0;
    const overlapX = halfX + radius - Math.abs(localX - center.x);
    const overlapZ = halfZ + radius - Math.abs(localZ - center.z);
    return overlapX > 0 && overlapZ > 0 ? Math.min(overlapX, overlapZ) : 0;
  }

  function canMoveCharacterTo(name, fromX, fromZ, toX, toZ, bottomY, radius, height) {
    const bodyScale = bench.getWorldScale(benchScale);
    const localRadius = radius / Math.max(0.001, Math.min(Math.abs(bodyScale.x), Math.abs(bodyScale.z)));
    const localHeight = height / Math.max(0.001, Math.abs(bodyScale.y));
    for (const collider of benchColliders) {
      const fromDepth = benchPenetration(name, fromX, fromZ, bottomY, collider, localRadius, localHeight);
      const toDepth = benchPenetration(name, toX, toZ, bottomY, collider, localRadius, localHeight);
      if (toDepth <= 0 || (fromDepth > 0 && toDepth <= fromDepth + 0.001)) continue;
      return false;
    }
    return true;
  }

  function moveRootWithBenchCollision(name, root, desiredX, desiredZ) {
    const body = characterBodies[name];
    if (!body) return { x: desiredX, z: desiredZ };
    bench.updateMatrixWorld(true);
    const from = bench.worldToLocal(new T.Vector3(root.position.x, root.position.y, root.position.z));
    const desired = bench.worldToLocal(new T.Vector3(desiredX, root.position.y, desiredZ));
    const dx = desired.x - from.x;
    const dz = desired.z - from.z;
    let x = from.x;
    let z = from.z;
    if (Math.abs(dx) > 0.000001 && canMoveCharacterTo(name, from.x, from.z, x + dx, z, from.y, body.radius, body.height)) x += dx;
    if (Math.abs(dz) > 0.000001 && canMoveCharacterTo(name, from.x, from.z, x, z + dz, from.y, body.radius, body.height)) z += dz;
    const result = bench.localToWorld(new T.Vector3(x, from.y, z));
    const hitsObstacle = (px, pz) => obstacles.some((o) => {
      const next = Math.hypot(px - o.x, pz - o.z);
      return next < o.r + body.radius && next < Math.hypot(root.position.x - o.x, root.position.z - o.z);
    });
    if (hitsObstacle(result.x, root.position.z)) result.x = root.position.x;
    if (hitsObstacle(result.x, result.z)) result.z = root.position.z;
    const blockedByCharacter = name === 'MrLee'
      ? ['SooAh', 'Ted'].some((actorName) => Math.hypot(result.x - characterRoots[actorName].position.x, result.z - characterRoots[actorName].position.z) < body.radius + characterBodies[actorName].radius)
      : routeStarted && Math.hypot(result.x - mrLeeRoot.position.x, result.z - mrLeeRoot.position.z) < body.radius + characterBodies.MrLee.radius;
    if (blockedByCharacter) return { x: root.position.x, z: root.position.z };
    return { x: result.x, z: result.z };
  }

  function updateMrLeePatrol(dt) {
    if (!mrLeePatrolling) return;
    const actor = characterRoots[selectedCharacter];
    const dx = actor.position.x - mrLeeRoot.position.x;
    const dz = actor.position.z - mrLeeRoot.position.z;
    const distance = Math.hypot(dx, dz);
    const facingX = Math.sin(mrLeeRoot.rotation.y);
    const facingZ = Math.cos(mrLeeRoot.rotation.y);
    const facingDot = distance > 0.001 ? (facingX * dx + facingZ * dz) / distance : 1;
    const turnToward = (x, z) => {
      const target = Math.atan2(x - mrLeeRoot.position.x, z - mrLeeRoot.position.z);
      const delta = Math.atan2(Math.sin(target - mrLeeRoot.rotation.y), Math.cos(target - mrLeeRoot.rotation.y));
      mrLeeRoot.rotation.y += delta * Math.min(1, dt * 4.5);
    };

    if (mrLeeAware) {
      if (distance > 2.8) {
        mrLeeAware = false;
        mrLeePatrolWait = 1.6;
        message = 'Mr. Lee goes back to watching the path.';
      } else {
        setMrLeeMode('idle');
        turnToward(actor.position.x, actor.position.z);
        return;
      }
    } else if (distance < 2.1 && facingDot > 0.15) {
      mrLeeAware = true;
      setMrLeeMode('idle');
      turnToward(actor.position.x, actor.position.z);
      message = 'Mr. Lee spots you. Back off and try another route.';
      return;
    }

    if (mrLeePatrolWait > 0) {
      mrLeePatrolWait = Math.max(0, mrLeePatrolWait - dt);
      setMrLeeMode('idle');
      return;
    }

    const waypoint = mrLeeRoute[mrLeePatrolIndex];
    const toX = waypoint.x - mrLeeRoot.position.x;
    const toZ = waypoint.z - mrLeeRoot.position.z;
    const remaining = Math.hypot(toX, toZ);
    if (remaining < 0.12) {
      mrLeePatrolIndex = (mrLeePatrolIndex + 1) % mrLeeRoute.length;
      mrLeePatrolWait = 1.1;
      setMrLeeMode('idle');
      return;
    }
    turnToward(waypoint.x, waypoint.z);
    const turn = Math.atan2(Math.sin(Math.atan2(toX, toZ) - mrLeeRoot.rotation.y), Math.cos(Math.atan2(toX, toZ) - mrLeeRoot.rotation.y));
    if (Math.abs(turn) > 0.12) {
      setMrLeeMode('idle');
      return;
    }
    const step = Math.min(remaining, 0.82 * dt);
    const next = moveRootWithBenchCollision('MrLee', mrLeeRoot,
      mrLeeRoot.position.x + (toX / remaining) * step,
      mrLeeRoot.position.z + (toZ / remaining) * step);
    mrLeeRoot.position.x = next.x;
    mrLeeRoot.position.z = next.z;
    mrLeeRoot.position.y = parkHeightAt(next.x, next.z);
    setMrLeeMode('walk');
  }

  function saveStandingPose(name) {
    const pose = new Map();
    characterRoots[name].traverse((node) => {
      if (node.isBone) pose.set(node.name, {
        position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
      });
    });
    standingPoses[name] = pose;
  }

  function restoreStandingPose(name) {
    const pose = standingPoses[name];
    if (!pose) return;
    characterRoots[name].traverse((node) => {
      const saved = pose.get(node.name);
      if (!saved) return;
      node.position.copy(saved.position);
      node.quaternion.copy(saved.quaternion);
      node.scale.copy(saved.scale);
    });
  }

  function startRoute() {
    if (routeStarted) return true;
    const name = selectedCharacter;
    const root = characterRoots[name];
    const mixer = characterMixers[name];
    const clip = sitToStandClips[name];
    if (!root || !mixer || (name === 'SooAh' && !clip)) return false;
    routeStarted = true;
    root.position.set(routeSpawn.x, parkHeightAt(routeSpawn.x, routeSpawn.z), routeSpawn.z);
    root.rotation.y = Math.atan2(-routeSpawn.x, -routeSpawn.z);
    player.x = routeSpawn.x;
    player.z = routeSpawn.z;
    player.yaw = Math.atan2(routeSpawn.x, routeSpawn.z);
    setCameraView('back');
    followCamera.angle = followCamera.targetAngle;
    mrLeePatrolling = true;
    mrLeeAware = false;
    mrLeePatrolIndex = 1;
    mrLeePatrolWait = 3;
    setMrLeeMode('idle');
    if (name === 'Ted') {
      sittingCharacters.delete(name);
      sittingDown.delete(name);
      standingCharacters.add(name);
      standingReady.add(name);
      characterMode[name] = 'standingIdle';
      characterMixers[name].stopAllAction();
      characterMixers[name].update(0);
      characterActions[name] = null;
      delete facingTargets[name];
      delete pendingMoves[name];
      delete turnStates[name];
      turningCharacters.delete(name);
      playTedStandingIdle(0);
      characterMixers[name].update(0);
      groundTedDuringStand();
      saveStandingPose(name);
      message = 'Ted is standing and ready to walk.';
      return true;
    }
    sitClearance[name] = { y: 0, z: 0 };
    sittingCharacters.delete(name);
    standingReady.delete(name);
    standingCharacters.add(name);
    characterMode[name] = 'standingUp';
    const action = playClip(name, clip, { loop: false, fade: 0.16 });
    if (!action) return false;
    action.timeScale = name === 'SooAh' ? sooAhStandSpeed : 1;
    const onFinished = (event) => {
      if (event.action !== action) return;
      mixer.removeEventListener('finished', onFinished);
      delete standFinishHandlers[name];
      if (name === 'SooAh') groundSooAhDuringStand();
      if (name === 'Ted') groundTedDuringStand();
      saveStandingPose(name);
      standingReady.add(name);
      characterMode[name] = 'standingIdle';
    };
    standFinishHandlers[name] = onFinished;
    mixer.addEventListener('finished', onFinished);
    message = `${name === 'Ted' ? 'Ted' : 'Soo-ah'} heads toward the bench.`;
    return true;
  }

  function beginTurn(name, direction, angle = null) {
    const mixer = characterMixers[name];
    const root = characterRoots[name];
    const clip = turnClips[name]?.[direction];
    const measured = turnAngles[name]?.[direction] ?? Math.PI / 2;
    const amount = Math.abs(angle ?? Math.PI / 2);
    const action = playClip(name, clip, { loop: false, fade: 0.12 });
    const timeScale = measured / Math.max(amount, 0.1);
    if (action) action.timeScale = timeScale;
    walkingCharacters.delete(name);
    const turnAngle = direction === 'left' ? -amount : amount;
    turnStates[name] = {
      startYaw: root.rotation.y,
      endYaw: root.rotation.y + turnAngle,
      elapsed: 0,
      duration: Math.max((clip?.duration ?? 0.45) / timeScale, 0.25),
      direction,
    };
    delete movementModes[name];
    turningCharacters.add(name);
    turningDirection[name] = direction;
    delete turnConsumed[name];
    characterMode[name] = direction === 'left' ? 'turningLeft' : 'turningRight';
  }

  function setCameraView(view) {
    if (!(view in cameraViewOffsets)) return false;
    const facing = characterRoots[selectedCharacter].rotation.y;
    if (followCamera.mode === 'free') followCamera.angle = player.yaw;
    followCamera.mode = view;
    followCamera.targetAngle = followCamera.angle + wrapAngle(facing + cameraViewOffsets[view] - followCamera.angle);
    return true;
  }

  function updateFollowCamera(dt) {
    const root = characterRoots[mochiEating?.recipient ?? mochiCameraTarget ?? selectedCharacter];
    followCamera.angle += wrapAngle(followCamera.targetAngle - followCamera.angle) * (1 - Math.exp(-dt * 6));
    if (cafeJourney.active) {
      const companion = characterRoots[selectedCharacter === 'Ted' ? 'SooAh' : 'Ted'];
      const pairDistance = Math.hypot(root.position.x - companion.position.x, root.position.z - companion.position.z);
      followCamera.distance = Math.max(followCamera.distance, 4.8, pairDistance * 1.8 + 2.1);
      followTarget.set(
        (root.position.x + companion.position.x) / 2,
        (root.position.y + companion.position.y) / 2 + 0.92,
        (root.position.z + companion.position.z) / 2,
      );
    } else {
      followTarget.set(root.position.x, root.position.y + 0.7, root.position.z);
    }
    const horizontal = Math.cos(followCamera.pitch) * followCamera.distance;
    camera.position.set(
      followTarget.x + Math.sin(followCamera.angle) * horizontal,
      followTarget.y + Math.sin(followCamera.pitch) * followCamera.distance,
      followTarget.z + Math.cos(followCamera.angle) * horizontal,
    );
    camera.position.y = Math.max(camera.position.y, (school.active || family.active ? 0 : parkHeightAt(camera.position.x, camera.position.z)) + 0.3);
    camera.lookAt(followTarget);
    // Arrow keys walk relative to player.yaw, so keep it pointing where the camera looks.
    player.x = camera.position.x;
    player.z = camera.position.z;
    player.yaw = followCamera.angle;
  }

  const nearest = () => {
    // Talk range is measured from the character you play, not from the camera.
    const self = characterRoots[selectedCharacter].position;
    const targets = [
      selectedCharacter === 'SooAh'
        ? { id: 'ted', point: characterRoots.Ted.position, radius: 1.4 }
        : { id: 'sooAh', point: characterRoots.SooAh.position, radius: 1.4 },
      { id: 'lee', point: mrLeeRoot.position, radius: 1.8 },
    ];
    if ((mochiHolder === selectedCharacter && !mochiShared) || (mochiShared && mochiConsumed)) {
      const friend = targets[0];
      if (dist(self.x, self.z, friend.point) < friend.radius) return friend.id;
    }
    if (routeStarted && !mochiHolder && !mochiShared) targets.push({ id: 'mochi', point: mochiStool.position, radius: 3.2 });
    return targets
      .map((target) => ({ ...target, distance: dist(self.x, self.z, target.point) }))
      .filter((target) => target.distance < target.radius)
      .sort((a, b) => a.distance - b.distance)[0]?.id ?? null;
  };

  const attachMochiToHand = (name) => {
    const hand = name === 'Ted' ? tedRightHand : sooAhLeftHand;
    if (!hand) return false;
    hand.add(mochiItem);
    mochiItem.visible = false;
    stoolMochiStick.visible = false;
    mochiItem.scale.copy(mochiScale);
    hand.updateWorldMatrix(true, false);
    characterRoots[name].updateMatrixWorld(true);
    hand.getWorldPosition(heldMochiWorld);
    heldMochiWorld.y += 0.008;
    heldMochiForward.set(0, 0, 1).applyQuaternion(characterRoots[name].quaternion);
    heldMochiWorld.addScaledVector(heldMochiForward, 0.032);
    hand.add(heldMochiSkewer);
    heldMochiSkewer.position.copy(hand.worldToLocal(heldMochiWorld));
    const topBall = heldMochiSkewer.getObjectByName('MochiBall_2');
    if (topBall) topBall.visible = true;
    hand.getWorldScale(heldMochiParentScale);
    heldMochiSkewer.scale.set(
      1 / heldMochiParentScale.x,
      1 / heldMochiParentScale.y,
      1 / heldMochiParentScale.z,
    );
    hand.getWorldQuaternion(heldMochiHandQuaternion);
    characterRoots[name].getWorldQuaternion(heldMochiRootQuaternion);
    heldMochiSkewer.quaternion.copy(heldMochiHandQuaternion.invert().multiply(heldMochiRootQuaternion));
    heldMochiSkewer.visible = true;
    heldMochi.visible = false;
    mochiItem.rotation.set(0, 0, 0);
    return true;
  };
  const pickUpMochi = () => {
    if (!routeStarted || mochiHolder || mochiShared || !attachMochiToHand(selectedCharacter)) return false;
    mochiHolder = selectedCharacter;
    mochiConsumed = false;
    mochiEating = null;
    message = `${selectedCharacter === 'Ted' ? 'Ted' : 'Soo-ah'} picks up the mochi.`;
    return true;
  };
  const shareMochi = () => {
    if (mochiHolder !== selectedCharacter || mochiShared) return false;
    const receiver = selectedCharacter === 'Ted' ? 'SooAh' : 'Ted';
    const topBall = heldMochiSkewer.getObjectByName('MochiBall_2');
    if (!topBall) return false;
    if (!attachMochiToHand(receiver)) return false;
    heldMochiSkewer.updateMatrixWorld(true);
    topBall.updateWorldMatrix(true, false);
    topBall.getWorldPosition(heldMochiWorld);
    topBall.visible = false;
    const hand = receiver === 'Ted' ? tedRightHand : sooAhLeftHand;
    hand.add(heldMochi);
    heldMochi.position.copy(hand.worldToLocal(heldMochiWorld));
    hand.getWorldScale(heldMochiParentScale);
    heldMochi.scale.set(
      0.72 / heldMochiParentScale.x,
      0.72 / heldMochiParentScale.y,
      0.72 / heldMochiParentScale.z,
    );
    heldMochi.visible = true;
    mochiHolder = receiver;
    mochiShared = true;
    mochiConsumed = false;
    mochiEating = {
      recipient: receiver,
      elapsed: 0,
      duration: receiver === 'SooAh' && eatingClips.SooAh ? eatingClips.SooAh.duration : 3.1,
      biteAt: 0.9,
      handAnimation: receiver === 'SooAh' && Boolean(eatingClips.SooAh),
      startPosition: heldMochi.position.clone(),
      startScale: heldMochi.scale.clone(),
      startHeadQuaternion: (receiver === 'SooAh' ? sooAhHead : tedHead)?.quaternion.clone() ?? null,
    };
    if (mochiEating.handAnimation) {
      sittingTalkTimers.SooAh = 0;
      characterMode.SooAh = 'eating';
      playClip('SooAh', eatingClips.SooAh, { loop: false, fade: 0.12 });
    }
    if (followCamera.mode !== 'free') {
      followCamera.mode = 'front';
      followCamera.targetAngle = characterRoots[receiver].rotation.y;
    }
    mochiCameraTarget = receiver;
    message = selectedCharacter === 'Ted' ? 'Ted gives Soo-ah the mochi.' : 'Soo-ah shares the mochi with Ted.';
    return true;
  };

  function move({ forward = 0, strafe = 0, dt = 0, fast = false }) {
    if (followCamera.mode !== 'free') {
      // W/S zoom in and out, A/D orbit around the character.
      const rate = fast ? 2.4 : 1.4;
      followCamera.distance = clamp(followCamera.distance * Math.exp(-forward * rate * dt), 0.9, 9);
      followCamera.angle += strafe * rate * dt;
      followCamera.targetAngle += strafe * rate * dt;
      return;
    }
    const speed = fast ? 4.8 : 3.1;
    const dx = (-Math.sin(player.yaw) * forward + Math.cos(player.yaw) * strafe) * speed * dt;
    const dz = (-Math.cos(player.yaw) * forward - Math.sin(player.yaw) * strafe) * speed * dt;
    const nx = clamp(player.x + dx, -parkLimit, parkLimit);
    const nz = clamp(player.z + dz, -parkLimit, parkLimit);
    const nearChair = Math.hypot(nx, nz - 0.17) < 0.75;
    player.x = nx;
    player.z = nearChair ? nz + (nz < 0.17 ? -1 : 1) * 0.05 : nz;
  }

  function walkSelected({ directionX = 0, directionZ = 0, dt = 0, run = false } = {}) {
    if (audition.pending) return false;
    if (audition.active) return walkAuditionSelected({ directionX, directionZ, dt, run });
    if (family.active || family.pending) return false;
    if (school.active && school.phase === 'conversation') return false;
    if (cafeJourney.active && (cafeJourney.talking || cafeJourney.phase === 'at-cafe')) return false;
    if (journey.active && journey.phase === 'at-home') return false;
    if (cafeJourney.active) cafeJourney.runRequested = run && Math.hypot(directionX, directionZ) > 0.01;
    const name = selectedCharacter;
    const inputLength = Math.hypot(directionX, directionZ);
    if (cafeJourney.active) {
      const companion = characterRoots[name === 'Ted' ? 'SooAh' : 'Ted'].position;
      const root = characterRoots[name].position;
      const toCompanionX = companion.x - root.x;
      const toCompanionZ = companion.z - root.z;
      if (Math.hypot(toCompanionX, toCompanionZ) > 2.2
        && inputLength > 0.01
        && directionX * toCompanionX + directionZ * toCompanionZ < 0) {
        stopCafeWalker(name);
        return false;
      }
    }
    const mixer = characterMixers[name];
    if (!mixer || emotionalStates[name]?.blocksMovement) return false;
    if (!standingCharacters.has(name) || sittingDown.has(name)) return false;
    const useLookBehind = run && name === 'SooAh' && lookBehindRun;
    if (useLookBehind && !lookBehindRunClip) {
      ensureClip('SooAhLookBehindRun').catch((error) => console.error(error));
    } else if (run && !runningClips[name]) {
      ensureClip(name === 'SooAh' ? 'SooAhRun' : 'TedRun').catch((error) => console.error(error));
    }
    const root = characterRoots[name];
    const hasInput = inputLength > 0.01;
    if (!hasInput) {
      delete pendingMoves[name];
      if (walkingCharacters.has(name)) {
        characterActions[name]?.fadeOut(0.18);
        fadingMovement[name] = 0.18;
        walkingCharacters.delete(name);
        delete movementModes[name];
        characterMode[name] = 'standingIdle';
      }
      delete turnConsumed[name];
      return false;
    }
    pendingMoves[name] = { x: directionX / inputLength, z: directionZ / inputLength };
    if (!standingReady.has(name)) return false;
    if (turnStates[name]) return true;
    const direction = pendingMoves[name];
    // The imported Mixamo model faces local +Z; keep its yaw aligned with the world destination.
    const targetYaw = Math.atan2(direction.x, direction.z);
    delete facingTargets[name];
    const turnDelta = Math.atan2(Math.sin(targetYaw - root.rotation.y), Math.cos(targetYaw - root.rotation.y));
    const turnSide = turnDelta < 0 ? 'left' : 'right';
    const measuredAngle = turnAngles[name][turnSide];
    if (Math.abs(turnDelta) >= Math.min(measuredAngle * 0.8, Math.PI / 4)) {
      if (!turnClips[name][turnSide]) {
        ensureClip(`${name}Turn${turnSide === 'left' ? 'Left' : 'Right'}`).catch((error) => console.error(error));
        return true;
      }
      const turnStep = Math.min(Math.abs(turnDelta), Math.PI / 2);
      beginTurn(name, turnSide, turnStep);
      return true;
    }
    if (Math.abs(turnDelta) > 0.02) {
      root.rotation.y += turnDelta * Math.min(1, dt * 5);
      return true;
    }
    root.rotation.y = targetYaw;
    const useLookBehindClip = useLookBehind && Boolean(lookBehindRunClip);
    const desiredMode = run && (runningClips[name] || useLookBehindClip)
      ? useLookBehindClip ? 'lookingBehindRunning' : 'running'
      : 'walking';
    const clip = desiredMode === 'lookingBehindRunning' ? lookBehindRunClip
      : desiredMode === 'running' ? runningClips[name] : walkClipFor(name);
    if (!clip) {
      // Walk clip still streaming in: wait for it rather than gliding without animation.
      ensureClip(name === 'Ted' && activeWalkVariant.Ted === 'alternative' ? 'TedWalkAlternative' : `${name}Walk`)
        .catch((error) => console.error(error));
      return true;
    }
    const targetSpeed = desiredMode === 'walking' ? walkSpeeds[name] : runSpeeds[name];
    currentSpeeds[name] += (targetSpeed - currentSpeeds[name]) * Math.min(1, dt * 5);
    const step = currentSpeeds[name] * dt;
    const oldX = root.position.x;
    const oldZ = root.position.z;
    const movementLimitX = school.active ? 34 : parkLimit;
    const minZ = school.active ? schoolMapZ - 34 : -parkLimit;
    const maxZ = school.active ? schoolMapZ + 34 : parkLimit;
    const desiredX = clamp(oldX + direction.x * step, -movementLimitX, movementLimitX);
    const desiredZ = clamp(oldZ + direction.z * step, minZ, maxZ);
    const next = school.active
      ? { x: desiredX, z: desiredZ }
      : moveRootWithBenchCollision(name, root, desiredX, desiredZ);
    if (Math.hypot(next.x - oldX, next.z - oldZ) < 0.0005) {
      if (walkingCharacters.has(name)) {
        characterActions[name]?.fadeOut(0.12);
        fadingMovement[name] = 0.12;
        walkingCharacters.delete(name);
      }
      delete movementModes[name];
      characterMode[name] = 'standingIdle';
      return true;
    }
    if (movementModes[name] !== desiredMode) {
      playClip(name, clip, { loop: true, fade: 0.18 });
      movementModes[name] = desiredMode;
      walkingCharacters.add(name);
      characterMode[name] = desiredMode;
    }
    root.position.x = clamp(next.x, -movementLimitX, movementLimitX);
    root.position.z = clamp(next.z, minZ, maxZ);
    root.position.y = school.active ? 0 : parkHeightAt(root.position.x, root.position.z);
    player.x += root.position.x - oldX;
    player.z += root.position.z - oldZ;
    return true;
  }

  function stopCafeWalker(name) {
    if (!walkingCharacters.has(name)) return;
    characterActions[name]?.fadeOut(0.16);
    fadingMovement[name] = 0.16;
    walkingCharacters.delete(name);
    delete movementModes[name];
    characterMode[name] = 'standingIdle';
  }

  function updateCafeCompanion(dt) {
    if (!cafeJourney.active || cafeJourney.phase === 'at-cafe' || cafeJourney.talking) return;
    const leaderName = selectedCharacter;
    const name = leaderName === 'Ted' ? 'SooAh' : 'Ted';
    const leader = characterRoots[leaderName];
    const root = characterRoots[name];
    const side = name === 'Ted' ? 0.58 : -0.58;
    const targetX = leader.position.x - Math.sin(leader.rotation.y) * 0.72 + Math.cos(leader.rotation.y) * side;
    const targetZ = leader.position.z - Math.cos(leader.rotation.y) * 0.72 - Math.sin(leader.rotation.y) * side;
    const dx = targetX - root.position.x;
    const dz = targetZ - root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.48) {
      stopCafeWalker(name);
      return;
    }
    if (!standingReady.has(name) || turnStates[name]) return;

    const targetYaw = Math.atan2(dx, dz);
    const turnDelta = wrapAngle(targetYaw - root.rotation.y);
    if (Math.abs(turnDelta) > 0.55) {
      const direction = turnDelta < 0 ? 'left' : 'right';
      if (turnClips[name]?.[direction]) {
        stopCafeWalker(name);
        beginTurn(name, direction, Math.min(Math.abs(turnDelta), Math.PI / 2));
        return;
      }
    }
    if (Math.abs(turnDelta) > 0.12) {
      stopCafeWalker(name);
      root.rotation.y += turnDelta * Math.min(1, dt * 5);
      return;
    }
    root.rotation.y = targetYaw;

    const running = cafeJourney.runRequested || distance > 1.7;
    if (running && !runningClips[name]) {
      ensureClip(name === 'SooAh' ? 'SooAhRun' : 'TedRun').catch((error) => console.error(error));
    }
    const runClip = runningClips[name];
    const desiredMode = running && runClip ? 'running' : 'walking';
    const clip = desiredMode === 'running' ? runClip : walkClipFor(name);
    if (!clip) {
      ensureClip(name === 'Ted' && activeWalkVariant.Ted === 'alternative' ? 'TedWalkAlternative' : `${name}Walk`)
        .catch((error) => console.error(error));
      return;
    }
    const speed = desiredMode === 'running' ? runSpeeds[name] : walkSpeeds[name];
    const step = Math.min(distance - 0.42, speed * dt);
    if (step <= 0) return;
    const next = moveRootWithBenchCollision(name, root, root.position.x + (dx / distance) * step, root.position.z + (dz / distance) * step);
    if (Math.hypot(next.x - root.position.x, next.z - root.position.z) < 0.0005) {
      stopCafeWalker(name);
      return;
    }
    if (movementModes[name] !== desiredMode) {
      playClip(name, clip, { loop: true, fade: 0.18 });
      movementModes[name] = desiredMode;
      walkingCharacters.add(name);
      characterMode[name] = desiredMode;
    }
    root.position.x = next.x;
    root.position.z = next.z;
    root.position.y = parkHeightAt(next.x, next.z);
  }

  function look(dx, dy) {
    if (audition.active) return;
    if (followCamera.mode !== 'free') {
      followCamera.angle -= dx * 0.005;
      followCamera.targetAngle -= dx * 0.005;
      followCamera.pitch = clamp(followCamera.pitch + dy * 0.004, -0.1, 1.25);
      return;
    }
    player.yaw -= dx * 0.0022;
    player.pitch = clamp(player.pitch - dy * 0.0018, -0.85, 0.48);
  }

  function setAuditionPhase(phase, actor, clipName, { speed = 1, loop = false, message: line = '', duration = null } = {}) {
    audition.phase = phase;
    audition.elapsed = 0;
    const playback = actor && clipName ? playAuditionClip(actor, clipName, { loop, speed }) : null;
    audition.phaseDuration = duration ?? playback?.duration ?? 0;
    if (line) message = line;
  }

  function placeTedFigure() {
    tedAuditionFigure.visible = true;
    if (tedAuditionFigure.parent !== auditionStage) auditionStage.attach(tedAuditionFigure);
    const from = tedAuditionFigure.position.clone();
    audition.figureTransition = {
      from,
      to: new T.Vector3(-1.6, auditionStageTop, 2.3),
      elapsed: 0,
      duration: 0.8,
    };
  }

  function beginTedSinging() {
    setAuditionPhase('ted-singing', 'Ted', 'TedAuditionSinging', {
      speed: 3.2,
      message: 'Ted starts to sing, giving Soo-ah a moment to breathe.',
    });
  }

  function beginTedDance() {
    placeTedFigure();
    setAuditionPhase('ted-dance', 'Ted', 'TedGangnamStyle', {
      speed: 2.35,
      message: 'Ted sets down his figure and launches into his Gangnam Style dance.',
    });
  }

  function beginTedThumbsUp() {
    setAuditionPhase('ted-thumbs-up', 'Ted', 'TedThumbsUp', {
      speed: 1.7,
      message: 'Ted gives Soo-ah a thumbs-up.',
    });
  }

  function beginTedLine() {
    setAuditionPhase('ted-line', 'Ted', 'TedHappyGesture', {
      speed: 1.45,
      message: 'Ted: “Over to you, chipmunk.”',
      duration: 2.8,
    });
  }

  function beginSooAhHappy() {
    sendTedOffStage();
    setAuditionPhase('sooah-happy', 'SooAh', 'SooAhAuditionHappy', {
      speed: 3.1,
      message: 'Soo-ah smiles and finds her courage.',
    });
  }

  function beginSooAhWalkIn() {
    auditionRoots.SooAh.position.x = 1.7;
    auditionRoots.SooAh.rotation.y = -Math.PI / 2;
    setAuditionPhase('sooah-enter', 'SooAh', 'SooAhAuditionWalk', {
      speed: 1.1,
      loop: true,
      duration: 2.2,
      message: 'Soo-ah walks into the spotlight.',
    });
  }

  const sooAhDanceSections = [
    ['SooAhAuditionSinging', 3.2],
    ['SooAhHipHop', 2.35],
    ['SooAhJazz', 1.15],
    ['SooAhStepHipHop', 2.8],
    ['SooAhVictory', 2.7],
  ];

  function sendTedOffStage() {
    const root = auditionRoots.Ted;
    if (!root?.visible || audition.tedExit) return;
    const targetX = -7.4;
    const targetYaw = -Math.PI / 2;
    const turnDuration = 0.3;
    const walkDuration = Math.abs(targetX - root.position.x) / 2.7;
    playAuditionClip('Ted', 'TedAuditionWalk', { loop: true, speed: 1.25, fade: 0.12 });
    audition.tedExit = {
      startX: root.position.x,
      startYaw: root.rotation.y,
      targetX,
      targetYaw,
      z: root.position.z,
      turnDuration,
      walkDuration,
      elapsed: 0,
      duration: turnDuration + walkDuration,
    };
  }

  function focusSooAhPerformance() {
    const root = auditionRoots.SooAh;
    audition.cameraFocus = {
      x: root.position.x,
      z: root.position.z + (camera.aspect < 1 ? 4.0 : 3.7),
    };
  }

  function getJudgeScoreCards() {
    if (audition.score === 0 && !['retry', 'judges-reaction', 'judges-accepted', 'celebration'].includes(audition.phase)) {
      return auditionJudgeSources.map(({ title }) => ({ name: title, score: null }));
    }
    const base = 2 + clamp(audition.score, 0, 8);
    return [
      { name: 'Gen-1 Idol', score: clamp(base + 1, 1, 10) },
      { name: 'Age 22 Judge', score: clamp(base, 1, 10) },
      { name: 'Senior Judge', score: clamp(base - 1, 1, 10) },
    ];
  }

  function beginJudgesReaction() {
    audition.passed = true;
    school.auditionPassed = true;
    audition.phase = 'judges-reaction';
    audition.elapsed = 0;
    audition.phaseDuration = 3.2;
    audition.cameraFocus = { x: 0, z: 14.5 };
    playAuditionClip('SooAh', 'SooAhVictory', { loop: true, speed: 1.1 });
    message = 'The three NOVA judges compare their scorecards.';
  }

  function beginJudgeAcceptance() {
    const ted = auditionRoots.Ted;
    const sooAhActor = auditionRoots.SooAh;
    ted.visible = true;
    ted.position.set(-7.4, auditionStageTop, sooAhActor.position.z);
    ted.rotation.y = Math.PI / 2;
    const targetX = sooAhActor.position.x - 1.05;
    const walkDuration = Math.abs(targetX - ted.position.x) / 2.7;
    audition.tedReturn = { startX: ted.position.x, targetX, z: ted.position.z, elapsed: 0, duration: walkDuration };
    audition.phase = 'judges-accepted';
    audition.elapsed = 0;
    audition.phaseDuration = 0;
    audition.cameraFocus = { x: (targetX + sooAhActor.position.x) / 2, z: 14.5 };
    playAuditionClip('Ted', 'TedAuditionWalk', { loop: true, speed: 1.25, fade: 0.12 });
    const scores = getJudgeScoreCards().map(({ score }) => `${score}/10`).join(' · ');
    message = `The judges score Soo-ah ${scores}. “You’re in!” She’s been selected for NOVA.`;
  }

  function beginAuditionCelebration() {
    const ted = auditionRoots.Ted;
    const sooAhActor = auditionRoots.SooAh;
    ted.rotation.y = 0;
    sooAhActor.rotation.y = 0;
    playAuditionClip('Ted', 'TedHappyGesture', { loop: true, speed: 1.2 });
    playAuditionClip('SooAh', 'SooAhVictory', { loop: true, speed: 1.1 });
    audition.phase = 'celebration';
    audition.elapsed = 0;
    audition.phaseDuration = 3.2;
    audition.cameraFocus = { x: (ted.position.x + sooAhActor.position.x) / 2, z: sooAhActor.position.z + 7.0 };
    message = 'Ted and Soo-ah celebrate together. She has a place at NOVA.';
  }

  function startSooAhAutoSection(index) {
    if (index >= sooAhDanceSections.length) {
      audition.score = 8;
      beginJudgesReaction();
      return;
    }
    audition.autoSection = index;
    const [clip, speed] = sooAhDanceSections[index];
    const line = index === 0 ? 'Soo-ah begins to sing.'
      : index === 4 ? 'Soo-ah strikes a confident finishing pose.' : 'Soo-ah dances on the beat.';
    setAuditionPhase('sooah-auto', 'SooAh', clip, { speed, message: line });
  }

  function startSooAhAutoPerformance() {
    audition.score = 8;
    focusSooAhPerformance();
    startSooAhAutoSection(0);
  }

  function playSooAhCueMove(key) {
    const moves = {
      arrowup: ['SooAhHipHop', 2.35, false],
      arrowdown: ['SooAhAuditionSinging', 3.2, true],
      arrowleft: ['SooAhJazz', 1.15, false],
      arrowright: ['SooAhStepHipHop', 2.8, false],
    };
    const [clip, speed, loop] = moves[key] ?? ['SooAhAuditionIdle', 1, true];
    playAuditionClip('SooAh', clip, { loop, speed });
  }

  function finishSooAhQte() {
    if (audition.score < 5) {
      audition.passed = false;
      school.auditionPassed = false;
      audition.phase = 'retry';
      audition.elapsed = 0;
      audition.phaseDuration = 0;
      playAuditionClip('SooAh', 'SooAhAuditionIdle', { loop: true, speed: 1 });
      message = 'The judges see potential. Press F to try the audition again.';
      return;
    }
    setAuditionPhase('sooah-finale', 'SooAh', 'SooAhVictory', {
      speed: 2.7,
      message: 'Soo-ah finishes with a confident smile.',
    });
    audition.passed = true;
    school.auditionPassed = true;
  }

  function advanceSooAhCue(missed = false) {
    if (missed) {
      message = 'Keep going; the next beat is coming.';
      playAuditionClip('SooAh', 'SooAhAuditionIdle', { loop: true, speed: 1 });
    }
    audition.cueIndex++;
    audition.cueTimer = 0;
    audition.cueAnswered = false;
    if (audition.cueIndex >= audition.sequence.length) {
      finishSooAhQte();
    }
  }

  function startSooAhQte() {
    focusSooAhPerformance();
    audition.phase = 'sooah-qte';
    audition.elapsed = 0;
    audition.cueIndex = 0;
    audition.cueTimer = 0;
    audition.cueAnswered = false;
    audition.cueInterval = 3.0;
    audition.score = 0;
    const random = seededRandom(0x4e4f5641 + Math.floor(auditionTime * 1000) + audition.run * 97 + (selectedCharacter === 'Ted' ? 1 : 2));
    const choices = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    audition.sequence = Array.from({ length: 8 }, () => choices[Math.floor(random() * choices.length)]);
    audition.section = -1;
    playAuditionClip('SooAh', 'SooAhAuditionIdle', { loop: true, speed: 1 });
    message = 'Soo-ah waits for the first beat. Press the shown arrow to begin.';
  }

  function startAudition() {
    if (audition.active || audition.pending) return true;
    if (!auditionAccepted) return false;
    audition.pending = true;
    school.active = false;
    school.phase = 'inactive';
    school.dialogueIndex = 0;
    school.auditionPassed = false;
    audition.passed = false;
    journey.active = false;
    journey.phase = 'none';
    journey.destination = null;
    parkLimit = parkHalf - 0.9;
    message = 'The next morning, Ted and Soo-ah arrive at NOVA.';
    loadAuditionAssets().then(() => {
      audition.pending = false;
      audition.active = true;
      audition.run++;
      auditionStage.visible = true;
      for (const judge of auditionJudges) judge.root.visible = true;
      parkCharacterRoots.Ted.visible = false;
      parkCharacterRoots.SooAh.visible = false;
      mrLeeRoot.visible = false;
      mrLeePatrolling = false;
      walkingCharacters.clear();
      turningCharacters.clear();
      standingCharacters.clear();
      standingReady.clear();
      sittingCharacters.clear();
      sittingDown.clear();
      for (const collection of [turnStates, facingTargets, fadingMovement, movementModes, pendingMoves]) {
        for (const name of Object.keys(collection)) delete collection[name];
      }
      for (const name of ['SooAh', 'Ted']) {
        characterRoots[name] = auditionRoots[name];
        auditionRoots[name].visible = true;
        auditionRoots[name].position.set(0, auditionStageTop, auditionStageZ);
        auditionRoots[name].rotation.y = 0;
        sittingTalkTimers[name] = 0;
        auditionActions[name] = null;
        auditionCurrentClip[name] = null;
      }
      auditionStage.updateMatrixWorld(true);
      auditionStage.add(tedAuditionFigure);
      tedAuditionFigure.visible = false;
      tedAuditionFigure.scale.setScalar(0.5);
      tedAuditionFigure.position.set(-1.6, auditionStageTop, 2.3);
      tedAuditionFigure.rotation.set(0, 0, 0);
      audition.figureTransition = null;
      audition.tedExit = null;
      audition.cameraFocus = null;
      followCamera.mode = 'free';
      followCamera.angle = 0;
      followCamera.targetAngle = 0;
      followCamera.pitch = 0.1;
      player.x = 0;
      player.z = camera.aspect < 1 ? 7.5 : 6.2;
      player.yaw = 0;
      player.pitch = -0.08;
      const ted = auditionRoots.Ted;
      const sooAhActor = auditionRoots.SooAh;
      if (selectedCharacter === 'Ted') {
        ted.position.set(0, auditionStageTop, auditionStageZ + 4.1);
        ted.rotation.y = Math.PI;
        sooAhActor.position.set(1.7, auditionStageTop, auditionStageZ + 0.6);
        sooAhActor.rotation.y = -Math.PI / 2;
        audition.phase = 'ted-enter-player';
        playAuditionClip('Ted', 'TedHappyGesture', { loop: true, speed: 1.2 });
        message = 'Soo-ah freezes under the stage lights. Walk Ted to his mark.';
      } else {
        ted.position.set(-2.0, auditionStageTop, auditionStageZ + 0.6);
        ted.rotation.y = Math.PI / 2;
        sooAhActor.position.set(1.7, auditionStageTop, auditionStageZ + 0.6);
        sooAhActor.rotation.y = -Math.PI / 2;
        audition.phase = 'ted-enter-npc';
        audition.elapsed = 0;
        audition.phaseDuration = 2.3;
        playAuditionClip('Ted', 'TedAuditionWalk', { loop: true, speed: 1.25 });
        message = 'Soo-ah steps on stage and freezes as Ted comes to help.';
      }
      playAuditionClip('SooAh', 'SooAhAuditionTerrified', { loop: true, speed: 1.35 });
    }).catch((error) => {
      audition.pending = false;
      message = 'The NOVA audition scene could not load.';
      console.error(error);
    });
    return true;
  }

  function walkAuditionSelected({ directionX = 0, directionZ = 0, dt = 0, run = false } = {}) {
    if (selectedCharacter !== 'Ted' || audition.phase !== 'ted-enter-player') return false;
    const root = auditionRoots.Ted;
    const length = Math.hypot(directionX, directionZ);
    if (length < 0.01) {
      if (audition.walking) {
        audition.walking = false;
        playAuditionClip('Ted', 'TedHappyGesture', { loop: true, speed: 1.2 });
      }
      return false;
    }
    if (!audition.walking) {
      audition.walking = true;
      playAuditionClip('Ted', 'TedAuditionWalk', { loop: true, speed: run ? 1.45 : 1.1 });
    }
    const x = directionX / length;
    const z = directionZ / length;
    root.rotation.y = Math.atan2(x, z);
    const speed = run ? 3.0 : 2.0;
    root.position.x = clamp(root.position.x + x * speed * dt, -5.8, 5.8);
    root.position.z = clamp(root.position.z + z * speed * dt, auditionStageZ - 1.2, auditionStageZ + 4.1);
    if (root.position.z <= auditionStageZ + 0.95) {
      root.position.z = auditionStageZ + 0.95;
      root.position.x = -0.4;
      root.rotation.y = 0;
      audition.walking = false;
      beginTedSinging();
    }
    return true;
  }

  function handleAuditionKey(key) {
    if (!audition.active || audition.phase !== 'sooah-qte' || audition.cueAnswered) return false;
    const normalized = String(key).toLowerCase();
    if (!audition.sequence[audition.cueIndex]) return false;
    audition.cueAnswered = true;
    playSooAhCueMove(normalized);
    if (normalized === audition.sequence[audition.cueIndex]) {
      audition.score++;
      message = `On the beat · ${audition.score} moves hit.`;
    } else {
      message = 'Missed beat; keep dancing.';
    }
    return true;
  }

  function updateAudition(dt) {
    if (!audition.active) return;
    if (audition.tedReturn) {
      const returnState = audition.tedReturn;
      returnState.elapsed = Math.min(returnState.duration, returnState.elapsed + dt);
      const progress = returnState.elapsed / returnState.duration;
      const ted = auditionRoots.Ted;
      ted.position.x = returnState.startX + (returnState.targetX - returnState.startX) * progress;
      ted.position.z = returnState.z;
      if (progress >= 1) {
        ted.rotation.y = 0;
        audition.tedReturn = null;
        beginAuditionCelebration();
        return;
      }
    }
    if (audition.tedExit) {
      const exit = audition.tedExit;
      exit.elapsed = Math.min(exit.duration, exit.elapsed + dt);
      const root = auditionRoots.Ted;
      const turn = Math.min(1, exit.elapsed / exit.turnDuration);
      root.rotation.y = exit.startYaw + wrapAngle(exit.targetYaw - exit.startYaw) * turn;
      if (exit.elapsed > exit.turnDuration) {
        const walk = Math.min(1, (exit.elapsed - exit.turnDuration) / exit.walkDuration);
        root.position.x = exit.startX + (exit.targetX - exit.startX) * walk;
        root.position.z = exit.z;
      }
      if (exit.elapsed >= exit.duration) {
        root.visible = false;
        auditionMixers.Ted.stopAllAction();
        auditionActions.Ted = null;
        auditionCurrentClip.Ted = null;
        tedAuditionFigure.visible = false;
        audition.tedExit = null;
      }
    }
    if (audition.cameraFocus) {
      const blend = 1 - Math.exp(-dt * 3.5);
      player.x += (audition.cameraFocus.x - player.x) * blend;
      player.z += (audition.cameraFocus.z - player.z) * blend;
    }
    if (audition.figureTransition) {
      const transition = audition.figureTransition;
      transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
      const t = transition.elapsed / transition.duration;
      const eased = t * t * (3 - 2 * t);
      tedAuditionFigure.position.lerpVectors(transition.from, transition.to, eased);
      if (t >= 1) audition.figureTransition = null;
    }
    if (audition.phase === 'ted-enter-npc') {
      audition.elapsed = Math.min(audition.phaseDuration, audition.elapsed + dt);
      const t = audition.elapsed / audition.phaseDuration;
      const eased = t * t * (3 - 2 * t);
      auditionRoots.Ted.position.x = -2.0 + 1.4 * eased;
      if (t >= 1) {
        auditionRoots.Ted.rotation.y = 0;
        beginTedSinging();
      }
      return;
    }
    if (audition.phase === 'sooah-enter') {
      audition.elapsed = Math.min(audition.phaseDuration, audition.elapsed + dt);
      const t = audition.elapsed / audition.phaseDuration;
      const eased = t * t * (3 - 2 * t);
      auditionRoots.SooAh.position.x = 1.7 + (0.8 - 1.7) * eased;
      if (t >= 1) {
        auditionRoots.SooAh.rotation.y = 0;
        if (selectedCharacter === 'SooAh') startSooAhQte();
        else startSooAhAutoPerformance();
      }
      return;
    }
    if (audition.phase === 'ted-enter-player') return;
    if (audition.phase === 'sooah-qte') {
      audition.cueTimer += dt;
      if (audition.cueTimer >= audition.cueInterval) advanceSooAhCue(!audition.cueAnswered);
      return;
    }
    if (!audition.phaseDuration || audition.phase === 'complete') return;
    audition.elapsed += dt;
    if (audition.elapsed < audition.phaseDuration) return;
    if (audition.phase === 'ted-singing') beginTedDance();
    else if (audition.phase === 'ted-dance') beginTedThumbsUp();
    else if (audition.phase === 'ted-thumbs-up') beginTedLine();
    else if (audition.phase === 'ted-line') beginSooAhHappy();
    else if (audition.phase === 'sooah-happy') beginSooAhWalkIn();
    else if (audition.phase === 'sooah-auto') startSooAhAutoSection(audition.autoSection + 1);
    else if (audition.phase === 'sooah-finale') beginJudgesReaction();
    else if (audition.phase === 'judges-reaction') beginJudgeAcceptance();
    else if (audition.phase === 'celebration') beginSchoolDay();
  }

  function startHomeJourney() {
    if (!auditionAccepted || !mochiShared || !mochiConsumed || audition.active || audition.pending || journey.active) return journey.active;
    const name = selectedCharacter;
    mochiCameraTarget = null;
    if (followCamera.mode !== 'free') setCameraView('back');
    const destination = homeDestinations[name];
    journey.active = true;
    journey.phase = 'to-home';
    journey.destination = destination;
    parkLimit = 42;
    mrLeePatrolling = false;
    if (sittingCharacters.has(name) && canStandSelected()) standSelected();
    message = `They say goodbye. Follow the map to ${destination.label}.`;
    return true;
  }

  function updateHomeJourney() {
    if (!journey.active || journey.phase !== 'to-home') return;
    const name = selectedCharacter;
    const root = characterRoots[name];
    if (Math.hypot(root.position.x - journey.destination.x, root.position.z - journey.destination.z) > 2.2) return;
    journey.phase = 'at-home';
    if (walkingCharacters.has(name)) {
      characterActions[name]?.fadeOut(0.15);
      walkingCharacters.delete(name);
      delete movementModes[name];
      fadingMovement[name] = 0.15;
    }
    characterMode[name] = 'standingIdle';
    const label = name === 'Ted' ? 'Ted' : 'Soo-ah';
    message = `${label} arrives home. Press F for the next morning at NOVA.`;
  }

  function beginSchoolDay() {
    if (!school.auditionPassed) return false;
    audition.active = false;
    audition.phase = 'complete';
    journey.active = false;
    journey.phase = 'none';
    journey.destination = null;
    mrLeePatrolling = false;
    mrLeeAware = false;
    parkLimit = 18;
    school.active = true;
    school.phase = 'arrival';
    school.dialogueIndex = 0;
    school.arrived = 0;

    characterRoots.Ted = parkCharacterRoots.Ted;
    characterRoots.SooAh = parkCharacterRoots.SooAh;
    const schoolStarts = {
      Ted: { x: -0.55, z: schoolMapZ + 4.5, yaw: Math.PI / 2 },
      SooAh: { x: 0.55, z: schoolMapZ + 4.5, yaw: -Math.PI / 2 },
    };
    const completeArrival = (name) => {
      if (!standingPoses[name]) restoreStandingPose(name);
      standingCharacters.add(name);
      standingReady.add(name);
      if (name === 'Ted') playTedStandingIdle(0.16);
      characterMode[name] = 'standingIdle';
      school.arrived++;
      if (school.arrived === 2) {
        school.phase = 'conversation';
        school.dialogueIndex = 1;
        message = schoolDialogue[selectedCharacter][0];
      }
    };
    schoolScene.add(parkCharacterRoots.Ted, parkCharacterRoots.SooAh);
    for (const name of ['Ted', 'SooAh']) {
      const root = characterRoots[name];
      const mixer = characterMixers[name];
      const start = schoolStarts[name];
      root.visible = true;
      root.position.set(start.x, 0, start.z);
      root.rotation.y = start.yaw;
      sittingCharacters.delete(name);
      sittingDown.delete(name);
      standingCharacters.add(name);
      standingReady.delete(name);
      walkingCharacters.delete(name);
      turningCharacters.delete(name);
      delete movementModes[name];
      delete turnStates[name];
      delete facingTargets[name];
      sittingTalkTimers[name] = 0;
      characterMode[name] = 'standingUp';
      sitClearance[name] = { y: 0, z: 0 };
      mixer.stopAllAction();
      mixer.update(0);
      if (standFinishHandlers[name]) {
        mixer.removeEventListener('finished', standFinishHandlers[name]);
        delete standFinishHandlers[name];
      }
      if (sitFinishHandlers[name]) {
        mixer.removeEventListener('finished', sitFinishHandlers[name]);
        delete sitFinishHandlers[name];
      }
      const action = playClip(name, sitToStandClips[name], { loop: false, fade: 0.12 });
      if (!action) {
        completeArrival(name);
        continue;
      }
      action.timeScale = name === 'SooAh' ? sooAhStandSpeed : 1;
      const onFinished = (event) => {
        if (event.action !== action) return;
        mixer.removeEventListener('finished', onFinished);
        delete standFinishHandlers[name];
        if (name === 'SooAh') groundSooAhDuringStand();
        else groundTedDuringStand();
        saveStandingPose(name);
        completeArrival(name);
      };
      standFinishHandlers[name] = onFinished;
      mixer.addEventListener('finished', onFinished);
    }
    followCamera.mode = 'free';
    player.x = 0;
    player.z = schoolMapZ + 8;
    player.yaw = 0;
    player.pitch = -0.08;
    message = 'The next school day begins. Ted and Soo-ah meet at the school entrance.';
    return true;
  }

  function advanceSchoolDialogue() {
    if (!school.active) return false;
    if (school.phase === 'arrival') return true;
    const lines = schoolDialogue[selectedCharacter];
    if (school.phase === 'conversation' && school.dialogueIndex < lines.length) {
      message = lines[school.dialogueIndex++];
      if (school.dialogueIndex >= lines.length) school.phase = 'ready-to-tell';
      return true;
    }
    return startCafeJourney();
  }

  function startCafeJourney() {
    if (!school.active || school.phase !== 'ready-to-tell' || !school.auditionPassed || cafeJourney.active) return false;
    cafeJourney.active = true;
    cafeJourney.phase = 'walking';
    cafeJourney.talks = [false, false];
    cafeJourney.talking = null;
    cafeJourney.runRequested = false;
    school.active = false;
    school.phase = 'complete';
    parkLimit = 42;
    scene.add(parkCharacterRoots.Ted, parkCharacterRoots.SooAh);
    for (const name of ['Ted', 'SooAh']) {
      standingCharacters.add(name);
      standingReady.add(name);
      characterRoots[name].visible = true;
    }
    followCamera.distance = 5.1;
    followCamera.pitch = 0.24;
    followCamera.mode = 'back';
    followCamera.angle = Math.PI;
    followCamera.targetAngle = Math.PI;
    player.yaw = Math.PI;
    message = 'Ted and Soo-ah leave school together for Lee’s Cafe.';
    return true;
  }

  function startCafeTalk(index) {
    const stop = cafeTalkStops[index];
    if (!cafeJourney.active || !stop || cafeJourney.talks[index]) return false;
    cafeJourney.talks[index] = true;
    cafeJourney.talking = { index, line: 0 };
    for (const name of ['Ted', 'SooAh']) {
      stopCafeWalker(name);
      if (turnStates[name]) {
        delete turnStates[name];
        delete turningDirection[name];
        turningCharacters.delete(name);
        characterMixers[name].stopAllAction();
        characterMixers[name].update(0);
        restoreStandingPose(name);
        characterActions[name] = null;
      }
      delete movementModes[name];
      characterMode[name] = 'standingIdle';
    }
    const ted = characterRoots.Ted.position;
    const sooAh = characterRoots.SooAh.position;
    facingTargets.Ted = Math.atan2(sooAh.x - ted.x, sooAh.z - ted.z);
    facingTargets.SooAh = Math.atan2(ted.x - sooAh.x, ted.z - sooAh.z);
    return advanceCafeTalk();
  }

  function advanceCafeTalk() {
    const talk = cafeJourney.talking;
    if (!talk) return false;
    const lines = cafeTalkStops[talk.index].lines;
    message = lines[talk.line++];
    if (talk.line >= lines.length) {
      cafeJourney.talking = null;
      delete facingTargets.Ted;
      delete facingTargets.SooAh;
    }
    return true;
  }

  function nearbyCafeTalk() {
    if (!cafeJourney.active || cafeJourney.talking) return -1;
    const player = characterRoots[selectedCharacter].position;
    const companion = characterRoots[selectedCharacter === 'Ted' ? 'SooAh' : 'Ted'].position;
    return cafeTalkStops.findIndex((stop, index) => !cafeJourney.talks[index]
      && Math.hypot(player.x - stop.x, player.z - stop.z) < 2.6
      && Math.hypot(companion.x - stop.x, companion.z - stop.z) < 4.2);
  }

  function updateCafeJourney() {
    if (!cafeJourney.active || cafeJourney.talking || cafeJourney.phase === 'at-cafe') return;
    const goal = cafeJourney.destination;
    const ted = characterRoots.Ted.position;
    const sooAh = characterRoots.SooAh.position;
    if (Math.hypot(ted.x - goal.x, ted.z - goal.z) <= 1.7
      && Math.hypot(sooAh.x - goal.x, sooAh.z - goal.z) <= 1.7) {
      cafeJourney.phase = 'at-cafe';
      stopCafeWalker('Ted');
      stopCafeWalker('SooAh');
      message = 'Ted and Soo-ah have reached the entrance to Lee’s Cafe.';
    }
  }

  function loadFamilyAssets() {
    if (mrsLeeRoot && mrLeeHomeRoot) return Promise.resolve();
    if (!familyAssetsPromise) {
      familyAssetsPromise = Promise.all([
        fbxLoader.loadAsync('./assets/characters/mrs-lee-happy-gesture.fbx'),
        fbxLoader.loadAsync('./assets/characters/mr-lee-talking-home.fbx'),
        ensureClip('MrsLeeTalking'),
        textureLoader.loadAsync('./assets/textures/family/mrs-lee.png'),
      ]).then(([mrsAsset, mrAsset, talkingClip, texture]) => {
        const mrsGestureClip = mrsAsset.animations?.[0];
        mrLeeHomeTalkClip = mrAsset.animations?.[0];
        if (!mrsGestureClip) throw new Error('Mrs Lee home gesture FBX has no animation clip.');
        if (!mrLeeHomeTalkClip) throw new Error('Mr Lee home talking FBX has no animation clip.');
        mrsLeeRoot = mrsAsset;
        mrsLeeTalkingClip = talkingClip;
        applyCharacterTexture(mrsLeeRoot, texture, maxAnisotropy, true);
        fitToHeight(mrsLeeRoot, 1.48);
        mrsLeeRoot.name = 'MrsLeeHome';
        mrsLeeRoot.visible = false;
        setShadows(mrsLeeRoot);
        familyScene.add(mrsLeeRoot);
        mrLeeHomeRoot = mrAsset;
        applyCharacterTexture(mrLeeHomeRoot, mrLeeTexture, maxAnisotropy, true);
        fitToHeight(mrLeeHomeRoot, 1.6);
        mrLeeHomeRoot.name = 'MrLeeHome';
        mrLeeHomeRoot.visible = false;
        setShadows(mrLeeHomeRoot);
        familyScene.add(mrLeeHomeRoot);
        mrLeeHomeMixer = new T.AnimationMixer(mrLeeHomeRoot);
        mrsLeeMixer = new T.AnimationMixer(mrsLeeRoot);
        mrsLeeGestureAction = mrsLeeMixer.clipAction(mrsGestureClip);
        mrsLeeGestureAction.setLoop(T.LoopOnce, 1);
        mrsLeeGestureAction.clampWhenFinished = true;
        mixers.push(mrLeeHomeMixer, mrsLeeMixer);
      }).catch((error) => {
        familyAssetsPromise = null;
        throw error;
      });
    }
    return familyAssetsPromise;
  }

  function setMrLeeHomeMode(mode) {
    if (!mrLeeHomeMixer) return false;
    const clip = mode === 'talking' ? mrLeeHomeTalkClip : mrLeeClips.idle;
    if (!clip) return false;
    const action = mrLeeHomeMixer.clipAction(clip);
    if (action === mrLeeHomeAction && action.isRunning()) return true;
    action.reset();
    action.setLoop(T.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    if (mrLeeHomeAction) mrLeeHomeAction.fadeOut(0.2);
    action.fadeIn(0.2).play();
    mrLeeHomeAction = action;
    return true;
  }

  function playMrsLeeMode(mode) {
    if (!mrsLeeMixer) return false;
    if (mode === 'talking' && mrsLeeTalkingClip) {
      const action = mrsLeeMixer.clipAction(mrsLeeTalkingClip);
      action.reset();
      action.setLoop(T.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      mrsLeeGestureAction?.fadeOut(0.14);
      mrsLeeTalkingAction?.fadeOut(0.14);
      action.fadeIn(0.14).play();
      mrsLeeTalkingAction = action;
      return true;
    }
    mrsLeeTalkingAction?.fadeOut(0.14);
    if (!mrsLeeGestureAction) return false;
    mrsLeeGestureAction.reset();
    mrsLeeGestureAction.setLoop(T.LoopOnce, 1);
    mrsLeeGestureAction.clampWhenFinished = true;
    mrsLeeGestureAction.fadeIn(0.14).play();
    return true;
  }

  function faceFamilyActor(actor, target) {
    actor.rotation.y = Math.atan2(target.position.x - actor.position.x, target.position.z - actor.position.z);
  }

  function setCafeFamilySpeaker(line) {
    faceFamilyActor(mrLeeHomeRoot, characterRoots.SooAh);
    faceFamilyActor(mrsLeeRoot, characterRoots.SooAh);
    if (line.startsWith('Mr. Lee:')) {
      setMrLeeHomeMode('talking');
      playMrsLeeMode('supportive');
    } else if (line.startsWith('Mrs. Lee:')) {
      setMrLeeHomeMode('idle');
      playMrsLeeMode('talking');
    } else if (line.startsWith('Soo-ah:')) {
      setMrLeeHomeMode('idle');
      playMrsLeeMode('supportive');
      faceFamilyActor(characterRoots.SooAh, mrLeeHomeRoot);
      if (line.includes('Appa, Eomma') || line.includes('afraid')) triggerNervous('SooAh');
    } else {
      setMrLeeHomeMode('idle');
      playMrsLeeMode('supportive');
      faceFamilyActor(characterRoots.Ted, characterRoots.SooAh);
    }
  }

  function updateCafeFamilyScene(dt) {
    if (!family.active) return;
    if (family.phase === 'entering' && family.entry) {
      const entry = family.entry;
      entry.elapsed = Math.min(entry.duration, entry.elapsed + dt);
      const t = entry.elapsed / entry.duration;
      const eased = t * t * (3 - 2 * t);
      for (const name of ['Ted', 'SooAh']) {
        const root = characterRoots[name];
        const from = entry.starts[name];
        const to = entry.ends[name];
        root.position.set(from.x + (to.x - from.x) * eased, 0, from.z + (to.z - from.z) * eased);
        root.rotation.y = 0;
      }
      if (t >= 1) {
        family.entry = null;
        for (const name of ['Ted', 'SooAh']) {
          characterActions[name]?.fadeOut(0.16);
          walkingCharacters.delete(name);
          delete movementModes[name];
          fadingMovement[name] = 0.16;
          characterMode[name] = 'standingIdle';
        }
        family.phase = 'conversation';
        family.dialogueIndex = 0;
        message = 'Mr. Lee: Ted and Soo-ah? Why have you come together? Is something wrong?';
        setCafeFamilySpeaker(message);
      }
    }
    if (family.phase === 'reaction-pause') {
      family.pauseRemaining = Math.max(0, family.pauseRemaining - dt);
      if (family.pauseRemaining === 0) {
        family.phase = 'conversation';
        message = 'Mr. Lee is quiet for a moment.';
      }
    }
    if (family.mrsApproach) {
      const move = family.mrsApproach;
      move.elapsed = Math.min(move.duration, move.elapsed + dt);
      const scaled = (move.elapsed / move.duration) * (move.points.length - 1);
      const segment = Math.min(move.points.length - 2, Math.floor(scaled));
      const local = scaled - segment;
      const a = move.points[segment];
      const b = move.points[segment + 1];
      const eased = local * local * (3 - 2 * local);
      mrsLeeRoot.position.set(a.x + (b.x - a.x) * eased, 0, a.z + (b.z - a.z) * eased);
      faceFamilyActor(mrsLeeRoot, characterRoots.SooAh);
      if (move.elapsed >= move.duration) {
        mrsLeeRoot.position.set(b.x, 0, b.z);
        family.mrsApproach = null;
        playMrsLeeMode('supportive');
      }
    }
  }

  function startFamilyVisit() {
    if (!school.auditionPassed || family.active || family.auditionResultTold) return family.active;
    if (family.pending) return true;
    family.pending = true;
    family.phase = 'loading';
    message = 'Soo-ah and Ted step inside Lee’s Cafe.';
    loadFamilyAssets().then(() => {
      family.pending = false;
      family.active = true;
      family.phase = 'entering';
      family.dialogueIndex = 0;
      family.responseChoice = null;
      family.pendingChoiceResponse = null;
      family.auditionResultTold = false;
      family.mrsApproach = null;
      school.active = false;
      school.phase = 'complete';
      cafeJourney.active = false;
      cafeJourney.phase = 'complete';
      mrLeePatrolling = false;
      mrLeeAware = false;

      familyScene.add(cafeRoot, parkCharacterRoots.Ted, parkCharacterRoots.SooAh, mrLeeHomeRoot, mrsLeeRoot);
      setCafeInterior(true);
      family.entry = {
        elapsed: 0,
        duration: 1.15,
        starts: {
          Ted: { x: -0.8, z: -1.9 },
          SooAh: { x: -0.05, z: -2.05 },
        },
        ends: {
          Ted: { x: -0.65, z: -0.68 },
          SooAh: { x: 0.4, z: -0.78 },
        },
      };
      for (const name of ['Ted', 'SooAh']) {
        const root = parkCharacterRoots[name];
        characterRoots[name] = root;
        root.visible = true;
        root.position.set(family.entry.starts[name].x, 0, family.entry.starts[name].z);
        root.rotation.y = 0;
        sittingCharacters.delete(name);
        sittingDown.delete(name);
        walkingCharacters.delete(name);
        turningCharacters.delete(name);
        standingCharacters.add(name);
        standingReady.add(name);
        characterMode[name] = 'standingIdle';
        delete movementModes[name];
        delete turnStates[name];
        characterMixers[name].stopAllAction();
        characterMixers[name].update(0);
        restoreStandingPose(name);
        const walkClip = walkClipFor(name);
        if (walkClip) {
          playClip(name, walkClip, { loop: true, fade: 0.15 });
          walkingCharacters.add(name);
          movementModes[name] = 'walking';
          characterMode[name] = 'walking';
        }
      }

      const tedHomeRoot = parkCharacterRoots.Ted;
      // The park-scale Ted mesh reads short beside Soo-ah at home; keep his feet grounded while scaling the visual up slightly.
      tedHomeRoot.scale.setScalar(1.18);

      mrLeeRoot.visible = false;
      mrLeeHomeRoot.visible = true;
      mrLeeHomeRoot.position.set(0.55, 0, 0.92);
      mrLeeHomeRoot.rotation.y = Math.PI;
      mrsLeeRoot.visible = true;
      mrsLeeRoot.position.set(-0.8, 0, 0.92);
      mrsLeeRoot.rotation.y = Math.PI;
      mrLeeHomeMixer.stopAllAction();
      mrLeeHomeMixer.update(0);
      mrLeeHomeAction = null;
      setMrLeeHomeMode('idle');
      if (mrsLeeGestureAction) {
        mrsLeeGestureAction.reset();
        mrsLeeGestureAction.setLoop(T.LoopOnce, 1);
        mrsLeeGestureAction.clampWhenFinished = true;
        mrsLeeGestureAction.play();
      }
      groundTedDuringStand();
      groundSooAhDuringStand();
      familyPath.position.y = 0;

      followCamera.mode = 'free';
      player.x = -0.2;
      player.z = -6.0;
      player.yaw = Math.PI;
      player.pitch = 0.02;
      message = 'Soo-ah and Ted enter Lee’s Cafe. Mr. Lee notices them behind the counter.';
    }).catch((error) => {
      family.pending = false;
      family.phase = 'ready-to-tell';
      message = 'Lee’s Cafe conversation could not load. Press F to try again.';
      console.error(error);
    });
    return true;
  }

  function advanceFamilyDialogue() {
    if (!family.active) return false;
    if (family.phase === 'complete') return leaveCafeStory();
    if (['entering', 'reaction-pause', 'choice'].includes(family.phase)) return true;
    if (family.pendingChoiceResponse) {
      message = family.pendingChoiceResponse;
      family.pendingChoiceResponse = null;
      setCafeFamilySpeaker(message);
      return true;
    }
    message = familyDialogue[family.dialogueIndex++];
    setCafeFamilySpeaker(message);
    if (message.includes('I auditioned for NOVA. And… I passed.')) {
      family.auditionResultTold = true;
      family.phase = 'reaction-pause';
      family.pauseRemaining = 1.25;
      setMrLeeHomeMode('idle');
    } else if (message.includes('I was afraid you would say no.')) {
      family.phase = 'choice';
    } else if (message.startsWith('Mrs. Lee: You passed?')) {
      family.mrsApproach = {
        elapsed: 0,
        duration: 1.8,
        points: [
          { x: -0.8, z: 0.92 },
          { x: -1.35, z: 0.92 },
          { x: -1.35, z: -0.25 },
          { x: 0.9, z: -0.35 },
        ],
      };
    }
    if (family.dialogueIndex >= familyDialogue.length) {
      family.phase = 'complete';
      family.storyComplete = true;
    }
    return true;
  }

  function chooseFamilyResponse(index) {
    if (!family.active || family.phase !== 'choice' || !Number.isInteger(index) || !familyChoices[index]) return false;
    const choice = familyChoices[index];
    family.responseChoice = index;
    family.pendingChoiceResponse = choice.reply;
    family.phase = 'conversation';
    message = `Soo-ah: “${choice.text}”`;
    setCafeFamilySpeaker(`Soo-ah: ${choice.text}`);
    return true;
  }

  function leaveCafeStory() {
    if (!family.active || family.phase !== 'complete') return false;
    family.active = false;
    family.phase = 'complete';
    familyScene.add(familyHouse, familyGround, familyPath);
    scene.add(cafeRoot, parkCharacterRoots.Ted, parkCharacterRoots.SooAh);
    setCafeInterior(false);
    const outside = {
      Ted: { x: -5.55, z: 31.5 },
      SooAh: { x: -4.45, z: 31.5 },
    };
    for (const name of ['Ted', 'SooAh']) {
      const root = characterRoots[name];
      root.position.set(outside[name].x, parkHeightAt(outside[name].x, outside[name].z), outside[name].z);
      root.rotation.y = Math.PI;
      standingCharacters.add(name);
      standingReady.add(name);
      if (name === 'Ted') playTedStandingIdle(0.16);
      else characterMode[name] = 'standingIdle';
    }
    parkLimit = parkHalf - 0.9;
    followCamera.mode = 'front';
    followCamera.angle = Math.PI;
    followCamera.distance = 5.4;
    followCamera.pitch = 0.22;
    setCameraView('front');
    message = 'Soo-ah has told her parents about NOVA. The family will talk more soon.';
    return true;
  }

  function mapState() {
    if (cafeJourney.active) {
      const root = characterRoots[selectedCharacter];
      let nearestRouteIndex = 0;
      let nearestRouteDistance = Infinity;
      for (let i = 0; i < cafeRouteNodes.length; i++) {
        const point = cafeRouteNodes[i];
        const distance = Math.hypot(root.position.x - point.x, root.position.z - point.z);
        if (distance < nearestRouteDistance) {
          nearestRouteDistance = distance;
          nearestRouteIndex = i;
        }
      }
      return {
        visible: true,
        phase: cafeJourney.phase,
        player: { x: root.position.x, z: root.position.z, yaw: root.rotation.y },
        destination: cafeJourney.destination,
        goal: { ...cafeJourney.destination, label: 'C' },
        route: cafeRouteNodes.slice(nearestRouteIndex),
      };
    }
    if (!journey.active) return { visible: false };
    const root = characterRoots[selectedCharacter];
    let route = [];
    if (journey.phase === 'to-home') {
      const nodes = homeRouteNodes[selectedCharacter];
      let closest = 0;
      let nearest = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const distance = Math.hypot(root.position.x - nodes[i].x, root.position.z - nodes[i].z);
        if (distance < nearest) { nearest = distance; closest = i; }
      }
      route = nodes.slice(closest);
    }
    return {
      visible: true,
      phase: journey.phase,
      player: { x: root.position.x, z: root.position.z, yaw: root.rotation.y },
      destination: journey.destination,
      route,
      homes: Object.entries(homeDestinations).map(([name, home]) => ({
        x: home.x,
        z: home.z,
        label: home.marker,
        active: name === selectedCharacter,
      })),
    };
  }

  function interact() {
    if (audition.pending) return true;
    if (family.pending) return true;
    if (family.active) return advanceFamilyDialogue();
    if (cafeJourney.talking) return advanceCafeTalk();
    if (cafeJourney.active) {
      const talkIndex = nearbyCafeTalk();
      if (talkIndex >= 0) return startCafeTalk(talkIndex);
      if (cafeJourney.phase === 'at-cafe') return startFamilyVisit();
      message = 'Keep walking together to the entrance of Lee’s Cafe.';
      return true;
    }
    if (school.active) return advanceSchoolDialogue();
    if (audition.active) {
      if (audition.phase === 'retry') {
        startSooAhQte();
        return true;
      }
      if (audition.phase === 'ted-enter-player') {
        if (auditionRoots.Ted.position.z <= auditionStageZ + 1.1) beginTedSinging();
        else message = 'Walk Ted farther onto the stage first.';
      }
      return true;
    }
    if (journey.active) {
      if (journey.phase === 'at-home') {
        journey.active = false;
        journey.phase = 'none';
        parkLimit = parkHalf - 0.9;
        return startAudition();
      }
      return true;
    }
    if (auditionAccepted && mochiShared && mochiConsumed) return startHomeJourney();
    if (mochiEating) {
      message = mochiEating.recipient === 'SooAh' ? 'Soo-ah is taking a bite…' : 'Ted is taking a bite…';
      return true;
    }
    const target = nearest();
    if (!target) return false;
    if (target === 'mochi') return pickUpMochi();
    const isBenchFriend = selectedCharacter === 'Ted' ? target === 'sooAh' : target === 'ted';
    if (routeStarted && isBenchFriend) {
      if (mrLeeAware) {
        message = 'Mr. Lee is watching. Move out of sight before you share the mochi or talk.';
        return true;
      }
      if (mochiHolder === selectedCharacter && !mochiShared) return shareMochi();
      if (!mochiShared || !mochiConsumed) {
        message = 'Pick up the mochi at the stool and share it before talking about NOVA.';
        return true;
      }
      return talkAtBench();
    }
    if (target === 'lee') {
      message = selectedCharacter === 'SooAh'
        ? 'Mr. Lee: Soo-ah, your exams are close. You should be home studying.'
        : 'Mr. Lee frowns. "Ted, Soo-ah needs to focus on her studies. Please give her some space."';
    } else if (target === 'sooAh') {
      message = 'Soo-ah smiles at Ted.';
    } else if (target === 'ted') {
      message = 'Ted smiles at Soo-ah.';
    }
    startSittingTalk(selectedCharacter);
    return true;
  }

  function talkAtBench() {
    if (mrLeeAware) {
      message = 'Mr. Lee is watching. Move out of sight and wait before you talk.';
      return true;
    }
    if (!mochiShared || !mochiConsumed) {
      message = 'Share the mochi and let them finish eating before the audition conversation.';
      return true;
    }
    mrLeePatrolling = false;
    setMrLeeMode('idle');
    const tedLines = [
        'Ted: Nova is holding auditions. You should try with me.',
        'Soo-ah: My dad told me not to see you. He wants me focused on studying.',
        'Ted: You helped me with Korean when school felt lonely. Let me support something you want.',
        'Soo-ah: All right. I will go to the audition.',
      ];
    if (mochiShared && mochiHolder === 'SooAh') tedLines.splice(1, 0, 'Soo-ah: That was yummy. Thank you, Ted.');
    const sooAhLines = [
        'Soo-ah: I said I would always help you with Korean.',
        mochiShared ? 'They share mochi and renew their promise.' : 'They renew their promise.',
        'Ted: Nova is holding auditions. You should try for one too.',
        'Soo-ah: I am scared to tell Dad, but I will go.',
      ];
    const lines = selectedCharacter === 'Ted' ? tedLines : sooAhLines;
    if (routeDialogueIndex < lines.length) {
      message = lines[routeDialogueIndex++];
      if (routeDialogueIndex === lines.length) auditionAccepted = true;
    } else {
      message = auditionAccepted ? 'They agree to face the audition together.' : lines[0];
    }
    // Whoever speaks plays their seated talking pose; the other settles back to listen.
    const speakers = message.startsWith('Ted:') ? ['Ted'] : message.startsWith('Soo-ah:') ? ['SooAh'] : ['SooAh', 'Ted'];
    for (const name of ['SooAh', 'Ted']) {
      if (speakers.includes(name)) startSittingTalk(name);
      else if (characterMode[name] === 'sittingTalking') {
        sittingTalkTimers[name] = 0;
        restoreIdle(name);
      }
    }
    return true;
  }

  function startSittingTalk(name) {
    if (!sittingCharacters.has(name) || emotionalStates[name]) return false;
    if (!sittingTalkClips[name]) {
      ensureClip(name === 'SooAh' ? 'SooAhSittingTalk' : 'TedSittingTalk')
        .then(() => startSittingTalk(name)).catch((error) => console.error(error));
      return true;
    }
    sittingTalkTimers[name] = 4.3;
    characterMode[name] = 'sittingTalking';
    playClip(name, sittingTalkClips[name], { loop: true, fade: 0.18 });
    if (name === 'Ted') {
      characterMixers[name].update(0);
      alignTedPelvisToSeat({ horizontal: true });
    }
    return true;
  }

  function selectCharacter(name) {
    // Once the route starts you play one character; the other stays seated on the bench.
    if (routeStarted && name !== selectedCharacter) return;
    if (name === 'SooAh' || name === 'Ted') selectedCharacter = name;
    if (followCamera.mode !== 'free') setCameraView(followCamera.mode);
  }

  async function setWalkingVariant(name = 'Ted', variant = 'folder') {
    if (name !== 'Ted' || !['folder', 'alternative'].includes(variant) || walkingCharacters.has(name)) return false;
    if (variant === 'alternative') await ensureClip('TedWalkAlternative');
    activeWalkVariant.Ted = variant;
    return true;
  }

  function triggerNervous(name = selectedCharacter) {
    if (walkingCharacters.has(name) || turningCharacters.has(name)
      || turnStates[name] || sittingDown.has(name) || standFinishHandlers[name]
      || emotionalStates[name] || characterMode[name] === 'sittingTalking'
      || (!standingReady.has(name) && !sittingCharacters.has(name))) return false;
    if (!nervousClips[name]) {
      ensureClip(name === 'SooAh' ? 'SooAhNervous' : 'TedNervous')
        .then(() => triggerNervous(name)).catch((error) => console.error(error));
      return true;
    }
    const clip = inPlaceFbxWalk(nervousClips[name]);
    emotionalStates[name] = { kind: 'nervous', remaining: clip.duration, blocksMovement: true };
    characterMode[name] = 'nervous';
    playClip(name, clip, { loop: false, fade: 0.2 });
    return true;
  }

  function triggerTerrified(name = selectedCharacter, duration = null) {
    if (turningCharacters.has(name) || sittingDown.has(name) || standFinishHandlers[name]
      || (!standingReady.has(name) && !sittingCharacters.has(name) && !walkingCharacters.has(name))) return false;
    if (!terrifiedClips[name]) {
      ensureClip(name === 'SooAh' ? 'SooAhTerrified' : 'TedTerrified')
        .then(() => triggerTerrified(name, duration)).catch((error) => console.error(error));
      return true;
    }
    delete pendingMoves[name];
    sittingTalkTimers[name] = 0;
    delete turnStates[name];
    turningCharacters.delete(name);
    walkingCharacters.delete(name);
    delete movementModes[name];
    const clip = inPlaceFbxWalk(terrifiedClips[name]);
    emotionalStates[name] = { kind: 'terrified', remaining: Math.max(0.1, duration ?? clip.duration), blocksMovement: true };
    characterMode[name] = 'terrified';
    playClip(name, clip, { loop: false, fade: 0.24 });
    return true;
  }

  function clearEmotion(name = selectedCharacter) {
    if (!emotionalStates[name]) return false;
    delete emotionalStates[name];
    restoreIdle(name);
    return true;
  }

  function setLookBehindRun(active = true) {
    lookBehindRun = Boolean(active);
    return true;
  }

  function standSelected() {
    const name = selectedCharacter;
    if (!canStandSelected()) return false;
    const mixer = characterMixers[name];
    const clip = sitToStandClips[name];
    if (!mixer || !clip) return false;
    if (standFinishHandlers[name]) {
      mixer.removeEventListener('finished', standFinishHandlers[name]);
      delete standFinishHandlers[name];
      delete standRootTransitions[name];
    }
    if (sitFinishHandlers[name]) {
      mixer.removeEventListener('finished', sitFinishHandlers[name]);
      delete sitFinishHandlers[name];
    }
    standingReady.delete(name);
    walkingCharacters.delete(name);
    turningCharacters.delete(name);
    sittingCharacters.delete(name);
    sittingTalkTimers[name] = 0;
    delete turnStates[name];
    delete turningDirection[name];
    delete turnConsumed[name];
    delete walkingDirection[name];
    delete walkingYaw[name];
    delete facingTargets[name];
    characterRoots[name].position.y -= sitClearance[name].y;
    characterRoots[name].position.z -= sitClearance[name].z;
    sitClearance[name] = { y: 0, z: 0 };
    const startPosition = bench.worldToLocal(characterRoots[name].position.clone());
    characterMode[name] = 'standingUp';
    const standSpeed = name === 'SooAh' ? sooAhStandSpeed : 1;
    const action = playClip(name, clip, { loop: false, fade: 0.18 });
    if (!action) return false;
    action.timeScale = standSpeed;
    if (name === 'SooAh' || name === 'Ted') {
      standRootTransitions[name] = {
        startX: startPosition.x,
        startZ: startPosition.z,
        elapsed: 0,
        duration: Math.max(clip.duration / standSpeed, 0.001),
      };
    }
    const onFinished = (event) => {
      if (event.action !== action) return;
      mixer.removeEventListener('finished', onFinished);
      delete standFinishHandlers[name];
      if (name === 'SooAh') groundSooAhDuringStand();
      if (name === 'Ted') {
        groundTedDuringStand();
        characterRoots[name].rotation.y = 0;
      }
      delete standRootTransitions[name];
      placeAtBenchAnchor(name, standingAnchors[name]);
      saveStandingPose(name);
      standingReady.add(name);
      if (name === 'Ted') playTedStandingIdle(0.14);
      else characterMode[name] = 'standingIdle';
    };
    standFinishHandlers[name] = onFinished;
    mixer.addEventListener('finished', onFinished);
    standingCharacters.add(name);
    message = `${selectedCharacter === 'Ted' ? 'Ted' : 'Soo-ah'} stands up.`;
    return true;
  }

  function canSitSelected() {
    if (!standingCharacters.has(selectedCharacter) || !standingReady.has(selectedCharacter)
      || walkingCharacters.has(selectedCharacter) || turningCharacters.has(selectedCharacter)
      || turnStates[selectedCharacter] || emotionalStates[selectedCharacter] || sittingDown.has(selectedCharacter)) return false;
    const name = selectedCharacter;
    const root = characterRoots[name];
    return dist(root.position.x, root.position.z, seatAnchors[name]) <= 0.7;
  }

  function canStandSelected() {
    const name = selectedCharacter;
    if (!sittingCharacters.has(name) || !['sitting', 'sittingTalking'].includes(characterMode[name])
      || standingCharacters.has(name) || emotionalStates[name] || sittingDown.has(name) || !characterMixers[name]) return false;
    const root = characterRoots[name];
    return dist(root.position.x, root.position.z, seatAnchors[name]) <= 0.7;
  }

  function sitSelected() {
    if (!canSitSelected()) return false;
    const name = selectedCharacter;
    const mixer = characterMixers[name];
    const clip = standToSitClips[name];
    if (mixer && !clip) {
      // Not loaded yet: sit as soon as it arrives.
      ensureClip(`${name}StandToSit`).then(() => sitSelected()).catch((error) => console.error(error));
      return true;
    }
    if (!mixer) return false;
    if (standFinishHandlers[name]) {
      mixer.removeEventListener('finished', standFinishHandlers[name]);
      delete standFinishHandlers[name];
    }
    standingReady.delete(name);
    walkingCharacters.delete(name);
    turningCharacters.delete(name);
    sittingCharacters.delete(name);
    sittingTalkTimers[name] = 0;
    delete turnStates[name];
    delete turningDirection[name];
    delete turnConsumed[name];
    delete walkingDirection[name];
    delete walkingYaw[name];
    delete pendingMoves[name];
    facingTargets[name] = 0;
    if (name !== 'Ted') {
      placeAtBenchAnchor(name, {
        x: seatAnchors[name].x,
        z: seatAnchors[name].z,
      });
    }
    const tedSitStart = name === 'Ted' ? getCharacterSeatState('Ted') : null;
    if (name === 'SooAh') {
      characterRoots[name].position.y += 0.04;
      sitClearance[name] = { y: 0.04, z: 0 };
    }
    if (name === 'Ted') {
      sitClearance[name] = { y: 0, z: 0 };
    }
    characterMode[name] = 'sittingDown';
    const action = playClip(name, clip, { loop: false, fade: 0.18 });
    if (!action) return false;
    action.timeScale = name === 'SooAh' ? sooAhSitSpeed : 1;
    if (name === 'Ted') {
      tedSitTransition = {
        action,
        duration: clip.duration,
        startHip: new T.Vector3(tedSitStart.hipsBenchLocalX, tedSitStart.hipsBenchLocalY, tedSitStart.hipsBenchLocalZ),
      };
    }
    sittingDown.add(name);
    const onFinished = (event) => {
      if (event.action !== action) return;
      mixer.removeEventListener('finished', onFinished);
      delete sitFinishHandlers[name];
      if (name === 'Ted' && tedSitTransition) {
        applyTedSitHeight(1);
        tedSitTransition = null;
      }
      sittingDown.delete(name);
      standingCharacters.delete(name);
      sittingCharacters.add(name);
      characterMode[name] = 'sitting';
      const seatedPose = sittingClips[name];
      playClip(name, seatedPose, { loop: true, fade: 0.2 });
      if (name === 'Ted') {
        mixer.update(0);
        alignTedPelvisToSeat({ horizontal: true });
        message = 'Ted sits back down.';
      }
      // Sitting down beside your friend on the route opens the bench conversation.
      if (routeStarted && routeDialogueIndex === 0 && sittingCharacters.has(name === 'Ted' ? 'SooAh' : 'Ted')) talkAtBench();
    };
    sitFinishHandlers[name] = onFinished;
    mixer.addEventListener('finished', onFinished);
    message = `${name === 'Ted' ? 'Ted' : 'Soo-ah'} sits back down.`;
    return true;
  }

  function hud() {
    if (family.pending) {
      return { task: 'Lee’s Cafe · telling Mr. and Mrs. Lee', prompt: 'Opening the cafe…', message, hint: 'Soo-ah and Ted are going inside together.' };
    }
    if (family.active) {
      const phasePrompt = family.phase === 'complete' ? 'F · Return to the cafe entrance'
        : family.phase === 'conversation' ? 'F · Continue conversation'
          : family.phase === 'choice' ? 'Choose Soo-ah’s response'
            : family.phase === 'reaction-pause' ? 'Mr. Lee is taking a moment…' : '';
      const phaseHint = family.phase === 'complete' ? 'The family will talk more about NOVA in the next chapter.'
        : family.phase === 'choice' ? 'Any response leads to the same conversation.'
          : family.phase === 'entering' ? 'Mr. Lee is working behind the counter; Mrs. Lee is preparing the cafe.'
            : 'Soo-ah is telling her parents about the audition.';
      return {
        task: family.phase === 'complete' ? 'Soo-ah has told her parents about NOVA' : 'Inside Lee’s Cafe · tell the parents',
        prompt: phasePrompt,
        message,
        hint: phaseHint,
        selectedCharacter,
        standing: true,
        walkingReady: family.phase === 'complete',
        choices: family.phase === 'choice' ? familyChoices.map((choice) => choice.text) : null,
      };
    }
    if (family.phase === 'complete') {
      return { task: 'Soo-ah has told her parents about NOVA', prompt: '', message, hint: 'Ted and Soo-ah are outside Lee’s Cafe.', selectedCharacter, standing: true, walkingReady: true };
    }
    if (school.active) {
      const task = school.phase === 'arrival' ? 'Next school day · Seoul school entrance'
        : school.phase === 'conversation' ? 'Ted and Soo-ah discuss telling Mr. and Mrs. Lee'
          : 'After class · walk together to Lee’s Cafe';
      return {
        task,
        prompt: school.phase === 'conversation' ? 'F · Continue conversation'
          : school.phase === 'ready-to-tell' ? 'F · Walk to Lee’s Cafe' : '',
        message,
        hint: school.phase === 'conversation'
          ? 'Ted and Soo-ah are together at school. Mr. Lee does not know about the audition yet.'
          : 'Arrows walk · Shift + arrows run · WASD moves the camera',
        selectedCharacter,
        standing: standingCharacters.has(selectedCharacter),
        walkingReady: standingReady.has(selectedCharacter),
      };
    }
    if (cafeJourney.active) {
      const talkIndex = nearbyCafeTalk();
      const companionName = selectedCharacter === 'Ted' ? 'Soo-ah' : 'Ted';
      const task = cafeJourney.phase === 'at-cafe' ? 'At Lee’s Cafe · both characters have arrived'
        : 'Walk together to Lee’s Cafe';
      const prompt = cafeJourney.talking ? 'F · Continue conversation'
        : cafeJourney.phase === 'at-cafe' ? 'F · Enter Lee’s Cafe'
          : talkIndex >= 0 ? 'F · Talk together'
            : '';
      const hintText = cafeJourney.talking
        ? 'The walk pauses while they talk.'
        : cafeJourney.phase === 'at-cafe' ? 'Both are at the cafe entrance. Press F to continue the story.'
          : `Arrows walk · Shift + arrows run · WASD moves the camera · stay with ${companionName}`;
      return {
        task,
        prompt,
        message,
        hint: hintText,
        selectedCharacter,
        standing: standingCharacters.has(selectedCharacter),
        walkingReady: standingReady.has(selectedCharacter),
      };
    }
    if (audition.pending) {
      return { task: 'The next morning at NOVA', prompt: 'Preparing the audition stage…', message, hint: 'Loading Ted and Soo-ah’s performance clips.' };
    }
    if (journey.active) {
      const label = selectedCharacter === 'Ted' ? 'Ted' : 'Soo-ah';
      return journey.phase === 'at-home'
        ? { task: `${label} is home for the night`, prompt: 'F · Next morning, go to NOVA', message, hint: 'The map shows home. Press F when you are ready for the audition.' }
        : { task: `Walking home · ${Math.round(Math.hypot(characterRoots[selectedCharacter].position.x - journey.destination.x, characterRoots[selectedCharacter].position.z - journey.destination.z))} m to ${journey.destination.label}`, prompt: 'Follow the route on the map', message, hint: 'Arrows walk · Shift + arrows run · WASD moves the camera · follow the bright home marker' };
    }
    if (audition.active) {
      const arrow = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };
      const tasks = {
        'ted-enter-player': 'Soo-ah is terrified · walk Ted onto the stage',
        'ted-enter-npc': 'Soo-ah is terrified · Ted is coming to help',
        'ted-singing': 'Ted sings to encourage Soo-ah',
        'ted-dance': 'Ted performs Gangnam Style',
        'ted-thumbs-up': 'Ted gives Soo-ah a thumbs-up',
        'ted-line': 'Ted encourages Soo-ah',
        'sooah-happy': 'Soo-ah finds her courage',
        'sooah-enter': 'Soo-ah walks into the spotlight',
        'sooah-auto': 'Soo-ah dances and sings',
        'sooah-qte': `Soo-ah’s performance · ${audition.score} on beat`,
        'sooah-finale': 'Soo-ah finishes her audition',
        retry: 'Soo-ah gets another audition try',
        'judges-reaction': 'The NOVA judges score Soo-ah’s performance',
        'judges-accepted': 'Soo-ah has been selected for NOVA',
        celebration: 'Ted and Soo-ah celebrate together',
      };
      const prompt = audition.phase === 'ted-enter-player' ? '↑ · Walk Ted to the mark'
        : audition.phase === 'sooah-enter' ? 'Soo-ah walks to her mark'
        : audition.phase === 'sooah-qte'
          ? `Beat ${Math.min(audition.cueIndex + 1, audition.sequence.length)}/${audition.sequence.length} · ${arrow[audition.sequence[audition.cueIndex]] ?? '♪'}`
          : audition.phase === 'retry' ? 'F · Try the audition again' : 'Watch the performance';
      const hint = audition.phase === 'ted-enter-player'
        ? 'Arrow keys walk Ted · F starts his song at the stage mark'
        : audition.phase === 'sooah-enter' ? 'Soo-ah walks into the spotlight'
        : audition.phase === 'sooah-qte' ? 'Press the shown arrow on each beat · missed cues never stop the audition' : 'Performance controls are active';
      return {
        task: tasks[audition.phase] ?? 'NOVA audition', prompt, message, hint, selectedCharacter,
        standing: false, walkingReady: false,
        judgeScores: {
          rows: getJudgeScoreCards(),
          verdict: ['judges-accepted', 'celebration'].includes(audition.phase) ? 'Selected for NOVA'
            : audition.phase === 'retry' ? 'Try again' : audition.phase === 'judges-reaction' ? 'Final scores' : 'Live scoring',
        },
      };
    }
    if (auditionAccepted) {
      return { task: 'Ted and Soo-ah say goodnight at the bench.', prompt: 'F · Walk home', message, hint: 'Follow the map to your home.', selectedCharacter, standing: standingCharacters.has(selectedCharacter), walkingReady: standingReady.has(selectedCharacter) };
    }
    const target = nearest();
    const label = selectedCharacter === 'Ted' ? 'Ted' : 'Soo-ah';
    const mode = characterMode[selectedCharacter];
    const task = sittingDown.has(selectedCharacter) ? `${label} is sitting down…`
      : mode === 'sittingTalking' ? `${label} is talking from the bench`
        : mode === 'nervous' ? `${label} is looking around nervously…`
          : mode === 'terrified' ? `${label} is frightened…`
            : mode === 'running' || mode === 'lookingBehindRunning' ? `${label} running · arrows steer`
      : standingCharacters.has(selectedCharacter)
        ? standingReady.has(selectedCharacter) ? `${label} standing · arrows turn + walk · Q sit at bench` : `${label} is standing up…`
        : `${label} selected · E stand at bench`;
    const friendPrompt = target === 'sooAh' || target === 'ted'
      ? mochiHolder === selectedCharacter && !mochiShared ? 'F · Give the mochi'
        : !mochiShared ? 'Pick up the mochi first'
          : !mochiConsumed ? `${mochiEating?.recipient === 'SooAh' ? 'Soo-ah' : 'Ted'} is eating the mochi…`
            : `F · Talk to ${target === 'sooAh' ? 'Soo-ah' : 'Ted'}`
      : '';
    const prompt = target === 'mochi' ? 'F · Pick up the mochi'
      : friendPrompt || (target === 'lee' ? 'F · Talk to Mr. Lee' : '');
    return { task, prompt, message, selectedCharacter, standing: standingCharacters.has(selectedCharacter), walkingReady: standingReady.has(selectedCharacter) };
  }

  function update(t, dt) {
    auditionTime = t;
    const followed = characterRoots[selectedCharacter].position;
    sun.target.position.set(followed.x, 0, followed.z);
    sun.position.set(followed.x - 12, 20, followed.z + 16);
    if (followCamera.mode === 'free') {
      focus.set(player.x, 1.48, player.z);
      camera.position.copy(focus);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    }
    const trafficU = (t * trafficSpeed / trafficLength + movingKia.userData.trafficPhase) % 1;
    roadCurve.getPointAt(trafficU, trafficPoint);
    roadCurve.getTangentAt(trafficU, trafficTangent);
    const trafficX = trafficPoint.x - trafficTangent.z * 1.3;
    const trafficZ = trafficPoint.z + trafficTangent.x * 1.3;
    movingKia.position.set(trafficX, parkHeightAt(trafficX, trafficZ) + 0.02, trafficZ);
    trafficQuat.setFromUnitVectors(trafficForward, trafficTangent);
    movingKia.quaternion.copy(trafficQuat);
    updateMrLeePatrol(dt);
    for (const mixer of mixers) mixer.update(dt);
    updateCafeFamilyScene(dt);
    updateAudition(dt);
    updateHomeJourney();
    if (walkingCharacters.has('Ted') || characterMode.Ted === 'standingIdle') groundTedDuringStand();
    if (school.active && walkingCharacters.has('SooAh')) groundSooAhDuringStand();
    if (standRootTransitions.SooAh) groundSooAhDuringStand();
    if (standRootTransitions.Ted) groundTedDuringStand();
    for (const [name, transition] of Object.entries(standRootTransitions)) {
      transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
      const progress = transition.elapsed / transition.duration;
      const eased = progress * progress * (3 - 2 * progress);
      const target = standingAnchors[name];
      placeAtBenchAnchor(name, {
        x: transition.startX + (target.x - transition.startX) * eased,
        z: transition.startZ + (target.z - transition.startZ) * eased,
      });
      if (name === 'SooAh') characterRoots[name].position.y += 0.05 * (1 - eased);
      if (name === 'Ted') characterRoots[name].position.y += 0.07 * (1 - eased);
    }
    for (const [name, state] of Object.entries(turnStates)) {
      state.elapsed = Math.min(state.duration, state.elapsed + dt);
      const progress = state.elapsed / state.duration;
      const eased = progress * progress * (3 - 2 * progress);
      const root = characterRoots[name];
      root.rotation.y = state.startYaw + (state.endYaw - state.startYaw) * eased;
      if (progress >= 1) {
        root.rotation.y = state.endYaw;
        const mixer = characterMixers[name];
        mixer.stopAllAction();
        mixer.update(0);
        delete turnStates[name];
        turningCharacters.delete(name);
        delete turningDirection[name];
        turnConsumed[name] = state.direction;
        delete movementModes[name];
        characterMode[name] = 'standingIdle';
        if (name === 'Ted' && standingCharacters.has(name) && !sittingCharacters.has(name)) playTedStandingIdle(0.14);
        else {
          restoreStandingPose(name);
          characterActions[name] = null;
        }
      }
    }
    for (const name of Object.keys(sittingTalkTimers)) {
      if (sittingTalkTimers[name] <= 0) continue;
      sittingTalkTimers[name] = Math.max(0, sittingTalkTimers[name] - dt);
      if (sittingTalkTimers[name] === 0 && characterMode[name] === 'sittingTalking') {
        restoreIdle(name);
        if (mochiCameraTarget === name) mochiCameraTarget = null;
      }
    }
    for (const [name, state] of Object.entries(emotionalStates)) {
      state.remaining = Math.max(0, state.remaining - dt);
      if (state.remaining === 0) clearEmotion(name);
    }
    for (const [name, remaining] of Object.entries(fadingMovement)) {
      const next = remaining - dt;
      if (next > 0) {
        fadingMovement[name] = next;
        continue;
      }
      delete fadingMovement[name];
      const mixer = characterMixers[name];
      mixer?.stopAllAction();
      mixer?.update(0);
      if (name === 'Ted' && standingCharacters.has(name) && !sittingCharacters.has(name)) playTedStandingIdle(0.14);
      else {
        restoreStandingPose(name);
        characterActions[name] = null;
      }
    }
    for (const [name, target] of Object.entries(facingTargets)) {
      const root = characterRoots[name];
      const turn = Math.atan2(Math.sin(target - root.rotation.y), Math.cos(target - root.rotation.y));
      root.rotation.y += turn * Math.min(1, dt * 8);
      if (Math.abs(turn) < 0.01) {
        root.rotation.y = target;
        delete facingTargets[name];
      }
    }
    if (tedSitTransition) applyTedSitHeight(tedSitTransition.action.time / tedSitTransition.duration);
    else if (sittingCharacters.has('Ted') && !sittingDown.has('Ted')) alignTedPelvisToSeat({ horizontal: true });
    if (!school.active) for (const name of ['SooAh', 'Ted']) {
      if (sittingCharacters.has(name) || sittingDown.has(name) || characterMode[name] === 'standingUp') clampSeatedPelvis(name);
    }
    updateMochiEating(dt);
    updateCafeCompanion(dt);
    updateCafeJourney();
    // Last, so the camera sees where every root ended up this frame.
    if (followCamera.mode !== 'free') updateFollowCamera(dt);
    if (debugRecording) {
      debugSamples.push({ frame: debugFrame++, t, ...getCharacterSeatState(debugRecordingName) });
    }
    return hud();
  }

  const getCharacterSeatState = (name) => {
    const root = characterRoots[name];
    const hips = name === 'Ted' ? tedHips : sooAhHips;
    if (!root || !hips) return { name, error: 'hips bone unavailable' };
    root.updateMatrixWorld(true);
    bench.updateMatrixWorld(true);
    const hipsWorld = hips.getWorldPosition(new T.Vector3());
    const hipsBench = bench.worldToLocal(hipsWorld.clone());
    const rootBench = bench.worldToLocal(root.position.clone());
    return {
      name,
      rootY: root.position.y,
      rootBenchLocalX: rootBench.x,
      rootBenchLocalZ: rootBench.z,
      hipsWorldY: hipsWorld.y,
      hipsBenchLocalX: hipsBench.x,
      hipsBenchLocalY: hipsBench.y,
      hipsBenchLocalZ: hipsBench.z,
      seatedPelvisTarget: name === 'Ted' && tedSeatedPelvisReady
        ? { x: tedSeatedPelvis.x, y: tedSeatTopLocalY(), z: tedSeatedPelvis.z } : null,
      seatTargetBenchLocalY: tedSeatTopLocalY(),
      seatColliderBounds: {
        minX: tedSeatCollider.position.x - tedSeatCollider.userData.halfExtents[0],
        maxX: tedSeatCollider.position.x + tedSeatCollider.userData.halfExtents[0],
        minZ: tedSeatCollider.position.z - tedSeatCollider.userData.halfExtents[2],
        maxZ: tedSeatCollider.position.z + tedSeatCollider.userData.halfExtents[2],
      },
      mode: characterMode[name],
      sittingDown: sittingDown.has(name),
      actionTime: characterActions[name]?.time ?? null,
      sitProgress: tedSitTransition && name === 'Ted'
        ? Math.min(1, tedSitTransition.action.time / tedSitTransition.duration) : null,
      sitTargetHipX: tedSitTransition && name === 'Ted' ? tedSitPositionLocal.x : null,
      sitTargetHipZ: tedSitTransition && name === 'Ted' ? tedSitPositionLocal.z : null,
    };
  };

  const measureTedSeatMesh = () => {
    const point = new T.Vector3();
    const seatMinY = tedSeatCollider.position.y - tedSeatCollider.userData.halfExtents[1];
    const seatMaxY = tedSeatCollider.position.y + tedSeatCollider.userData.halfExtents[1];
    let minYInSeatFootprint = Infinity;
    let verticesInsideSeat = 0;
    for (const mesh of tedStandMeshes) {
      mesh.skeleton.update();
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        mesh.getVertexPosition(i, point);
        mesh.localToWorld(point);
        bench.worldToLocal(point);
        if (Math.abs(point.x - tedSeatCollider.position.x) > tedSeatCollider.userData.halfExtents[0]
          || Math.abs(point.z - tedSeatCollider.position.z) > tedSeatCollider.userData.halfExtents[2]) continue;
        minYInSeatFootprint = Math.min(minYInSeatFootprint, point.y);
        if (point.y >= seatMinY && point.y <= seatMaxY) verticesInsideSeat++;
      }
    }
    return { minYInSeatFootprint, seatMinY, seatTopY: seatMaxY, verticesInsideSeat };
  };

  const measureTedChairIntersections = ({ full = false } = {}) => {
    const chairMeshes = [];
    bench.traverse((node) => {
      if (node.isMesh && node.visible && !node.userData.collisionPart) chairMeshes.push(node);
    });
    bench.updateMatrixWorld(true);
    const chairTriangles = [];
    const chairA = new T.Vector3();
    const chairB = new T.Vector3();
    const chairC = new T.Vector3();
    const chairBox = new T.Box3();
    for (const mesh of chairMeshes) {
      const geometry = mesh.geometry;
      const positions = geometry.attributes.position;
      const index = geometry.index;
      const triangleCount = index ? index.count / 3 : positions.count / 3;
      for (let face = 0; face < triangleCount; face++) {
        const a = index ? index.getX(face * 3) : face * 3;
        const b = index ? index.getX(face * 3 + 1) : face * 3 + 1;
        const c = index ? index.getX(face * 3 + 2) : face * 3 + 2;
        chairA.fromBufferAttribute(positions, a).applyMatrix4(mesh.matrixWorld);
        chairB.fromBufferAttribute(positions, b).applyMatrix4(mesh.matrixWorld);
        chairC.fromBufferAttribute(positions, c).applyMatrix4(mesh.matrixWorld);
        const triangle = new T.Triangle(chairA.clone(), chairB.clone(), chairC.clone());
        chairBox.makeEmpty().expandByPoint(chairA).expandByPoint(chairB).expandByPoint(chairC);
        chairTriangles.push({ mesh: mesh.name, triangle, box: chairBox.clone() });
      }
    }
    const vertexA = new T.Vector3();
    const vertexB = new T.Vector3();
    const vertexC = new T.Vector3();
    const candidate = new T.Triangle();
    const candidateBox = new T.Box3();
    const examples = [];
    const totalTedTriangles = tedStandMeshes.reduce((sum, mesh) => {
      const geometry = mesh.geometry;
      return sum + (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    }, 0);
    let testedTedTriangles = 0;
    let broadphaseCandidates = 0;
    let intersectingTedTriangles = 0;
    tedRoot.updateMatrixWorld(true);
    for (const mesh of tedStandMeshes) {
      mesh.skeleton.update();
      const geometry = mesh.geometry;
      const positions = geometry.attributes.position;
      const index = geometry.index;
      const triangleCount = index ? index.count / 3 : positions.count / 3;
      const stride = full ? 1 : Math.max(1, Math.ceil(triangleCount / 3000));
      for (let face = 0; face < triangleCount; face += stride) {
        const a = index ? index.getX(face * 3) : face * 3;
        const b = index ? index.getX(face * 3 + 1) : face * 3 + 1;
        const c = index ? index.getX(face * 3 + 2) : face * 3 + 2;
        mesh.getVertexPosition(a, vertexA);
        mesh.getVertexPosition(b, vertexB);
        mesh.getVertexPosition(c, vertexC);
        mesh.localToWorld(vertexA);
        mesh.localToWorld(vertexB);
        mesh.localToWorld(vertexC);
        candidate.set(vertexA, vertexB, vertexC);
        candidateBox.makeEmpty().expandByPoint(vertexA).expandByPoint(vertexB).expandByPoint(vertexC);
        testedTedTriangles++;
        for (const chair of chairTriangles) {
          if (!candidateBox.intersectsBox(chair.box)) continue;
          broadphaseCandidates++;
          if (!candidate.intersectsTriangle(chair.triangle, true)) continue;
          intersectingTedTriangles++;
          if (examples.length < 12) examples.push({
            tedMesh: mesh.name,
            tedTriangle: face,
            chairMesh: chair.mesh,
            point: vertexA.toArray(),
          });
          break;
        }
      }
    }
    return { chairMeshCount: chairMeshes.length, chairTriangleCount: chairTriangles.length, totalTedTriangles, testedTedTriangles, broadphaseCandidates, intersectingTedTriangles, examples };
  };

  // Clips the player is likely to need next stream in behind the start screen; runs, emotions and
  // Mr. Lee's reactions are left to load on first use.
  for (const name of ['SooAhWalk', 'TedWalk', 'SooAhTurnLeft', 'SooAhTurnRight', 'TedTurnLeft', 'TedTurnRight',
    'SooAhStandToSit', 'TedStandToSit', 'MrLeeWalk', 'SooAhSittingTalk', 'TedSittingTalk']) {
    ensureClip(name).catch((error) => console.error(error));
  }

  const debug = {
    startAudition: () => { auditionAccepted = true; return startAudition(); },
    startHomeJourney: () => { auditionAccepted = true; mochiShared = true; mochiConsumed = true; return startHomeJourney(); },
    startCafeStory: () => {
      school.auditionPassed = true;
      auditionAccepted = true;
      mochiShared = true;
      mochiConsumed = true;
      routeStarted = true;
      cafeJourney.active = true;
      cafeJourney.phase = 'at-cafe';
      cafeJourney.talks = [true, true];
      for (const [name, offset] of [['Ted', -0.55], ['SooAh', 0.55]]) {
        const root = characterRoots[name];
        const mixer = characterMixers[name];
        const standClip = sitToStandClips[name];
        if (mixer && standClip) {
          mixer.stopAllAction();
          const action = mixer.clipAction(standClip);
          action.reset();
          action.setLoop(T.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.play();
          action.time = standClip.duration;
          mixer.update(0);
          saveStandingPose(name);
          mixer.stopAllAction();
          mixer.update(0);
          restoreStandingPose(name);
        }
        sittingCharacters.delete(name);
        sittingDown.delete(name);
        root.visible = true;
        root.position.set(cafeJourney.destination.x + offset, parkHeightAt(cafeJourney.destination.x + offset, cafeJourney.destination.z), cafeJourney.destination.z);
        root.rotation.y = Math.PI;
        standingCharacters.add(name);
        standingReady.add(name);
      }
      return interact();
    },
    getHomeState: () => ({ phase: journey.phase, selectedCharacter, position: characterRoots[selectedCharacter].position.toArray(), target: journey.destination, parkLimit, standing: standingCharacters.has(selectedCharacter), standingReady: standingReady.has(selectedCharacter), walking: walkingCharacters.has(selectedCharacter) }),
    getAuditionState: () => ({
      phase: audition.phase,
      selectedCharacter,
      camera: { position: camera.position.toArray(), angle: followCamera.angle, targetAngle: followCamera.targetAngle },
      actors: Object.fromEntries(['Ted', 'SooAh'].map((name) => {
        const root = auditionRoots[name];
        if (!root) return [name, null];
        root.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(root);
        return [name, { position: root.position.toArray(), rotation: root.rotation.y, scale: root.scale.toArray(), bounds: box.getSize(new T.Vector3()).toArray() }];
      })),
    }),
    getSeatState: (name = 'Ted') => getCharacterSeatState(name),
    setSideView: (name = 'Ted', distance = 2.2) => {
      followCamera.mode = 'free';
      const root = characterRoots[name];
      const rightX = Math.cos(root.rotation.y);
      const rightZ = -Math.sin(root.rotation.y);
      player.x = root.position.x + rightX * distance;
      player.z = root.position.z + rightZ * distance;
      player.yaw = Math.atan2(player.x - root.position.x, player.z - root.position.z);
      player.pitch = -0.25;
    },
    measureTedStandToSitEnd: () => {
      const clip = standToSitClips.Ted;
      const hipsTrackData = (source) => {
        const track = source?.tracks.find((item) => item.name.toLowerCase().endsWith('.position')
          && item.name.slice(0, -'.position'.length).toLowerCase().replace(/[^a-z]/g, '').endsWith('mixamorighips'));
        if (!track) return null;
        const n = track.values.length;
        return { name: track.name, first: Array.from(track.values.slice(0, 3)), last: Array.from(track.values.slice(n - 3)) };
      };
      const mixer = new T.AnimationMixer(ted);
      const action = mixer.clipAction(clip);
      action.setLoop(T.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.time = clip.duration;
      mixer.update(0);
      tedRoot.updateMatrixWorld(true);
      bench.updateMatrixWorld(true);
      const end = getCharacterSeatState('Ted');
      mixer.stopAllAction();
      mixer.uncacheRoot(ted);
      characterMixers.Ted.stopAllAction();
      characterMixers.Ted.update(0);
      restoreStandingPose('Ted');
      characterActions.Ted = null;
      return {
        duration: clip.duration,
        ...end,
        targetWorldY: tedSeatTargetWorldY(),
        bindPoseHips: tedHips ? tedHips.position.toArray() : null,
        idleHipsTrack: hipsTrackData(clips.TedSitting),
        talkHipsTrack: hipsTrackData(clips.TedSittingTalk),
        rawStandToSitHipsTrack: hipsTrackData(clips.TedStandToSit),
        processedStandToSitHipsTrack: hipsTrackData(clip),
      };
    },
    placeAtSeat: (name = 'Ted') => {
      selectCharacter(name);
      walkingCharacters.delete(name);
      turningCharacters.delete(name);
      delete movementModes[name];
      delete turnStates[name];
      placeAtBenchAnchor(name, seatAnchors[name]);
      player.x = characterRoots[name].position.x;
      player.z = characterRoots[name].position.z;
      return canSitSelected();
    },
    placeAtStandingAnchor: (name = 'Ted') => {
      selectCharacter(name);
      walkingCharacters.delete(name);
      turningCharacters.delete(name);
      delete movementModes[name];
      delete turnStates[name];
      placeAtBenchAnchor(name, standingAnchors[name]);
      player.x = characterRoots[name].position.x;
      player.z = characterRoots[name].position.z;
      return canSitSelected();
    },
    startTalk: (name = 'Ted') => startSittingTalk(name),
    startRecording: (name = 'Ted') => {
      debugRecordingName = name;
      debugSamples = [];
      debugFrame = 0;
      debugRecording = true;
    },
    stopRecording: () => {
      debugRecording = false;
      return debugSamples.slice();
    },
    samples: () => debugSamples.slice(),
    runMochiFlow: async () => {
      const nextFrame = () => new Promise(requestAnimationFrame);
      let frames = 0;
      selectCharacter('Ted');
      if (!routeStarted && !startRoute()) throw new Error('Ted could not start his route');
      if (routeStarted && !standingReady.has('Ted') && sittingCharacters.has('Ted') && !standSelected()) {
        throw new Error('Ted could not stand before the mochi pickup');
      }
      while (!standingReady.has('Ted') && frames++ < 900) await nextFrame();
      if (!standingReady.has('Ted')) throw new Error('Ted did not finish standing');

      mochiHolder = null;
      mochiShared = false;
      mochiConsumed = false;
      mochiEating = null;
      mochiCameraTarget = null;
      mochiStool.add(mochiItem);
      mochiItem.visible = true;
      mochiItem.scale.copy(mochiScale);
      heldMochiSkewer.visible = false;
      const topBall = heldMochiSkewer.getObjectByName('MochiBall_2');
      if (topBall) topBall.visible = true;
      heldMochi.visible = false;
      heldMochi.scale.setScalar(1);
      mochiItem.position.copy(mochiOnStoolPosition);
      mochiItem.rotation.set(0, 0, 0);
      mochiStool.add(stoolMochiStick);
      stoolMochiStick.visible = true;
      stoolMochiStick.position.set(0, 0.434, 0);
      stoolMochiStick.scale.setScalar(1.7);
      mrLeeAware = false;
      placeAtBenchAnchor('Ted', mochiStoolPosition);
      const pickupTarget = nearest();
      const pickedUp = interact();
      const carriedInTedHand = mochiHolder === 'Ted' && heldMochiSkewer.parent === tedRightHand;
      const visibleInTedHand = heldMochiSkewer.visible && heldMochiSkewer.parent === tedRightHand;
      if (pickedUp) {
        await nextFrame();
        await debug.captureScreenshot?.('mochi-ted-hand.png');
      }
      placeAtBenchAnchor('Ted', seatAnchors.Ted);
      mrLeeAware = true;
      const mrLeeWasAwareAtGive = mrLeeAware;
      const giveTarget = nearest();
      const gaveToSooAh = interact();
      const visibleInSooAhHand = heldMochiSkewer.visible && heldMochiSkewer.parent === sooAhLeftHand
        && heldMochi.visible && heldMochi.parent === sooAhLeftHand;
      heldMochi.getWorldScale(heldMochiParentScale);
      if (gaveToSooAh) {
        await nextFrame();
        await debug.captureScreenshot?.('mochi-in-hand.png');
        while (mochiEating && mochiEating.elapsed < 0.7) await nextFrame();
        await debug.captureScreenshot?.('mochi-at-mouth.png');
      }
      frames = 0;
      while (gaveToSooAh && mochiEating && frames++ < 180) await nextFrame();
      mrLeeAware = true;
      const talkTargetAfterEat = nearest();
      const inSooAhHand = mochiShared && heldMochiSkewer.parent === sooAhLeftHand;
      return {
        pickupTarget,
        pickedUp,
        carriedInTedHand,
        visibleInTedHand,
        giveTarget,
        gaveToSooAh,
        mrLeeWasAwareAtGive,
        inSooAhHand,
        visibleInSooAhHand,
        heldMochiWorldScale: heldMochiParentScale.toArray(),
        mochiShared,
        mochiConsumed,
        mochiHiddenAfterBite: !heldMochi.visible && !heldMochiSkewer.visible,
        talkTargetAfterEat,
        stoolPosition: { ...mochiStoolPosition },
      };
    },
    runTedSuite: async () => {
      const nextFrame = () => new Promise(requestAnimationFrame);
      const waitFor = async (predicate, limit = 900) => {
        for (let frame = 0; frame < limit; frame++) {
          if (predicate()) return true;
          await nextFrame();
        }
        return predicate();
      };
      const recordSit = async (name) => {
        const canSit = canSitSelected();
        const start = getCharacterSeatState(name);
        if (name === 'Ted' && cycles.length === 0) {
          debug.setSideView('Ted');
          await nextFrame();
          await debug.captureScreenshot?.('standing.png');
        }
        debugRecordingName = name;
        debugSamples = [];
        debugFrame = 0;
        debugRecording = true;
        const started = sitSelected();
        let midSitCaptured = false;
        let midSitPenetration = null;
        while (started && (sittingDown.has(name) || !sittingCharacters.has(name))) {
          await nextFrame();
          if (name === 'Ted' && cycles.length === 0 && !midSitCaptured
            && tedSitTransition?.action.time / tedSitTransition?.duration >= 0.5) {
            await debug.captureScreenshot?.('mid-sit.png');
            midSitPenetration = measureTedChairIntersections({ full: true });
            midSitCaptured = true;
          }
        }
        const finished = started && !sittingDown.has(name) && sittingCharacters.has(name);
        if (name === 'Ted' && cycles.length === 0 && finished) {
          await debug.captureScreenshot?.('sit-finished.png');
        }
        const finishedAt = performance.now();
        while (started && finished && performance.now() - finishedAt < 1000) await nextFrame();
        if (name === 'Ted' && cycles.length === 0 && finished) {
          await debug.captureScreenshot?.('sit-plus-1s.png');
        }
        debugRecording = false;
        const samples = debugSamples.slice();
        const finishIndex = samples.findIndex((sample, index) => index > 0 && !sample.sittingDown && sample.mode === 'sitting');
        const trajectory = finishIndex >= 0 ? [start, ...samples.slice(0, finishIndex + 1)] : [start, ...samples];
        const startY = start.hipsBenchLocalY;
        const seatY = start.seatTargetBenchLocalY;
        const final = samples.at(-1) ?? start;
        const snapDelta = finishIndex > 0
          ? Math.abs(samples[finishIndex].hipsBenchLocalY - samples[finishIndex - 1].hipsBenchLocalY) : null;
        const checkedSamples = [start, ...samples.slice(0, finishIndex >= 0 ? finishIndex + 1 : undefined)];
        const maxHipHorizontalStep = Math.max(0, ...checkedSamples.slice(1)
          .map((sample, index) => Math.hypot(
            sample.hipsBenchLocalX - checkedSamples[index].hipsBenchLocalX,
            sample.hipsBenchLocalZ - checkedSamples[index].hipsBenchLocalZ,
          )));
        const target = start.seatedPelvisTarget;
        const finalHipHorizontalError = target ? Math.hypot(
          final.hipsBenchLocalX - target.x,
          final.hipsBenchLocalZ - target.z,
        ) : null;
        return {
          started, canSit, finished, start, finishIndex, snapDelta,
          checks: {
            neverAboveStart: trajectory.every((sample) => sample.hipsBenchLocalY <= startY + 0.002),
            monotonicDown: trajectory.every((sample, index) => index === 0 || sample.hipsBenchLocalY <= trajectory[index - 1].hipsBenchLocalY + 0.002),
            noSnapAtFinish: snapDelta !== null && snapDelta < 0.01,
            finalWithinSeat: Math.abs(final.hipsBenchLocalY - seatY) < 0.01,
            noPelvisHorizontalTeleport: maxHipHorizontalStep < 0.02,
            finalPelvisAtSeatedPose: finalHipHorizontalError !== null && finalHipHorizontalError < 0.01,
          },
          maxHipHorizontalStep,
          finalHipHorizontalError,
          midSitPenetration,
          seatedChairIntersections: name === 'Ted' && cycles.length === 0 && finished ? measureTedChairIntersections({ full: true }) : null,
          final,
          samples,
        };
      };
      selectCharacter('Ted');
      if (!routeStarted) startRoute();
      if (!await waitFor(() => standingReady.has('Ted'))) throw new Error('Ted did not finish standing');
      const cycles = [];
      for (let cycle = 0; cycle < 2; cycle++) {
        if (cycle > 0) {
          if (!standSelected()) throw new Error(`Ted could not start the second stand transition: ${JSON.stringify({
            canStand: canStandSelected(),
            sitting: sittingCharacters.has('Ted'),
            standing: standingCharacters.has('Ted'),
            standingReady: standingReady.has('Ted'),
            sittingDown: sittingDown.has('Ted'),
            mode: characterMode.Ted,
            root: getCharacterSeatState('Ted'),
          })}`);
          if (!await waitFor(() => standingReady.has('Ted'))) throw new Error('Ted did not finish the second stand');
        }
        if (!debug.placeAtStandingAnchor('Ted')) throw new Error('Ted was not within bench sit range');
        cycles.push(await recordSit('Ted'));
      }
      debugRecordingName = 'Ted';
      debugSamples = [];
      debugFrame = 0;
      debugRecording = true;
      const beforeTalk = getCharacterSeatState('Ted');
      const talkStarted = startSittingTalk('Ted');
      const afterTalkStart = getCharacterSeatState('Ted');
      const talkHandoffDelta = Math.hypot(
        afterTalkStart.hipsBenchLocalX - beforeTalk.hipsBenchLocalX,
        afterTalkStart.hipsBenchLocalY - beforeTalk.hipsBenchLocalY,
        afterTalkStart.hipsBenchLocalZ - beforeTalk.hipsBenchLocalZ,
      );
      const restored = talkStarted && await waitFor(() => sittingTalkTimers.Ted === 0 && characterMode.Ted === 'sitting');
      const restoredAt = performance.now();
      while (restored && performance.now() - restoredAt < 1000) await nextFrame();
      debugRecording = false;
      const talkSamples = debugSamples.slice();
      const talkTarget = talkSamples[0]?.seatedPelvisTarget;
      const talkMaxSeatError = talkSamples.length && talkTarget
        ? Math.max(...talkSamples.map((sample) => Math.hypot(
          sample.hipsBenchLocalX - talkTarget.x,
          sample.hipsBenchLocalY - talkTarget.y,
          sample.hipsBenchLocalZ - talkTarget.z,
        ))) : null;
      return {
        cycles,
        talk: {
          started: talkStarted,
          restored,
          noHandoffJump: talkHandoffDelta < 0.02,
          handoffDelta: talkHandoffDelta,
          stayedAtSeat: talkMaxSeatError !== null && talkMaxSeatError < 0.01,
          maxSeatError: talkMaxSeatError,
          final: getCharacterSeatState('Ted'),
          samples: talkSamples,
        },
        seatedMesh: measureTedSeatMesh(),
      };
    },
    runSooAhCycle: async () => {
      const nextFrame = () => new Promise(requestAnimationFrame);
      let ready = 0;
      selectCharacter('SooAh');
      if (!routeStarted) startRoute();
      while (!standingReady.has('SooAh') && ready++ < 900) await nextFrame();
      placeAtBenchAnchor('SooAh', seatAnchors.SooAh);
      player.x = sooAh.position.x;
      player.z = sooAh.position.z;
      debugRecordingName = 'SooAh';
      debugSamples = [];
      debugFrame = 0;
      debugRecording = true;
      const start = getCharacterSeatState('SooAh');
      const started = sitSelected();
      let frames = 0;
      while (started && sittingDown.has('SooAh') && frames++ < 900) await nextFrame();
      const finished = started && !sittingDown.has('SooAh');
      const finishedAt = performance.now();
      while (finished && performance.now() - finishedAt < 1000) await nextFrame();
      debugRecording = false;
      const seated = debugSamples.slice();
      const finishIndex = seated.findIndex((sample, index) => index > 0 && !sample.sittingDown && sample.mode === 'sitting');
      const trajectory = finishIndex >= 0 ? [start, ...seated.slice(0, finishIndex + 1)] : [start, ...seated];
      const final = seated.at(-1) ?? start;
      const snapDelta = finishIndex > 0
        ? Math.abs(seated[finishIndex].hipsBenchLocalY - seated[finishIndex - 1].hipsBenchLocalY) : null;
      const stood = standSelected();
      frames = 0;
      while (stood && !standingReady.has('SooAh') && frames++ < 900) await nextFrame();
      return {
        start,
        started,
        finished,
        checks: {
          neverAboveStart: trajectory.every((sample) => sample.hipsBenchLocalY <= start.hipsBenchLocalY + 0.002),
          monotonicDown: trajectory.every((sample, index) => index === 0 || sample.hipsBenchLocalY <= trajectory[index - 1].hipsBenchLocalY + 0.002),
          noSnapAtFinish: snapDelta !== null && snapDelta < 0.01,
        },
        snapDelta,
        final,
        seated,
        stood,
        standingReady: standingReady.has('SooAh'),
        standingFinal: getCharacterSeatState('SooAh'),
      };
    },
  };

  return { get scene() { return family.active ? familyScene : school.active ? schoolScene : audition.active ? auditionScene : scene; }, cameras: [{ name: 'PromiseGrove', camera }], camera, update, move, walkSelected, look, interact, chooseFamilyResponse, selectCharacter, setCameraView, startRoute, startHomeJourney, startAudition, auditionActive: () => audition.active || audition.pending, handleAuditionKey, mapState, setWalkingVariant, setLookBehindRun, triggerNervous, triggerTerrified, clearEmotion, standSelected, sitSelected, canStandSelected, canSitSelected, setMrLeeMode, hud, player, debug };
}
