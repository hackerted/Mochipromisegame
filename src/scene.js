import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

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

function inPlaceTurn(clip) {
  if (!clip) return clip;
  const adjusted = clip.clone();
  // Turn clips carry pelvis yaw; the controller applies that measured yaw to the actor root instead.
  adjusted.tracks = adjusted.tracks.filter((track) =>
    !track.name.toLowerCase().split('.')[0].replace(/[^a-z]/g, '').endsWith('mixamorighips'));
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
  const [chairAsset, mrLeeAsset, tedAsset, sooAh, mrLeeTexture, tedTexture, sooAhTexture, cafeAsset, cherryTreeAsset, houseAsset, apartmentAsset, gateAsset, sakuraAsset, mochiAsset, mochiHeldAsset, mochiSkewerAsset, mrLeeIdleClip, sooAhSittingClip] = await Promise.all([
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
    gltf(gltfLoader, './assets/mochi.glb'),
    gltf(gltfLoader, './assets/mochi-held.glb'),
    gltf(gltfLoader, './assets/mochi-skewer-held.glb'),
    loadJsonClip('./assets/clips/MrLeeIdle.json'),
    loadJsonClip('./assets/clips/SooAhSitting.json'),
  ]);
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
    MrLeeWalk: { url: './assets/clips/MrLeeWalk.json', type: 'json' },
    MrLeeRun: { url: './assets/clips/MrLeeRun.json', type: 'json' },
    MrLeeAngryPoint: { url: './assets/clips/MrLeeAngryPoint.json', type: 'json' },
    MrLeeAngryGesture: { url: './assets/clips/MrLeeAngryGesture.json', type: 'json' },
    MrLeePointing: { url: './assets/clips/MrLeePointing.json', type: 'json' },
    MrLeeTalking: { url: './assets/clips/MrLeeTalking.json', type: 'json' },
  };
  const ted = tedAsset.scene;
  ted.traverse((node) => {
    if (node.isBone) node.name = T.PropertyBinding.sanitizeNodeName(node.name);
  });
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

  // ---- Park ---------------------------------------------------------------------------------------
  // Sized for the 1 m tall characters. The story bench stays at the origin facing +Z (north); the park
  // is a 45 m square around it inside a hedge, with the city to go outside the hedge.
  const parkHalf = 22.6;
  const parkLimit = parkHalf - 0.9;
  const reserved = []; // { x, z, r }: trees and decor keep off these
  const obstacles = []; // { x, z, r }: solid for walkers
  const pathLines = []; // { points, halfWidth }
  const pathMaterial = new T.MeshStandardMaterial({ color: '#c8b892', roughness: 0.95, side: T.DoubleSide });

  function addPath(name, points, { closed = false, width = 1.8, lift = 0.012 } = {}) {
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
    const mesh = new T.Mesh(geometry, pathMaterial);
    mesh.name = name;
    mesh.receiveShadow = true;
    scene.add(mesh);
    pathLines.push({ points: samples, halfWidth: width / 2 });
    return curve;
  }
  // Distance from a point to the nearest path edge (negative = on the path).
  const distanceToPaths = (x, z) => Math.min(...pathLines.map(({ points, halfWidth }) =>
    Math.min(...points.map((p) => Math.hypot(p.x - x, p.z - z))) - halfWidth));
  const isClear = (x, z, r) => reserved.every((spot) => Math.hypot(spot.x - x, spot.z - z) >= spot.r + r);

  // A loop passes just in front of the bench; spokes lead to the four entrances.
  const loopCenter = { x: 0, z: 10 };
  const loopPath = addPath('ParkLoopPath', [
    [0, 2.3], [6.5, 3.2], [11, 7], [11.5, 12.5], [7, 16.5], [0, 17.5], [-7, 16.5], [-11.5, 12.5], [-11, 7], [-6.5, 3.2],
  ], { closed: true });
  addPath('ParkNorthPath', [[0, 17.5], [0, 20], [0, parkHalf + 0.6]], { lift: 0.018 });
  addPath('MochiStoolPath', [[0, 20], [2.8, 19.8]], { width: 1.2, lift: 0.018 });
  addPath('ParkGatePath', [[0, -parkHalf - 0.6], [0, -16], [-3, -9], [-7, -3], [-9.4, 4.8]], { lift: 0.018 });
  addPath('ParkEastPath', [[11.5, 12.5], [17, 12.5], [parkHalf + 0.6, 12.5]], { lift: 0.018 });
  addPath('ParkWestPath', [[-11.5, 12.5], [-17, 12.5], [-parkHalf - 0.6, 12.5]], { lift: 0.018 });

  const mochiStoolPosition = { x: 2.8, z: 19.8 };
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
  const mochiScale = new T.Vector3(0.12 / rawMochiSize.x, 0.12 / rawMochiSize.y, 0.12 / rawMochiSize.z);
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
  mochiStool.add(mochiItem);
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
  const nervousClips = { SooAh: null, Ted: null };
  const terrifiedClips = { SooAh: null, Ted: null };
  const sitToStandClips = { SooAh: null, Ted: null };
  const standToSitClips = { SooAh: null, Ted: null };
  const mrLeeClips = { idle: inPlaceStandTransition(mrLeeIdleClip), walk: null };
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
    if (name === 'TedTurnLeft') { turnClips.Ted.left = inPlaceTurn(clip); turnAngles.Ted.left = measuredTurnAngle(clip); }
    if (name === 'TedTurnRight') { turnClips.Ted.right = inPlaceTurn(clip); turnAngles.Ted.right = measuredTurnAngle(clip); }
    if (name === 'TedSitting') sittingClips.Ted = clip;
    // Pin hip drift but keep its seated height (stripping the hips track floated her to standing
    // height). Processed once here so repeated F presses reuse the same clip.
    // Both talking clips turn toward the character's left (+X); Soo-ah sits on the +X side, so she
    // is mirrored to turn toward Ted instead of away from him.
    if (name === 'SooAhSittingTalk') sittingTalkClips.SooAh = mirrorClip(inPlaceStandTransition(clip));
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
  // Startup waits only for what Begin needs (Ted's seated idle drives the mixer setup below; each
  // character's sit-to-stand plays on Begin). The rest load later: see preloadSoon at the end.
  await Promise.all(['TedSitting', 'SooAhSitToStand', 'TedSitToStand'].map(ensureClip));
  const activeWalkVariant = { Ted: 'folder' };
  const walkClipFor = (name) => name === 'Ted' && activeWalkVariant.Ted === 'alternative'
    ? walkingVariants.Ted : walkingClips[name];
  const emotionalStates = {};
  const sittingTalkTimers = { SooAh: 0, Ted: 0 };
  let lookBehindRun = false;
  const sittingCharacters = new Set(['SooAh', 'Ted']);
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
      const idleClip = name ? sittingClips[name] : actorClips[0];
      const action = mixer.clipAction(idleClip);
      action.play();
      mixers.push(mixer);
      if (name) {
        characterMixers[name] = mixer;
        characterActions[name] = action;
      }
    }
  }
  characterMixers.Ted?.update(0);
  alignTedPelvisToSeat();
  tedHips.getWorldPosition(tedSeatedPelvis);
  bench.worldToLocal(tedSeatedPelvis);
  // The load-pose pelvis sits too far back for Ted's deformed legs to clear the seat.
  tedSeatedPelvis.z += 0.12;
  tedSeatedPelvisReady = true;
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
  const standingCharacters = new Set();
  const characterRoots = { SooAh: sooAh, Ted: tedRoot };
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
  const characterMode = { SooAh: 'sitting', Ted: 'sitting' };
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
    sooAh.position.y += parkHeightAt(sooAh.position.x, sooAh.position.z) - sooAhStandBounds.setFromObject(sooAh, true).min.y;
    sooAh.updateMatrixWorld(true);
  };
  const tedStandBounds = new T.Box3();
  const tedStandMeshes = [];
  ted.traverse((node) => { if (node.isSkinnedMesh) tedStandMeshes.push(node); });
  const groundTedDuringStand = () => {
    tedRoot.updateMatrixWorld(true);
    for (const mesh of tedStandMeshes) mesh.skeleton.update();
    tedRoot.position.y += parkHeightAt(tedRoot.position.x, tedRoot.position.z) - tedStandBounds.setFromObject(tedRoot, true).min.y;
    tedRoot.updateMatrixWorld(true);
  };
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
    if (!root || !mixer || !clip) return false;
    routeStarted = true;
    root.position.set(routeSpawn.x, parkHeightAt(routeSpawn.x, routeSpawn.z), routeSpawn.z);
    root.rotation.y = Math.atan2(-routeSpawn.x, -routeSpawn.z);
    sitClearance[name] = { y: 0, z: 0 };
    sittingCharacters.delete(name);
    standingReady.delete(name);
    standingCharacters.add(name);
    characterMode[name] = 'standingUp';
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
    const root = characterRoots[mochiEating?.recipient ?? selectedCharacter];
    followCamera.angle += wrapAngle(followCamera.targetAngle - followCamera.angle) * (1 - Math.exp(-dt * 6));
    followTarget.set(root.position.x, root.position.y + 0.7, root.position.z);
    const horizontal = Math.cos(followCamera.pitch) * followCamera.distance;
    camera.position.set(
      followTarget.x + Math.sin(followCamera.angle) * horizontal,
      followTarget.y + Math.sin(followCamera.pitch) * followCamera.distance,
      followTarget.z + Math.cos(followCamera.angle) * horizontal,
    );
    camera.position.y = Math.max(camera.position.y, parkHeightAt(camera.position.x, camera.position.z) + 0.3);
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
    if (mochiHolder === selectedCharacter && !mochiShared) {
      const friend = targets[0];
      if (dist(self.x, self.z, friend.point) < friend.radius) return friend.id;
    }
    if (routeStarted && !mochiHolder && !mochiShared) targets.push({ id: 'mochi', point: mochiStool.position, radius: 1.35 });
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
      duration: 3.1,
      startPosition: heldMochi.position.clone(),
      startScale: heldMochi.scale.clone(),
      startHeadQuaternion: (receiver === 'SooAh' ? sooAhHead : tedHead)?.quaternion.clone() ?? null,
    };
    if (followCamera.mode !== 'free') {
      followCamera.mode = 'front';
      followCamera.targetAngle = characterRoots[receiver].rotation.y;
    }
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
    const name = selectedCharacter;
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
    const inputLength = Math.hypot(directionX, directionZ);
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
    const next = moveRootWithBenchCollision(name, root,
      clamp(oldX + direction.x * step, -parkLimit, parkLimit), clamp(oldZ + direction.z * step, -parkLimit, parkLimit));
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
    root.position.x = clamp(next.x, -parkLimit, parkLimit);
    root.position.z = clamp(next.z, -parkLimit, parkLimit);
    root.position.y = parkHeightAt(root.position.x, root.position.z);
    player.x += root.position.x - oldX;
    player.z += root.position.z - oldZ;
    return true;
  }

  function look(dx, dy) {
    if (followCamera.mode !== 'free') {
      followCamera.angle -= dx * 0.005;
      followCamera.targetAngle -= dx * 0.005;
      followCamera.pitch = clamp(followCamera.pitch + dy * 0.004, -0.1, 1.25);
      return;
    }
    player.yaw -= dx * 0.0022;
    player.pitch = clamp(player.pitch - dy * 0.0018, -0.85, 0.48);
  }

  function interact() {
    const target = nearest();
    if (!target) return false;
    if (target === 'mochi') return pickUpMochi();
    const isBenchFriend = selectedCharacter === 'Ted' ? target === 'sooAh' : target === 'ted';
    if (routeStarted && isBenchFriend) {
      if (mochiHolder === selectedCharacter && !mochiShared) return shareMochi();
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
    mrLeePatrolling = false;
    setMrLeeMode('idle');
    const tedLines = [
        'Ted: Nova is holding auditions. You should try with me.',
        'Soo-ah: My dad told me not to see you. He wants me focused on studying.',
        'Ted: You helped me with Korean when school felt lonely. Let me support something you want.',
        'Soo-ah: All right. I will go to the audition.',
      ];
    if (mochiShared && mochiHolder === 'SooAh') tedLines.splice(1, 0, 'Soo-ah: Thank you for bringing the mochi.');
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
      characterMode[name] = 'standingIdle';
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
    const prompt = target === 'mochi' ? 'F · Pick up the mochi'
      : target === 'sooAh' ? mochiHolder === selectedCharacter && !mochiShared ? 'F · Give the mochi' : 'F · Talk to Soo-ah'
        : target === 'ted' ? mochiHolder === selectedCharacter && !mochiShared ? 'F · Give the mochi' : 'F · Talk to Ted'
        : target === 'lee' ? 'F · Talk to Mr. Lee' : '';
    return { task, prompt, message, selectedCharacter, standing: standingCharacters.has(selectedCharacter), walkingReady: standingReady.has(selectedCharacter) };
  }

  function update(t, dt) {
    const followed = characterRoots[selectedCharacter].position;
    sun.target.position.set(followed.x, 0, followed.z);
    sun.position.set(followed.x - 12, 20, followed.z + 16);
    if (followCamera.mode === 'free') {
      focus.set(player.x, 1.48, player.z);
      camera.position.copy(focus);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
    }
    updateMrLeePatrol(dt);
    for (const mixer of mixers) mixer.update(dt);
    if (walkingCharacters.has('Ted')) groundTedDuringStand();
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
        restoreStandingPose(name);
        delete turnStates[name];
        turningCharacters.delete(name);
        delete turningDirection[name];
        turnConsumed[name] = state.direction;
        delete movementModes[name];
        characterMode[name] = 'standingIdle';
        characterActions[name] = null;
      }
    }
    for (const name of Object.keys(sittingTalkTimers)) {
      if (sittingTalkTimers[name] <= 0) continue;
      sittingTalkTimers[name] = Math.max(0, sittingTalkTimers[name] - dt);
      if (sittingTalkTimers[name] === 0 && characterMode[name] === 'sittingTalking') restoreIdle(name);
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
      restoreStandingPose(name);
      characterActions[name] = null;
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
    for (const name of ['SooAh', 'Ted']) {
      if (sittingCharacters.has(name) || sittingDown.has(name) || characterMode[name] === 'standingUp') clampSeatedPelvis(name);
    }
    updateMochiEating(dt);
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
        while (mochiEating && mochiEating.elapsed < 2.3) await nextFrame();
        await debug.captureScreenshot?.('mochi-at-mouth.png');
      }
      frames = 0;
      while (gaveToSooAh && !mochiConsumed && frames++ < 180) await nextFrame();
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
        mochiHiddenAfterBite: !heldMochi.visible,
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

  return { scene, cameras: [{ name: 'PromiseGrove', camera }], camera, update, move, walkSelected, look, interact, selectCharacter, setCameraView, startRoute, setWalkingVariant, setLookBehindRun, triggerNervous, triggerTerrified, clearEmotion, standSelected, sitSelected, canStandSelected, canSitSelected, setMrLeeMode, hud, player, debug };
}
