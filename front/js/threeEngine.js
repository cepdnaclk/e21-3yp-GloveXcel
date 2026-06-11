/**
 * threeEngine.js — PersistentThreeEngine Singleton
 *
 * Owns the WebGL context, scene, camera, render loop, and HandRigController.
 * Initialized ONCE via ThreeEngine.init(container). Survives all view transitions.
 *
 * View controller contract:
 *   ThreeEngine.onTick = (nowMs) => { /* compute pose *\/ engine.setPose(pose); };  // mount
 *   ThreeEngine.onModelStatus = (msg) => { statusEl.textContent = msg; };           // mount
 *   ThreeEngine.onTick = null;   // unmount
 *   ThreeEngine.clearPose();     // unmount
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { HandRigController }   from './handRigController.js';
import { FINGER_MAPPING_TABLE } from './mappingTable.js';

const MODEL_URL = './hand.glb';

// ─── Class definition ─────────────────────────────────────────────────────────
class PersistentThreeEngine {
  constructor() {
    // ── Public callback slots ───────────────────────────────────────────────
    this.onTick        = null;   // (nowMs: number) => void  — set by active view controller
    this.onModelStatus = null;   // (msg: string)   => void  — set by active view controller

    // ── Private Three.js objects ────────────────────────────────────────────
    this._scene          = null;
    this._camera         = null;
    this._renderer       = null;
    this._controls       = null;
    this._handController = null;
    this._currentPose    = null;
    this._container      = null;
    this._initialized    = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Initialize the WebGL context and start the render loop.
   * Call this ONCE from patient_app.html after the DOM is ready.
   * Subsequent calls are safe (idempotent — just re-mounts the canvas).
   */
  init(container) {
    if (this._initialized) {
      this.mountTo(container);
      return;
    }

    this._container  = container;
    this._initialized = true;

    // Scene
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color('#0d1117');

    // Camera
    const w = Math.max(container.clientWidth, 320);
    const h = Math.max(container.clientHeight, 240);
    this._camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 100);
    this._camera.position.set(0.2, 0.2, 0.8);

    // Renderer
    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this._renderer.domElement);

    // OrbitControls
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.target.set(0, 0.1, 0);

    // Lighting
    this._scene.add(new THREE.AmbientLight('#ffffff', 0.9));
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.2);
    keyLight.position.set(1, 1, 1);
    this._scene.add(keyLight);

    // Ground plane
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2, 64),
      new THREE.MeshStandardMaterial({ color: '#1a2235', roughness: 0.9, metalness: 0.0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.2;
    this._scene.add(floor);

    // Load hand model
    this._loadModel();

    // Start the permanent render loop
    this._startRenderLoop();

    // Keep canvas sized to its container
    this._watchResize(container);
  }

  /**
   * Re-attach the canvas to a different container element (e.g., after a hot-reload).
   * Does NOT restart the render loop.
   */
  mountTo(container) {
    if (!container || !this._renderer) return;
    this._container = container;
    if (!container.contains(this._renderer.domElement)) {
      container.appendChild(this._renderer.domElement);
    }
    this.resizeTo(container);
  }

  /** Resize the renderer and update camera aspect ratio. */
  resizeTo(container) {
    if (!this._renderer || !this._camera) return;
    const w = Math.max(container.clientWidth, 320);
    const h = Math.max(container.clientHeight, 240);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }

  /**
   * Set the finger pose for the next rendered frame.
   * @param {Array} poseArray — format expected by HandRigController.applyFingerPose()
   */
  setPose(poseArray) {
    this._currentPose = poseArray;
  }

  /** Clear the current pose (hand returns to rest quaternions). */
  clearPose() {
    this._currentPose = null;
  }

  /** True once the GLB has loaded and HandRigController is ready. */
  get isModelLoaded() { return this._handController !== null; }

  /** Expose THREE so view controllers can use THREE.MathUtils.lerp etc. */
  get THREE() { return THREE; }

  /** Expose FINGER_MAPPING_TABLE so controllers don't need a separate import. */
  get FINGER_MAPPING_TABLE() { return FINGER_MAPPING_TABLE; }

  // ── Private methods ─────────────────────────────────────────────────────────

  _loadModel() {
    if (typeof this.onModelStatus === 'function') {
      this.onModelStatus('Loading hand model…');
    }

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        const handRoot = gltf.scene;
        this._scene.add(handRoot);
        this._frameObject(handRoot);
        this._handController = new HandRigController(handRoot, FINGER_MAPPING_TABLE);

        if (typeof this.onModelStatus === 'function') {
          this.onModelStatus('Model loaded.');
        }
      },
      undefined,
      (error) => {
        const detail = error?.message || error?.toString?.() || 'Unknown GLTF error';
        console.error('[ThreeEngine] GLB load error:', error);
        if (typeof this.onModelStatus === 'function') {
          this.onModelStatus(`Model failed: ${detail}`);
        }
      }
    );
  }

  /** Auto-frame camera to fit the loaded object — preserved verbatim from original pages. */
  _frameObject(object3D) {
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;

    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxSize       = Math.max(size.x, size.y, size.z);
    const fitHeight     = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(this._camera.fov) / 2));
    const fitWidth      = fitHeight / this._camera.aspect;
    const distance      = 1.3 * Math.max(fitHeight, fitWidth);

    this._controls.target.copy(center);
    this._camera.position.set(
      center.x + distance * 0.7,
      center.y + distance * 0.35,
      center.z + distance
    );
    this._camera.near = Math.max(0.01, distance / 100);
    this._camera.far  = distance * 100;
    this._camera.updateProjectionMatrix();
    this._controls.update();
  }

  /** Start the permanent rAF loop. Runs forever. */
  _startRenderLoop() {
    const loop = (nowMs) => {
      requestAnimationFrame(loop);

      // Give the active view controller a tick to compute and push its pose
      if (typeof this.onTick === 'function') {
        this.onTick(nowMs);
      }

      // Apply whatever pose was set last
      if (this._handController && this._currentPose) {
        this._handController.applyFingerPose(this._currentPose);
      }

      this._controls.update();
      this._renderer.render(this._scene, this._camera);
    };
    requestAnimationFrame(loop);
  }

  _watchResize(container) {
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.resizeTo(container));
      ro.observe(container);
    }
    window.addEventListener('resize', () => {
      if (this._container) this.resizeTo(this._container);
    });
  }
}

// ─── Export singleton instance ────────────────────────────────────────────────
export const ThreeEngine = new PersistentThreeEngine();
