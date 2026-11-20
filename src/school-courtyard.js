import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function buildSchoolCourtyard(THREE, { frontZ, mapZ, benchAsset, treeAsset }) {
  const root = new THREE.Group();
  root.name = 'SeoulSchoolCourtyardDressing';
  const materials = {
    path: new THREE.MeshStandardMaterial({ color: '#c5c1b7', roughness: 0.94 }),
    pathJoint: new THREE.MeshStandardMaterial({ color: '#ada99f', roughness: 0.97 }),
    stone: new THREE.MeshStandardMaterial({ color: '#c7c2b8', roughness: 0.9 }),
    navy: new THREE.MeshStandardMaterial({ color: '#263d50', roughness: 0.76 }),
    door: new THREE.MeshStandardMaterial({ color: '#334b57', roughness: 0.42, metalness: 0.12 }),
    glass: new THREE.MeshStandardMaterial({ color: '#8baeb5', roughness: 0.26, metalness: 0.05 }),
    trim: new THREE.MeshStandardMaterial({ color: '#d7d0c2', roughness: 0.82 }),
    wood: new THREE.MeshStandardMaterial({ color: '#76513b', roughness: 0.84 }),
    planter: new THREE.MeshStandardMaterial({ color: '#827d72', roughness: 0.94 }),
    soil: new THREE.MeshStandardMaterial({ color: '#44392d', roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#506947', roughness: 0.92 }),
    leafLight: new THREE.MeshStandardMaterial({ color: '#789061', roughness: 0.9 }),
    flower: new THREE.MeshStandardMaterial({ color: '#e4afbd', roughness: 0.84 }),
    metal: new THREE.MeshStandardMaterial({ color: '#687771', roughness: 0.54, metalness: 0.36 }),
    paper: new THREE.MeshStandardMaterial({ color: '#f0e6d4', roughness: 0.88 }),
    red: new THREE.MeshStandardMaterial({ color: '#bd6f6b', roughness: 0.84 }),
    brass: new THREE.MeshStandardMaterial({ color: '#c6a66b', roughness: 0.46, metalness: 0.48 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: '#f3d9a4', emissive: '#f0b85c', emissiveIntensity: 1.1, roughness: 0.3 }),
  };
  const addMesh = (parent, name, geometry, material, position, rotation = null) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const rounded = (parent, name, size, radius, material, position) => addMesh(
    parent, name, new RoundedBoxGeometry(...size, 3, radius), material, position,
  );

  const entryZ = frontZ + 0.10;
  const canopyZ = frontZ + 0.72;
  const canopy = new THREE.Group();
  canopy.name = 'SchoolEntranceCanopy';
  rounded(canopy, 'SchoolCanopyRoof', [6.0, 0.16, 1.55], 0.04, materials.navy, [0, 2.55, canopyZ]);
  rounded(canopy, 'SchoolCanopyUnderside', [5.72, 0.045, 1.34], 0.02, materials.trim, [0, 2.45, canopyZ]);
  for (const x of [-2.65, 2.65]) {
    rounded(canopy, `SchoolCanopyColumn_${x}`, [0.22, 2.42, 0.22], 0.035, materials.trim, [x, 1.21, canopyZ]);
    addMesh(canopy, `SchoolColumnFoot_${x}`, new THREE.BoxGeometry(0.34, 0.12, 0.34), materials.navy, [x, 0.06, canopyZ]);
  }
  root.add(canopy);

  const threshold = addMesh(root, 'SchoolEntranceStep', new THREE.BoxGeometry(5.8, 0.12, 1.45), materials.stone, [0, 0.035, frontZ + 0.52]);
  threshold.receiveShadow = true;
  for (const x of [-0.51, 0.51]) {
    rounded(root, `SchoolEntryDoor_${x}`, [0.94, 2.02, 0.085], 0.025, materials.door, [x, 1.03, entryZ]);
    addMesh(root, `SchoolDoorWindow_${x}`, new THREE.BoxGeometry(0.72, 1.12, 0.016), materials.glass, [x, 1.35, entryZ - 0.05]);
    addMesh(root, `SchoolDoorKick_${x}`, new THREE.BoxGeometry(0.76, 0.35, 0.02), materials.navy, [x, 0.36, entryZ - 0.052]);
  }
  addMesh(root, 'SchoolDoorCenterPost', new THREE.BoxGeometry(0.08, 2.08, 0.10), materials.trim, [0, 1.04, entryZ - 0.01]);
  for (const x of [-0.08, 0.08]) {
    addMesh(root, `SchoolDoorHandle_${x}`, new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), materials.trim, [x, 1.02, entryZ - 0.08]);
  }

  const signCanvas = document.createElement('canvas');
  signCanvas.width = 768;
  signCanvas.height = 160;
  const signContext = signCanvas.getContext('2d');
  signContext.fillStyle = '#253e52';
  signContext.fillRect(0, 0, signCanvas.width, signCanvas.height);
  signContext.strokeStyle = '#e7d6b4';
  signContext.lineWidth = 8;
  signContext.strokeRect(6, 6, signCanvas.width - 12, signCanvas.height - 12);
  signContext.textAlign = 'center';
  signContext.fillStyle = '#f5ead7';
  signContext.font = 'bold 42px sans-serif';
  signContext.fillText('SEOUL HIGH SCHOOL  ·  서울고등학교', signCanvas.width / 2, 100);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  rounded(root, 'SchoolEntranceSignFrame', [4.25, 0.72, 0.10], 0.04, materials.trim, [0, 3.22, frontZ + 1.55]);
  const signFace = new THREE.Mesh(new THREE.PlaneGeometry(4.05, 0.56), new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide, toneMapped: false }));
  signFace.name = 'SchoolEntranceSign';
  signFace.position.set(0, 3.22, frontZ + 1.61);
  root.add(signFace);

  const walkwayStart = frontZ + 1.35;
  const walkwayEnd = mapZ + 15.5;
  const walkwayLength = Math.max(8, walkwayEnd - walkwayStart);
  const walkway = new THREE.Mesh(new THREE.PlaneGeometry(3.2, walkwayLength), materials.path);
  walkway.name = 'SchoolEntranceWalkway';
  walkway.rotation.x = -Math.PI / 2;
  walkway.position.set(0, -0.004, (walkwayStart + walkwayEnd) / 2);
  walkway.receiveShadow = true;
  root.add(walkway);
  const jointCount = Math.floor(walkwayLength / 1.45);
  for (let i = 1; i < jointCount; i++) {
    const z = walkwayStart + (walkwayLength * i) / jointCount;
    addMesh(root, `SchoolWalkwayJoint_${i}`, new THREE.BoxGeometry(3.16, 0.006, 0.018), materials.pathJoint, [0, 0.001, z]);
  }
  for (const x of [-1.65, 1.65]) {
    addMesh(root, `SchoolWalkwayBorder_${x}`, new THREE.BoxGeometry(0.12, 0.035, walkwayLength), materials.stone, [x, 0.005, (walkwayStart + walkwayEnd) / 2]);
  }

  const addPlanter = (name, x, z) => {
    const planter = new THREE.Group();
    planter.name = name;
    rounded(planter, `${name}Box`, [1.2, 0.42, 0.55], 0.045, materials.planter, [0, 0.21, 0]);
    addMesh(planter, `${name}Soil`, new THREE.BoxGeometry(1.04, 0.045, 0.40), materials.soil, [0, 0.43, 0]);
    for (let i = 0; i < 5; i++) {
      const xOffset = (i - 2) * 0.19;
      const shrub = addMesh(planter, `${name}Shrub_${i}`, new THREE.SphereGeometry(0.25, 10, 8), i % 2 ? materials.leaf : materials.leafLight, [xOffset, 0.62 + (i % 2) * 0.05, (i % 2 ? 0.07 : -0.05)]);
      shrub.scale.set(1.0, 0.72, 0.82);
    }
    for (const [i, offset] of [[0, -0.28], [1, 0.22]]) {
      addMesh(planter, `${name}Flower_${i}`, new THREE.SphereGeometry(0.07, 10, 8), materials.flower, [offset, 0.82, 0.08]);
    }
    planter.position.set(x, -0.02, z);
    root.add(planter);
  };
  for (const z of [frontZ + 2.8, mapZ + 4.5]) {
    addPlanter(`SchoolPlanterLeft_${z}`, -2.3, z);
    addPlanter(`SchoolPlanterRight_${z}`, 2.3, z);
  }

  if (treeAsset) {
    for (const [name, x, z, yaw] of [
      ['SchoolBlossomTreeWest', -3.4, frontZ + 4.8, 0.12],
      ['SchoolBlossomTreeEast', 3.4, frontZ + 4.8, Math.PI - 0.12],
    ]) {
      const tree = treeAsset.clone(true);
      tree.name = name;
      tree.rotation.y = yaw;
      tree.traverse((node) => {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (node.isMesh && materials.some((material) => material?.name === 'Material.003')) node.parent?.remove(node);
      });
      tree.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material.map((material) => material.clone()) : node.material.clone();
        for (const material of Array.isArray(materials) ? materials : [materials]) material.side = THREE.DoubleSide;
        node.material = materials;
      });
      const bounds = new THREE.Box3().setFromObject(tree);
      const scale = 0.24;
      const center = bounds.getCenter(new THREE.Vector3());
      tree.scale.setScalar(scale);
      tree.position.set(x - center.x * scale, -bounds.min.y * scale, z - center.z * scale);
      setTreeShadows(tree);
      root.add(tree);
    }
  }

  for (const [side, x] of [['West', -2.15], ['East', 2.15]]) {
    const z = mapZ + 1.3;
    const pole = addMesh(root, `SchoolPathLampPole${side}`, new THREE.CylinderGeometry(0.045, 0.07, 2.8, 10), materials.metal, [x, 1.4, z]);
    addMesh(root, `SchoolPathLampBase${side}`, new THREE.CylinderGeometry(0.18, 0.22, 0.12, 12), materials.navy, [x, 0.06, z]);
    addMesh(root, `SchoolPathLampCap${side}`, new THREE.CylinderGeometry(0.21, 0.15, 0.16, 12), materials.trim, [x, 2.84, z]);
    addMesh(root, `SchoolPathLampGlow${side}`, new THREE.SphereGeometry(0.12, 12, 8), materials.lampGlow, [x, 2.72, z]);
    pole.castShadow = false;
  }

  const noticeBoard = new THREE.Group();
  noticeBoard.name = 'SchoolNoticeBoard';
  rounded(noticeBoard, 'SchoolNoticeFrame', [1.35, 1.55, 0.12], 0.045, materials.wood, [0, 0.78, 0]);
  rounded(noticeBoard, 'SchoolNoticeBacking', [1.18, 1.34, 0.025], 0.008, materials.navy, [0, 0.78, -0.073]);
  for (const [i, [x, y]] of [[0, [-0.31, 1.05]], [1, [0.28, 0.98]], [2, [-0.28, 0.51]], [3, [0.27, 0.48]]]) {
    rounded(noticeBoard, `SchoolNoticePaper_${i}`, [0.42, 0.40, 0.014], 0.005, materials.paper, [x, y, -0.095]);
    addMesh(noticeBoard, `SchoolNoticePin_${i}`, new THREE.SphereGeometry(0.023, 8, 6), i % 2 ? materials.red : materials.brass, [x, y + 0.12, -0.106]);
  }
  noticeBoard.position.set(3.6, 0, frontZ + 3.0);
  noticeBoard.rotation.y = -0.08;
  root.add(noticeBoard);

  if (benchAsset) {
    for (const [name, x, yaw] of [['SchoolCourtyardBenchWest', -3.35, Math.PI / 2], ['SchoolCourtyardBenchEast', 3.35, -Math.PI / 2]]) {
      const bench = benchAsset.clone(true);
      bench.name = name;
      bench.rotation.y = yaw;
      bench.position.set(x, 0, mapZ + 1.5);
      const box = new THREE.Box3().setFromObject(bench);
      bench.position.y -= box.min.y;
      root.add(bench);
    }
  }

  return root;
}

function setTreeShadows(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });
}
