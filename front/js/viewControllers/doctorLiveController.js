/**
 * doctorLiveController.js
 *
 * View controller for the Live Assessment.
 * Mirrors the doctor's live glove movement and checks compliance against targets.
 */

import { FINGER_MAPPING_TABLE } from '../mappingTable.js';

const FINGER_LABELS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const SELECTED_PATIENT_KEY = 'doctorSelectedPatient';
const MQTT_TOPIC_BASE = 'project/glove01/patients';

let _state = null;
let _engine = null;
let _container = null;
let _selectedPatient = null;

let fallbackPatientCalib = null;

// DOM refs
let liveAssessmentTitle, liveAssessmentSubtitle;
let defaultTargetInput, setDoctorTargetBtn, resetLiveTargetBtn, setTargetToast;
let targetSourceLabel, repSetStatus, resetRepsBtn;
let matchGrid, peakGrid;
let createLiveExerciseBtn, saveLiveExerciseBtn, liveExerciseDraftEl, liveExerciseListEl;
let mqttHostInput, mqttTopicInput, mqttUsernameInput, mqttPasswordInput;
let mqttConnectBtn, mqttDisconnectBtn, mqttStatusLabel, mqttRateLabel;
let mqttTopicLabel;
let mqttRawMinInput, mqttRawMaxInput, mqttDriveModelCheckbox;
let liveForceLevelInput, applyForceBtn, liveForceStatus;

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
let assessmentActive = true;
let patientCapturedMin = [90, 90, 90, 90, 90];
let patientCapturedMax = [0, 0, 0, 0, 0];
let currentLiveAngles = [null, null, null, null, null];
let currentRawValues = [0, 0, 0, 0, 0];
let liveExerciseDraft = null;
let liveExercises = [];

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

function getSelectedPatient() {
  try {
    const patient = JSON.parse(localStorage.getItem(SELECTED_PATIENT_KEY) || 'null');
    return patient?.patient_id ? patient : null;
  } catch {
    return null;
  }
}

function getSelectedPatientId() {
  return _selectedPatient?.patient_id || '';
}

function mqttSafeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_');
}

function getSelectedPatientMqttTopic() {
  const patientId = mqttSafeSegment(getSelectedPatientId());
  return patientId ? `${MQTT_TOPIC_BASE}/${patientId}/status` : '';
}

function selectedPatientLabel() {
  if (!_selectedPatient) return '';
  return _selectedPatient.name || _selectedPatient.patient_id;
}

function patientDisplayName(patientId = getSelectedPatientId()) {
  if (_selectedPatient?.patient_id === patientId) {
    return _selectedPatient.name || _selectedPatient.patient_id;
  }
  return patientId || '--';
}

function updateSelectedPatientHeader() {
  if (!liveAssessmentTitle || !liveAssessmentSubtitle) return;

  if (_selectedPatient) {
    const label = selectedPatientLabel();
    liveAssessmentTitle.textContent = `Live Assessment (Patient - ${label})`;
    liveAssessmentSubtitle.textContent = `Monitoring live exercise data for ${label} (${_selectedPatient.patient_id}).`;
    if (mqttTopicLabel) {
      mqttTopicLabel.textContent = getSelectedPatientMqttTopic() || '--';
    }
    return;
  }

  liveAssessmentTitle.textContent = 'Live Assessment';
  liveAssessmentSubtitle.textContent = 'Patient compliance monitor and peak detection. Driven by doctor\'s physical glove stream.';
  if (mqttTopicLabel) {
    mqttTopicLabel.textContent = 'Select a patient first';
  }
}

async function fetchFallbackPatientCalibration() {
  try {
    const patientId = getSelectedPatientId();
    if (!patientId) return;
    const apiBase = _state.apiBase;
    const headers = _state.getAuthHeaders();
    const resp = await fetch(`${apiBase}/api/patient-cal/${encodeURIComponent(patientId)}`, { headers });
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

async function fetchCurrentForceLevel() {
  try {
    const apiBase = _state.apiBase;
    const headers = _state.getAuthHeaders();
    const patientId = getSelectedPatientId();
    if (!patientId) return;
    const resp = await fetch(`${apiBase}/api/forces?patient_id=${patientId}`, { headers });
    if (resp.ok) {
      const data = await resp.json();
      const level = data?.level;
      if (Number.isFinite(level) && level >= 1 && level <= 10) {
        if (liveForceStatus) {
          liveForceStatus.textContent = `✓ Current active force level: ${level}`;
          liveForceStatus.style.color = 'var(--c-ok)';
        }
      }
    }
  } catch (err) {
    console.error('[DoctorLive] Failed to fetch current force level:', err);
  }
}

function getDefaultTarget() {
  const v = parseInt(defaultTargetInput?.value ?? '90', 10);
  return Number.isFinite(v) && v >= 0 && v <= 90 ? v : 90;
}

function getSelectedForceLevel(defaultLevel = 1) {
  const level = parseInt(liveForceLevelInput?.value ?? '', 10);
  return Number.isInteger(level) && level >= 1 && level <= 10 ? level : defaultLevel;
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
function getDoctorId() {
  try {
    const profile = JSON.parse(localStorage.getItem('auth_profile') || '{}');
    if (profile?.doctor_id) return profile.doctor_id;
  } catch { /* fall through */ }
  return localStorage.getItem('doctorId') || 'DOC-1b402238f4ad4c92a7deedbc1a53c813';
}

function generateLiveExerciseId() {
  return `live_ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatExerciseDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'Live Exercise';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function createLiveExerciseName(capturedAt) {
  return `Live Exercise - ${formatExerciseDate(capturedAt)}`;
}

function liveExerciseDisplayName(exercise) {
  const savedName = exercise?.exercise_name || exercise?.description || '';
  if (savedName && savedName !== 'Live Exercise Snapshot') return savedName;
  return createLiveExerciseName(exercise?.capturedAt || exercise?.createdAt);
}

function formatAngle(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}°` : '--';
}

function buildLiveExerciseDraft() {
  const fingers = {};

  FINGER_KEYS.forEach((key, index) => {
    const min = Number(patientCapturedMin[index]);
    const max = Number(patientCapturedMax[index]);
    const angle = Number(currentLiveAngles[index]);
    const raw = Number(currentRawValues[index]);

    fingers[key] = {
      min: Number.isFinite(min) ? Number(min.toFixed(1)) : 90,
      max: Number.isFinite(max) ? Number(max.toFixed(1)) : 0,
      angle: Number.isFinite(angle) ? Number(angle.toFixed(1)) : 0,
      raw: Number.isFinite(raw) ? raw : 0
    };
  });

  const capturedAt = new Date().toISOString();
  const exerciseName = createLiveExerciseName(capturedAt);

  return {
    exercise_id: generateLiveExerciseId(),
    exercise_name: exerciseName,
    description: exerciseName,
    doctor_id: getDoctorId(),
    patient_id: getSelectedPatientId(),
    force_level: getSelectedForceLevel(1),
    fingers,
    capturedAt
  };
}

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

function renderLiveExerciseDraft() {
  if (!liveExerciseDraftEl || !saveLiveExerciseBtn) return;

  if (!liveExerciseDraft) {
    liveExerciseDraftEl.textContent = 'No live exercise snapshot created yet.';
    saveLiveExerciseBtn.disabled = true;
    if (applyForceBtn) applyForceBtn.disabled = true;
    if (liveForceLevelInput) liveForceLevelInput.disabled = true;
    if (liveForceStatus) {
      liveForceStatus.textContent = 'Create a live exercise snapshot before applying force.';
      liveForceStatus.style.color = 'var(--c-text-muted)';
    }
    return;
  }

  if (liveForceLevelInput) {
    liveForceLevelInput.disabled = false;
    if (!liveForceLevelInput.value) liveForceLevelInput.value = '1';
  }
  if (applyForceBtn) applyForceBtn.disabled = false;

  const summary = FINGER_KEYS.map((key, index) => {
    const finger = liveExerciseDraft.fingers[key];
    return `${FINGER_LABELS[index]} raw ${finger.raw}, min ${formatAngle(finger.min)}, max ${formatAngle(finger.max)}, angle ${formatAngle(finger.angle)}`;
  }).join(' | ');

  liveExerciseDraftEl.textContent = `Ready to save live exercise snapshot for ${patientDisplayName(liveExerciseDraft.patient_id)} with force level ${liveExerciseDraft.force_level || 1}: ${summary}`;
  saveLiveExerciseBtn.disabled = false;
}

function renderLiveExerciseList() {
  if (!liveExerciseListEl) return;

  if (!liveExercises.length) {
    liveExerciseListEl.innerHTML = '<li>No live exercises saved yet.</li>';
    return;
  }

  liveExerciseListEl.innerHTML = '';
  liveExercises.forEach((exercise) => {
    const li = document.createElement('li');
    const created = exercise.createdAt ? new Date(exercise.createdAt).toLocaleString() : '--';
    const maxSummary = FINGER_KEYS.map((key, index) => {
      const finger = exercise.fingers?.[key] || {};
      const raw = exercise.raw_values?.[key];
      return `${FINGER_LABELS[index]} raw ${Number.isFinite(Number(raw)) ? raw : '--'} angle ${formatAngle(Number(finger.angle))}`;
    }).join(', ');

    li.innerHTML = `
      <div class="live-exercise-list-item-head">
        <strong>${liveExerciseDisplayName(exercise)}</strong>
        <button class="live-exercise-delete-btn" type="button" data-exercise-id="${exercise.exercise_id}">Delete</button>
      </div>
      <div>Patient: ${patientDisplayName(exercise.patient_id)}</div>
      <div>Force level: ${Number.isFinite(Number(exercise.force_level)) ? Number(exercise.force_level) : 1}</div>
      <div>Saved: ${created}</div>
      <div>${maxSummary}</div>
    `;
    liveExerciseListEl.appendChild(li);
  });

  liveExerciseListEl.querySelectorAll('.live-exercise-delete-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const exerciseId = button.dataset.exerciseId;
      if (!exerciseId) return;
      if (!window.confirm(`Delete live exercise ${exerciseId}?`)) return;

      button.disabled = true;
      button.textContent = 'Deleting...';
      try {
        const resp = await fetch(`${_state.apiBase}/api/live-exercises/${encodeURIComponent(exerciseId)}`, {
          method: 'DELETE',
          headers: _state.getAuthHeaders()
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        liveExercises = liveExercises.filter(exercise => exercise.exercise_id !== exerciseId);
        renderLiveExerciseList();
      } catch (error) {
        console.error('[DoctorLive] Failed to delete live exercise:', error);
        button.disabled = false;
        button.textContent = 'Delete';
        window.alert('Failed to delete live exercise. Check the backend connection.');
      }
    });
  });
}

async function loadLiveExercises() {
  if (!liveExerciseListEl) return;

  try {
    const doctorId = getDoctorId();
    const patientId = getSelectedPatientId();
    if (!patientId) {
      liveExercises = [];
      liveExerciseListEl.innerHTML = '<li>Select a patient from My Patients to view saved live exercises.</li>';
      return;
    }
    const resp = await fetch(`${_state.apiBase}/api/live-exercises?doctor_id=${encodeURIComponent(doctorId)}&patient_id=${encodeURIComponent(patientId)}`, {
      headers: _state.getAuthHeaders()
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    liveExercises = Array.isArray(data.exercises) ? data.exercises : [];
    renderLiveExerciseList();
  } catch (error) {
    console.error('[DoctorLive] Failed to load live exercises:', error);
    liveExerciseListEl.innerHTML = '<li>Failed to load saved live exercises.</li>';
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
  currentLiveAngles = angles.map(angle => Number.isFinite(angle) ? angle : null);

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
  _selectedPatient = getSelectedPatient();
  
  // DOM Bindings
  liveAssessmentTitle = container.querySelector('#liveAssessmentTitle');
  liveAssessmentSubtitle = container.querySelector('#liveAssessmentSubtitle');
  defaultTargetInput = container.querySelector('#defaultTargetInput');
  setDoctorTargetBtn = container.querySelector('#setDoctorTargetBtn');
  resetLiveTargetBtn = container.querySelector('#resetLiveTargetBtn');
  setTargetToast     = container.querySelector('#setTargetToast');
  targetSourceLabel  = container.querySelector('#targetSourceLabel');
  repSetStatus       = container.querySelector('#repSetStatus');
  resetRepsBtn       = container.querySelector('#resetRepsBtn');
  matchGrid          = container.querySelector('#matchGrid');
  peakGrid           = container.querySelector('#peakGrid');
  createLiveExerciseBtn = container.querySelector('#createLiveExerciseBtn');
  saveLiveExerciseBtn   = container.querySelector('#saveLiveExerciseBtn');
  liveExerciseDraftEl   = container.querySelector('#liveExerciseDraft');
  liveExerciseListEl    = container.querySelector('#liveExerciseList');

  mqttHostInput          = container.querySelector('#mqttHostInput');
  mqttTopicInput         = container.querySelector('#mqttTopicInput');
  mqttUsernameInput      = container.querySelector('#mqttUsernameInput');
  mqttPasswordInput      = container.querySelector('#mqttPasswordInput');
  mqttConnectBtn         = container.querySelector('#mqttConnectBtn');
  mqttDisconnectBtn      = container.querySelector('#mqttDisconnectBtn');
  mqttStatusLabel        = container.querySelector('#mqttStatusLabel');
  mqttRateLabel          = container.querySelector('#mqttRateLabel');
  mqttTopicLabel         = container.querySelector('#mqttTopicLabel');
  mqttRawMinInput        = container.querySelector('#mqttRawMinInput');
  mqttRawMaxInput        = container.querySelector('#mqttRawMaxInput');
  mqttDriveModelCheckbox = container.querySelector('#mqttDriveModelCheckbox');

  liveForceLevelInput    = container.querySelector('#liveForceLevelInput');
  applyForceBtn          = container.querySelector('#applyForceBtn');
  liveForceStatus        = container.querySelector('#liveForceStatus');

  updateSelectedPatientHeader();
  initGrids();
  renderCalibrationBanner();
  activeDoctorTargets = Array(5).fill(getDefaultTarget());
  updateTargetSourceLabel();
  updateRepSetStatus(false);

  // Initial render with latest packet
  const initialAngles = getCurrentAngles(_state.latestPacket);
  currentRawValues = Array.isArray(_state.latestPacket) ? _state.latestPacket.slice(0, 5) : [0, 0, 0, 0, 0];
  processLiveStream(initialAngles);
  if (_engine.isModelLoaded && _state.doctorCalibration?.ready) {
    _engine.setPose(buildPoseFromAngles(initialAngles));
  }

  // Event Listeners
  setDoctorTargetBtn?.addEventListener('click', () => {
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

  resetLiveTargetBtn?.addEventListener('click', () => {
    const def = getDefaultTarget();
    activeDoctorTargets = Array(5).fill(def);
    currentReps = 0; currentSets = 0; repLatched = false; disqualifyRep = false;
    updateRepSetStatus(false);
    updateTargetSourceLabel();
    showToast(`✓ Targets reset to ${def}°.`, 'ok');
  });

  resetRepsBtn?.addEventListener('click', () => {
    currentReps = 0; currentSets = 0; repLatched = false; disqualifyRep = false;
    updateRepSetStatus(false);
  });

  createLiveExerciseBtn?.addEventListener('click', () => {
    if (!getSelectedPatientId()) {
      alert('Please select a patient from My Patients before creating a live exercise.');
      return;
    }
    if (liveForceLevelInput) liveForceLevelInput.value = '1';
    liveExerciseDraft = buildLiveExerciseDraft();
    renderLiveExerciseDraft();
  });

  saveLiveExerciseBtn?.addEventListener('click', async () => {
    if (!liveExerciseDraft) return;
    if (!getSelectedPatientId()) {
      alert('Please select a patient from My Patients before saving a live exercise.');
      return;
    }

    saveLiveExerciseBtn.disabled = true;
    try {
      liveExerciseDraft = {
        ...buildLiveExerciseDraft(),
        exercise_id: liveExerciseDraft.exercise_id
      };
      renderLiveExerciseDraft();

      const resp = await fetch(`${_state.apiBase}/api/live-exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._state.getAuthHeaders() },
        body: JSON.stringify(liveExerciseDraft)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      liveExercises = [
        data.exercise,
        ...liveExercises.filter(ex => ex.exercise_id !== data.exercise.exercise_id)
      ];
      liveExerciseDraft = null;
      renderLiveExerciseDraft();
      await loadLiveExercises();
    } catch (error) {
      console.error('[DoctorLive] Failed to save live exercise:', error);
      saveLiveExerciseBtn.disabled = false;
      if (liveExerciseDraftEl) {
        liveExerciseDraftEl.textContent = 'Failed to save live exercise. Check the backend connection and try again.';
      }
    }
  });

  function connectMqttPatient() {
    if (mqttClient) {
      mqttClient.end();
    }

    const brokerUrl = mqttHostInput?.value?.trim() || '';
    const topic = getSelectedPatientMqttTopic() || mqttTopicInput?.value?.trim() || '';
    const username = mqttUsernameInput?.value?.trim() || '';
    const password = mqttPasswordInput?.value?.trim() || '';

    if (!getSelectedPatientId() || !topic) {
      if (mqttStatusLabel) {
        mqttStatusLabel.textContent = 'Select a patient first';
        mqttStatusLabel.style.color = 'var(--c-danger)';
      }
      return;
    }

    if (mqttStatusLabel) {
      mqttStatusLabel.textContent = 'Connecting...';
      mqttStatusLabel.style.color = 'var(--c-warn)';
    }
    if (mqttTopicLabel) mqttTopicLabel.textContent = topic;
    if (mqttConnectBtn) mqttConnectBtn.disabled = true;

    const clientId = `doctor_receiver_${mqttSafeSegment(getSelectedPatientId())}_${Math.random().toString(16).substring(2, 8)}`;

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
          mqttStatusLabel.textContent = `Listening to ${selectedPatientLabel() || getSelectedPatientId()}`;
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
          currentRawValues = rawValues;

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
          mqttStatusLabel.textContent = 'Patient glove offline';
          mqttStatusLabel.style.color = 'var(--c-danger)';
        }
      });

    } catch (err) {
      console.error('MQTT Connect setup failed:', err);
      if (mqttStatusLabel) {
        mqttStatusLabel.textContent = 'Connection setup error';
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
    currentRawValues = Array.isArray(packet) ? packet.slice(0, 5) : currentRawValues;
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

  // Fetch current active force level (non-blocking)
  fetchCurrentForceLevel();

  // Add event listeners for Force input & button
  liveForceLevelInput?.addEventListener('keydown', (e) => {
    if (!/^[0-9]$/.test(e.key) && !['Backspace', 'ArrowLeft', 'ArrowRight', 'Tab', 'Delete'].includes(e.key)) {
      e.preventDefault();
    }
  });

  liveForceLevelInput?.addEventListener('input', (e) => {
    let val = parseInt(e.target.value, 10);
    if (!isNaN(val)) {
      if (val > 10) e.target.value = '10';
      if (val < 1) e.target.value = '';
    } else {
      e.target.value = '';
    }
  });

  applyForceBtn?.addEventListener('click', async () => {
    if (!liveExerciseDraft) {
      alert('Please create a live exercise snapshot before applying force.');
      return;
    }

    const levelVal = liveForceLevelInput?.value;
    const level = levelVal === '' || levelVal === undefined ? 1 : parseInt(levelVal, 10);
    if (isNaN(level) || level < 1 || level > 10) {
      alert('Please enter a valid motor force level (1-10).');
      return;
    }
    if (liveForceLevelInput && !liveForceLevelInput.value) {
      liveForceLevelInput.value = String(level);
    }
    if (liveExerciseDraft) {
      liveExerciseDraft.force_level = level;
      renderLiveExerciseDraft();
    }

    if (liveForceStatus) {
      liveForceStatus.textContent = 'Sending force command...';
      liveForceStatus.style.color = 'var(--c-warn)';
    }

    const patientId = getSelectedPatientId();
    if (!patientId) {
      alert('Please select a patient from My Patients before applying force.');
      return;
    }
    const doctorId = getDoctorId();
    const exerciseId = `ex_live_force_${Date.now()}`;

    // 1. Create realtime exercise in the database
    const exercisePayload = {
      exercise_id: exerciseId,
      description: 'Live Force Assessment',
      level: level,
      target_reps: 10,
      target_sets: 3,
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
      patient_id: patientId,
      doctor_id: doctorId,
      max_angles: { thumb: 90, index: 90, middle: 90, ring: 90, pinky: 90 }
    };

    try {
      // Create exercise
      const exResp = await fetch(`${_state.apiBase}/api/exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._state.getAuthHeaders() },
        body: JSON.stringify(exercisePayload)
      });
      if (!exResp.ok) throw new Error(`Exercise API returned ${exResp.status}`);

      // 2. Set force level in MongoDB
      const forcePayload = {
        level: level,
        patient_id: patientId,
        exercise_id: exerciseId
      };
      const forceResp = await fetch(`${_state.apiBase}/api/forces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._state.getAuthHeaders() },
        body: JSON.stringify(forcePayload)
      });
      if (!forceResp.ok) throw new Error(`Force API returned ${forceResp.status}`);

      if (liveForceStatus) {
        liveForceStatus.textContent = `✓ Force level ${level} applied (Exercise ID: ${exerciseId})`;
        liveForceStatus.style.color = 'var(--c-ok)';
      }
    } catch (err) {
      console.error('[DoctorLive] Failed to apply force:', err);
      if (liveForceStatus) {
        liveForceStatus.textContent = `❌ Failed to apply force: ${err.message}`;
        liveForceStatus.style.color = 'var(--c-danger)';
      }
    }
  });
  renderLiveExerciseDraft();
  loadLiveExercises();
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
  
  liveAssessmentTitle = liveAssessmentSubtitle = null;
  defaultTargetInput = setDoctorTargetBtn = resetLiveTargetBtn = setTargetToast = null;
  targetSourceLabel = repSetStatus = resetRepsBtn = null;
  matchGrid = peakGrid = null;
  createLiveExerciseBtn = saveLiveExerciseBtn = liveExerciseDraftEl = liveExerciseListEl = null;
  mqttHostInput = mqttTopicInput = mqttUsernameInput = mqttPasswordInput = null;
  mqttConnectBtn = mqttDisconnectBtn = mqttStatusLabel = mqttRateLabel = null;
  mqttTopicLabel = null;
  mqttRawMinInput = mqttRawMaxInput = mqttDriveModelCheckbox = null;
  liveForceLevelInput = applyForceBtn = liveForceStatus = null;
  fallbackPatientCalib = null;
  _selectedPatient = null;
  currentRawValues = [0, 0, 0, 0, 0];
  liveExerciseDraft = null;
  liveExercises = [];
  _container = null;
}
