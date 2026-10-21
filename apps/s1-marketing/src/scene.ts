import {
  Box3, BoxGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera,
  PlaneGeometry, Scene, Vector3, WebGLRenderer, type Object3D,
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
 * THE SIGN-IN YARD — the outdoor service yard, seen from a camera above it:
 * Unit TACLA-14402C turning on a turntable at the centre, a pad on the
 * asphalt for each portal with that portal's sign-in plate pinned above it,
 * and behind the bay the stock waiting to go out — residential condensers on
 * pallets and packaged rooftop units on skids — in front of the shop, inside
 * a chain-link fence.
 *
 * Modelled on the ERS recovery line (erektor-return.systems): depth depicts
 * plant, not interface. The plates are ordinary links in the page, positioned
 * each frame by projecting their pad into the view; the canvas takes no input.
 *
 * Every colour but the equipment's is read from the page's Arc Foundry roles
 * at mount — asphalt from the muted text, stall lines from the surface, the
 * shop from the sunken well, posts, rails and doors from the hard border, fog
 * from the page ground, a lit pad from the action fill — so no colour literal
 * enters the surface. The truck, condensers and RTUs are assets
 * (public/truck.glb, condenser.glb, rtu.glb) and wear their own paint.
 *
 * `[data-live]` goes on the scene root at the truck's first frame; until then,
 * and where WebGL is unavailable, the still poster and the CSS ring stand in.
 * Under `prefers-reduced-motion` nothing turns: one frame is drawn, and
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

  // --- The yard: asphalt in the muted slate, stall lines in surface white, a kerb around the pads.
  const yard = new Mesh(new PlaneGeometry(260, 260), mat("text-muted", 0.97));
  yard.rotation.x = -Math.PI / 2;
  yard.receiveShadow = true;
  scene.add(yard);
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
