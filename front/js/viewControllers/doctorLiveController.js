/**
 * doctorLiveController.js
 *
 * View controller for the Live Assessment.
 * Mirrors the doctor's live glove movement and checks compliance against targets.
 */

import { FINGER_MAPPING_TABLE } from '../mappingTable.js';

const FINGER_LABELS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

let _state = null;
let _engine = null;
let _container = null;

let fallbackPatientCalib = null;

// DOM refs
let defaultTargetInput, setDoctorTargetBtn, resetLiveTargetBtn, setTargetToast;
let targetSourceLabel, repSetStatus, resetRepsBtn;
let startAssessmentBtn, stopAssessmentBtn, resetPeaksBtn, saveBaselineBtn, assessmentStatus;
let matchGrid, peakGrid;
let mqttHostInput, mqttTopicInput, mqttUsernameInput, mqttPasswordInput;
let mqttConnectBtn, mqttDisconnectBtn, mqttStatusLabel, mqttRateLabel;
let mqttRawMinInput, mqttRawMaxInput, mqttDriveModelCheckbox;

// MQTT Client State
let mqttClient = null;
let mqttMsgCounter = 0;
let mqttHzInterval = null;

// Assessment State
let activeDoctorTargets = [90, 90, 90, 90, 90];
let currentReps = 0;
let currentSets = 0;
let repLatched = false;
let disqualifyRep = false;
let assessmentActive = false;
let patientCapturedMin = [90, 90, 90, 90, 90];
let patientCapturedMax = [0, 0, 0, 0, 0];

// Thresholds
const SAFE_LOW = 0.95;
const SAFE_HIGH = 1.05;
const LATCH_ENTRY = 0.95;
const RELEASE_THRESHOLD = 0.40;

// ── Math Helpers ──
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function rawToAngle(rawValue, minValue, maxValue) {
  if (minValue === null || maxValue === null || minValue === maxValue) return null;
  const t = (rawValue - minValue) / (maxValue - minValue);
  return clamp(t * 90, 0, 90);
}

async function fetchFallbackPatientCalibration() {
  try {
    const apiBase = _state.apiBase;
    const headers = _state.getAuthHeaders();
    const resp = await fetch(`${apiBase}/api/patient-cal/PAT-a7a19957fb68446f8314d672bfccfa8b`, { headers });
    if (resp.ok) {
      const doc = await resp.json();
      const min = doc?.min || {};
      const max = doc?.max || {};
      const keys = ['thumb', 'index', 'middle', 'ring', 'pinky'];
      
      fallbackPatientCalib = {
        min: keys.map(k => Number.isFinite(Number(min[k])) ? Number(min[k]) : null),
        max: keys.map(k => Number.isFinite(Number(max[k])) ? Number(max[k]) : null)
      };
    }
  } catch (err) {
    console.error('Failed to load fallback patient calibration:', err);
  }
}

function getDefaultTarget() {
  const v = parseInt(defaultTargetInput?.value ?? '90', 10);
  return Number.isFinite(v) && v >= 0 && v <= 90 ? v : 90;
}

function getCurrentAngles(packet) {
  const cal = _state.doctorCalibration;
  if (!cal || !cal.ready) return [null, null, null, null, null];
  
  return packet.map((raw, i) => {
    const angle = rawToAngle(raw, cal.min[i], cal.max[i]);
    return angle === null ? null : Number(angle.toFixed(1));
  });
}

function buildPoseFromAngles(angles) {
  return FINGER_MAPPING_TABLE.map((row, index) => {
    const angle = angles[index] ?? 0;
    const baseAngle = Math.max(0, Math.min(90, 90 - angle));
    const spreadSign = row.spreadInvert ? -1 : 1;
    return {
      fingerName: row.fingerName,
      rawValue: 0,
      baseAngle,
      midAngle: baseAngle * row.midRatio,
      tipAngle: baseAngle * row.tipRatio,
      spreadAngle: row.isThumb ? row.spreadAmount * spreadSign : 0,
    };
  });
}

// ── UI Updaters ──
function showToast(msg, type) {
  if (!setTargetToast) return;
  setTargetToast.textContent = msg;
  setTargetToast.style.backgroundColor = type === 'ok' ? 'var(--c-ok)' : 'var(--c-warn)';
  setTargetToast.style.opacity = '1';
  setTimeout(() => { if (setTargetToast) setTargetToast.style.opacity = '0'; }, 3000);
}

function updateTargetSourceLabel() {
  if (!targetSourceLabel) return;
  const def = getDefaultTarget();
  const allDefault = activeDoctorTargets.every(t => t === def);
  targetSourceLabel.textContent = allDefault
    ? `(default ${def}° target)`
    : `(doctor targets: ${activeDoctorTargets.join('°, ')}°)`;
}

function updateRepSetStatus(warn) {
  if (!repSetStatus) return;
  repSetStatus.textContent = `Reps: ${currentReps} / --  |  Sets: ${currentSets} / --`;
  if (warn) {
    repSetStatus.classList.add('warning');
    setTimeout(() => { if (repSetStatus) repSetStatus.classList.remove('warning'); }, 1600);
  } else {
    repSetStatus.classList.remove('warning');
  }
}

function initGrids() {
  if (matchGrid) {
    matchGrid.innerHTML = FINGER_LABELS.map((label, i) => `
      <div class="match-row">
        <span class="match-label">${label}</span>
        <div class="match-bar-track">
          <div class="match-bar-fill" id="mBar${i}"></div>
          <div class="match-ceiling-line"></div>
        </div>
        <span class="match-value" id="mVal${i}">0° / 90°</span>
      </div>
    `).join('');
  }
  
  if (peakGrid) {
    peakGrid.innerHTML = FINGER_LABELS.map((label, i) => `
      <div class="peak-card">
        <div style="font-size:14px; font-weight:600; color:#fff; margin-bottom:8px;">${label}</div>
        <div class="peak-card-row"><span style="color:var(--c-text-muted);">Min</span><span id="pMin${i}" style="color:#3b82f6;">90.0°</span></div>
        <div class="peak-card-row"><span style="color:var(--c-text-muted);">Max</span><span id="pMax${i}" style="color:#f59e0b;">0.0°</span></div>
        <div class="peak-card-row"><span style="color:var(--c-text-muted);">Live</span><span id="pLive${i}" style="color:#22c55e;">--</span></div>
      </div>
    `).join('');
  }
}

function processLiveStream(angles) {
  // Peak Detection
  if (assessmentActive) {
    angles.forEach((angle, i) => {
      if (angle !== null) {
        if (angle < patientCapturedMin[i]) patientCapturedMin[i] = angle;
        if (angle > patientCapturedMax[i]) patientCapturedMax[i] = angle;
      }
    });
  }

  // Rep State Machine
  const ratios = angles.map((a, i) => {
    const t = activeDoctorTargets[i];
    return a !== null && t > 0 ? a / t : 0;
  });

  const allInSafeZone = ratios.every(r => r >= LATCH_ENTRY);
  const anyOverFlex = ratios.some(r => r > SAFE_HIGH);
  const allReleased = ratios.every(r => r <= RELEASE_THRESHOLD);

  if (!repLatched) {
    if (allInSafeZone) {
      repLatched = true;
      disqualifyRep = false;
    }
  } else {
    if (anyOverFlex) disqualifyRep = true;
    if (allReleased) {
      repLatched = false;
      if (disqualifyRep) {
        disqualifyRep = false;
        updateRepSetStatus(true); // Flash warning
      } else {
        currentReps++;
        updateRepSetStatus(false);
      }
    }
  }

  // Render Match Grid
  angles.forEach((angle, i) => {
    const target = activeDoctorTargets[i];
    const ratio = angle !== null ? angle / target : 0;
    const fillPct = Math.min((ratio / 1.2) * 100, 100);

    let color = '#93c5fd';
    let overFlex = false;
    if (ratio > SAFE_HIGH) { color = 'var(--c-danger)'; overFlex = true; }
    else if (ratio >= SAFE_LOW) { color = 'var(--c-ok)'; }
    else if (ratio >= 0.5) { color = '#3b82f6'; }

    const barEl = _container?.querySelector(`#mBar${i}`);
    const valEl = _container?.querySelector(`#mVal${i}`);
    
    if (barEl) {
      barEl.style.width = `${fillPct}%`;
      if (overFlex) {
        barEl.classList.add('overflex');
        barEl.style.backgroundColor = '';
      } else {
        barEl.classList.remove('overflex');
        barEl.style.backgroundColor = color;
      }
    }
    
    if (valEl) {
      valEl.textContent = `${angle !== null ? angle.toFixed(1) : '--'}° / ${target}°`;
      valEl.style.color = overFlex ? 'var(--c-danger)' : color;
    }
  });

  // Render Peak Grid
  angles.forEach((angle, i) => {
    const minEl = _container?.querySelector(`#pMin${i}`);
    const maxEl = _container?.querySelector(`#pMax${i}`);
    const liveEl = _container?.querySelector(`#pLive${i}`);

    if (minEl) minEl.textContent = assessmentActive || patientCapturedMin[i] < 90 ? `${patientCapturedMin[i].toFixed(1)}°` : '--';
    if (maxEl) maxEl.textContent = assessmentActive || patientCapturedMax[i] > 0 ? `${patientCapturedMax[i].toFixed(1)}°` : '--';
    if (liveEl) liveEl.textContent = angle !== null ? `${angle.toFixed(1)}°` : '--';
  });
}

function renderCalibrationBanner() {
  _container?.querySelector('.calib-warning-banner')?.remove();
  if (_state.doctorCalibration && _state.doctorCalibration.ready) return;

  const banner = document.createElement('div');
  banner.className = 'calib-warning-banner';
  banner.innerHTML = `
    <span class="calib-warning-icon" aria-hidden="true">⚠️</span>
    <div class="calib-warning-body">
      <strong>Doctor not calibrated.</strong>
      Live angles cannot be computed until the doctor glove is calibrated.
      <br />
      <button type="button" class="calib-warning-link">Go to Setup tab →</button>
    </div>
    <button type="button" class="calib-warning-dismiss" aria-label="Dismiss banner">✕</button>`;

  banner.querySelector('.calib-warning-link')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('spa:navigate', { detail: { route: 'doctor-setup' } }));
  });
  banner.querySelector('.calib-warning-dismiss')?.addEventListener('click', () => banner.remove());

  const viewHeader = _container?.querySelector('.view-header');
  if (viewHeader) viewHeader.insertAdjacentElement('afterend', banner);
}

// ── Exported Lifecycle ──

export function mount(container, gloveState, threeEngine) {
  _container = container;
  _state = gloveState;
  _engine = threeEngine;
  
  // DOM Bindings
  defaultTargetInput = container.querySelector('#defaultTargetInput');
  setDoctorTargetBtn = container.querySelector('#setDoctorTargetBtn');
  resetLiveTargetBtn = container.querySelector('#resetLiveTargetBtn');
  setTargetToast     = container.querySelector('#setTargetToast');
  targetSourceLabel  = container.querySelector('#targetSourceLabel');
  repSetStatus       = container.querySelector('#repSetStatus');
  resetRepsBtn       = container.querySelector('#resetRepsBtn');
  matchGrid          = container.querySelector('#matchGrid');
  peakGrid           = container.querySelector('#peakGrid');
  startAssessmentBtn = container.querySelector('#startAssessmentBtn');
  stopAssessmentBtn  = container.querySelector('#stopAssessmentBtn');
  resetPeaksBtn      = container.querySelector('#resetPeaksBtn');
  saveBaselineBtn    = container.querySelector('#saveBaselineBtn');
  assessmentStatus   = container.querySelector('#assessmentStatus');

  mqttHostInput          = container.querySelector('#mqttHostInput');
  mqttTopicInput         = container.querySelector('#mqttTopicInput');
  mqttUsernameInput      = container.querySelector('#mqttUsernameInput');
  mqttPasswordInput      = container.querySelector('#mqttPasswordInput');
  mqttConnectBtn         = container.querySelector('#mqttConnectBtn');
  mqttDisconnectBtn      = container.querySelector('#mqttDisconnectBtn');
  mqttStatusLabel        = container.querySelector('#mqttStatusLabel');
  mqttRateLabel          = container.querySelector('#mqttRateLabel');
  mqttRawMinInput        = container.querySelector('#mqttRawMinInput');
  mqttRawMaxInput        = container.querySelector('#mqttRawMaxInput');
  mqttDriveModelCheckbox = container.querySelector('#mqttDriveModelCheckbox');

  initGrids();
  renderCalibrationBanner();
  activeDoctorTargets = Array(5).fill(getDefaultTarget());
  updateTargetSourceLabel();
  updateRepSetStatus(false);

  // Initial render with latest packet
  const initialAngles = getCurrentAngles(_state.latestPacket);
  processLiveStream(initialAngles);
  if (_engine.isModelLoaded && _state.doctorCalibration?.ready) {
    _engine.setPose(buildPoseFromAngles(initialAngles));
  }

  // Event Listeners
  setDoctorTargetBtn.addEventListener('click', () => {
    const liveAngles = getCurrentAngles(_state.latestPacket);
    if (!liveAngles || liveAngles.some(a => a === null)) {
      showToast('⚠ Cannot set targets: Ensure glove is calibrated and connected.', 'warn');
      return;
    }
    activeDoctorTargets = liveAngles.map(a => Math.round(a));
    currentReps = 0; currentSets = 0; repLatched = false; disqualifyRep = false;
    updateRepSetStatus(false);
    updateTargetSourceLabel();
    showToast(`✓ Targets set from live pose.`, 'ok');
  });

  resetLiveTargetBtn.addEventListener('click', () => {
    const def = getDefaultTarget();
    activeDoctorTargets = Array(5).fill(def);
    currentReps = 0; currentSets = 0; repLatched = false; disqualifyRep = false;
    updateRepSetStatus(false);
    updateTargetSourceLabel();
    showToast(`✓ Targets reset to ${def}°.`, 'ok');
  });

  resetRepsBtn.addEventListener('click', () => {
    currentReps = 0; currentSets = 0; repLatched = false; disqualifyRep = false;
    updateRepSetStatus(false);
  });

  startAssessmentBtn.addEventListener('click', () => {
    assessmentActive = true;
    startAssessmentBtn.disabled = true;
    stopAssessmentBtn.disabled = false;
    assessmentStatus.textContent = '⏺ Assessment running — capturing continuous peaks...';
    assessmentStatus.style.color = 'var(--c-ok)';
  });

  stopAssessmentBtn.addEventListener('click', () => {
    assessmentActive = false;
    stopAssessmentBtn.disabled = true;
    startAssessmentBtn.disabled = false;
    assessmentStatus.textContent = '⏹ Assessment stopped. Peaks frozen.';
    assessmentStatus.style.color = 'var(--c-warn)';
  });

  resetPeaksBtn.addEventListener('click', () => {
    patientCapturedMin = [90, 90, 90, 90, 90];
    patientCapturedMax = [0, 0, 0, 0, 0];
    assessmentStatus.textContent = 'Peaks reset.';
    assessmentStatus.style.color = 'var(--c-text-muted)';
  });

  saveBaselineBtn.addEventListener('click', () => {
    const baseline = {
      capturedMin: [...patientCapturedMin],
      capturedMax: [...patientCapturedMax],
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('doctorAssessmentBaseline', JSON.stringify(baseline));
    assessmentStatus.textContent = `✓ Baseline saved locally at ${baseline.timestamp}`;
    assessmentStatus.style.color = 'var(--c-ok)';
  });

  function connectMqttPatient() {
    if (mqttClient) {
      mqttClient.end();
    }

    const brokerUrl = mqttHostInput?.value?.trim() || '';
    const topic = mqttTopicInput?.value?.trim() || '';
    const username = mqttUsernameInput?.value?.trim() || '';
    const password = mqttPasswordInput?.value?.trim() || '';

    if (mqttStatusLabel) {
      mqttStatusLabel.textContent = 'Connecting...';
      mqttStatusLabel.style.color = 'var(--c-warn)';
    }
    if (mqttConnectBtn) mqttConnectBtn.disabled = true;

    const clientId = 'sim_receiver_' + Math.random().toString(16).substring(2, 8);

    try {
      mqttClient = mqtt.connect(brokerUrl, {
        username: username,
        password: password,
        clientId: clientId,
        connectTimeout: 5000,
        reconnectPeriod: 2000
      });

      mqttClient.on('connect', () => {
        if (mqttStatusLabel) {
          mqttStatusLabel.textContent = 'Connected & Listening';
          mqttStatusLabel.style.color = 'var(--c-ok)';
        }
        if (mqttConnectBtn) mqttConnectBtn.disabled = true;
        if (mqttDisconnectBtn) mqttDisconnectBtn.disabled = false;
        mqttClient.subscribe(topic);

        mqttMsgCounter = 0;
        if (mqttHzInterval) clearInterval(mqttHzInterval);
        mqttHzInterval = setInterval(() => {
          if (mqttRateLabel) mqttRateLabel.textContent = mqttMsgCounter + ' Hz';
          mqttMsgCounter = 0;
        }, 1000);
      });

      mqttClient.on('message', (receivedTopic, message) => {
        if (receivedTopic !== topic) return;
        mqttMsgCounter++;

        if (message.length === 10) {
          const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
          const r0 = view.getUint16(0, true);
          const r1 = view.getUint16(2, true);
          const r2 = view.getUint16(4, true);
          const r3 = view.getUint16(6, true);
          const r4 = view.getUint16(8, true);
          const rawValues = [r0, r1, r2, r3, r4];

          let minLimit = parseInt(mqttRawMinInput?.value || '1000', 10);
          let maxLimit = parseInt(mqttRawMaxInput?.value || '3500', 10);

          // Auto-detect small-scale payloads (e.g. 0-255 ADC) and adjust mapping
          const observedMax = Math.max(...rawValues);
          const observedMin = Math.min(...rawValues);
          if (observedMax <= 255 && observedMax < minLimit) {
            minLimit = 0;
            maxLimit = 255;
          }

          const span = maxLimit - minLimit;
          const patientAngles = rawValues.map((rawVal, i) => {
            const rawEl = _container?.querySelector('#mqttRawVal' + i);
            const angEl = _container?.querySelector('#mqttAngVal' + i);
            let angle = 0;
            if (span > 0) {
              const t = (rawVal - minLimit) / span;
              angle = Math.max(0, Math.min(90, t * 90));
            } else {
              // Fallback: if no valid span, map 0..255
              const t = (rawVal) / 255;
              angle = Math.max(0, Math.min(90, t * 90));
            }

            if (rawEl) rawEl.textContent = rawVal;
            if (angEl) angEl.textContent = angle.toFixed(1) + '°';
            return angle;
          });

          // Feed MQTT data to Live Assessment
          processLiveStream(patientAngles);

          // Animate 3D Model if option is checked
          if (mqttDriveModelCheckbox?.checked && _engine.isModelLoaded) {
            const isCalib12Bit = fallbackPatientCalib?.min?.some(v => v > 255) || fallbackPatientCalib?.max?.some(v => v > 255);
            const isTelemetry8Bit = observedMax <= 255;
            const isCalib8Bit = fallbackPatientCalib?.min?.every(v => v <= 255) && fallbackPatientCalib?.max?.every(v => v <= 255);
            const isTelemetry12Bit = observedMax > 255;

            const modelAngles = rawValues.map((rawVal, i) => {
              const minV = fallbackPatientCalib?.min?.[i];
              const maxV = fallbackPatientCalib?.max?.[i];
              if (Number.isFinite(minV) && Number.isFinite(maxV) && minV !== maxV) {
                let scaledRaw = rawVal;
                if (isTelemetry8Bit && isCalib12Bit) {
                  scaledRaw = rawVal * 16;
                } else if (isTelemetry12Bit && isCalib8Bit) {
                  scaledRaw = rawVal / 16;
                }
                const t = (scaledRaw - minV) / (maxV - minV);
                return Math.max(0, Math.min(90, t * 90));
              }
              return patientAngles[i];
            });
            _engine.setPose(buildPoseFromAngles(modelAngles));
          }
        }
      });

      mqttClient.on('error', (err) => {
        console.error('MQTT error:', err);
        if (mqttStatusLabel) {
          mqttStatusLabel.textContent = 'Error: ' + err.message;
          mqttStatusLabel.style.color = 'var(--c-danger)';
        }
        disconnectMqttPatient();
      });

      mqttClient.on('offline', () => {
        if (mqttStatusLabel) {
          mqttStatusLabel.textContent = 'Offline';
          mqttStatusLabel.style.color = 'var(--c-danger)';
        }
      });

    } catch (err) {
      console.error('MQTT Connect setup failed:', err);
      if (mqttStatusLabel) {
        mqttStatusLabel.textContent = 'Setup Error';
        mqttStatusLabel.style.color = 'var(--c-danger)';
      }
      if (mqttConnectBtn) mqttConnectBtn.disabled = false;
    }
  }

  function disconnectMqttPatient() {
    if (mqttClient) {
      mqttClient.end();
      mqttClient = null;
    }
    if (mqttHzInterval) {
      clearInterval(mqttHzInterval);
      mqttHzInterval = null;
    }
    if (mqttStatusLabel) {
      mqttStatusLabel.textContent = 'Disconnected';
      mqttStatusLabel.style.color = 'var(--c-danger)';
    }
    if (mqttRateLabel) mqttRateLabel.textContent = '0 Hz';
    if (mqttConnectBtn) mqttConnectBtn.disabled = false;
    if (mqttDisconnectBtn) mqttDisconnectBtn.disabled = true;

    for (let i = 0; i < 5; i++) {
      const rawEl = _container?.querySelector('#mqttRawVal' + i);
      const angEl = _container?.querySelector('#mqttAngVal' + i);
      if (rawEl) rawEl.textContent = '--';
      if (angEl) angEl.textContent = '--°';
    }
  }

  mqttConnectBtn?.addEventListener('click', connectMqttPatient);
  mqttDisconnectBtn?.addEventListener('click', disconnectMqttPatient);

  // Wire State
  _state.onPacket = (packet) => {
    if (mqttClient && mqttClient.connected && mqttDriveModelCheckbox?.checked) {
      return;
    }
    const angles = getCurrentAngles(packet);
    processLiveStream(angles);
    
    // Drive 3D Model
    if (_engine.isModelLoaded && _state.doctorCalibration?.ready) {
      _engine.setPose(buildPoseFromAngles(angles));
    }
  };

  // We explicitly manage model updates per-packet, so we disable the automatic tick.
  _engine.onTick = null;

  // Fetch fallback patient calibration (non-blocking)
  fetchFallbackPatientCalibration();
}

export function unmount() {
  if (mqttClient) {
    mqttClient.end();
    mqttClient = null;
  }
  if (mqttHzInterval) {
    clearInterval(mqttHzInterval);
    mqttHzInterval = null;
  }

  if (_state) {
    _state.onPacket = null;
    _state.onStatus = null;
    _state.onConnectionChange = null;
  }
  if (_engine) {
    _engine.onTick = null;
    _engine.clearPose();
  }
  
  defaultTargetInput = setDoctorTargetBtn = resetLiveTargetBtn = setTargetToast = null;
  targetSourceLabel = repSetStatus = resetRepsBtn = null;
  startAssessmentBtn = stopAssessmentBtn = resetPeaksBtn = saveBaselineBtn = assessmentStatus = null;
  matchGrid = peakGrid = null;
  mqttHostInput = mqttTopicInput = mqttUsernameInput = mqttPasswordInput = null;
  mqttConnectBtn = mqttDisconnectBtn = mqttStatusLabel = mqttRateLabel = null;
  mqttRawMinInput = mqttRawMaxInput = mqttDriveModelCheckbox = null;
  fallbackPatientCalib = null;
  _container = null;
}
