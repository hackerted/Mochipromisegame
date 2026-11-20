import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function buildCafeFurniture(THREE) {
  const seating = new THREE.Group();
  seating.name = 'LeeCafeDiningFurniture';
  seating.position.y = -0.012;

  const counterDressing = new THREE.Group();
  counterDressing.name = 'LeeCafeCounterDressing';

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
  machine.position.set(-0.04, 0.96, 0.34);
  counterDressing.add(machine);
  makeCup(counterDressing, 'LeeCafeCounterCupLeft', [-0.78, 0.96, 0.34], materials.cream);
  makeCup(counterDressing, 'LeeCafeCounterCupRight', [0.78, 0.96, 0.34], materials.sage, false);

  return { seating, counterDressing };
}
