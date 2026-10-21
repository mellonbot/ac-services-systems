import {
  Box3, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, PlaneGeometry, Scene, ShadowMaterial, Sphere, Vector3, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** One turn of the truck, in milliseconds. */
const REVOLUTION_MS = 36_000;
/** The heading the truck rests at under reduced motion, and starts from otherwise: a front three-quarter. */
const REST_ANGLE = -0.7;

/**
 * THE TRUCK AT THE CENTRE OF THE SIGN-IN RING — Unit TACLA-14402C, turning
 * on the spot, drawn live at the display's frame rate.
 *
 * The model is an asset (public/truck.glb, exported from the unit's 3D
 * model), not code: its paint and livery are the vehicle's, and no colour
 * literal enters the surface. The canvas is transparent, so the page ground
 * shows through; the lights are white, and the only other mark is the
 * ground shadow.
 *
 * Under `prefers-reduced-motion` one still frame is drawn and nothing loops.
 * Where WebGL is unavailable this returns without drawing and the still
 * poster behind the canvas stays. The returned function stops the loop and
 * releases the GPU context; the home screen calls it when it unmounts.
 */
export const spinTruck = (canvas: HTMLCanvasElement, modelUrl: string): (() => void) => {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return () => {};
  }
  let stopped = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1.5, 0.01, 500);
  scene.add(new HemisphereLight(undefined, undefined, 1));
  const key = new DirectionalLight(undefined, 2.2);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  scene.add(key);
  const fill = new DirectionalLight(undefined, 0.5);
  fill.position.set(-5, 3, -4);
  scene.add(fill);
  const ground = new Mesh(new PlaneGeometry(200, 200), new ShadowMaterial({ opacity: 0.18 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const pivot = new Group();
  pivot.rotation.y = REST_ANGLE;
  scene.add(pivot);

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let loaded = false;
  const fit = (): void => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // A resize clears the canvas; with no loop running, the still frame is redrawn here.
    if (still && loaded) renderer.render(scene, camera);
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);

  new GLTFLoader().loadAsync(modelUrl).then(({ scene: truck }) => {
    if (stopped) return;
    truck.traverse((o) => { if (o instanceof Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new Box3().setFromObject(truck);
    const centre = box.getCenter(new Vector3());
    // Turn about the truck's own centre, not the model's origin.
    truck.position.set(-centre.x, 0, -centre.z);
    pivot.add(truck);
    ground.position.y = box.min.y;
    const radius = box.getBoundingSphere(new Sphere()).radius;
    const target = new Vector3(0, centre.y, 0);
    const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 0.92;
    camera.position.copy(target).add(new Vector3(0, 0.42, 1).normalize().multiplyScalar(dist));
    camera.lookAt(target);
    const span = radius * 3;
    Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span });
    key.shadow.camera.updateProjectionMatrix();

    canvas.parentElement?.setAttribute("data-live", "");
    loaded = true;
    if (still) { renderer.render(scene, camera); return; }
    const start = performance.now();
    renderer.setAnimationLoop((now) => {
      pivot.rotation.y = REST_ANGLE - ((now - start) / REVOLUTION_MS) * Math.PI * 2;
      renderer.render(scene, camera);
    });
  }, () => { /* no model, no WebGL frame: the poster stays */ });

  return () => {
    stopped = true;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    renderer.dispose();
  };
};
