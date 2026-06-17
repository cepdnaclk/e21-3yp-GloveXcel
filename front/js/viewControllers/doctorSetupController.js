/**
 * doctorSetupController.js
 *
 * View controller for the Doctor Setup & Calibration view.
 * Handles connecting the doctor's glove and loading/verifying doctor calibration.
 */

import { FINGER_MAPPING_TABLE } from '../mappingTable.js';

const FINGER_LABELS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const DOCTOR_CALIB_KEY_V2 = 'doctorCalibrationV2';

let _state = null;
let _engine = null;
let _container = null;

let _activePreviewMode = 'live';
let _previewAngles = [90, 90, 90, 90, 90];
let _targetAngles = [90, 90, 90, 90, 90];

// DOM refs
let doctorSetupGloveStatusIndicator, doctorSetupGloveStatus, doctorSetupConnectBtn;
let doctorCalibGrid, doctorLiveGrid, openCalibrationBtn;
let captureNonThumbMinBtn, captureNonThumbMaxBtn, captureThumbMinBtn, captureThumbMaxBtn;
let previewNonThumbMinBtn, previewNonThumbMaxBtn, previewThumbMinBtn, previewThumbMaxBtn, livePreviewBtn;

// ── Math Helpers ──
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rawToAngle(rawValue, minValue, maxValue) {
  if (minValue === null || maxValue === null || minValue === maxValue) return null;
  const t = (rawValue - minValue) / (maxValue - minValue);
  return clamp(t * 90, 0, 90);
}

function getDoctorId() {
  try {
    const profile = JSON.parse(localStorage.getItem('auth_profile') || '{}');
    if (profile?.doctor_id) return profile.doctor_id;
  } catch { /* fall through */ }

  return localStorage.getItem('doctorId') || 'DOC-1b402238f4ad4c92a7deedbc1a53c813';
}

// ── Doctor Calibration Logic ──

function loadDoctorCalibrationLocally() {
  try {
    const rawV2 = localStorage.getItem(DOCTOR_CALIB_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      return {
        min: Array.isArray(parsed.finalMin) ? parsed.finalMin : [null, null, null, null, null],
        max: Array.isArray(parsed.finalMax) ? parsed.finalMax : [null, null, null, null, null],
        nonThumbMin: Array.isArray(parsed.nonThumbMin) ? parsed.nonThumbMin : [null, null, null, null, null],
        nonThumbMax: Array.isArray(parsed.nonThumbMax) ? parsed.nonThumbMax : [null, null, null, null, null],
        thumbMin: Array.isArray(parsed.thumbMin) ? parsed.thumbMin : [null, null, null, null, null],
        thumbMax: Array.isArray(parsed.thumbMax) ? parsed.thumbMax : [null, null, null, null, null],
        ready: Array.isArray(parsed.finalMin) && Array.isArray(parsed.finalMax) && parsed.finalMin.every(Number.isFinite) && parsed.finalMax.every(Number.isFinite),
        capturedAt: parsed.capturedAt || null
      };
    }
  } catch (err) {
    console.warn('[DoctorSetup] Local calibration load failed:', err);
  }
  return { 
    min: [null, null, null, null, null], max: [null, null, null, null, null], 
    nonThumbMin: [null, null, null, null, null], nonThumbMax: [null, null, null, null, null],
    thumbMin: [null, null, null, null, null], thumbMax: [null, null, null, null, null],
    ready: false, capturedAt: null 
  };
}

async function fetchDoctorCalibrationFromDB() {
  try {
    const resp = await fetch(`${_state.apiBase}/api/doctor-cal/${encodeURIComponent(getDoctorId())}`, {
      headers: _state.getAuthHeaders()
    });
    if (!resp.ok) {
      if (resp.status !== 404) console.warn('[DoctorSetup] HTTP error fetching doctor cal:', resp.status);
      return;
    }
    const doc = await resp.json();
    const min = doc?.min || {};
    const max = doc?.max || {};
    const finalMin = ['thumb', 'index', 'middle', 'ring', 'pinky'].map(k => Number.isFinite(Number(min[k])) ? Number(min[k]) : null);
    const finalMax = ['thumb', 'index', 'middle', 'ring', 'pinky'].map(k => Number.isFinite(Number(max[k])) ? Number(max[k]) : null);
    
    const calData = {
      version: 2,
      nonThumbMin: [null, finalMin[1], finalMin[2], finalMin[3], finalMin[4]],
      nonThumbMax: [null, finalMax[1], finalMax[2], finalMax[3], finalMax[4]],
      thumbMin: [finalMin[0], null, null, null, null],
      thumbMax: [finalMax[0], null, null, null, null],
      finalMin,
      finalMax,
      capturedAt: doc.updatedAt || new Date().toISOString()
    };
    
    localStorage.setItem(DOCTOR_CALIB_KEY_V2, JSON.stringify(calData));
    _state.doctorCalibration = loadDoctorCalibrationLocally();
    renderCalibrationSnapshot();
  } catch (err) {
    console.error('[DoctorSetup] Error fetching DB calibration:', err);
  }
}

async function _saveDoctorCalibration() {
  const cal = _state.doctorCalibration;
  cal.min = [cal.thumbMin[0], cal.nonThumbMin[1], cal.nonThumbMin[2], cal.nonThumbMin[3], cal.nonThumbMin[4]];
  cal.max = [cal.thumbMax[0], cal.nonThumbMax[1], cal.nonThumbMax[2], cal.nonThumbMax[3], cal.nonThumbMax[4]];
  cal.ready = cal.min.every(Number.isFinite) && cal.max.every(Number.isFinite);
  cal.capturedAt = new Date().toISOString();
  
  const calData = {
    version: 2,
    nonThumbMin: cal.nonThumbMin,
    nonThumbMax: cal.nonThumbMax,
    thumbMin: cal.thumbMin,
    thumbMax: cal.thumbMax,
    finalMin: cal.min,
    finalMax: cal.max,
    capturedAt: cal.capturedAt
  };
  localStorage.setItem(DOCTOR_CALIB_KEY_V2, JSON.stringify(calData));
  renderCalibrationSnapshot();
}

async function _capturePass(indexes, targetArrayName) {
  if (!_state.isConnected) {
    alert('Connect doctor glove first.');
    return;
  }
  const targetArray = _state.doctorCalibration[targetArrayName];
  indexes.forEach(idx => { targetArray[idx] = _state.latestPacket[idx]; });
  await _saveDoctorCalibration();
}

function _previewCalibrationPose(mode) {
  _activePreviewMode = mode;
  if (mode === 'non-thumb-min') {
    _targetAngles = [90, 0, 0, 0, 0];
    return;
  }
  if (mode === 'non-thumb-max') {
    _targetAngles = [90, 90, 90, 90, 90];
    return;
  }
  if (mode === 'thumb-min') {
    _targetAngles = [0, 90, 90, 90, 90];
    return;
  }
  if (mode === 'thumb-max') {
    _targetAngles = [90, 90, 90, 90, 90];
  }
}

function _buildPoseFromAngles(angles) {
  return FINGER_MAPPING_TABLE.map((row, i) => {
    const sourceAngle = Number.isFinite(angles[i]) ? angles[i] : 0;
    const baseAngle   = Math.max(0, Math.min(90, 90 - sourceAngle));
    const spreadSign  = row.spreadInvert ? -1 : 1;
    return {
      fingerName:  row.fingerName,
      rawValue:    0,
      baseAngle,
      midAngle:    baseAngle * row.midRatio,
      tipAngle:    baseAngle * row.tipRatio,
      spreadAngle: row.isThumb ? row.spreadAmount * spreadSign : 0,
    };
  });
}

// ── Rendering ──

function renderCalibrationSnapshot() {
  if (!doctorCalibGrid) return;
  doctorCalibGrid.innerHTML = '';
  
  const cal = _state.doctorCalibration || loadDoctorCalibrationLocally();
  
  FINGER_LABELS.forEach((label, i) => {
    const minV = cal.min[i] !== null ? cal.min[i] : '--';
    const maxV = cal.max[i] !== null ? cal.max[i] : '--';
    
    const card = document.createElement('div');
    card.className = 'mini-card';
    card.innerHTML = `
      <h3>${label}</h3>
      <div style="font-size:13px; color:var(--c-text-main);">Min: ${minV}</div>
      <div style="font-size:13px; color:var(--c-text-main);">Max: ${maxV}</div>
    `;
    doctorCalibGrid.appendChild(card);
  });
}

function renderLiveGrid(packet) {
  if (!doctorLiveGrid) return;
  doctorLiveGrid.innerHTML = '';
  
  const cal = _state.doctorCalibration || loadDoctorCalibrationLocally();
  
  FINGER_LABELS.forEach((label, i) => {
    const raw = packet[i];
    const angle = rawToAngle(raw, cal.min[i], cal.max[i]);
    
    const card = document.createElement('div');
    card.className = 'mini-card';
    card.innerHTML = `
      <h3>${label}</h3>
      <div class="raw-val">${Number.isFinite(raw) ? raw : '--'}</div>
      <div class="angle-val">${angle !== null ? angle.toFixed(1) + '°' : '--'}</div>
    `;
    doctorLiveGrid.appendChild(card);
  });
}

// ── Exported Lifecycle ──

export function mount(container, gloveState, threeEngine) {
  _container = container;
  _state = gloveState;
  _engine = threeEngine;
  
  // Attach doctorCalibration to state for other views to reuse
  _state.doctorCalibration = loadDoctorCalibrationLocally();
  fetchDoctorCalibrationFromDB();
  
  // DOM Bindings
  doctorSetupGloveStatusIndicator = _container.querySelector('#doctorSetupGloveStatusIndicator');
  doctorSetupGloveStatus          = _container.querySelector('#doctorSetupGloveStatus');
  doctorSetupConnectBtn           = _container.querySelector('#doctorSetupConnectBtn');
  doctorCalibGrid                 = _container.querySelector('#doctorCalibGrid');
  doctorLiveGrid                  = _container.querySelector('#doctorLiveGrid');
  openCalibrationBtn              = _container.querySelector('#openCalibrationBtn');
  captureNonThumbMinBtn           = _container.querySelector('#captureNonThumbMinBtn');
  captureNonThumbMaxBtn           = _container.querySelector('#captureNonThumbMaxBtn');
  captureThumbMinBtn              = _container.querySelector('#captureThumbMinBtn');
  captureThumbMaxBtn              = _container.querySelector('#captureThumbMaxBtn');
  previewNonThumbMinBtn           = _container.querySelector('#previewNonThumbMinBtn');
  previewNonThumbMaxBtn           = _container.querySelector('#previewNonThumbMaxBtn');
  previewThumbMinBtn              = _container.querySelector('#previewThumbMinBtn');
  previewThumbMaxBtn              = _container.querySelector('#previewThumbMaxBtn');
  livePreviewBtn                  = _container.querySelector('#livePreviewBtn');
  
  // Initial Render
  renderCalibrationSnapshot();
  renderLiveGrid(_state.latestPacket);
  
  // Connection State Reflection
  if (_state.isConnected) {
    doctorSetupConnectBtn.textContent = 'Glove Connected';
    doctorSetupConnectBtn.disabled = true;
    doctorSetupGloveStatusIndicator.classList.add('online');
    doctorSetupGloveStatus.textContent = 'Doctor glove status: Connected.';
    if (captureNonThumbMinBtn) captureNonThumbMinBtn.disabled = false;
    if (captureNonThumbMaxBtn) captureNonThumbMaxBtn.disabled = false;
    if (captureThumbMinBtn) captureThumbMinBtn.disabled = false;
    if (captureThumbMaxBtn) captureThumbMaxBtn.disabled = false;
  }
  
  // Event Listeners
  doctorSetupConnectBtn.addEventListener('click', async () => {
    doctorSetupConnectBtn.disabled = true;
    doctorSetupConnectBtn.textContent = 'Connecting...';
    try {
      await _state.connect();
      _state.isConnected = true;
      doctorSetupConnectBtn.textContent = 'Glove Connected';
      doctorSetupGloveStatusIndicator.classList.add('online');
      doctorSetupGloveStatus.textContent = 'Doctor glove status: Connected.';
      if (captureNonThumbMinBtn) captureNonThumbMinBtn.disabled = false;
      if (captureNonThumbMaxBtn) captureNonThumbMaxBtn.disabled = false;
      if (captureThumbMinBtn) captureThumbMinBtn.disabled = false;
      if (captureThumbMaxBtn) captureThumbMaxBtn.disabled = false;
    } catch (err) {
      console.error('[DoctorSetup] Connection failed:', err);
      doctorSetupConnectBtn.textContent = 'Connect to Glove';
      doctorSetupConnectBtn.disabled = false;
      doctorSetupGloveStatus.textContent = `Connection failed: ${err.message}`;
    }
  });
  
  openCalibrationBtn.addEventListener('click', () => {
    fetchDoctorCalibrationFromDB();
  });
  
  captureNonThumbMinBtn?.addEventListener('click', () => _capturePass([1, 2, 3, 4], 'nonThumbMin'));
  captureNonThumbMaxBtn?.addEventListener('click', () => _capturePass([1, 2, 3, 4], 'nonThumbMax'));
  captureThumbMinBtn?.addEventListener('click', () => _capturePass([0], 'thumbMin'));
  captureThumbMaxBtn?.addEventListener('click', () => _capturePass([0], 'thumbMax'));
  
  previewNonThumbMinBtn?.addEventListener('click', () => _previewCalibrationPose('non-thumb-min'));
  previewNonThumbMaxBtn?.addEventListener('click', () => _previewCalibrationPose('non-thumb-max'));
  previewThumbMinBtn?.addEventListener('click', () => _previewCalibrationPose('thumb-min'));
  previewThumbMaxBtn?.addEventListener('click', () => _previewCalibrationPose('thumb-max'));
  livePreviewBtn?.addEventListener('click', () => { _activePreviewMode = 'live'; });
  
  // Wire State Callbacks
  _state.onPacket = (packet) => {
    renderLiveGrid(packet);
    
    // Drive the 3D model for the doctor setup
    if (_engine.isModelLoaded && _activePreviewMode === 'live') {
      const cal = _state.doctorCalibration;
      if (cal && cal.ready) {
        const angles = packet.map((raw, i) => rawToAngle(raw, cal.min[i], cal.max[i]) ?? 0);
        _engine.setPose(_buildPoseFromAngles(angles));
      }
    }
  };
  
  _engine.onTick = () => {
    if (_activePreviewMode !== 'live') {
      const THREE = _engine.THREE;
      _previewAngles = _previewAngles.map((a, i) =>
        THREE.MathUtils.lerp(a, _targetAngles[i], 0.12)
      );
      _engine.setPose(_buildPoseFromAngles(_previewAngles));
    }
  };
  
  _state.onStatus = (msg) => {
    if (msg === 'Disconnected') {
      doctorSetupConnectBtn.disabled = false;
      doctorSetupConnectBtn.textContent = 'Connect to Glove';
      doctorSetupGloveStatusIndicator.classList.remove('online');
      if (captureNonThumbMinBtn) captureNonThumbMinBtn.disabled = true;
      if (captureNonThumbMaxBtn) captureNonThumbMaxBtn.disabled = true;
      if (captureThumbMinBtn) captureThumbMinBtn.disabled = true;
      if (captureThumbMaxBtn) captureThumbMaxBtn.disabled = true;
    }
    doctorSetupGloveStatus.textContent = `Doctor glove status: ${msg}`;
  };
  
  _activePreviewMode = 'live';
  _engine.clearPose();
}

export function unmount() {
  if (_state) {
    _state.onPacket = null;
    _state.onStatus = null;
    _state.onConnectionChange = null;
  }
  if (_engine) {
    _engine.onTick = null;
    _engine.clearPose();
  }
  
  doctorSetupGloveStatusIndicator = doctorSetupGloveStatus = doctorSetupConnectBtn = null;
  doctorCalibGrid = doctorLiveGrid = openCalibrationBtn = null;
  captureNonThumbMinBtn = captureNonThumbMaxBtn = captureThumbMinBtn = captureThumbMaxBtn = null;
  previewNonThumbMinBtn = previewNonThumbMaxBtn = previewThumbMinBtn = previewThumbMaxBtn = livePreviewBtn = null;
  _container = null;
}
