/**
 * exerciseLiveController.js
 *
 * View controller for the Real-Time Session view.
 *
 * In this mode:
 *   • There is NO loop animation.  engine.onTick is NOT used.
 *   • state.onPacket receives every BLE packet, computes angles from the
 *     patient's personal calibration range, updates the raw grid,
 *     updates the live match bars, and calls engine.setPose() to mirror
 *     the hand in 3D in real time.
 *
 * Memory-leak contract:
 *   unmount() nullifies state.onPacket and state.onStatus.
 *   engine.onTick is explicitly set to null (was never set, but safeguarded).
 *   No setInterval or setTimeout is used.
 */

import { FINGER_MAPPING_TABLE } from '../mappingTable.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const FINGER_LABELS     = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const PATIENT_CALIB_KEY = 'patientCalibrationV1';

// ─── Module-level mutable state ───────────────────────────────────────────────
let _state     = null;
let _engine    = null;
let _container = null;

let _patientCalibration = {
  finalMin:   [null, null, null, null, null],
  finalMax:   [null, null, null, null, null],
  ready:      false,
  capturedAt: null,
};

// Optional manual reference target (null = show raw range bars only)
let _manualRefAngle = null;

// ─── DOM references ───────────────────────────────────────────────────────────
let liveStatusEl, liveGloveStatusEl, liveCalibStatusEl, liveForceStatusEl;
let liveRawGridEl, liveMatchGridEl, liveOverallBadgeEl;
let liveConnectGloveBtn, liveLoadCalibBtn, fetchForceBtn;
let liveRefAngleInput, applyLiveRefBtn, clearLiveRefBtn;
let mqttToggleBtn;

// MQTT publisher state (initialized when user clicks MQTT button)
let _mqttClient = null;
let _mqttConnected = false;
const MQTT_BROKER_URL = 'wss://f13259acb4eb4d23a9ccdd68b977301c.s1.eu.hivemq.cloud:8884/mqtt';
const MQTT_USERNAME = 'Glovexl';
const MQTT_PASSWORD = '200209Ost';
const MQTT_TOPIC = 'project/glove01/status';

// ═══════════════════════════════════════════════════════════════════════════════
// MATH HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * rawToAngle
 * Maps a single raw ADC sensor value to an angle in degrees using the patient's
 * personal calibrated min/max range, scaled to 0–90deg.
 * Returns null if calibration is missing or degenerate.
 */
function rawToAngle(raw, minV, maxV) {
  if (
    !Number.isFinite(raw) ||
    !Number.isFinite(minV) ||
    !Number.isFinite(maxV) ||
    minV === maxV
  ) {
    return null;
  }
  const t = clamp((raw - minV) / (maxV - minV), 0, 1);
  return t * 90;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATIENT CALIBRATION
// ═══════════════════════════════════════════════════════════════════════════════

function loadPatientCalibrationFromStorage() {
  try {
    const raw = localStorage.getItem(PATIENT_CALIB_KEY);
    if (!raw) {
      _patientCalibration = { finalMin: [null,null,null,null,null], finalMax: [null,null,null,null,null], ready: false, capturedAt: null };
      return;
    }
    const parsed   = JSON.parse(raw);
    const finalMin = Array.isArray(parsed.finalMin) ? parsed.finalMin : [null,null,null,null,null];
    const finalMax = Array.isArray(parsed.finalMax) ? parsed.finalMax : [null,null,null,null,null];
    const ready    = finalMin.every(Number.isFinite) && finalMax.every(Number.isFinite);
    _patientCalibration = { finalMin, finalMax, ready, capturedAt: parsed.capturedAt || null };
  } catch (err) {
    console.warn('[LiveCtrl] Failed to load patient calibration:', err);
    _patientCalibration = { finalMin: [null,null,null,null,null], finalMax: [null,null,null,null,null], ready: false, capturedAt: null };
  }
}

function _resolveCalibration() {
  const sc = _state?.patientCalibration;
  if (sc?.ready && Array.isArray(sc.finalMin) && Array.isArray(sc.finalMax)) {
    _patientCalibration = {
      finalMin:   sc.finalMin,
      finalMax:   sc.finalMax,
      capturedAt: sc.capturedAt || null,
      ready:      true,
    };
  } else {
    loadPatientCalibrationFromStorage();
  }
}

function _renderCalibrationBanner() {
  _container?.querySelector('.calib-warning-banner')?.remove();
  if (_patientCalibration.ready) return;

  const banner = document.createElement('div');
  banner.className = 'calib-warning-banner';
  banner.innerHTML = `
    <span class="calib-warning-icon" aria-hidden="true">⚠️</span>
    <div class="calib-warning-body">
      <strong>Glove not calibrated.</strong>
      Real-time angles cannot be computed without calibration data.
      The 3D hand will mirror raw packet values until you calibrate.
      <br />
      <button type="button" class="calib-warning-link">Go to Calibration tab →</button>
    </div>
    <button type="button" class="calib-warning-dismiss" aria-label="Dismiss banner">✕</button>`;

  banner.querySelector('.calib-warning-link')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('spa:navigate', { detail: { route: 'calibration' } }));
  });
  banner.querySelector('.calib-warning-dismiss')?.addEventListener('click', () => banner.remove());

  const statusBar = _container?.querySelector('.status-bar');
  if (statusBar) statusBar.insertAdjacentElement('afterend', banner);
  else _container?.prepend(banner);
}

function renderCalibStatus() {
  if (!liveCalibStatusEl) return;
  liveCalibStatusEl.textContent = _patientCalibration.ready
    ? `Patient calibration status: Ready (captured: ${_patientCalibration.capturedAt || 'unknown'}).`
    : 'Patient calibration status: Not loaded. Open Calibration view first.';
}

async function hydratePatientCalibrationFromDatabase() {
  try {
    let resp = await fetch(
      `${_state.apiBase}/api/patient-cal/${encodeURIComponent(_state.patientId)}`,
      { headers: _state.getAuthHeaders() }
    );
    
    let is404 = resp.status === 404;
    let doc = null;
    if (resp.ok) {
      doc = await resp.json();
    }

    const isCalibrationEmpty = (d) => {
      if (!d) return true;
      const keys = ['thumb', 'index', 'middle', 'ring', 'pinky'];
      const minAllZero = keys.every(k => !d.min || Number(d.min[k]) === 0);
      const maxAllZero = keys.every(k => !d.max || Number(d.max[k]) === 0);
      return minAllZero && maxAllZero;
    };

    if (is404 || isCalibrationEmpty(doc)) {
      const fallbackResp = await fetch(
        `${_state.apiBase}/api/patient-cal/PAT-a7a19957fb68446f8314d672bfccfa8b`,
        { headers: _state.getAuthHeaders() }
      );
      if (fallbackResp.ok) {
        doc = await fallbackResp.json();
      }
    }

    if (!doc) return;

    const min  = doc?.min || {};
    const max  = doc?.max || {};
    const keys = ['thumb', 'index', 'middle', 'ring', 'pinky'];

    const finalMin = keys.map(k => { const v = Number(min[k]); return Number.isFinite(v) ? v : null; });
    const finalMax = keys.map(k => { const v = Number(max[k]); return Number.isFinite(v) ? v : null; });
    const ready    = finalMin.every(Number.isFinite) && finalMax.every(Number.isFinite);

    _patientCalibration = { finalMin, finalMax, ready, capturedAt: doc?.updatedAt || null };

    // Also sync into the shared GloveState for other views
    _state.patientCalibration = {
      finalMin, finalMax, ready, capturedAt: doc?.updatedAt || null,
    };

    renderCalibStatus();
    _renderCalibrationBanner();
    const packet = _state.latestPacket || [0,0,0,0,0];
    renderRawGrid(packet);
    renderLiveMatchGrid(packet);
    if (_engine.isModelLoaded && ready) {
      _engine.setPose(buildPoseFromPacket(packet));
    }
  } catch (error) {
    console.error('[LiveCtrl] Failed to fetch patient calibration from DB:', error);
  }
}

async function fetchAndApplyForce() {
  if (!_state) return;
  
  if (liveForceStatusEl) {
    liveForceStatusEl.textContent = 'Fetching force level...';
  }
  
  try {
    const apiBase = _state.apiBase;
    const headers = _state.getAuthHeaders();
    const patientId = 'PAT-a7a19957fb68446f8314d672bfccfa8b';
    const resp = await fetch(`${apiBase}/api/forces?patient_id=${patientId}`, { headers });
    
    if (resp.status === 404) {
      if (liveForceStatusEl) {
        liveForceStatusEl.textContent = 'Resistive force level: Not set yet in database.';
      }
      alert('No force level has been set by the doctor yet.');
      return;
    }

    if (resp.ok) {
      const data = await resp.json();
      const level = data?.level;
      if (Number.isFinite(level) && level >= 1 && level <= 10) {
        if (!_state.isConnected || !_state.bleClient) {
          if (liveForceStatusEl) {
            liveForceStatusEl.textContent = `Resistive force level: ${level} (glove disconnected).`;
          }
          alert(`Fetched force level ${level}, but patient glove is not connected. Please connect the glove first.`);
          return;
        }

        console.log(`[LiveCtrl] Applying manual fetched force level ${level} to patient glove`);
        await _state.bleClient.sendMotorLevel(level);
        
        if (liveForceStatusEl) {
          liveForceStatusEl.textContent = `Resistive force level: ${level} (applied to motor).`;
        }
        setStatus(`Force level ${level} fetched and applied to motor.`);
        alert(`Successfully fetched and applied force level ${level} to the glove motor.`);
      } else {
        if (liveForceStatusEl) {
          liveForceStatusEl.textContent = 'Resistive force level: Invalid or not set.';
        }
        alert('Active force level in database is not set or invalid.');
      }
    } else {
      throw new Error(`Server returned ${resp.status}`);
    }
  } catch (err) {
    console.error('[LiveCtrl] Error fetching active force:', err);
    if (liveForceStatusEl) {
      liveForceStatusEl.textContent = 'Failed to fetch force level.';
    }
    alert(`Failed to fetch force level: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function setStatus(text) {
  if (liveStatusEl) liveStatusEl.textContent = text;
}

/**
 * renderRawGrid
 * Shows per-finger raw ADC value and computed angle for each finger.
 */
function renderRawGrid(packet) {
  if (!liveRawGridEl) return;
  liveRawGridEl.innerHTML = '';

  for (let i = 0; i < FINGER_LABELS.length; i += 1) {
    const raw   = packet[i];
    const minV  = _patientCalibration.finalMin[i];
    const maxV  = _patientCalibration.finalMax[i];
    const angle = rawToAngle(raw, minV, maxV);

    const card = document.createElement('div');
    card.className = 'mini-card';
    card.innerHTML = `
      <strong>${FINGER_LABELS[i]}</strong>
      <div>Raw: ${Number.isFinite(raw) ? raw : '--'}</div>
      <div>Angle: ${angle !== null ? angle.toFixed(1) + 'deg' : '--'}</div>`;
    liveRawGridEl.appendChild(card);
  }
}

/**
 * renderLiveMatchGrid
 * Renders a bar per finger.
 *
 * Two display modes:
 *   • No ref target  → bar width = raw calibration range fraction (0–90deg), blue fill
 *   • With ref target → bar width = match score vs reference angle, green/amber/red fill
 */
function renderLiveMatchGrid(packet) {
  if (!liveMatchGridEl) return;
  liveMatchGridEl.innerHTML = '';

  const useRef = _manualRefAngle !== null && Number.isFinite(_manualRefAngle);

  let sumScore   = 0;
  let validCount = 0;

  for (let i = 0; i < FINGER_LABELS.length; i += 1) {
    const raw   = packet[i];
    const minV  = _patientCalibration.finalMin[i];
    const maxV  = _patientCalibration.finalMax[i];
    const angle = rawToAngle(raw, minV, maxV);

    let fillPct   = 0;
    let fillColor = '#4e8ef7';  // brand blue (no-ref mode)
    let score     = 0;

    if (angle !== null) {
      if (useRef) {
        const refAngle  = clamp(_manualRefAngle, 0, 90);
        const tolerance = Math.max(5, refAngle * 0.1);
        score           = clamp(1 - Math.max(0, refAngle - angle) / (tolerance * 2), 0, 1);
        fillPct         = score * 100;
        fillColor       = score >= 0.75 ? '#28a745' : (score >= 0.45 ? '#d18a00' : '#d94e4e');
      } else {
        // Simple range bar: 0deg → 0%, 90deg → 100%
        fillPct   = clamp((angle / 90) * 100, 0, 100);
        fillColor = '#4e8ef7';
        score     = angle / 90;
      }
      sumScore   += score;
      validCount += 1;
    }

    const fill = document.createElement('div');
    fill.className           = 'bar-fill';
    fill.style.width         = `${fillPct.toFixed(0)}%`;
    fill.style.backgroundColor = fillColor;

    const track = document.createElement('div');
    track.className = 'bar-track';
    track.appendChild(fill);

    const card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML = `
      <strong>${FINGER_LABELS[i]}</strong>
      <div>Raw: ${Number.isFinite(raw) ? raw : '--'}</div>
      <div>Angle: ${angle !== null ? angle.toFixed(1) + 'deg' : '--'}</div>
      ${useRef ? `<div>Ref: ${_manualRefAngle.toFixed(0)}deg</div>` : ''}`;
    card.appendChild(track);
    liveMatchGridEl.appendChild(card);
  }

  // Overall badge
  if (!liveOverallBadgeEl) return;
  if (validCount === 0) {
    liveOverallBadgeEl.textContent       = 'Overall: --';
    liveOverallBadgeEl.style.color       = '#9a6700';
    liveOverallBadgeEl.style.background  = '#fff7e0';
    liveOverallBadgeEl.style.borderColor = '#f0d491';
    return;
  }

  const overall = sumScore / validCount;
  if (useRef) {
    liveOverallBadgeEl.textContent       = `Overall Match: ${(overall * 100).toFixed(0)}%`;
    liveOverallBadgeEl.style.color       = overall >= 0.75 ? '#166f3f' : (overall >= 0.45 ? '#9a6700' : '#8a1f1f');
    liveOverallBadgeEl.style.background  = overall >= 0.75 ? '#e8f7ef' : (overall >= 0.45 ? '#fff7e0' : '#fdecec');
    liveOverallBadgeEl.style.borderColor = overall >= 0.75 ? '#b7e3c9' : (overall >= 0.45 ? '#f0d491' : '#f2b7b7');
  } else {
    liveOverallBadgeEl.textContent       = `Avg Extension: ${(overall * 100).toFixed(0)}%`;
    liveOverallBadgeEl.style.color       = '#1a56a0';
    liveOverallBadgeEl.style.background  = '#e8f0fe';
    liveOverallBadgeEl.style.borderColor = '#b3cffc';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3D POSE — drive the persistent hand rig from live BLE data
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * buildPoseFromPacket
 * Converts raw packet values directly into the pose format expected by
 * HandRigController.applyFingerPose().
 *
 * Mirrors the logic in renderLoop (patient_exercise.html:1298-1309) but
 * uses raw-to-angle mapping via patient calibration instead of a loop wave.
 */
function buildPoseFromPacket(packet) {
  return FINGER_MAPPING_TABLE.map((row, index) => {
    const minV  = _patientCalibration.finalMin[index];
    const maxV  = _patientCalibration.finalMax[index];
    const angle = rawToAngle(packet[index], minV, maxV) ?? 0;

    // angle is 0 (open) → 90 (closed); baseAngle flips for the rig
    const baseAngle  = Math.max(0, Math.min(90, 90 - angle));
    const spreadSign = row.spreadInvert ? -1 : 1;
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

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

export function mount(container, gloveState, threeEngine) {
  _container      = container;
  _state          = gloveState;
  _engine         = threeEngine;
  _manualRefAngle = null;

  // Priority: use GloveState's in-memory calibration (set by calibration view),
  // falling back to localStorage if the user hasn't calibrated this session.
  _resolveCalibration();

  // ── Bind DOM refs (ALL via container.querySelector) ──────────────────
  liveStatusEl        = container.querySelector('#liveStatus');
  liveGloveStatusEl   = container.querySelector('#liveGloveStatus');
  liveCalibStatusEl   = container.querySelector('#liveCalibStatus');
  liveForceStatusEl   = container.querySelector('#liveForceStatus');
  liveRawGridEl       = container.querySelector('#liveRawGrid');
  liveMatchGridEl     = container.querySelector('#liveMatchGrid');
  liveOverallBadgeEl  = container.querySelector('#liveOverallBadge');
  liveConnectGloveBtn = container.querySelector('#liveConnectGloveBtn');
  liveLoadCalibBtn    = container.querySelector('#liveLoadCalibBtn');
  fetchForceBtn       = container.querySelector('#fetchForceBtn');
  mqttToggleBtn       = container.querySelector('#mqttToggleBtn');
  liveRefAngleInput   = container.querySelector('#liveRefAngle');
  applyLiveRefBtn     = container.querySelector('#applyLiveRefBtn');
  clearLiveRefBtn     = container.querySelector('#clearLiveRefBtn');

  // ── Reflect existing BLE connection state ─────────────────────────────
  if (_state.isConnected && liveConnectGloveBtn) {
    liveConnectGloveBtn.textContent = 'Glove Connected';
    liveConnectGloveBtn.disabled    = true;
    if (liveGloveStatusEl) liveGloveStatusEl.textContent = 'Patient glove status: Connected.';
  }

  // ── Wire GloveState callbacks ─────────────────────────────────────────

  _state.onPacket = (packet) => {
    // Real-time: every packet drives both the UI and the 3D hand
    renderRawGrid(packet);
    renderLiveMatchGrid(packet);
    if (_engine.isModelLoaded) {
      _engine.setPose(buildPoseFromPacket(packet));
    }
    // Publish to MQTT when enabled/connected
    if (_mqttClient && _mqttConnected) {
      try {
        const buffer = new ArrayBuffer(10);
        const view = new DataView(buffer);
        for (let i = 0; i < 5; i += 1) {
          const v = Number(packet[i]) || 0;
          view.setUint16(i * 2, v & 0xffff, true);
        }
        _mqttClient.publish(MQTT_TOPIC, new Uint8Array(buffer), { qos: 0, retain: false });
      } catch (err) {
        console.warn('[MQTT] publish failed', err);
      }
    }
  };

  _state.onStatus = (msg) => {
    if (liveGloveStatusEl) liveGloveStatusEl.textContent = `Patient glove status: ${msg}`;
    if (msg === 'Disconnected' && liveConnectGloveBtn) {
      liveConnectGloveBtn.disabled    = false;
      liveConnectGloveBtn.textContent = 'Reconnect Patient Glove';
    }
  };

  // ── engine.onTick is explicitly NOT set — no animation loop needed ────
  _engine.onTick = null;

  // ── Event listeners ───────────────────────────────────────────────────

  liveConnectGloveBtn?.addEventListener('click', async () => {
    liveConnectGloveBtn.disabled    = true;
    liveConnectGloveBtn.textContent = 'Connecting...';
    try {
      await _state.connect();
      _state.isConnected              = true;
      liveConnectGloveBtn.textContent = 'Glove Connected';
      if (liveGloveStatusEl) liveGloveStatusEl.textContent = 'Patient glove status: Connected.';
      await hydratePatientCalibrationFromDatabase();
      setStatus('Glove connected. Monitoring live sensor stream in real time.');
    } catch (error) {
      console.error('[LiveCtrl] BLE connect failed:', error);
      _state.isConnected              = false;
      liveConnectGloveBtn.textContent = 'Connect Patient Glove';
      liveConnectGloveBtn.disabled    = false;
      setStatus(`Connection failed: ${error?.name || 'Error'} - ${error?.message || 'Unknown'}`);
    }
  });

  liveLoadCalibBtn?.addEventListener('click', () => {
    _resolveCalibration();   // GloveState-first, localStorage fallback
    renderCalibStatus();
    _renderCalibrationBanner();  // Removes banner if now ready
    const packet = _state.latestPacket || [0,0,0,0,0];
    renderRawGrid(packet);
    renderLiveMatchGrid(packet);
    setStatus(
      _patientCalibration.ready
        ? 'Patient calibration loaded. Angles now computed.'
        : 'Patient calibration not found. Open Calibration view first.'
    );
  });

  fetchForceBtn?.addEventListener('click', fetchAndApplyForce);

  applyLiveRefBtn?.addEventListener('click', () => {
    const v = Number(liveRefAngleInput?.value);
    if (Number.isFinite(v) && v >= 0 && v <= 90) {
      _manualRefAngle = v;
      const packet = _state.latestPacket || [0,0,0,0,0];
      renderLiveMatchGrid(packet);
      setStatus(`Manual reference target set to ${v.toFixed(0)}deg.`);
    }
  });

  clearLiveRefBtn?.addEventListener('click', () => {
    _manualRefAngle = null;
    const packet = _state.latestPacket || [0,0,0,0,0];
    renderLiveMatchGrid(packet);
    setStatus('Manual reference target cleared. Showing raw extension range.');
  });

  // MQTT toggle (connect / disconnect) — publishes binary packets when connected
  mqttToggleBtn?.addEventListener('click', () => {
    if (!_mqttConnected) {
      if (!globalThis.mqtt) {
        setStatus('MQTT library not loaded in page.');
        return;
      }
      setStatus('Connecting to MQTT broker...');
      try {
        _mqttClient = globalThis.mqtt.connect(MQTT_BROKER_URL, {
          username: MQTT_USERNAME,
          password: MQTT_PASSWORD,
          clientId: 'patient_' + Math.random().toString(16).substring(2,8),
          reconnectPeriod: 2000,
        });

        _mqttClient.on('connect', () => {
          _mqttConnected = true;
          mqttToggleBtn.textContent = 'MQTT: Connected';
          mqttToggleBtn.classList.remove('btn-secondary');
          setStatus('Connected to MQTT broker — streaming enabled.');
        });

        _mqttClient.on('error', (err) => {
          console.warn('[MQTT] error', err);
          setStatus('MQTT error');
        });

        _mqttClient.on('close', () => {
          _mqttConnected = false;
          mqttToggleBtn.textContent = 'MQTT';
          mqttToggleBtn.classList.add('btn-secondary');
          setStatus('MQTT disconnected');
        });
      } catch (err) {
        console.warn('[MQTT] init failed', err);
        setStatus('MQTT init failed');
      }
    } else {
      try { _mqttClient.end(true); } catch (e) { /* ignore */ }
      _mqttClient = null;
      _mqttConnected = false;
      mqttToggleBtn.textContent = 'MQTT';
      mqttToggleBtn.classList.add('btn-secondary');
      setStatus('MQTT disconnected');
    }
  });

  // ── Initial render ────────────────────────────────────────────────
  renderCalibStatus();
  _renderCalibrationBanner();    // Show immediately if not calibrated
  const initialPacket = _state.latestPacket || [0,0,0,0,0];
  renderRawGrid(initialPacket);
  renderLiveMatchGrid(initialPacket);
  if (_engine.isModelLoaded && _patientCalibration.ready) {
    _engine.setPose(buildPoseFromPacket(initialPacket));
  }
  setStatus('Connect the patient glove to begin real-time monitoring.');

  // Try to load latest DB calibration on load (non-blocking)
  hydratePatientCalibrationFromDatabase();
}

export function unmount() {
  // ── Memory-leak contract ──────────────────────────────────────────────
  // 1. Null GloveState callbacks
  if (_state) {
    _state.onPacket           = null;
    _state.onStatus           = null;
    _state.onConnectionChange = null;
  }
  // 2. Null ThreeEngine callbacks (onTick was never set, but safety guard)
  if (_engine) {
    _engine.onTick        = null;
    _engine.onModelStatus = null;
    _engine.clearPose();
  }
  // Disconnect MQTT client if present
  if (_mqttClient) {
    try { _mqttClient.end(true); } catch (e) { /* ignore */ }
    _mqttClient = null;
    _mqttConnected = false;
  }
  // 3. No window-level listeners were added by this controller.
  // 4. Null all DOM refs to break stale closure chains
  liveStatusEl = liveGloveStatusEl = liveCalibStatusEl = liveForceStatusEl = null;
  liveRawGridEl = liveMatchGridEl = liveOverallBadgeEl = null;
  liveConnectGloveBtn = liveLoadCalibBtn = fetchForceBtn = null;
  mqttToggleBtn = null;
  liveRefAngleInput = applyLiveRefBtn = clearLiveRefBtn = null;
  _container = null;
}
