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
const TRUCK_SCALE = 2.4;
/** The portal pads sit on this ellipse around the turntable, in metres. */
const PAD_RX = 17, PAD_RZ = 11.5;
/** Below this stage width the plates leave the floor and stack under it; the camera frames the truck alone. */
const FLAT_BELOW_PX = 640;

/**
 * THE SIGN-IN FLOOR — the service bay as it stands, seen from a camera above
 * it: Unit TACLA-14402C turning on a turntable at the centre, and a pad on the
 * floor for each portal, with that portal's sign-in plate pinned above it.
 *
 * Modelled on the ERS recovery line (erektor-return.systems): depth depicts
 * plant, not interface. The plates are ordinary links in the page, positioned
 * each frame by projecting their pad into the view; the canvas takes no input.
 *
 * Every colour but the truck's is read from the page's Arc Foundry roles at
 * mount — floor from the surface, joints and kerbs from the borders, the far
 * wall from the sunken well, fog from the page ground, a lit pad from the
 * action fill — so no colour literal enters the surface. The truck is an asset
 * (public/truck.glb) and wears its own paint.
 *
 * `[data-live]` goes on the scene root at the first frame; until then, and
 * where WebGL is unavailable, the still poster and the CSS ring stand in.
 * Under `prefers-reduced-motion` nothing turns: one frame is drawn, and
 * redrawn on resize or when a pad lights. The returned function stops the
 * loop and releases the GPU context.
 */
export const mountScene = (canvas: HTMLCanvasElement, modelUrl: string): (() => void) => {
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
  key.position.set(18, 34, 24);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -30, right: 30, top: 24, bottom: -24, far: 100 });
  scene.add(key);
  const fill = new DirectionalLight(undefined, 0.45);
  fill.position.set(-18, 12, -16);
  scene.add(fill);

  // --- The floor: sealed slab, saw-cut joints every 6 m, a kerb-lined bay around the pads.
  const floor = new Mesh(new PlaneGeometry(260, 260), mat("surface", 0.95));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const joint = mat("border");
  for (let v = -96; v <= 96; v += 8) { paint(200, 0.04, 0, v, joint); paint(0.04, 200, v, 0, joint); }
  const kerb = mat("border-hard");
  const bx = PAD_RX + 5, bz = PAD_RZ + 4;
  paint(2 * bx, 0.14, 0, -bz, kerb); paint(2 * bx, 0.14, 0, bz, kerb);
  paint(0.14, 2 * bz, -bx, 0, kerb); paint(0.14, 2 * bz, bx, 0, kerb);

  // --- The far wall: panels in the sunken role, steel columns in the hard border.
  const wall = mat("surface-sunken", 0.95);
  box(300, 10, 0.4, 0, 5, -34, wall, scene).castShadow = false;
  for (let x = -96; x <= 96; x += 16) box(0.8, 10, 0.8, x, 5, -33.6, kerb, scene);

  // --- The turntable the truck stands on, and the truck's pivot above it.
  const table = new Group();
  scene.add(table);
  const disc = add(new Mesh(new CylinderGeometry(8.8, 8.9, 0.16, 96), mat("surface-sunken", 0.6)), table);
  disc.position.y = 0.08;
  const rim = add(new Mesh(new CylinderGeometry(8.95, 8.95, 0.1, 96, 1, true), kerb), table);
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
    const [envW, envH, target] = flat ? [18, 10, new Vector3(0, 2, 0)] : [2 * (PAD_RX + 2.5), 2 * PAD_RZ + 4, new Vector3(0, 0, 0.8)];
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

  new GLTFLoader().loadAsync(modelUrl).then(({ scene: truck }) => {
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
