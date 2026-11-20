import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function buildCafeFurniture(THREE) {
  const seating = new THREE.Group();
  seating.name = 'LeeCafeDiningFurniture';
  seating.position.y = -0.012;

  const counterDressing = new THREE.Group();
  counterDressing.name = 'LeeCafeCounterDressing';
  const room = new THREE.Group();
  room.name = 'LeeCafeBingsuInterior';
  room.position.y = -0.012;

  const materials = {
    wood: new THREE.MeshStandardMaterial({ color: '#80543a', roughness: 0.78 }),
    lightWood: new THREE.MeshStandardMaterial({ color: '#a9784d', roughness: 0.74 }),
    darkWood: new THREE.MeshStandardMaterial({ color: '#583a2d', roughness: 0.82 }),
    metal: new THREE.MeshStandardMaterial({ color: '#30383b', roughness: 0.42, metalness: 0.65 }),
    steel: new THREE.MeshStandardMaterial({ color: '#bcc4c3', roughness: 0.48, metalness: 0.15 }),
    panel: new THREE.MeshStandardMaterial({ color: '#283234', roughness: 0.38, metalness: 0.25 }),
    cream: new THREE.MeshStandardMaterial({ color: '#f2e6d1', roughness: 0.28 }),
    sage: new THREE.MeshStandardMaterial({ color: '#71836c', roughness: 0.88 }),
    rust: new THREE.MeshStandardMaterial({ color: '#a5664d', roughness: 0.86 }),
    coffee: new THREE.MeshStandardMaterial({ color: '#38231b', roughness: 0.32 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b18a52', roughness: 0.35, metalness: 0.72 }),
    red: new THREE.MeshStandardMaterial({ color: '#c75e4d', roughness: 0.4 }),
    green: new THREE.MeshStandardMaterial({ color: '#8aa56d', roughness: 0.42 }),
    plaster: new THREE.MeshStandardMaterial({ color: '#e8d9c4', roughness: 0.92 }),
    wallWood: new THREE.MeshStandardMaterial({ color: '#75513b', roughness: 0.84 }),
    wallTrim: new THREE.MeshStandardMaterial({ color: '#4e3a2d', roughness: 0.82 }),
    glass: new THREE.MeshStandardMaterial({ color: '#a7c8c7', roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.26, depthWrite: false }),
    fridgeInterior: new THREE.MeshStandardMaterial({ color: '#dce6df', roughness: 0.72 }),
    berry: new THREE.MeshStandardMaterial({ color: '#c83d4f', roughness: 0.54 }),
    ice: new THREE.MeshStandardMaterial({ color: '#edf4f2', roughness: 0.2, transparent: true, opacity: 0.82 }),
  };
  const fridgeGlass = new THREE.MeshBasicMaterial({ color: '#dff1e8', side: THREE.DoubleSide, transparent: true, opacity: 0.18, depthWrite: false });

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

  const addRoundedBox = (parent, name, size, radius, material, position) => addMesh(
    parent, name, new RoundedBoxGeometry(...size, 3, radius), material, position,
  );

  const makeCup = (parent, name, position, porcelain, withCoffee = true) => {
    const cup = new THREE.Group();
    cup.name = name;
    cup.position.set(...position);
    addMesh(cup, `${name}Saucer`, new THREE.CylinderGeometry(0.079, 0.079, 0.009, 24), materials.cream, [0, 0.005, 0]);
    const profile = [
      new THREE.Vector2(0.031, 0.011), new THREE.Vector2(0.039, 0.011),
      new THREE.Vector2(0.046, 0.018), new THREE.Vector2(0.052, 0.088),
      new THREE.Vector2(0.049, 0.095), new THREE.Vector2(0.043, 0.091),
      new THREE.Vector2(0.038, 0.082), new THREE.Vector2(0.034, 0.02),
      new THREE.Vector2(0.028, 0.017),
    ];
    const mug = addMesh(cup, `${name}Mug`, new THREE.LatheGeometry(profile, 24), porcelain, [0, 0.009, 0]);
    mug.material.side = THREE.DoubleSide;
    addMesh(cup, `${name}Handle`, new THREE.TorusGeometry(0.026, 0.005, 8, 20), porcelain, [0.049, 0.055, 0]);
    addMesh(cup, `${name}Rim`, new THREE.TorusGeometry(0.049, 0.0025, 6, 24), porcelain, [0, 0.099, 0], [Math.PI / 2, 0, 0]);
    if (withCoffee) {
      addMesh(cup, `${name}Coffee`, new THREE.CylinderGeometry(0.034, 0.034, 0.003, 20), materials.coffee, [0, 0.087, 0]);
    }
    parent.add(cup);
    return cup;
  };

  const makeChair = (name, cushionMaterial) => {
    const chair = new THREE.Group();
    chair.name = name;
    addRoundedBox(chair, `${name}SeatFrame`, [0.43, 0.055, 0.43], 0.018, materials.wood, [0, 0.45, 0]);
    addRoundedBox(chair, `${name}Cushion`, [0.385, 0.032, 0.385], 0.018, cushionMaterial, [0, 0.493, 0]);
    for (const x of [-0.17, 0.17]) for (const z of [-0.17, 0.17]) {
      addMesh(chair, `${name}Leg_${x}_${z}`, new THREE.BoxGeometry(0.035, 0.43, 0.035), materials.darkWood, [x, 0.215, z]);
    }
    for (const x of [-0.18, 0.18]) {
      addMesh(chair, `${name}BackPost_${x}`, new THREE.BoxGeometry(0.038, 0.42, 0.038), materials.wood, [x, 0.69, -0.185]);
    }
    for (const y of [0.62, 0.77]) {
      addRoundedBox(chair, `${name}BackSlat_${y}`, [0.34, 0.055, 0.035], 0.012, materials.lightWood, [0, y, -0.185]);
    }
    return chair;
  };

  for (const [side, x, cushion] of [['Left', -1.65, materials.sage], ['Right', 1.65, materials.rust]]) {
    const table = new THREE.Group();
    table.name = `LeeCafeTable${side}`;
    addMesh(table, `${table.name}Base`, new THREE.CylinderGeometry(0.22, 0.22, 0.028, 28), materials.metal, [0, 0.014, 0]);
    addMesh(table, `${table.name}Pedestal`, new THREE.CylinderGeometry(0.036, 0.042, 0.66, 16), materials.metal, [0, 0.36, 0]);
    addMesh(table, `${table.name}TopMount`, new THREE.CylinderGeometry(0.15, 0.15, 0.025, 24), materials.metal, [0, 0.69, 0]);
    addMesh(table, `${table.name}Top`, new THREE.CylinderGeometry(0.38, 0.38, 0.06, 32), side === 'Left' ? materials.lightWood : materials.wood, [0, 0.735, 0]);
    addMesh(table, `${table.name}Edge`, new THREE.TorusGeometry(0.365, 0.006, 6, 32), materials.darkWood, [0, 0.762, 0], [Math.PI / 2, 0, 0]);
    makeCup(table, `${table.name}Cup`, [0.12, 0.765, 0.015], materials.cream);
    table.position.set(x, 0, -1.15);
    seating.add(table);

    const nearChair = makeChair(`LeeCafeChair${side}Near`, cushion);
    nearChair.position.set(x, 0, -1.91);
    seating.add(nearChair);
    const farChair = makeChair(`LeeCafeChair${side}Far`, cushion);
    farChair.position.set(x, 0, -0.39);
    farChair.rotation.y = Math.PI;
    seating.add(farChair);
  }

  const machine = new THREE.Group();
  machine.name = 'LeeCafeEspressoMachine';
  addMesh(machine, `${machine.name}Base`, new THREE.BoxGeometry(0.74, 0.045, 0.34), materials.darkWood, [0, 0.0225, 0]);
  addRoundedBox(machine, `${machine.name}Body`, [0.70, 0.30, 0.34], 0.035, materials.steel, [0, 0.19, 0]);
  addMesh(machine, `${machine.name}TopTray`, new THREE.BoxGeometry(0.67, 0.025, 0.29), materials.metal, [0, 0.353, 0]);
  addMesh(machine, `${machine.name}ControlPanel`, new THREE.BoxGeometry(0.54, 0.11, 0.018), materials.panel, [0, 0.245, -0.18]);
  for (const [i, material] of [materials.green, materials.red, materials.brass].entries()) {
    addMesh(machine, `${machine.name}Button_${i}`, new THREE.SphereGeometry(0.018, 12, 8), material, [-0.15 + i * 0.15, 0.25, -0.194]);
  }
  addMesh(machine, `${machine.name}Display`, new THREE.BoxGeometry(0.11, 0.045, 0.008), materials.green, [0.29, 0.27, -0.19]);
  const gauge = new THREE.Group();
  gauge.name = `${machine.name}PressureGauge`;
  gauge.rotation.y = Math.PI;
  addMesh(gauge, `${gauge.name}Bezel`, new THREE.TorusGeometry(0.041, 0.005, 8, 24), materials.brass, [0, 0, 0]);
  addMesh(gauge, `${gauge.name}Face`, new THREE.CircleGeometry(0.036, 24), materials.cream, [0, 0, 0.002]);
  addMesh(gauge, `${gauge.name}Needle`, new THREE.BoxGeometry(0.003, 0.026, 0.003), materials.red, [0.006, 0.002, 0.006], [0, 0, -0.35]);
  gauge.position.set(-0.25, 0.29, -0.19);
  machine.add(gauge);
  for (const x of [-0.18, 0.18]) {
    addMesh(machine, `${machine.name}GroupHead_${x}`, new THREE.CylinderGeometry(0.035, 0.035, 0.055, 16), materials.brass, [x, 0.105, -0.19], [Math.PI / 2, 0, 0]);
    addMesh(machine, `${machine.name}Portafilter_${x}`, new THREE.CylinderGeometry(0.009, 0.009, 0.105, 8), materials.darkWood, [x, 0.07, -0.24], [Math.PI / 2, 0, 0]);
  }
  addMesh(machine, `${machine.name}SteamWand`, new THREE.CylinderGeometry(0.008, 0.01, 0.17, 8), materials.steel, [0.32, 0.11, -0.13], [0.22, 0, 0]);
  addMesh(machine, `${machine.name}SteamTip`, new THREE.SphereGeometry(0.014, 10, 8), materials.brass, [0.34, 0.035, -0.15]);
  machine.position.set(-0.84, 0.78, 0.34);
  counterDressing.add(machine);
  makeCup(counterDressing, 'LeeCafeCounterCupLeft', [-0.22, 0.78, 0.34], materials.cream);
  makeCup(counterDressing, 'LeeCafeCounterCupRight', [0.75, 0.78, 0.34], materials.sage, false);

  addRoundedBox(room, 'CafeBackWall', [5.8, 3.0, 0.14], 0.025, materials.plaster, [0, 1.5, 2.36]);
  addRoundedBox(room, 'CafeBackWainscot', [5.8, 0.78, 0.07], 0.015, materials.wallWood, [0, 0.39, 2.25]);
  addRoundedBox(room, 'CafeBackRail', [5.8, 0.07, 0.09], 0.012, materials.lightWood, [0, 0.81, 2.23]);
  addRoundedBox(room, 'CafeBackBaseboard', [5.8, 0.10, 0.08], 0.012, materials.wallTrim, [0, 0.05, 2.23]);
  for (const x of [-2.35, -1.55, -0.75, 0.75, 1.55, 2.35]) {
    addMesh(room, `CafeBackPanel_${x}`, new THREE.BoxGeometry(0.018, 2.05, 0.028), materials.wallWood, [x, 1.87, 2.27]);
  }
  for (const side of [-1, 1]) {
    addRoundedBox(room, `CafeSideWall_${side}`, [0.14, 3.0, 4.9], 0.02, materials.plaster, [side * 2.83, 1.5, 0]);
    addRoundedBox(room, `CafeSideWainscot_${side}`, [0.07, 0.78, 4.9], 0.012, materials.wallWood, [side * 2.73, 0.39, 0]);
    addMesh(room, `CafeSideWindow_${side}`, new THREE.BoxGeometry(0.035, 1.15, 1.25), materials.glass, [side * 2.73, 1.92, 0.42]);
    for (const z of [-0.23, 1.07]) addMesh(room, `CafeSideWindowFrame_${side}_${z}`, new THREE.BoxGeometry(0.08, 1.25, 0.055), materials.wallWood, [side * 2.70, 1.92, z]);
    for (const y of [1.32, 2.52]) addMesh(room, `CafeSideWindowRail_${side}_${y}`, new THREE.BoxGeometry(0.08, 0.055, 1.35), materials.wallWood, [side * 2.70, y, 0.42]);
  }

  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 160;
  const boardContext = boardCanvas.getContext('2d');
  boardContext.translate(boardCanvas.width, 0);
  boardContext.scale(-1, 1);
  boardContext.fillStyle = '#294139';
  boardContext.fillRect(0, 0, 512, 160);
  boardContext.strokeStyle = '#c4a370';
  boardContext.lineWidth = 8;
  boardContext.strokeRect(6, 6, 500, 148);
  boardContext.textAlign = 'center';
  boardContext.fillStyle = '#f2e4cf';
  boardContext.font = 'bold 34px sans-serif';
  boardContext.fillText('FRESH BINGSU  ·  COFFEE', 256, 64);
  boardContext.font = '22px sans-serif';
  boardContext.fillText('RED BEAN  ·  STRAWBERRY  ·  INJEOLMI', 256, 112);
  const boardTexture = new THREE.CanvasTexture(boardCanvas);
  boardTexture.colorSpace = THREE.SRGBColorSpace;
  addRoundedBox(room, 'BingsuMenuFrame', [1.92, 0.68, 0.06], 0.025, materials.wallTrim, [0, 2.35, 2.24]);
  const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(1.82, 0.58), new THREE.MeshBasicMaterial({ map: boardTexture, side: THREE.DoubleSide, toneMapped: false }));
  boardFace.name = 'BingsuMenuBoard';
  boardFace.position.set(0, 2.35, 2.204);
  room.add(boardFace);

  const prep = new THREE.Group();
  prep.name = 'LeeCafePreparationStation';
  prep.position.set(-2.0, 0, 1.44);
  addRoundedBox(prep, 'CafePrepCabinet', [1.58, 0.76, 0.58], 0.025, materials.wallWood, [0, 0.38, 0]);
  addRoundedBox(prep, 'CafePrepSteelTop', [1.68, 0.055, 0.68], 0.02, materials.steel, [0, 0.81, 0]);
  for (const x of [-0.48, 0.48]) {
    addRoundedBox(prep, `CafePrepDoor_${x}`, [0.56, 0.57, 0.025], 0.015, materials.lightWood, [x, 0.38, -0.302]);
    addMesh(prep, `CafePrepHandle_${x}`, new THREE.CylinderGeometry(0.009, 0.009, 0.12, 8), materials.brass, [x + 0.18, 0.4, -0.324], [Math.PI / 2, 0, 0]);
  }
  const iceShaver = new THREE.Group();
  iceShaver.name = 'BingsuIceShaver';
  iceShaver.position.set(-0.48, 0.84, 0.02);
  addRoundedBox(iceShaver, 'IceShaverBody', [0.42, 0.42, 0.38], 0.035, materials.steel, [0, 0.21, 0]);
  addRoundedBox(iceShaver, 'IceShaverFront', [0.30, 0.20, 0.025], 0.018, materials.panel, [0, 0.22, -0.204]);
  addMesh(iceShaver, 'IceShaverHopper', new THREE.CylinderGeometry(0.12, 0.10, 0.16, 20), materials.cream, [0, 0.50, 0]);
  addMesh(iceShaver, 'IceShaverHopperLid', new THREE.CylinderGeometry(0.125, 0.125, 0.018, 20), materials.wallTrim, [0, 0.59, 0]);
  addMesh(iceShaver, 'IceShaverSpout', new THREE.CylinderGeometry(0.028, 0.028, 0.12, 12), materials.steel, [0.11, 0.09, -0.22], [Math.PI / 2, 0, -0.25]);
  const shavedIceBowl = new THREE.Group();
  shavedIceBowl.name = 'ShavedIceBowl';
  addMesh(shavedIceBowl, 'ShavedIceBowlDish', new THREE.CylinderGeometry(0.14, 0.10, 0.06, 18), materials.steel, [0, 0.03, 0]);
  addMesh(shavedIceBowl, 'ShavedIceMound', new THREE.SphereGeometry(0.095, 16, 10), materials.ice, [0, 0.105, 0]);
  shavedIceBowl.position.set(-0.28, 0.84, -0.24);
  prep.add(iceShaver, shavedIceBowl);
  const hob = new THREE.Group();
  hob.name = 'CafeInductionHob';
  hob.position.set(0.43, 0.84, 0.02);
  addRoundedBox(hob, 'InductionHobTop', [0.44, 0.025, 0.38], 0.025, materials.panel, [0, 0, 0]);
  addMesh(hob, 'InductionHobRing', new THREE.TorusGeometry(0.12, 0.008, 6, 24), materials.red, [0, 0.016, 0], [Math.PI / 2, 0, 0]);
  const pot = new THREE.Group();
  pot.name = 'CafeCookingPot';
  addMesh(pot, 'CookingPotBody', new THREE.CylinderGeometry(0.095, 0.085, 0.13, 18), materials.steel, [0, 0.09, 0]);
  addMesh(pot, 'CookingPotLid', new THREE.CylinderGeometry(0.092, 0.092, 0.018, 18), materials.metal, [0, 0.164, 0]);
  addMesh(pot, 'CookingPotKnob', new THREE.SphereGeometry(0.018, 10, 8), materials.darkWood, [0, 0.185, 0]);
  pot.position.set(0.43, 0.835, 0.02);
  prep.add(hob, pot);
  room.add(prep);

  const fridge = new THREE.Group();
  fridge.name = 'BingsuIngredientFridge';
  fridge.position.set(2.08, 0, 1.56);
  addRoundedBox(fridge, 'IngredientFridgeShell', [0.76, 1.88, 0.62], 0.025, materials.steel, [0, 0.94, 0]);
  addRoundedBox(fridge, 'IngredientFridgeInterior', [0.61, 1.68, 0.025], 0.015, materials.fridgeInterior, [0, 0.94, 0.285]);
  addMesh(fridge, 'IngredientFridgeDoorGlass', new THREE.BoxGeometry(0.63, 1.66, 0.018), fridgeGlass, [0, 0.94, -0.322]);
  for (const y of [0.46, 0.86, 1.26, 1.64]) {
    addMesh(fridge, `IngredientFridgeShelf_${y}`, new THREE.BoxGeometry(0.56, 0.018, 0.43), materials.steel, [0, y, -0.05]);
  }
  addMesh(fridge, 'IngredientFridgeHandle', new THREE.CylinderGeometry(0.012, 0.012, 0.72, 8), materials.brass, [0.27, 0.97, -0.344]);
  for (const [i, color] of [materials.berry, materials.green, materials.cream].entries()) {
    const rowY = [0.57, 0.97, 1.37][i];
    addMesh(fridge, `BingsuToppingBowl_${i}`, new THREE.CylinderGeometry(0.12, 0.09, 0.06, 16), materials.cream, [-0.13, rowY, -0.08]);
    for (let berry = 0; berry < 4; berry++) {
      addMesh(fridge, `BingsuTopping_${i}_${berry}`, new THREE.SphereGeometry(0.025, 8, 6), color, [-0.19 + berry * 0.04, rowY + 0.055, -0.08]);
    }
  }
  addRoundedBox(fridge, 'IngredientFridgeNameplate', [0.50, 0.13, 0.025], 0.015, materials.wallTrim, [0, 1.81, -0.327]);
  room.add(fridge);

  return { seating, counterDressing, room };
}
