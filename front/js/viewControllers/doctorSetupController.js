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
let doctorSetupGloveStatusIndicator, doctorSetupGloveStatus, doctorSetupConnectBtn, doctorSetupDisconnectBtn;
let doctorGreetingText;
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

function getDoctorProfile() {
  try {
    return JSON.parse(localStorage.getItem('auth_profile') || '{}') || {};
  } catch {
    return {};
  }
}

function getGreetingText() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function renderDoctorGreeting() {
  const profile = getDoctorProfile();
  const doctorName = profile.name || profile.email || 'Doctor';
  if (doctorGreetingText) {
    doctorGreetingText.textContent = `${getGreetingText()}, ${doctorName}`;
  }
}

function getAuthHeaders() {
  return _state?.getAuthHeaders ? _state.getAuthHeaders() : {};
}

function setStatus(text) {
  if (doctorSetupGloveStatus && text) {
    doctorSetupGloveStatus.textContent = text;
  }
}

function setDoctorSetupConnectionUi(connected, statusText) {
  if (doctorSetupConnectBtn) {
    doctorSetupConnectBtn.disabled = connected;
    doctorSetupConnectBtn.textContent = connected ? 'Glove Connected' : 'Connect to Glove';
  }
  if (doctorSetupDisconnectBtn) {
    doctorSetupDisconnectBtn.disabled = !connected;
  }
  if (doctorSetupGloveStatusIndicator) {
    doctorSetupGloveStatusIndicator.classList.toggle('online', connected);
  }
  if (doctorSetupGloveStatus && statusText) {
    doctorSetupGloveStatus.textContent = statusText;
  }
  if (captureNonThumbMinBtn) captureNonThumbMinBtn.disabled = !connected;
  if (captureNonThumbMaxBtn) captureNonThumbMaxBtn.disabled = !connected;
  if (captureThumbMinBtn) captureThumbMinBtn.disabled = !connected;
  if (captureThumbMaxBtn) captureThumbMaxBtn.disabled = !connected;
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
  const result = await _state.hydrateDoctorCalibrationFromDatabase();
  renderCalibrationSnapshot();
  renderLiveGrid(_state.latestPacket);
  return result;
}

async function saveDoctorCalibrationToDatabase() {
  const cal = _state.doctorCalibration;
  const doctorId = getDoctorId();
  if (!doctorId) return { remoteSaved: false, reason: 'missing-doctor-id' };

  const minThumb = cal.min[0];
  const maxThumb = cal.max[0];
  const minFingers = {
    index: cal.min[1],
    middle: cal.min[2],
    ring: cal.min[3],
    pinky: cal.min[4],
  };
  const maxFingers = {
    index: cal.max[1],
    middle: cal.max[2],
    ring: cal.max[3],
    pinky: cal.max[4],
  };
  const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  const baseUrl = `${_state.apiBase}/api/doctor-cal/${encodeURIComponent(doctorId)}`;
  const requests = [];

  if (Number.isFinite(minThumb)) {
    requests.push(fetch(`${baseUrl}/min/thumb`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ thumb: minThumb }),
    }));
  }
  if (Object.values(minFingers).every(Number.isFinite)) {
    requests.push(fetch(`${baseUrl}/min/fingers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(minFingers),
    }));
  }
  if (Number.isFinite(maxThumb)) {
    requests.push(fetch(`${baseUrl}/max/thumb`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ thumb: maxThumb }),
    }));
  }
  if (Object.values(maxFingers).every(Number.isFinite)) {
    requests.push(fetch(`${baseUrl}/max/fingers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(maxFingers),
    }));
  }

  if (!requests.length) return { remoteSaved: false, reason: 'incomplete-calibration' };

  const responses = await Promise.all(requests);
  const failed = responses.find(response => !response.ok);
  if (failed) return { remoteSaved: false, reason: `HTTP ${failed.status}` };

  await _state.hydrateDoctorCalibrationFromDatabase();
  return { remoteSaved: true };
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
  _state.loadDoctorCalibration();
  renderCalibrationSnapshot();
  return await saveDoctorCalibrationToDatabase();
}

async function _capturePass(indexes, targetArrayName) {
  if (!_state.isConnected) {
    alert('Connect doctor glove first.');
    return;
  }
  const targetArray = _state.doctorCalibration[targetArrayName];
  indexes.forEach(idx => { targetArray[idx] = _state.latestPacket[idx]; });
  const result = await _saveDoctorCalibration();
  renderCalibrationSnapshot();
  renderLiveGrid(_state.latestPacket);
  if (result.remoteSaved) {
    setStatus(`Doctor glove status: Calibration saved to database for ${getDoctorId()}.`);
  } else {
    setStatus(`Doctor glove status: Calibration captured locally. Database sync failed (${result.reason}).`);
  }
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
  
  // DOM Bindings
  doctorSetupGloveStatusIndicator = _container.querySelector('#doctorSetupGloveStatusIndicator');
  doctorSetupGloveStatus          = _container.querySelector('#doctorSetupGloveStatus');
  doctorSetupConnectBtn           = _container.querySelector('#doctorSetupConnectBtn');
  doctorSetupDisconnectBtn        = _container.querySelector('#doctorSetupDisconnectBtn');
  doctorGreetingText              = _container.querySelector('#doctorGreetingText');
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
  renderDoctorGreeting();
  renderCalibrationSnapshot();
  renderLiveGrid(_state.latestPacket);
  fetchDoctorCalibrationFromDB();
  
  // Connection State Reflection
  setDoctorSetupConnectionUi(_state.isConnected, _state.isConnected ? 'Doctor glove status: Connected.' : null);
  
  // Event Listeners
  doctorSetupConnectBtn.addEventListener('click', async () => {
    doctorSetupConnectBtn.disabled = true;
    if (doctorSetupDisconnectBtn) doctorSetupDisconnectBtn.disabled = true;
    doctorSetupConnectBtn.textContent = 'Connecting...';
    try {
      await _state.connect();
      _state.isConnected = true;
      setDoctorSetupConnectionUi(true, 'Doctor glove status: Connected.');
      await fetchDoctorCalibrationFromDB();
    } catch (err) {
      console.error('[DoctorSetup] Connection failed:', err);
      setDoctorSetupConnectionUi(false, `Connection failed: ${err.message}`);
    }
  });

  doctorSetupDisconnectBtn?.addEventListener('click', () => {
    doctorSetupDisconnectBtn.disabled = true;
    _state.disconnect();
    setDoctorSetupConnectionUi(false, 'Doctor glove status: Disconnected.');
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
      setDoctorSetupConnectionUi(false, 'Doctor glove status: Disconnected.');
      return;
    }
    if (doctorSetupGloveStatus) {
      doctorSetupGloveStatus.textContent = `Doctor glove status: ${msg}`;
    }
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
  
  doctorSetupGloveStatusIndicator = doctorSetupGloveStatus = doctorSetupConnectBtn = doctorSetupDisconnectBtn = null;
  doctorGreetingText = null;
  doctorCalibGrid = doctorLiveGrid = openCalibrationBtn = null;
  captureNonThumbMinBtn = captureNonThumbMaxBtn = captureThumbMinBtn = captureThumbMaxBtn = null;
  previewNonThumbMinBtn = previewNonThumbMaxBtn = previewThumbMinBtn = previewThumbMaxBtn = livePreviewBtn = null;
  _container = null;
}
