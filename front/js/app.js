import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BleGloveClient } from "./bleGloveClient.js";
import { FINGER_MAPPING_TABLE, mapPacketToFingerPose } from "./mappingTable.js";
import { HandRigController } from "./handRigController.js";

const MODEL_URL = "./models/hand.glb";

const connectBtn = document.getElementById("connectBtn");
const statusEl = document.getElementById("status");
const exerciseListEl = document.getElementById("exerciseList");
const calibrationStateEl = document.getElementById("calibrationState");
const openCalibrationBtn = document.getElementById("openCalibrationBtn");
const openExerciseBtn = document.getElementById("openExerciseBtn");

const CALIBRATION_STORAGE_KEY_V2 = "doctorCalibrationV2";
const CALIBRATION_STORAGE_KEY_V1 = "doctorCalibrationV1";
const EXERCISE_STORAGE_KEY = "doctorExercisesV1";

const fingerValueEls = {
  Thumb: document.getElementById("valThumb"),
  Index: document.getElementById("valIndex"),
  Middle: document.getElementById("valMiddle"),
  Ring: document.getElementById("valRing"),
  Pinky: document.getElementById("valPinky")
};

function loadExercises() {
  try {
    const raw = localStorage.getItem(EXERCISE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.warn("Exercise load failed:", error);
    return [];
  }
}

function renderExerciseList() {
  if (!exerciseListEl) {
    return;
  }

  const exercises = loadExercises();
  exerciseListEl.innerHTML = "";

  if (!Array.isArray(exercises) || exercises.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No exercises available yet.";
    exerciseListEl.appendChild(li);
    return;
  }

  exercises.forEach((exercise) => {
    const li = document.createElement("li");
    const name = exercise?.name || "Unnamed exercise";
    const created = exercise?.createdAt || "Unknown date";
    li.textContent = `${name} (${created})`;
    exerciseListEl.appendChild(li);
  });
}

function loadCalibration() {
  try {
    const rawV2 = localStorage.getItem(CALIBRATION_STORAGE_KEY_V2);
    if (rawV2) {
      const parsedV2 = JSON.parse(rawV2);
      const min = Array.isArray(parsedV2.finalMin) ? parsedV2.finalMin : null;
      const max = Array.isArray(parsedV2.finalMax) ? parsedV2.finalMax : null;
      return {
        min,
        max,
        capturedAt: parsedV2.capturedAt || null
      };
    }

    const rawV1 = localStorage.getItem(CALIBRATION_STORAGE_KEY_V1);
    if (rawV1) {
      const parsedV1 = JSON.parse(rawV1);
      return {
        min: Array.isArray(parsedV1.min) ? parsedV1.min : null,
        max: Array.isArray(parsedV1.max) ? parsedV1.max : null,
        capturedAt: parsedV1.capturedAt || null
      };
    }
  } catch (error) {
    console.warn("Calibration load failed:", error);
  }

  return {
    min: null,
    max: null,
    capturedAt: null
  };
}

function renderCalibrationState() {
  if (!calibrationStateEl) {
    return;
  }

  const calibration = loadCalibration();
  const ready = Array.isArray(calibration.min) && Array.isArray(calibration.max);
  if (!ready) {
    calibrationStateEl.textContent = "Calibration status: Not calibrated yet. Use the calibration page first.";
    return;
  }

  const capturedAt = calibration.capturedAt || "Unknown time";
  calibrationStateEl.textContent = `Calibration status: Ready. Last updated: ${capturedAt}`;
}

if (openCalibrationBtn) {
  openCalibrationBtn.addEventListener("click", () => {
    window.location.href = "./patient_calibration.html";
  });
}

if (openExerciseBtn) {
  openExerciseBtn.addEventListener("click", () => {
    window.location.href = "./patient_exercise.html";
  });
}

renderExerciseList();
renderCalibrationState();

const rendererContainer = document.getElementById("rendererContainer");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#e8edf3");

const camera = new THREE.PerspectiveCamera(
  50,
  rendererContainer.clientWidth / rendererContainer.clientHeight,
  0.01,
  100
);
camera.position.set(0.2, 0.2, 0.8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(rendererContainer.clientWidth, rendererContainer.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
rendererContainer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.1, 0);

scene.add(new THREE.AmbientLight("#ffffff", 0.9));
const keyLight = new THREE.DirectionalLight("#ffffff", 1.2);
keyLight.position.set(1, 1, 1);
scene.add(keyLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(2, 64),
  new THREE.MeshStandardMaterial({ color: "#d2dae6", roughness: 0.9, metalness: 0.0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.2;
scene.add(floor);

function frameObject(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  if (box.isEmpty()) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxSize = Math.max(size.x, size.y, size.z);
  const fitHeightDistance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = 1.3 * Math.max(fitHeightDistance, fitWidthDistance);

  controls.target.copy(center);
  camera.position.set(center.x + distance * 0.7, center.y + distance * 0.35, center.z + distance);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

let handController = null;
let latestPacket = [0, 0, 0, 0, 0];

const loader = new GLTFLoader();
loader.load(
  MODEL_URL,
  (gltf) => {
    const handRoot = gltf.scene;
    scene.add(handRoot);
    frameObject(handRoot);

    handController = new HandRigController(handRoot, FINGER_MAPPING_TABLE);
    statusEl.textContent = "Model loaded. Connect glove to start streaming.";
  },
  undefined,
  (error) => {
    console.error(error);
    statusEl.textContent = "Failed to load model. Check MODEL_URL path in js/app.js.";
  }
);

function renderLoop() {
  requestAnimationFrame(renderLoop);

  if (handController) {
    const fingerPose = mapPacketToFingerPose(latestPacket, FINGER_MAPPING_TABLE);
    handController.applyFingerPose(fingerPose);
  }

  controls.update();
  renderer.render(scene, camera);
}
renderLoop();

window.addEventListener("resize", () => {
  const width = rendererContainer.clientWidth;
  const height = rendererContainer.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

const gloveClient = new BleGloveClient();
gloveClient.onStatus = (msg) => {
  statusEl.textContent = msg;

  if (msg === "Disconnected") {
    connectBtn.disabled = false;
    connectBtn.textContent = "Reconnect to Glove";
  }
};

gloveClient.onPacket = (packet) => {
  latestPacket = packet;

  const pose = mapPacketToFingerPose(packet, FINGER_MAPPING_TABLE);
  for (const p of pose) {
    const el = fingerValueEls[p.fingerName];
    if (el) {
      el.textContent = `${p.rawValue} / ${p.baseAngle.toFixed(1)}deg`;
    }
  }
};

connectBtn.addEventListener("click", async () => {
  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting...";

  try {
    await gloveClient.connect();
    connectBtn.textContent = "Connected";
    connectBtn.disabled = true;
  } catch (err) {
    console.error(err);
    const errorName = err?.name || "Error";
    const errorMessage = err?.message || "Unknown BLE error";
    statusEl.textContent = `BLE connection failed: ${errorName} - ${errorMessage}`;
    connectBtn.textContent = "Connect to Glove";
    connectBtn.disabled = false;
  }
});
