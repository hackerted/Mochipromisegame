export function buildAuditionStage(THREE) {
  const root = new THREE.Group();
  root.name = 'NOVA_AuditionStage';

  const material = (name, color, roughness = 0.82, metalness = 0) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    value.name = name;
    return value;
  };
  const wood = material('Stage_WarmWood', '#7d4c39');
  const woodEdge = material('Stage_DarkEdge', '#382d39');
  const backdropMat = material('Stage_Backdrop', '#18263c');
  const curtainMat = material('Stage_Curtain', '#673d67');
  const trimMat = material('Stage_GoldTrim', '#d5a95f', 0.42, 0.25);
  const speakerMat = material('Stage_Speaker', '#202630', 0.65);
  const micMat = material('Stage_Microphone', '#4e5764', 0.38, 0.65);
  const robotWhite = material('Ted_Figure_White', '#e6e9ee', 0.45);
  const robotBlue = material('Ted_Figure_Blue', '#3b6a9d', 0.42, 0.1);
  const robotRed = material('Ted_Figure_Red', '#c64f55', 0.42, 0.05);

  const box = (name, size, position, surface) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), surface);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  box('Audition_StageDeck', [14, 0.38, 10], [0, 0.19, 0], wood);
  box('Audition_StageFront', [14, 0.62, 0.28], [0, 0.03, 5.12], woodEdge);
  box('Audition_StageNosing', [14, 0.055, 0.12], [0, 0.39, 5.03], trimMat);
  box('Audition_BackWall', [16, 8, 0.35], [0, 4, -5.25], backdropMat);
  box('Audition_LeftWall', [0.32, 8, 10.5], [-8.05, 4, -0.15], backdropMat);
  box('Audition_RightWall', [0.32, 8, 10.5], [8.05, 4, -0.15], backdropMat);
  box('Audition_LeftCurtain', [1.15, 6.8, 0.42], [-6.8, 3.65, -4.93], curtainMat);
  box('Audition_RightCurtain', [1.15, 6.8, 0.42], [6.8, 3.65, -4.93], curtainMat);
  box('Audition_Header', [14, 0.3, 0.52], [0, 5.75, -4.98], woodEdge);
  box('Audition_HeaderTrim', [14, 0.075, 0.56], [0, 5.57, -4.95], trimMat);

  const signCanvas = document.createElement('canvas');
  signCanvas.width = 1024;
  signCanvas.height = 256;
  const signContext = signCanvas.getContext('2d');
  signContext.fillStyle = '#18263c';
  signContext.fillRect(0, 0, signCanvas.width, signCanvas.height);
  signContext.strokeStyle = '#d5a95f';
  signContext.lineWidth = 10;
  signContext.strokeRect(8, 8, signCanvas.width - 16, signCanvas.height - 16);
  signContext.fillStyle = '#f6e8df';
  signContext.font = '700 150px Arial, sans-serif';
  signContext.textAlign = 'center';
  signContext.textBaseline = 'middle';
  signContext.fillText('NOVA', signCanvas.width / 2, signCanvas.height / 2);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 1.45), new THREE.MeshBasicMaterial({
    map: signTexture,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));
  sign.name = 'Audition_NovaSign';
  sign.position.set(0, 4.3, -5.04);
  root.add(sign);

  for (const x of [-5.8, 5.8]) {
    box(`Audition_Speaker_${x < 0 ? 'L' : 'R'}`, [0.92, 1.65, 0.68], [x, 1.2, -1.2], speakerMat);
  }

  const mic = new THREE.Group();
  mic.name = 'Audition_MicrophoneStand';
  const micBase = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.07, 16), micMat);
  micBase.position.y = 0.425;
  const micPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.15, 10), micMat);
  micPole.position.y = 1.03;
  const micHead = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.18, 4, 8), micMat);
  micHead.rotation.z = Math.PI / 2;
  micHead.position.set(0, 1.64, 0.02);
  mic.add(micBase, micPole, micHead);
  mic.position.set(2.6, 0, -0.8);
  root.add(mic);

  const figure = new THREE.Group();
  figure.name = 'Ted_GoodLuck_Figure';
  const figurePart = (name, size, position, surface) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), surface);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    figure.add(mesh);
  };
  figurePart('Figure_Torso', [0.23, 0.3, 0.15], [0, 0.39, 0], robotBlue);
  figurePart('Figure_Chest', [0.13, 0.095, 0.035], [0, 0.43, 0.088], robotRed);
  figurePart('Figure_Head', [0.2, 0.18, 0.18], [0, 0.64, 0], robotWhite);
  figurePart('Figure_Horn_L', [0.035, 0.17, 0.045], [-0.09, 0.78, 0], robotRed);
  figurePart('Figure_Horn_R', [0.035, 0.17, 0.045], [0.09, 0.78, 0], robotRed);
  for (const side of [-1, 1]) {
    figurePart(`Figure_Arm_${side}`, [0.09, 0.29, 0.1], [side * 0.17, 0.38, 0], robotWhite);
    figurePart(`Figure_Leg_${side}`, [0.085, 0.25, 0.1], [side * 0.07, 0.12, 0], robotBlue);
  }
  const figureStand = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.48), woodEdge);
  figureStand.name = 'Ted_Figure_Display_Plinth';
  figureStand.position.set(0, 0.06, 0);
  figureStand.castShadow = true;
  figure.add(figureStand);
  figure.scale.setScalar(0.5);
  figure.position.set(3.2, 0.38, 2.3);
  root.add(figure);
  figure.visible = false;

  const fill = new THREE.HemisphereLight('#d8e6ff', '#392e42', 1.15);
  fill.name = 'Audition_FillLight';
  root.add(fill);
  for (const [i, color] of ['#f8c5d4', '#b9d3ff', '#ffe0a8'].entries()) {
    const light = new THREE.SpotLight(color, 48, 22, Math.PI / 6, 0.6, 1.3);
    light.name = `Audition_Spot_${i + 1}`;
    light.position.set((i - 1) * 3.5, 6.8, 1.5);
    light.castShadow = false;
    const target = new THREE.Object3D();
    target.position.set((i - 1) * 1.6, 0.3, -0.8);
    target.name = `Audition_SpotTarget_${i + 1}`;
    root.add(target);
    light.target = target;
    root.add(light);
  }

  return { root, figure };
}
