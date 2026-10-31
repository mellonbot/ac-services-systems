import {
  Box3, BoxGeometry, CatmullRomCurve3, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Euler, Fog, Group, HemisphereLight,
  InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, PerspectiveCamera, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Scene, TextureLoader, TorusGeometry, TubeGeometry,
  Vector3, WebGLRenderer, type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** The truck's heading: a low front three-quarter, nose to the left, the lettered side to the camera. */
const HEADING = -2.25;
/** The drive runs along the truck's length, which lies on the model's local z. */
const ROAD_TURN = Math.PI / 2;
/** The truck is the subject, so it is drawn larger than the floor around it is to scale. */
const TRUCK_SCALE = 2.8;
/** The bay the truck stands in, in metres: its cones stand on these corners. */
const BAY_X = 26, BAY_Z = 18;
/** Equipment in the yard waiting to go out — [model, x, z, heading], on a pallet or skid, at the truck's scale. */
const STOCK: readonly (readonly [string, number, number, number])[] = [
  ["/condenser.glb", -30, -26, 0.1], ["/condenser.glb", -25.5, -26, -0.05], ["/condenser.glb", -30, -21.5, 0.05], ["/condenser.glb", -25.5, -21.5, 0.3],
  ["/rtu.glb", 24, -27.5, 0], ["/rtu.glb", 22, -21, 0.08],
];
/** Below this stage width the plates stack under the stage; the camera frames the truck alone. */
const FLAT_BELOW_PX = 720;

/**
 * THE SIGN-IN YARD — the outdoor service yard, trimmed lawn with dirt roads
 * worn through it, seen low and close: Unit TACLA-14402C parked on the dirt, right of centre in a front
 * three-quarter, with the live portals' plates standing large down the left
 * (CSS, in front of the canvas) and the ones not open yet small and far, high
 * on the right. Behind the bay the stock waiting to go out — residential condensers on
 * pallets and packaged rooftop units on skids — in front of the shop, inside
 * a chain-link fence. Spiral duct and fittings lie by the bay, a dumpster and
 * empty pallets stand by the shop, and a forklift in the house red works its
 * lane between the bay and the condenser pallets.
 *
 * Modelled on the ERS recovery line (erektor-return.systems): depth depicts
 * plant, not interface. The plates are ordinary links in the page laid out by
 * CSS; the canvas takes no input. A depth-of-field pass holds the truck sharp
 * and lets the yard behind it — the forklift working its lane — fall just out
 * of focus.
 *
 * Every colour but the equipment's is read from the page's Arc Foundry roles
 * at mount — the cones' collars from the surface, the
 * shop from the sunken well, posts, rails and doors from the hard border, fog
 * and sky from the page ground — so no colour literal
 * enters the surface. The truck, condensers and RTUs are assets
 * (public/truck.glb, condenser.glb, rtu.glb) and wear their own paint; the
 * lawn, the roadside grass and the fence-line weeds are textures too
 * (public/lawn.webp, grass.webp, weeds.webp, drawn by
 * tools/textures/vegetation.py), so their colour is the asset's. The models ship meshopt-compressed (`gltf-transform optimize --compress meshopt
 * --texture-compress false --simplify false`, textures lossless WebP first) — a
 * raw exporter GLB is ~8x the bytes and ~10x the draw calls. The roads' earth is
 * a texture as well (public/dirt.webp), not an ink.
 *
 * `[data-live]` goes on the scene root at the truck's first frame; until then,
 * and where WebGL is unavailable, the still poster and the CSS ring stand in.
 * Under `prefers-reduced-motion` nothing drives: one frame is drawn, and
 * redrawn on resize or when a unit arrives. The returned
 * function stops the loop and releases the GPU context.
 */
export const mountScene = (canvas: HTMLCanvasElement): (() => void) => {
  const root = canvas.closest<HTMLElement>(".s1-scene");
  if (!root) return () => {};
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return () => {};
  }
  let stopped = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;

  const role = (name: string): Color => new Color(getComputedStyle(root).getPropertyValue(`--color-${name}`).trim());
  const mat = (name: string, roughness = 0.85): MeshStandardMaterial => new MeshStandardMaterial({ color: role(name), roughness, metalness: 0.05 });
  const add = <T extends Object3D>(o: T, parent: Object3D): T => {
    o.traverse((m) => { if (m instanceof Mesh) { m.castShadow = true; m.receiveShadow = true; } });
    parent.add(o);
    return o;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: MeshStandardMaterial, parent: Object3D): Mesh => {
    const mesh = add(new Mesh(new BoxGeometry(w, h, d), m), parent);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const paint = (w: number, d: number, x: number, z: number, m: MeshStandardMaterial): void => {
    const p = new Mesh(new PlaneGeometry(w, d), m);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.01, z);
    p.receiveShadow = true;
    scene.add(p);
  };

  const scene = new Scene();
  scene.background = role("page");
  scene.fog = new Fog(role("page"), 90, 190);
  const camera = new PerspectiveCamera(28, 16 / 9, 0.5, 400);

  scene.add(new HemisphereLight(undefined, role("border-hard"), 1.1));
  const key = new DirectionalLight(undefined, 2.0);
  key.position.set(24, 44, 30);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -50, right: 50, top: 40, bottom: -40, far: 140 });
  scene.add(key);
  const fill = new DirectionalLight(undefined, 0.45);
  fill.position.set(-18, 12, -16);
  scene.add(fill);

  // --- The yard: trimmed lawn (public/lawn.webp), with dirt roads (public/dirt.webp) worn through it.
  // Each texture is tiled in world metres, so the grain matches across every strip; the hard border
  // and the sunken well stand in until they arrive.
  const surfaceOf = (url: string, every: number, fallback: string): MeshStandardMaterial => {
    const m = mat(fallback, 1);
    void new TextureLoader().loadAsync(url).then((map) => {
      if (stopped) return;
      map.wrapS = map.wrapT = RepeatWrapping;
      map.repeat.set(1 / every, 1 / every);
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      m.map = map;
      m.color.setScalar(1);
      m.needsUpdate = true;
      if (still && loaded) draw();
    }, () => { /* no texture: the ground stays in its role */ });
    return m;
  };
  const lay = (w: number, d: number, x: number, z: number, y: number, m: MeshStandardMaterial, heading = 0): void => {
    const g = new PlaneGeometry(w, d);
    // World-space UVs: one unit of UV per metre, offset by the strip's position.
    const uv = g.attributes.uv!, pos = g.attributes.position!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + x, pos.getY(i) - z);
    const p = new Mesh(g, m);
    p.rotation.set(-Math.PI / 2, 0, heading);
    p.position.set(x, y, z);
    p.receiveShadow = true;
    scene.add(p);
  };
  lay(260, 260, 0, 0, 0, surfaceOf("/lawn.webp", 6, "border-hard"));
  const dirt = surfaceOf("/dirt.webp", 8, "surface-sunken");
  /** The roads, [width, length, x, z, heading]: the drive the truck is parked on, along its length, and the back lane the forklift and the stock use. */
  const ROADS: readonly (readonly [number, number, number, number, number])[] = [
    [11, 130, 0, 0, HEADING + ROAD_TURN], [78, 9, -2, -23, 0],
  ];
  ROADS.forEach(([w, d, x, z, a], i) => lay(w, d, x, z, 0.004 + i * 0.002, dirt, a));
  /** World (x, z) to a road's own (across, along), and back. */
  const toRoad = ([, , rx, rz, a]: (typeof ROADS)[number], x: number, z: number): readonly [number, number] =>
    [(x - rx) * Math.cos(a) - (z - rz) * Math.sin(a), (x - rx) * Math.sin(a) + (z - rz) * Math.cos(a)];
  const fromRoad = ([, , rx, rz, a]: (typeof ROADS)[number], u: number, v: number): readonly [number, number] =>
    [rx + u * Math.cos(a) + v * Math.sin(a), rz - u * Math.sin(a) + v * Math.cos(a)];
  const stripe = mat("surface", 0.8);
  const kerb = mat("border-hard");
  const bx = BAY_X, bz = BAY_Z;

  // --- The shop along the back: metal walls, roll-up doors, a low-pitch roof.
  const shopZ = -40;
  box(96, 9, 14, 0, 4.5, shopZ, mat("surface-sunken", 0.7), scene);
  box(98, 0.6, 15, 0, 9.3, shopZ, kerb, scene);
  for (const x of [-30, -15, 0, 15, 30]) {
    box(8, 6.5, 0.2, x, 3.25, shopZ + 7.05, kerb, scene);
    for (let y = 0.6; y < 6.5; y += 0.6) box(8, 0.04, 0.05, x, y, shopZ + 7.18, mat("border"), scene);
  }

  // --- Chain-link fence round the yard: posts and a top rail in the hard border, see-through mesh.
  const fenceX = 36, fenceFront = 30, fenceBack = shopZ + 7;
  const mesh = new MeshStandardMaterial({ color: role("border"), transparent: true, opacity: 0.35, roughness: 0.6, metalness: 0.4 });
  const run = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
    const panel = new Mesh(new PlaneGeometry(len, 3.6), mesh);
    panel.position.set((x0 + x1) / 2, 1.8, (z0 + z1) / 2);
    panel.rotation.y = -ang;
    scene.add(panel);
    const rail = box(len, 0.12, 0.12, (x0 + x1) / 2, 3.6, (z0 + z1) / 2, kerb, scene);
    rail.rotation.y = -ang;
    for (let t = 0; t <= len; t += 4) box(0.16, 3.7, 0.16, x0 + (t / len) * (x1 - x0), 1.85, z0 + (t / len) * (z1 - z0), kerb, scene);
  };
  run(-fenceX, fenceBack, -fenceX, fenceFront); run(fenceX, fenceBack, fenceX, fenceFront);

  // --- Two light poles on the yard's back corners.
  for (const x of [-33, 33]) {
    box(0.35, 12, 0.35, x, 6, fenceBack + 3, kerb, scene);
    box(2.4, 0.3, 0.8, x + (x < 0 ? 1 : -1), 12, fenceBack + 3, kerb, scene);
  }

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let loaded = false;
  let flat = false;
  // Depth of field: focused on the truck; the far yard and the forklift soften, the truck never does.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 40, aperture: 0.0004, maxblur: 0.006 });
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());
  const draw = (): void => { composer.render(); };

  // The truck right of centre, low and close; on a narrow stage the truck alone, centred.
  const VIEW = new Vector3(0.1, 0.3, 1).normalize();
  const frame = (): void => {
    const [envW, envH, target] = flat ? [22, 14, new Vector3(0, 3, 0)] : [30, 17, new Vector3(-6, 3.5, 0)];
    const half = Math.tan((camera.fov * Math.PI) / 360);
    const dist = Math.max(envH / (2 * half), envW / camera.aspect / (2 * half));
    camera.position.copy(target).add(VIEW.clone().multiplyScalar(dist));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    (bokeh.uniforms as { focus: { value: number } }).focus.value = camera.position.length();
  };
  const fit = (): void => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    flat = root.clientWidth < FLAT_BELOW_PX;
    frame();
    // A resize clears the canvas; with no loop running, the still frame is redrawn here.
    if (still && loaded) draw();
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);
  // Scrolled past, the bay stops drawing; the turn is time-based, so it picks up where it would be.
  let onScreen = true;
  const io = new IntersectionObserver((entries) => { onScreen = entries.at(-1)?.isIntersecting ?? onScreen; });
  io.observe(canvas);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Each model loads once and is cloned for every unit that wears it.
  const models = new Map<string, Promise<Object3D>>();
  const load = (url: string): Promise<Object3D> => {
    if (!models.has(url)) models.set(url, loader.loadAsync(url).then((g) => g.scene));
    return models.get(url)!;
  };
  const pallet = mat("surface-sunken", 0.9);
  // --- Props, built in real metres inside a group drawn at the yard's scale.
  const prop = (x: number, z: number, heading: number): Group => {
    const g = new Group();
    g.position.set(x, 0, z);
    g.rotation.y = heading;
    g.scale.setScalar(TRUCK_SCALE);
    scene.add(g);
    return g;
  };
  const red = mat("brand", 0.55);
  const black = mat("text", 0.7);
  const galv = new MeshStandardMaterial({ color: role("border"), roughness: 0.35, metalness: 0.75, side: DoubleSide });

  // Spiral duct: a galvanized length with its helical lock seam, lying along z.
  const duct = (parent: Object3D, r: number, len: number, x: number, y: number, z: number): void => {
    const pipe = add(new Mesh(new CylinderGeometry(r, r, len, 40, 1, true), galv), parent);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, y, z);
    const turns = Math.round(len / 0.15), pts: Vector3[] = [];
    for (let i = 0; i <= turns * 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push(new Vector3(x + Math.cos(a) * r, y + Math.sin(a) * r, z - len / 2 + (i / (turns * 16)) * len));
    }
    add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), turns * 16, 0.008, 4), galv), parent);
  };
  const ducts = prop(26.5, -8, 0);
  for (const dx of [-0.75, 0.75]) box(0.1, 0.1, 3.2, dx, 0.05, 0, pallet, ducts).rotation.y = Math.PI / 2;
  [[-0.63, -0.21, 0.21, 0.63], [-0.42, 0, 0.42], [-0.21, 0.21]].forEach((row, i) => {
    for (const x of row) duct(ducts, 0.2, 3, x, 0.3 + i * 0.37, 0);
  });
  const fittings = prop(26, 4, 0.4);
  for (const [x, z, a] of [[0, 0, 0], [0.7, 0.4, 1.2], [-0.5, 0.6, 2.4]] as const) {
    const elbow = add(new Mesh(new TorusGeometry(0.4, 0.15, 12, 24, Math.PI / 2), galv), fittings);
    elbow.position.set(x, 0.15, z);
    elbow.rotation.set(-Math.PI / 2, 0, a);
  }
  for (const [x, z] of [[1.2, -0.5], [1.55, -0.1]] as const) {
    const stub = add(new Mesh(new CylinderGeometry(0.15, 0.15, 1.1, 32, 1, true), galv), fittings);
    stub.position.set(x, 0.55, z);
  }

  // Cones at the bay's corners, in the house red with a white collar.
  for (const [x, z] of [[-bx, -bz], [bx, -bz], [-bx, bz], [bx, bz]] as const) {
    const c = prop(x, z, 0);
    box(0.36, 0.03, 0.36, 0, 0.015, 0, black, c);
    add(new Mesh(new ConeGeometry(0.15, 0.7, 24), red), c).position.y = 0.36;
    add(new Mesh(new CylinderGeometry(0.085, 0.1, 0.1, 24), stripe), c).position.y = 0.4;
  }

  // A dumpster against the shop, and a stack of empty pallets beside the RTUs.
  const bin = prop(-14, -30.5, 0.05);
  box(1.9, 1.15, 1.2, 0, 0.62, 0, mat("text-muted", 0.6), bin);
  box(1.95, 0.06, 1.25, 0, 1.22, -0.03, black, bin).rotation.x = -0.12;
  for (const x of [-0.8, 0.8]) box(0.1, 0.1, 1.25, x, 0.05, 0, black, bin);
  const stack = prop(13, -27, -0.2);
  for (let i = 0; i < 6; i++) box(1.2, 0.14, 1.0, (i % 2) * 0.04, 0.07 + i * 0.145, 0, pallet, stack);

  // Tyre ruts along the forklift's lane across the back of the yard, in front of the condenser pallets, and the forklift itself.
  const rut = new MeshStandardMaterial({ color: role("text"), transparent: true, opacity: 0.22, roughness: 1 });
  const LANE_Z = -21.5, LANE_NEAR = -7, LANE_FAR = -19;
  for (const dz of [-1.4, 1.4]) paint(LANE_NEAR - LANE_FAR + 8, 0.9, (LANE_NEAR + LANE_FAR) / 2, LANE_Z + dz, rut);
  const lift = prop(LANE_NEAR, LANE_Z, Math.PI / 2);
  box(1.1, 0.5, 2.0, 0, 0.5, 0, red, lift);
  box(1.12, 0.75, 0.5, 0, 0.85, 0.85, red, lift);
  box(0.8, 0.35, 0.7, 0, 0.9, 0.2, black, lift);
  for (const [x, z] of [[-0.48, -0.35], [0.48, -0.35], [-0.48, 0.6], [0.48, 0.6]] as const) box(0.06, 1.35, 0.06, x, 1.6, z, black, lift);
  box(1.02, 0.05, 1.05, 0, 2.28, 0.12, black, lift);
  for (const [z, r] of [[-0.62, 0.3], [0.68, 0.26]] as const) for (const x of [-0.52, 0.52]) {
    const w = add(new Mesh(new CylinderGeometry(r, r, 0.22, 24), black), lift);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, r, z);
  }
  for (const x of [-0.36, 0.36]) box(0.08, 2.3, 0.1, x, 1.25, -1.08, black, lift);
  box(0.8, 0.08, 0.1, 0, 2.35, -1.08, black, lift);
  const carriage = new Group();
  carriage.position.set(0, 0.3, -1.16);
  lift.add(carriage);
  box(0.9, 0.5, 0.05, 0, 0.25, 0, black, carriage);
  for (const x of [-0.26, 0.26]) box(0.1, 0.05, 1.1, x, 0.02, -0.58, black, carriage);
  const liftPallet = box(1.1, 0.14, 1.0, 0, 0.12, -0.6, pallet, carriage);

  // One shuttle every 26 s: drive to the condenser pallets, raise, lower, reverse to the bay, wait.
  const SHUTTLE_MS = 26_000;
  const ease = (t: number): number => t * t * (3 - 2 * t);
  const span = (t: number, a: number, b: number): number => ease(Math.min(Math.max((t - a) / (b - a), 0), 1));
  const shuttle = (ms: number): void => {
    const t = (ms % SHUTTLE_MS) / SHUTTLE_MS;
    const out = span(t, 0.04, 0.34), back = span(t, 0.58, 0.9);
    lift.position.x = LANE_NEAR + (LANE_FAR - LANE_NEAR) * (out - back);
    carriage.position.y = 0.3 + 1.1 * (span(t, 0.36, 0.45) - span(t, 0.48, 0.56));
    liftPallet.visible = t > 0.47 && t < 0.97;
  };
  // Start (and, under reduced motion, rest) at the pallets, forks up.
  const SHUTTLE_FROM = SHUTTLE_MS * 0.4;
  shuttle(SHUTTLE_FROM);

  // Tall weeds along the back — the foot of the shop wall and the fence beside it — and a fringe of uncut grass where the lawn
  // meets a road: crossed planes, one instanced draw per texture, placed by a seeded walk so every
  // load (and the poster) grows the same yard.
  let seed = 14402;
  const rand = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const KEEP_CLEAR: readonly (readonly [number, number, number])[] = [
    [0, 0, 11], [-27.5, -23.5, 6], [23, -24, 7], [26.5, -8, 3], [26, 4, 2.5], [-14, -30.5, 3], [13, -27, 2.5], [-31, -26, 2],
  ];
  const onRoad = (x: number, z: number): boolean => ROADS.some((r) => { const [u, v] = toRoad(r, x, z); return Math.abs(u) < r[0] / 2 && Math.abs(v) < r[1] / 2; });
  const clear = (x: number, z: number): boolean => !onRoad(x, z) && KEEP_CLEAR.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) > r);
  const scatter = (n: number, zone: () => readonly [number, number]): (readonly [number, number])[] => {
    const out: (readonly [number, number])[] = [];
    for (let tries = 0; out.length < n && tries < n * 20; tries++) {
      const [x, z] = zone();
      if (clear(x, z)) out.push([x, z]);
    }
    return out;
  };
  /** A point just off one edge of a road, on the grass side. */
  const roadside = (): readonly [number, number] => {
    const r = ROADS[Math.floor(rand() * ROADS.length)]!;
    return fromRoad(r, (rand() < 0.5 ? -1 : 1) * (r[0] / 2 + 0.3 + rand() * 0.9), (rand() - 0.5) * r[1]);
  };
  const back = (): readonly [number, number] => [(rand() - 0.5) * 90, fenceBack - 1 + rand() * 3];
  const fence = (side: number) => (): readonly [number, number] => [side * (fenceX - 0.8 - rand() * 2.6), fenceBack + rand() * 20];
  const tufts = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const crossed = mergeGeometries([tufts, tufts.clone().rotateY(Math.PI / 2)]);
  const plant = (url: string, spots: readonly (readonly [number, number])[], height: () => number): void => {
    void new TextureLoader().loadAsync(url).then((map) => {
      if (stopped) return;
      map.colorSpace = SRGBColorSpace;
      const m = new InstancedMesh(crossed, new MeshStandardMaterial({ map, alphaTest: 0.5, side: DoubleSide, roughness: 1 }), spots.length);
      const at = new Matrix4(), turn = new Quaternion(), size = new Vector3(), where = new Vector3();
      spots.forEach(([x, z], i) => {
        const h = height();
        turn.setFromEuler(new Euler(0, rand() * Math.PI, (rand() - 0.5) * 0.12));
        m.setMatrixAt(i, at.compose(where.set(x, 0, z), turn, size.set(h * (0.8 + rand() * 0.5), h, h * (0.8 + rand() * 0.5))));
      });
      m.receiveShadow = true;
      scene.add(m);
      if (still && loaded) draw();
    }, () => { /* no texture: no vegetation */ });
  };
  plant("/grass.webp", scatter(170, roadside), () => 0.5 + rand() * 0.5);
  plant("/weeds.webp", [...scatter(70, back), ...scatter(20, fence(-1)), ...scatter(20, fence(1))], () => 2.6 + rand() * 2.2);

  for (const [url, x, z, heading] of STOCK) {
    void load(url).then((model) => {
      if (stopped) return;
      const unit = model.clone();
      unit.scale.setScalar(TRUCK_SCALE);
      const b = new Box3().setFromObject(unit);
      const size = b.getSize(new Vector3()), mid = b.getCenter(new Vector3());
      const base = new Group();
      base.position.set(x, 0, z);
      base.rotation.y = heading;
      scene.add(base);
      box(size.x + 0.4, 0.3, size.z + 0.4, 0, 0.15, 0, pallet, base);
      unit.position.set(-mid.x, 0.3 - b.min.y, -mid.z);
      add(unit, base);
      if (still && loaded) draw();
    }, () => { /* a missing unit leaves its pallet empty */ });
  }

  load("/truck.glb").then((model) => {
    const truck = model.clone();
    if (stopped) return;
    truck.scale.setScalar(TRUCK_SCALE);
    const box3 = new Box3().setFromObject(truck);
    const centre = box3.getCenter(new Vector3());
    // Headed about the truck's own centre, wheels on the dirt.
    truck.position.set(-centre.x, -box3.min.y, -centre.z);
    const pivot = new Group();
    pivot.rotation.y = HEADING;
    add(truck, pivot);
    scene.add(pivot);

    root.setAttribute("data-live", "");
    loaded = true;
    if (still) { draw(); return; }
    const start = performance.now();
    renderer.setAnimationLoop((now) => {
      if (!onScreen) return;
      shuttle(now - start + SHUTTLE_FROM);
      draw();
    });
  }, () => { /* no model, no WebGL frame: the poster stays */ });

  return () => {
    stopped = true;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    io.disconnect();
    composer.dispose();
    renderer.dispose();
  };
};
