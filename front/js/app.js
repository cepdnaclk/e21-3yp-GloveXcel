import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BleGloveClient } from "./bleGloveClient.js";
import { FINGER_MAPPING_TABLE, mapPacketToFingerPoseCalibrated } from "./mappingTable.js";
import { HandRigController } from "./handRigController.js";

const MODEL_URL = "./models/hand.glb";

const connectBtn = document.getElementById("connectBtn");
const statusEl = document.getElementById("status");
const exerciseEmptyStateEl = document.getElementById("exerciseEmptyState");
const calibrationStateEl = document.getElementById("calibrationState");
const calibrationLevelEl = document.getElementById("calibrationLevel");
const calibrationGridEl = document.getElementById("calibrationGrid");
const openCalibrationBtn = document.getElementById("openCalibrationBtn");
const openExerciseBtn = document.getElementById("openExerciseBtn");
const exerciseSelectEl = document.getElementById("exerciseSelect");
const loadSavedBtnEl = document.getElementById("loadSavedBtn");
const configBtnEl = document.getElementById("configBtn");
const applyForceBtnEl = document.getElementById("applyForceBtn");
const loadedCardEl = document.getElementById("loadedCard");
const loadedTimestampEl = document.getElementById("loadedTimestamp");
const loadedExerciseIdEl = document.getElementById("loadedExerciseId");
const loadedThumbEl = document.getElementById("loadedThumb");
const loadedIndexEl = document.getElementById("loadedIndex");
const loadedMiddleEl = document.getElementById("loadedMiddle");
const loadedRingEl = document.getElementById("loadedRing");
const loadedPinkyEl = document.getElementById("loadedPinky");
const loadedForceLevelEl = document.getElementById("loadedForceLevel");
const patientIdBadgeEl = document.getElementById("patientIdBadge");

const CALIBRATION_STORAGE_KEY_V1 = "patientCalibrationV1";
const PATIENT_ID_STORAGE_KEY = "patientId";
const AUTH_TOKEN_STORAGE_KEY = "auth_token";
const LEGACY_PATIENT_ID = "patient_003";
const API_BASE = (localStorage.getItem("apiBaseUrl") || "http://localhost:3000").replace(/\/$/, "");
const DATA_API_BASE = `${API_BASE}/api/data`;
const THERAPY_SESSIONS_API_BASE = `${API_BASE}/api/therapy-sessions`;
const PATIENT_CALIB_API_BASE = `${API_BASE}/api/patient-cal`;
const PATIENT_CROSS_PAGE_CHANNEL_KEY = "patientCrossPageV1";

const fingerValueEls = {
  Thumb: document.getElementById("valThumb"),
  Index: document.getElementById("valIndex"),
  Middle: document.getElementById("valMiddle"),
  Ring: document.getElementById("valRing"),
  Pinky: document.getElementById("valPinky")
};

let exerciseSessions = [];
let isConnected = false;
let activeCalibration = loadCalibration();
const patientCrossPageChannel = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel(PATIENT_CROSS_PAGE_CHANNEL_KEY)
  : null;

function reloadCalibrationAndUi() {
  activeCalibration = loadCalibration();
  renderCalibrationState();
  renderCalibrationDetails();
}

function loadCalibration() {
  try {
    const rawV1 = localStorage.getItem(CALIBRATION_STORAGE_KEY_V1);
    if (rawV1) {
      const parsedV1 = JSON.parse(rawV1);
      const min = Array.isArray(parsedV1.finalMin) ? parsedV1.finalMin : null;
      const max = Array.isArray(parsedV1.finalMax) ? parsedV1.finalMax : null;
      return {
        min,
        max,
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

function getStoredPatientId() {
  const storedPatientId = localStorage.getItem(PATIENT_ID_STORAGE_KEY);
  const rawProfile = localStorage.getItem("auth_profile");
  if (!rawProfile) {
    return storedPatientId && storedPatientId !== LEGACY_PATIENT_ID ? storedPatientId : "";
  }

  try {
    const profile = JSON.parse(rawProfile);
    return profile?.patient_id || (storedPatientId && storedPatientId !== LEGACY_PATIENT_ID ? storedPatientId : "");
  } catch {
    return storedPatientId && storedPatientId !== LEGACY_PATIENT_ID ? storedPatientId : "";
  }
}

function renderPatientIdBadge() {
  if (!patientIdBadgeEl) {
    return;
  }

  const patientId = getStoredPatientId();
  patientIdBadgeEl.textContent = patientId || "--";
}

function getAuthHeaders() {
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token || !isAuthTokenForCurrentSession(token)) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isAuthTokenForCurrentSession(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;

  if (payload.exp && payload.exp * 1000 <= Date.now()) {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    return false;
  }

  let profile = {};
  try {
    profile = JSON.parse(localStorage.getItem("auth_profile") || "{}");
  } catch {
    profile = {};
  }

  const role = String(localStorage.getItem("auth_role") || "").trim().toLowerCase();
  const tokenRole = String(payload.role || "").trim().toLowerCase();
  if (role && tokenRole && role !== tokenRole) return false;

  if (role === "patient") return payload.sub === profile.patient_id;
  if (role === "doctor") return payload.sub === profile.doctor_id;
  if (role === "admin") return payload.sub === profile.admin_id;

  return true;
}

function levelToAngle(level) {
  const normalized = Math.max(1, Math.min(6, Number(level))) - 1;
  return Math.round((normalized * 90) / 5);
}

async function syncPatientCalibrationFromDatabase() {
  const patientId = getStoredPatientId();

  try {
    const response = await fetch(`${PATIENT_CALIB_API_BASE}/${encodeURIComponent(patientId)}`, {
      headers: { ...getAuthHeaders() }
    });

    if (response.status === 404) {
      localStorage.removeItem(CALIBRATION_STORAGE_KEY_V1);
      activeCalibration = loadCalibration();
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const doc = await response.json();
    const min = doc?.min || {};
    const max = doc?.max || {};

    const finalMin = [min.thumb, min.index, min.middle, min.ring, min.pinky]
      .map((value) => Number(value))
      .map((value) => (Number.isFinite(value) ? value : null));
    const finalMax = [max.thumb, max.index, max.middle, max.ring, max.pinky]
      .map((value) => Number(value))
      .map((value) => (Number.isFinite(value) ? value : null));

    const level = Number(doc?.level);
    const payload = {
      nonThumbMin: [null, finalMin[1], finalMin[2], finalMin[3], finalMin[4]],
      nonThumbMax: [null, finalMax[1], finalMax[2], finalMax[3], finalMax[4]],
      thumbMin: [finalMin[0], null, null, null, null],
      thumbMax: [finalMax[0], null, null, null, null],
      finalMin,
      finalMax,
      targetMaxAngle: Number.isFinite(level) ? levelToAngle(level) : 90,
      level: Number.isFinite(level) ? level : null,
      capturedAt: doc?.updatedAt || null
    };

    localStorage.setItem(CALIBRATION_STORAGE_KEY_V1, JSON.stringify(payload));
    activeCalibration = { min: payload.finalMin, max: payload.finalMax, capturedAt: payload.capturedAt || null };
  } catch (error) {
    console.warn("Failed to sync patient calibration:", error);
  }
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

function renderCalibrationDetails() {
  if (!calibrationLevelEl || !calibrationGridEl) {
    return;
  }

  const calibration = loadCalibration();
  const ready = Array.isArray(calibration.min) && Array.isArray(calibration.max);
  if (!ready) {
    calibrationLevelEl.textContent = "Level: --";
    calibrationGridEl.innerHTML = "";
    return;
  }

  const rawV1 = localStorage.getItem(CALIBRATION_STORAGE_KEY_V1);
  let levelLabel = "--";
  if (rawV1) {
    try {
      const parsed = JSON.parse(rawV1);
      if (Number.isFinite(parsed.level)) {
        levelLabel = String(parsed.level);
      }
    } catch {
      // Ignore parse errors and keep fallback label.
    }
  }

  calibrationLevelEl.textContent = `Level: ${levelLabel}`;
  calibrationGridEl.innerHTML = "";

  const labels = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
  for (let i = 0; i < labels.length; i += 1) {
    const minV = Number.isFinite(calibration.min[i]) ? calibration.min[i] : "--";
    const maxV = Number.isFinite(calibration.max[i]) ? calibration.max[i] : "--";
    const row = document.createElement("div");
    row.className = "finger-row";
    row.innerHTML = `<span>${labels[i]}</span><strong>Min ${minV} | Max ${maxV}</strong>`;
    calibrationGridEl.appendChild(row);
  }
}

function broadcastPatientState(packet) {
  if (!patientCrossPageChannel) {
    return;
  }

  patientCrossPageChannel.postMessage({
    type: "patient-state",
    connected: isConnected,
    latestPacket: packet ? [...packet] : null,
    timestamp: Date.now()
  });
}

if (openCalibrationBtn) {
  openCalibrationBtn.addEventListener("click", () => {
    const patientId = getStoredPatientId();
    localStorage.setItem("patientId", patientId);
    localStorage.setItem("apiBaseUrl", API_BASE);
    const url = `./patient_calibration.html?patient_id=${encodeURIComponent(patientId)}&api_base=${encodeURIComponent(API_BASE)}`;
    window.location.href = url;
  });
}

if (openExerciseBtn) {
  openExerciseBtn.addEventListener("click", () => {
    window.location.href = "./patient_exercise.html";
  });
}

renderPatientIdBadge();
syncPatientCalibrationFromDatabase().finally(() => {
  reloadCalibrationAndUi();
  renderPatientIdBadge();
});

window.addEventListener("storage", (event) => {
  if (event.key === CALIBRATION_STORAGE_KEY_V1) {
    reloadCalibrationAndUi();
  }
});

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

function renderPacketValues(packet) {
  const pose = mapPacketToFingerPoseCalibrated(packet, activeCalibration, FINGER_MAPPING_TABLE);
  for (const p of pose) {
    const el = fingerValueEls[p.fingerName];
    if (el) {
      el.textContent = `${p.rawValue} / ${p.baseAngle.toFixed(1)}deg`;
    }
  }
}

function parseLoadedForceLevel() {
  if (!loadedForceLevelEl) {
    return NaN;
  }

  return Number.parseInt(loadedForceLevelEl.textContent || "", 10);
}

function updateEnhancedAccessState() {
  if (!exerciseSelectEl || !loadSavedBtnEl || !configBtnEl || !applyForceBtnEl) {
    return;
  }

  const hasSelectedExercise = Boolean(exerciseSelectEl.value);
  const forceLevel = parseLoadedForceLevel();
  exerciseSelectEl.disabled = !isConnected;
  loadSavedBtnEl.disabled = !(isConnected && hasSelectedExercise);
  configBtnEl.disabled = !(isConnected && hasSelectedExercise);
  applyForceBtnEl.disabled = !(isConnected && Number.isFinite(forceLevel));

  if (openCalibrationBtn) {
    openCalibrationBtn.disabled = !isConnected;
  }

  if (openExerciseBtn) {
    openExerciseBtn.disabled = !isConnected;
  }
}

async function loadExercisesForPatient() {
  if (!exerciseSelectEl) {
    return;
  }

  if (exerciseEmptyStateEl) {
    exerciseEmptyStateEl.style.display = "none";
  }

  exerciseSelectEl.innerHTML = '<option value="">-- Loading exercises... --</option>';
  exerciseSelectEl.disabled = true;

  try {
    const patientId = getStoredPatientId();
    const res = await fetch(
      `${THERAPY_SESSIONS_API_BASE}/patient/${encodeURIComponent(patientId)}`
    );
    if (!res.ok) {
      throw new Error(`Server responded ${res.status}`);
    }

    const payload = await res.json();
    const sessions = payload?.data || [];
    exerciseSessions = Array.isArray(sessions) ? sessions : [];

    const seen = new Set();
    const uniqueExerciseIds = [];
    for (const session of exerciseSessions) {
      const exerciseId = session?.exercise_id;
      if (!exerciseId || seen.has(exerciseId)) {
        continue;
      }

      seen.add(exerciseId);
      uniqueExerciseIds.push(exerciseId);
    }

    if (uniqueExerciseIds.length === 0) {
      exerciseSelectEl.innerHTML = '<option value="">-- No exercises found --</option>';
      if (exerciseEmptyStateEl) {
        exerciseEmptyStateEl.style.display = "block";
      }
      updateEnhancedAccessState();
      return;
    }

    exerciseSelectEl.innerHTML = '<option value="">-- Select an exercise --</option>';
    for (const exerciseId of uniqueExerciseIds) {
      const option = document.createElement("option");
      option.value = exerciseId;
      option.textContent = exerciseId;
      exerciseSelectEl.appendChild(option);
    }
  } catch (err) {
    console.error("Error loading exercises:", err);
    exerciseSelectEl.innerHTML = '<option value="">-- Failed to load exercises --</option>';
    if (exerciseEmptyStateEl) {
      exerciseEmptyStateEl.style.display = "none";
    }
    alert(`Failed to load exercises for ${getStoredPatientId()}. Is the Node server running?`);
  } finally {
    exerciseSelectEl.disabled = !isConnected;
    updateEnhancedAccessState();
  }
}

function populateLoadedCard(session) {
  if (!loadedCardEl) {
    return;
  }

  if (!session) {
    loadedCardEl.style.display = "none";
    return;
  }

  const thumb = Number.parseInt(session.thumb, 10) || 0;
  const index = Number.parseInt(session.index, 10) || 0;
  const middle = Number.parseInt(session.middle, 10) || 0;
  const ring = Number.parseInt(session.ring, 10) || 0;
  const pinky = Number.parseInt(session.pinky, 10) || 0;

  const ts = session.timestamp ? new Date(session.timestamp).toLocaleString() : "unknown";
  if (loadedTimestampEl) {
    loadedTimestampEl.textContent = ts;
  }
  if (loadedExerciseIdEl) {
    loadedExerciseIdEl.textContent = session.exercise_id || "-";
  }
  if (loadedThumbEl) {
    loadedThumbEl.textContent = String(thumb);
  }
  if (loadedIndexEl) {
    loadedIndexEl.textContent = String(index);
  }
  if (loadedMiddleEl) {
    loadedMiddleEl.textContent = String(middle);
  }
  if (loadedRingEl) {
    loadedRingEl.textContent = String(ring);
  }
  if (loadedPinkyEl) {
    loadedPinkyEl.textContent = String(pinky);
  }
  if (loadedForceLevelEl) {
    loadedForceLevelEl.textContent = String(Number.parseInt(session.force_level, 10) || 0);
  }

  loadedCardEl.style.display = "block";
}

async function fetchSavedData() {
  if (!exerciseSelectEl) {
    return;
  }

  const selectedExerciseId = exerciseSelectEl.value;
  if (!selectedExerciseId) {
    alert("Please select an exercise first.");
    return;
  }

  const originalText = loadSavedBtnEl ? loadSavedBtnEl.textContent : "Load Saved Data";
  if (loadSavedBtnEl) {
    loadSavedBtnEl.disabled = true;
    loadSavedBtnEl.textContent = "Loading...";
  }

  try {
    const res = await fetch(
      `${DATA_API_BASE}/${encodeURIComponent(getStoredPatientId())}?exercise_id=${encodeURIComponent(selectedExerciseId)}`
    );
    if (!res.ok) {
      throw new Error(`Server responded ${res.status}`);
    }

    const sessions = await res.json();
    const selected = Array.isArray(sessions)
      ? sessions.find((s) => s?.exercise_id === selectedExerciseId)
      : null;

    if (!selected) {
      populateLoadedCard(null);
      alert("No saved data found for selected exercise.");
      return;
    }

    populateLoadedCard(selected);
  } catch (err) {
    console.error("Error loading saved data:", err);
    alert("Failed to load saved data. Is the Node server running?");
  } finally {
    if (loadSavedBtnEl) {
      loadSavedBtnEl.textContent = originalText;
    }
    updateEnhancedAccessState();
  }
}

async function applyForce() {
  const level = parseLoadedForceLevel();
  if (!Number.isFinite(level) || level < 1 || level > 10) {
    alert("Load saved data first to get a valid force level (1-10).");
    return;
  }

  try {
    await gloveClient.sendMotorLevel(level);
    alert(`Force ${level} applied`);
  } catch (error) {
    console.error(error);
    alert("Apply force failed. Connect to a glove that supports motor commands.");
  }
}

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
    const fingerPose = mapPacketToFingerPoseCalibrated(latestPacket, activeCalibration, FINGER_MAPPING_TABLE);
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
    isConnected = false;
    connectBtn.disabled = false;
    connectBtn.textContent = "Reconnect to Glove";
    connectBtn.style.background = "#dc3545";
    updateEnhancedAccessState();
    broadcastPatientState(null);
  }
};

gloveClient.onPacket = (packet) => {
  latestPacket = packet;
  renderPacketValues(packet);
  broadcastPatientState(packet);
};

connectBtn.addEventListener("click", async () => {
  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting...";

  try {
    await gloveClient.connect();
    isConnected = true;
    connectBtn.textContent = "Connected!";
    connectBtn.style.background = "#28a745";
    connectBtn.disabled = true;
    updateEnhancedAccessState();
    await loadExercisesForPatient();
    broadcastPatientState(latestPacket);
  } catch (err) {
    console.error(err);
    const errorName = err?.name || "Error";
    const errorMessage = err?.message || "Unknown BLE error";
    statusEl.textContent = `BLE connection failed: ${errorName} - ${errorMessage}`;
    connectBtn.textContent = "Connect to Glove";
    connectBtn.style.background = "";
    connectBtn.disabled = false;
    isConnected = false;
    updateEnhancedAccessState();
    broadcastPatientState(null);
  }
});

if (patientCrossPageChannel) {
  patientCrossPageChannel.addEventListener("message", (event) => {
    const data = event?.data || {};
    if (data.type === "request-patient-state") {
      broadcastPatientState(latestPacket);
    }
  });
}

if (exerciseSelectEl) {
  exerciseSelectEl.addEventListener("change", updateEnhancedAccessState);
}

if (loadSavedBtnEl) {
  loadSavedBtnEl.addEventListener("click", fetchSavedData);
}

if (configBtnEl) {
  configBtnEl.addEventListener("click", () => {
    window.location.href = "./configur.html";
  });
}

if (applyForceBtnEl) {
  applyForceBtnEl.addEventListener("click", applyForce);
}

window.addEventListener("pagehide", () => {
  gloveClient.disconnect();
});

window.addEventListener("beforeunload", () => {
  gloveClient.disconnect();
});

updateEnhancedAccessState();
