/**
 * calibrationController.js — View Controller for the Calibration View
 *
 * Lifted from patient_calibration.html <script type="module"> block.
 * All calibration math, 2-pass capture logic, and API calls are preserved VERBATIM.
 *
 * Changes from the monolithic original:
 *   - Does NOT create its own Three.js scene. Calls engine.setPose() instead.
 *   - Does NOT own a BLE connection. Reads from state.latestPacket and sets state.onPacket.
 *   - Exports mount() / unmount() instead of running inline at page load.
 */

import { FINGER_MAPPING_TABLE } from '../mappingTable.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY         = 'patientCalibrationV1';
const FINGER_LABELS       = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const NON_THUMB_INDEXES   = [1, 2, 3, 4];

// ─── Module-level mutable state ───────────────────────────────────────────────
// These are reset on every mount() so each visit to the view is clean.
let _state       = null;   // GloveState singleton
let _engine      = null;   // ThreeEngine singleton
let _container   = null;   // #view-container DOM node

let _selectedLevel     = 1;
let _previewAngles     = [90, 90, 90, 90, 90];
let _targetAngles      = [90, 90, 90, 90, 90];
let _activePreviewMode = 'none';
let _calibration       = null;

// ─── DOM references (resolved after template injection) ───────────────────────
let connectBtn, clearBtn, levelSelect, previewLevelBtn, previewResetBtn;
let captureNonThumbMinBtn, captureNonThumbMaxBtn;
let captureThumbMinBtn, captureThumbMaxBtn;
let previewNonThumbMinBtn, previewNonThumbMaxBtn;
let previewThumbMinBtn, previewThumbMaxBtn;
let statusEl, levelInfoEl, rawGridEl, snapshotGridEl, readyBadgeEl, capturedAtEl, patientIdBadgeEl;

// ─── Calibration math (preserved VERBATIM from patient_calibration.html) ──────

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** levelToAngle: identical to patient_calibration.html:643 */
function levelToAngle(level) {
  const normalized = _clamp(level, 1, 6) - 1;
  return Math.round((normalized * 90) / 5);
}

/** rawToAngle: identical to patient_calibration.html:648 */
function rawToAngle(rawValue, minValue, maxValue) {
  if (
    !Number.isFinite(rawValue) ||
    !Number.isFinite(minValue) ||
    !Number.isFinite(maxValue) ||
    minValue === maxValue
  ) {
    return null;
  }
  const t = (rawValue - minValue) / (maxValue - minValue);
  const targetMax = Number.isFinite(_calibration.targetMaxAngle) ? _calibration.targetMaxAngle : 90;
  return _clamp(t * targetMax, 0, 90);
}

// ─── Calibration data helpers ─────────────────────────────────────────────────

function _emptyArray() {
  return [null, null, null, null, null];
}

/** loadCalibration: identical logic to patient_calibration.html:396 */
function _loadCalibration() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return _defaultCalibration();
    const parsed = JSON.parse(raw);
    return {
      nonThumbMin:    Array.isArray(parsed.nonThumbMin)    ? parsed.nonThumbMin    : _emptyArray(),
      nonThumbMax:    Array.isArray(parsed.nonThumbMax)    ? parsed.nonThumbMax    : _emptyArray(),
      thumbMin:       Array.isArray(parsed.thumbMin)       ? parsed.thumbMin       : _emptyArray(),
      thumbMax:       Array.isArray(parsed.thumbMax)       ? parsed.thumbMax       : _emptyArray(),
      finalMin:       Array.isArray(parsed.finalMin)       ? parsed.finalMin       : _emptyArray(),
      finalMax:       Array.isArray(parsed.finalMax)       ? parsed.finalMax       : _emptyArray(),
      targetMaxAngle: Number.isFinite(parsed.targetMaxAngle) ? parsed.targetMaxAngle : 90,
      level:          Number.isFinite(parsed.level)          ? parsed.level          : null,
      capturedAt:     parsed.capturedAt || null,
    };
  } catch (err) {
    console.warn('[CalibCtrl] Calibration load failed:', err);
    return _defaultCalibration();
  }
}

function _defaultCalibration() {
  return {
    nonThumbMin: _emptyArray(), nonThumbMax: _emptyArray(),
    thumbMin:    _emptyArray(), thumbMax:    _emptyArray(),
    finalMin:    _emptyArray(), finalMax:    _emptyArray(),
    targetMaxAngle: 90, level: null, capturedAt: null,
  };
}

/** persistCalibrationLocally: identical to patient_calibration.html:441 */
function _persistCalibrationLocally(capturedAt) {
  _calibration.capturedAt = capturedAt || _calibration.capturedAt || new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ..._calibration, capturedAt: _calibration.capturedAt }));
  // Also update GloveState in-memory calibration
  _state.loadCalibration();
}

/**
 * saveCalibration: identical 2-pass merge to patient_calibration.html:449
 * Merges thumbMin/Max and nonThumbMin/Max into finalMin/Max.
 */
async function _saveCalibration() {
  _calibration.finalMin = [
    _calibration.thumbMin[0],
    _calibration.nonThumbMin[1],
    _calibration.nonThumbMin[2],
    _calibration.nonThumbMin[3],
    _calibration.nonThumbMin[4],
  ];
  _calibration.finalMax = [
    _calibration.thumbMax[0],
    _calibration.nonThumbMax[1],
    _calibration.nonThumbMax[2],
    _calibration.nonThumbMax[3],
    _calibration.nonThumbMax[4],
  ];
  _calibration.level          = _selectedLevel;
  _calibration.targetMaxAngle = levelToAngle(_selectedLevel);
  _calibration.capturedAt     = new Date().toISOString();
  _persistCalibrationLocally(_calibration.capturedAt);
  await _savePatientCalibrationToDatabase();
}

/**
 * savePatientCalibrationToDatabase: identical to patient_calibration.html:473
 * Sends 4 split POST requests (min/thumb, min/fingers, max/thumb, max/fingers).
 */
async function _savePatientCalibrationToDatabase() {
  try {
    const minThumb   = _calibration.finalMin[0];
    const maxThumb   = _calibration.finalMax[0];
    const minFingers = {
      index:  _calibration.finalMin[1],
      middle: _calibration.finalMin[2],
      ring:   _calibration.finalMin[3],
      pinky:  _calibration.finalMin[4],
    };
    const maxFingers = {
      index:  _calibration.finalMax[1],
      middle: _calibration.finalMax[2],
      ring:   _calibration.finalMax[3],
      pinky:  _calibration.finalMax[4],
    };
    const payloadLevel = Number.isFinite(_selectedLevel) ? { level: _selectedLevel } : {};
    const patientId    = _state.patientId;
    const apiBase      = _state.apiBase;
    const headers      = { 'Content-Type': 'application/json', ..._state.getAuthHeaders() };
    const requests     = [];

    if (Number.isFinite(minThumb)) {
      requests.push(fetch(`${apiBase}/api/patient-cal/${encodeURIComponent(patientId)}/min/thumb`, {
        method: 'POST', headers,
        body: JSON.stringify({ thumb: minThumb, ...payloadLevel }),
      }));
    }
    if (Object.values(minFingers).every(Number.isFinite)) {
      requests.push(fetch(`${apiBase}/api/patient-cal/${encodeURIComponent(patientId)}/min/fingers`, {
        method: 'POST', headers,
        body: JSON.stringify({ ...minFingers, ...payloadLevel }),
      }));
    }
    if (Number.isFinite(maxThumb)) {
      requests.push(fetch(`${apiBase}/api/patient-cal/${encodeURIComponent(patientId)}/max/thumb`, {
        method: 'POST', headers,
        body: JSON.stringify({ thumb: maxThumb, ...payloadLevel }),
      }));
    }
    if (Object.values(maxFingers).every(Number.isFinite)) {
      requests.push(fetch(`${apiBase}/api/patient-cal/${encodeURIComponent(patientId)}/max/fingers`, {
        method: 'POST', headers,
        body: JSON.stringify({ ...maxFingers, ...payloadLevel }),
      }));
    }

    if (!requests.length) return { remoteSaved: false, reason: 'incomplete-calibration' };

    const responses = await Promise.all(requests);
    const failed    = responses.find(r => !r.ok);
    if (failed) throw new Error(`HTTP ${failed.status}`);
    return { remoteSaved: true };
  } catch (err) {
    console.error('[CalibCtrl] DB save failed:', err);
    return { remoteSaved: false, reason: err?.message || 'db-save-failed' };
  }
}

/**
 * capturePass: identical to patient_calibration.html:763
 * Snapshots latestPacket for the given sensor indexes.
 */
async function _capturePass(indexes, targetArray) {
  if (!_state.isConnected && !_state.broadcastChannel) {
    alert('Connect glove first.');
    return;
  }
  indexes.forEach(idx => { targetArray[idx] = _state.latestPacket[idx]; });
  await _saveCalibration();
  _renderAll();
  _setStatus('Calibration snapshot saved.');
}

// ─── Preview helpers ──────────────────────────────────────────────────────────

function _setPreviewToLevel(level) {
  const angle = levelToAngle(level);
  _activePreviewMode = 'level';
  _targetAngles      = [angle, angle, angle, angle, angle];
  _engine.onModelStatus = () => {};
}

function _previewCalibrationPose(mode) {
  const levelAngle   = levelToAngle(_selectedLevel);
  _activePreviewMode = mode;

  if (mode === 'non-thumb-min') {
    _targetAngles = [levelAngle, 0, 0, 0, 0];
    return;
  }
  if (mode === 'non-thumb-max') {
    _targetAngles = [levelAngle, levelAngle, levelAngle, levelAngle, levelAngle];
    return;
  }
  if (mode === 'thumb-min') {
    _targetAngles = [0, levelAngle, levelAngle, levelAngle, levelAngle];
    return;
  }
  if (mode === 'thumb-max') {
    _targetAngles = [levelAngle, levelAngle, levelAngle, levelAngle, levelAngle];
  }
}

function _resetPreview() {
  _activePreviewMode = 'none';
  _targetAngles      = [90, 90, 90, 90, 90];
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function _setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function _setLevelInfoText() {
  const angle = levelToAngle(_selectedLevel);
  if (levelInfoEl) levelInfoEl.textContent = `Selected level target angle: ${angle}deg (range 0 to 90).`;
  if (captureNonThumbMaxBtn) captureNonThumbMaxBtn.textContent = `Capture Non-Thumb Max (${angle}deg)`;
  if (captureThumbMaxBtn) captureThumbMaxBtn.textContent = `Capture Thumb Max (${angle}deg)`;
}

function _renderRawGrid() {
  if (!rawGridEl) return;
  rawGridEl.innerHTML = '';
  for (let i = 0; i < FINGER_LABELS.length; i++) {
    const minV  = _calibration.finalMin[i];
    const maxV  = _calibration.finalMax[i];
    const angle = rawToAngle(_state.latestPacket[i], minV, maxV);
    const card  = document.createElement('div');
    card.className   = 'mini-card';
    card.innerHTML   = `<strong>${FINGER_LABELS[i]}</strong><div>Raw: ${_state.latestPacket[i]}</div><div>Angle: ${angle === null ? '--' : angle.toFixed(1) + 'deg'}</div>`;
    rawGridEl.appendChild(card);
  }
}

function _renderSnapshotGrid() {
  if (!snapshotGridEl) return;
  snapshotGridEl.innerHTML = '';
  for (let i = 0; i < FINGER_LABELS.length; i++) {
    const minV = Number.isFinite(_calibration.finalMin[i]) ? _calibration.finalMin[i] : '--';
    const maxV = Number.isFinite(_calibration.finalMax[i]) ? _calibration.finalMax[i] : '--';
    const card = document.createElement('div');
    card.className = 'mini-card';
    card.innerHTML = `<strong>${FINGER_LABELS[i]}</strong><div>Min: ${minV}</div><div>Max: ${maxV}</div>`;
    snapshotGridEl.appendChild(card);
  }
  if (capturedAtEl) capturedAtEl.textContent = `Captured at: ${_calibration.capturedAt || '--'}`;
}

function _renderReadyBadge() {
  if (!readyBadgeEl) return;
  const ready = _calibration.finalMin.every(Number.isFinite) && _calibration.finalMax.every(Number.isFinite);
  readyBadgeEl.className   = ready ? 'pill pill-ok' : 'pill pill-warn';
  readyBadgeEl.textContent = ready ? 'Calibration complete' : 'Calibration incomplete';
}

function _renderConnectionState() {
  const connected = _state.isConnected;
  if (connectBtn) {
    connectBtn.disabled    = connected;
    connectBtn.textContent = connected ? 'Connected' : 'Connect to Glove';
  }
  if (captureNonThumbMinBtn) captureNonThumbMinBtn.disabled = !connected;
  if (captureNonThumbMaxBtn) captureNonThumbMaxBtn.disabled = !connected;
  if (captureThumbMinBtn)    captureThumbMinBtn.disabled    = !connected;
  if (captureThumbMaxBtn)    captureThumbMaxBtn.disabled    = !connected;
}

function _renderAll() {
  _renderConnectionState();
  _setLevelInfoText();
  _renderRawGrid();
  _renderSnapshotGrid();
  _renderReadyBadge();
}

// ─── Three.js pose driver ─────────────────────────────────────────────────────

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

// ─── BLE connect ─────────────────────────────────────────────────────────────

async function _handleConnect() {
  if (!connectBtn) return;
  connectBtn.disabled    = true;
  connectBtn.textContent = 'Connecting...';
  _setStatus('Requesting BLE device...');
  try {
    await _state.connect();
    _state.isConnected = true;
    _renderConnectionState();
    await _state.hydrateCalibrationFromDatabase();
    _calibration = _loadCalibration();
    _renderAll();
    _setStatus('Glove connected. Calibration loaded from database.');
  } catch (err) {
    console.error('[CalibCtrl] BLE connect failed:', err);
    _renderConnectionState();
    _setStatus(`Connection failed: ${err?.name || 'Error'} — ${err?.message || 'Unknown'}`);
  }
}

// ─── mount / unmount ──────────────────────────────────────────────────────────

export function mount(container, gloveState, threeEngine) {
  _container = container;
  _state     = gloveState;
  _engine    = threeEngine;

  // Resolve calibration state
  _calibration   = _loadCalibration();
  _selectedLevel = Number.isFinite(_calibration.level) ? _calibration.level : 1;

  // Bind DOM refs
  connectBtn             = container.querySelector('#connectBtn');
  clearBtn               = container.querySelector('#clearBtn');
  levelSelect            = container.querySelector('#levelSelect');
  previewLevelBtn        = container.querySelector('#previewLevelBtn');
  previewResetBtn        = container.querySelector('#previewResetBtn');
  captureNonThumbMinBtn  = container.querySelector('#captureNonThumbMinBtn');
  captureNonThumbMaxBtn  = container.querySelector('#captureNonThumbMaxBtn');
  captureThumbMinBtn     = container.querySelector('#captureThumbMinBtn');
  captureThumbMaxBtn     = container.querySelector('#captureThumbMaxBtn');
  previewNonThumbMinBtn  = container.querySelector('#previewNonThumbMinBtn');
  previewNonThumbMaxBtn  = container.querySelector('#previewNonThumbMaxBtn');
  previewThumbMinBtn     = container.querySelector('#previewThumbMinBtn');
  previewThumbMaxBtn     = container.querySelector('#previewThumbMaxBtn');
  statusEl               = container.querySelector('#calibStatus');
  levelInfoEl            = container.querySelector('#levelInfo');
  rawGridEl              = container.querySelector('#rawGrid');
  snapshotGridEl         = container.querySelector('#snapshotGrid');
  readyBadgeEl           = container.querySelector('#readyBadge');
  capturedAtEl           = container.querySelector('#capturedAt');
  patientIdBadgeEl       = container.querySelector('#patientIdBadge');

  // Set patient ID badge
  if (patientIdBadgeEl) patientIdBadgeEl.textContent = _state.patientId || '--';

  // Set level selector
  if (levelSelect) levelSelect.value = String(_selectedLevel);

  // Wire BLE packet callback
  _state.onPacket = (packet) => {
    _renderRawGrid();
    // Also drive the 3D preview if in live mode
    if (_activePreviewMode === 'live') {
      const angles = packet.map((raw, i) => {
        return rawToAngle(raw, _calibration.finalMin[i], _calibration.finalMax[i]) ?? 0;
      });
      _engine.setPose(_buildPoseFromAngles(angles));
    }
  };

  _state.onConnectionChange = () => _renderConnectionState();

  // Wire Three.js tick — drives preview animations
  _engine.onTick = () => {
    if (_activePreviewMode !== 'none' && _activePreviewMode !== 'live') {
      // Lerp previewAngles toward targetAngles
      const THREE = _engine.THREE;
      _previewAngles = _previewAngles.map((a, i) =>
        THREE.MathUtils.lerp(a, _targetAngles[i], 0.12)
      );
      _engine.setPose(_buildPoseFromAngles(_previewAngles));
    }
  };

  // Event listeners
  connectBtn?.addEventListener('click', _handleConnect);

  clearBtn?.addEventListener('click', () => {
    _calibration.nonThumbMin = _emptyArray();
    _calibration.nonThumbMax = _emptyArray();
    _calibration.thumbMin    = _emptyArray();
    _calibration.thumbMax    = _emptyArray();
    _calibration.finalMin    = _emptyArray();
    _calibration.finalMax    = _emptyArray();
    _calibration.targetMaxAngle = 90;
    _calibration.capturedAt  = null;
    localStorage.removeItem(STORAGE_KEY);
    _state.loadCalibration();
    _renderAll();
    _setStatus('Patient calibration cleared.');
  });

  levelSelect?.addEventListener('change', () => {
    _selectedLevel = Number(levelSelect.value);
    _setLevelInfoText();
  });

  previewLevelBtn?.addEventListener('click', () => { _setPreviewToLevel(_selectedLevel); });
  previewResetBtn?.addEventListener('click', () => { _resetPreview(); _engine.clearPose(); });

  captureNonThumbMinBtn?.addEventListener('click', () =>
    _capturePass(NON_THUMB_INDEXES, _calibration.nonThumbMin));
  captureNonThumbMaxBtn?.addEventListener('click', () =>
    _capturePass(NON_THUMB_INDEXES, _calibration.nonThumbMax));
  captureThumbMinBtn?.addEventListener('click', () =>
    _capturePass([0], _calibration.thumbMin));
  captureThumbMaxBtn?.addEventListener('click', () =>
    _capturePass([0], _calibration.thumbMax));

  previewNonThumbMinBtn?.addEventListener('click', () => _previewCalibrationPose('non-thumb-min'));
  previewNonThumbMaxBtn?.addEventListener('click', () => _previewCalibrationPose('non-thumb-max'));
  previewThumbMinBtn?.addEventListener('click',    () => _previewCalibrationPose('thumb-min'));
  previewThumbMaxBtn?.addEventListener('click',    () => _previewCalibrationPose('thumb-max'));

  // Initial render
  _renderAll();
  _setStatus('Connect glove, select level preview, then capture min/max.');
}

export function unmount() {
  // Detach GloveState callbacks so the next view gets a clean slate
  if (_state) {
    _state.onPacket           = null;
    _state.onStatus           = null;
    _state.onConnectionChange = null;
  }
  // Detach ThreeEngine tick callback
  if (_engine) {
    _engine.onTick        = null;
    _engine.onModelStatus = null;
    _engine.clearPose();
  }
  _container = null;
}
