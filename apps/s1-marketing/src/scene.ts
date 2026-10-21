import {
  Box3, BoxGeometry, CatmullRomCurve3, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Scene, TextureLoader, TorusGeometry, TubeGeometry,
  Vector3, WebGLRenderer, type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** One turn of the truck, in milliseconds. */
const REVOLUTION_MS = 36_000;
/** The heading the truck rests at under reduced motion, and starts from otherwise: a front three-quarter. */
const REST_ANGLE = -0.7;
/** The truck is the subject, so it is drawn larger than the floor around it is to scale. */
const TRUCK_SCALE = 2.8;
/** The portal pads sit on this ellipse around the turntable, in metres. */
const PAD_RX = 17, PAD_RZ = 11.5;
/** Equipment in the yard waiting to go out — [model, x, z, heading], on a pallet or skid, at the truck's scale. */
const STOCK: readonly (readonly [string, number, number, number])[] = [
  ["/condenser.glb", -30, -26, 0.1], ["/condenser.glb", -25.5, -26, -0.05], ["/condenser.glb", -30, -21.5, 0.05], ["/condenser.glb", -25.5, -21.5, 0.3],
  ["/rtu.glb", 24, -27.5, 0], ["/rtu.glb", 22, -21, 0.08],
];
/** Below this stage width the plates leave the floor and stack under it; the camera frames the truck alone. */
const FLAT_BELOW_PX = 640;

/**
 * THE SIGN-IN YARD — the outdoor service yard on packed dirt, seen from a camera above it:
 * Unit TACLA-14402C turning on a turntable at the centre, a pad on the
 * asphalt for each portal with that portal's sign-in plate pinned above it,
 * and behind the bay the stock waiting to go out — residential condensers on
 * pallets and packaged rooftop units on skids — in front of the shop, inside
 * a chain-link fence. Spiral duct and fittings lie by the bay, a dumpster and
 * empty pallets stand by the shop, and a forklift in the house red works its
 * lane between the bay and the condenser pallets.
 *
 * Modelled on the ERS recovery line (erektor-return.systems): depth depicts
 * plant, not interface. The plates are ordinary links in the page, positioned
 * each frame by projecting their pad into the view; the canvas takes no input.
 *
 * Every colour but the equipment's is read from the page's Arc Foundry roles
 * at mount — stall lines from the surface, the
 * shop from the sunken well, posts, rails and doors from the hard border, fog
 * from the page ground, a lit pad from the action fill — so no colour literal
 * enters the surface. The truck, condensers and RTUs are assets
 * (public/truck.glb, condenser.glb, rtu.glb) and wear their own paint; the
 * ground is one too (public/dirt.webp), so its earth is the texture's, not an ink.
 *
 * `[data-live]` goes on the scene root at the truck's first frame; until then,
 * and where WebGL is unavailable, the still poster and the CSS ring stand in.
 * Under `prefers-reduced-motion` nothing turns or drives: one frame is drawn, and
 * redrawn on resize, when a unit arrives, or when a pad lights. The returned
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
  scene.fog = new Fog(role("page"), 75, 140);
  const camera = new PerspectiveCamera(28, 16 / 9, 0.5, 400);

  scene.add(new HemisphereLight(undefined, role("border-hard"), 1.1));
  const key = new DirectionalLight(undefined, 2.0);
  key.position.set(24, 44, 30);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -50, right: 50, top: 40, bottom: -40, far: 140 });
  scene.add(key);
  const fill = new DirectionalLight(undefined, 0.45);
  fill.position.set(-18, 12, -16);
  scene.add(fill);

  // --- The yard: packed dirt (public/dirt.webp, tiled every 8 m; the hard border stands in until it
  // arrives), stall lines in surface white, a kerb around the pads.
  const dirt = mat("border-hard", 1);
  const yard = new Mesh(new PlaneGeometry(260, 260), dirt);
  yard.rotation.x = -Math.PI / 2;
  yard.receiveShadow = true;
  scene.add(yard);
  void new TextureLoader().loadAsync("/dirt.webp").then((map) => {
    if (stopped) return;
    map.wrapS = map.wrapT = RepeatWrapping;
    map.repeat.set(32, 32);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    dirt.map = map;
    dirt.color.setScalar(1);
    dirt.needsUpdate = true;
    if (still && loaded) draw();
  }, () => { /* no texture: the ground stays in the hard border */ });
  const stripe = mat("surface", 0.8);
  for (let x = -36; x <= 36; x += 6) if (Math.abs(x) > 24) paint(0.16, 9, x, 4, stripe);
  const kerb = mat("border-hard");
  const bx = PAD_RX + 5, bz = PAD_RZ + 4;
  paint(2 * bx, 0.18, 0, -bz, stripe); paint(2 * bx, 0.18, 0, bz, stripe);
  paint(0.18, 2 * bz, -bx, 0, stripe); paint(0.18, 2 * bz, bx, 0, stripe);

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

  // --- The turntable the truck stands on, and the truck's pivot above it.
  const table = new Group();
  scene.add(table);
  const disc = add(new Mesh(new CylinderGeometry(9.4, 9.5, 0.16, 96), mat("surface-sunken", 0.6)), table);
  disc.position.y = 0.08;
  const rim = add(new Mesh(new CylinderGeometry(9.55, 9.55, 0.1, 96, 1, true), kerb), table);
  rim.position.y = 0.11;

  // --- One pad per plate, in the plates' DOM order, around the same ellipse as the CSS ring.
  const plates = Array.from(root.querySelectorAll<HTMLElement>(".s1-scene__plate"));
  const idle = mat("surface", 0.7);
  const lit = new MeshStandardMaterial({ color: role("action"), roughness: 0.5, emissive: role("action"), emissiveIntensity: 0.25 });
  const pads = plates.map((plate) => {
    const a = (parseFloat(getComputedStyle(plate).getPropertyValue("--slot")) * Math.PI) / 180;
    const x = Math.sin(a) * PAD_RX, z = -Math.cos(a) * PAD_RZ;
    const pad = new Group();
    pad.position.set(x, 0, z);
    scene.add(pad);
    box(3.6, 0.14, 2.4, 0, 0.07, 0, kerb, pad);
    const top = box(3.3, 0.04, 2.1, 0, 0.16, 0, idle, pad);
    return { plate, pad, top };
  });

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let loaded = false;
  let flat = false;
  const draw = (): void => {
    renderer.render(scene, camera);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const v = new Vector3();
    for (const { plate, pad } of pads) {
      if (flat) { plate.style.removeProperty("--x"); plate.style.removeProperty("--y"); continue; }
      pad.getWorldPosition(v);
      v.y += 0.4;
      v.project(camera);
      plate.style.setProperty("--x", `${((v.x * 0.5 + 0.5) * w).toFixed(1)}px`);
      plate.style.setProperty("--y", `${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px`);
    }
  };

  // Frame the bay, or on a narrow stage the truck alone, from above and slightly to the right.
  const frame = (): void => {
    const [envW, envH, target] = flat ? [26, 16, new Vector3(0, 2.4, 0)] : [2 * (PAD_RX + 6), 2 * PAD_RZ + 12, new Vector3(0, 0, -4)];
    const half = Math.tan((camera.fov * Math.PI) / 360);
    const dist = Math.max(envH / (2 * half), envW / camera.aspect / (2 * half));
    camera.position.copy(target).add(new Vector3(0.12, 0.62, 0.78).normalize().multiplyScalar(dist));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };
  const fit = (): void => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    flat = root.clientWidth < FLAT_BELOW_PX;
    frame();
    // A resize clears the canvas; with no loop running, the still frame is redrawn here.
    if (still && loaded) draw();
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);

  // A plate under the pointer or the keyboard lights its pad.
  const light = (e: Event): void => {
    const on = e.type === "pointerenter" || e.type === "focusin";
    const hit = pads.find((p) => p.plate === e.currentTarget);
    if (hit) hit.top.material = on ? lit : idle;
    if (still && loaded) draw();
  };
  for (const { plate } of pads) for (const t of ["pointerenter", "pointerleave", "focusin", "focusout"]) plate.addEventListener(t, light);

  const loader = new GLTFLoader();
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

  // Tyre ruts down the forklift's lane, and the forklift itself.
  const rut = new MeshStandardMaterial({ color: role("text"), transparent: true, opacity: 0.22, roughness: 1 });
  const LANE_X = -25.5, LANE_NEAR = 6, LANE_FAR = -13;
  for (const dx of [-1.4, 1.4]) paint(0.9, LANE_NEAR - LANE_FAR + 8, LANE_X + dx, (LANE_NEAR + LANE_FAR) / 2, rut);
  const lift = prop(LANE_X, LANE_NEAR, 0);
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
    lift.position.z = LANE_NEAR + (LANE_FAR - LANE_NEAR) * (out - back);
    carriage.position.y = 0.3 + 1.1 * (span(t, 0.36, 0.45) - span(t, 0.48, 0.56));
    liftPallet.visible = t > 0.47 && t < 0.97;
  };
  shuttle(0);

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
    // Turn about the truck's own centre, standing on the turntable's deck.
    truck.position.set(-centre.x, 0.16 - box3.min.y, -centre.z);
    const pivot = new Group();
    pivot.rotation.y = REST_ANGLE;
    add(truck, pivot);
    table.add(pivot);

    root.setAttribute("data-live", "");
    loaded = true;
    if (still) { draw(); return; }
    const start = performance.now();
    renderer.setAnimationLoop((now) => {
      table.rotation.y = -((now - start) / REVOLUTION_MS) * Math.PI * 2;
      shuttle(now - start);
      draw();
    });
  }, () => { /* no model, no WebGL frame: the poster stays */ });

  return () => {
    stopped = true;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    for (const { plate } of pads) for (const t of ["pointerenter", "pointerleave", "focusin", "focusout"]) plate.removeEventListener(t, light);
    renderer.dispose();
  };
};
