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

// DOM refs
let defaultTargetInput, setDoctorTargetBtn, resetLiveTargetBtn, setTargetToast;
let targetSourceLabel, repSetStatus, resetRepsBtn;
let startAssessmentBtn, stopAssessmentBtn, resetPeaksBtn, saveBaselineBtn, assessmentStatus;
let matchGrid, peakGrid;

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

  // Wire State
  _state.onPacket = (packet) => {
    const angles = getCurrentAngles(packet);
    processLiveStream(angles);
    
    // Drive 3D Model
    if (_engine.isModelLoaded && _state.doctorCalibration?.ready) {
      _engine.setPose(buildPoseFromAngles(angles));
    }
  };

  // We explicitly manage model updates per-packet, so we disable the automatic tick.
  _engine.onTick = null;
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
  
  defaultTargetInput = setDoctorTargetBtn = resetLiveTargetBtn = setTargetToast = null;
  targetSourceLabel = repSetStatus = resetRepsBtn = null;
  startAssessmentBtn = stopAssessmentBtn = resetPeaksBtn = saveBaselineBtn = assessmentStatus = null;
  matchGrid = peakGrid = null;
  _container = null;
}
