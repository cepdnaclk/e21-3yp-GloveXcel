/**
 * exercisePreloadedController.js
 *
 * View controller for the Preloaded Exercise Session.
 * Extracted from patient_exercise.html <script type="module"> (lines 411–1339).
 *
 * What this controller owns:
 *   • engine.onTick  — drives the cosine-wave loop animation on the 3D hand
 *   • state.onPacket — receives live glove packets, updates the match grid
 *
 * What it does NOT own (singletons handle these):
 *   • The BLE connection  (GloveState)
 *   • The WebGL renderer  (ThreeEngine)
 *
 * Memory-leak contract:
 *   unmount() nullifies engine.onTick and state.onPacket. No setInterval is used.
 */

import { FINGER_MAPPING_TABLE } from '../mappingTable.js';

// ─── Constants (identical to patient_exercise.html:419-431) ──────────────────
const FINGER_KEYS       = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const FINGER_LABELS     = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const PATIENT_CALIB_KEY = 'patientCalibrationV1';

// ─── Module-level mutable state ───────────────────────────────────────────────
// All variables are reset inside mount() so each view visit starts clean.

let _state   = null;   // GloveState singleton
let _engine  = null;   // ThreeEngine singleton
let _container = null; // #view-container DOM node

// Doctor / exercise values
let _doctorData      = null;
let _isLoopRunning   = true;
let _loopStartMs     = 0;
let _animatedAngles  = [0, 0, 0, 0, 0];
let _patientPacket   = [0, 0, 0, 0, 0];

// Rep / set tracking
let _currentReps = 0;
let _currentSets = 0;
let _repLatched  = false;

// Patient calibration (local copy for this view)
let _patientCalibration = {
  min:       [null, null, null, null, null],
  max:       [null, null, null, null, null],
  capturedAt: null,
  ready:     false,
};

// ─── DOM references (resolved by container.querySelector in mount()) ──────────
let statusEl, levelInfoEl, loopBadgeEl, repSetStatusEl;
let doctorDataBody, targetGridEl, matchGridEl, overallMatchBadgeEl;
let gloveStatusEl, patientCalibStatusEl;
let connectGloveBtn, loadPatientCalibBtn;
let startLoopBtn, stopLoopBtn, resetPoseBtn;
let levelSelect, cycleMsInput;
let exerciseSelectEl, exerciseDetailsEl;
let exerciseForceLevelEl, sendExerciseMotorBtn, exerciseMotorStatusEl;

// ═══════════════════════════════════════════════════════════════════════════════
// MATH — preserved VERBATIM from patient_exercise.html
// ═══════════════════════════════════════════════════════════════════════════════

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function emptyArray(value = 0) {
  return [value, value, value, value, value];
}

/**
 * levelToAngle — patient_exercise.html:513
 * Maps a doctor difficulty level (1–6) to a target angle in degrees (0–90).
 */
function levelToAngle(level) {
  const normalized = clamp(Number(level) || 1, 1, 6) - 1;
  return Math.round((normalized * 90) / 5);
}

function getCurrentLevelAngle() {
  return levelToAngle(_doctorData.level);
}

/**
 * getTargetAngles — patient_exercise.html:771
 * Per-finger target = min(exerciseMax, levelAngle), clamped 0–90.
 */
function getTargetAngles() {
  const levelAngle = getCurrentLevelAngle();
  return _doctorData.exerciseMax.map((value) => clamp(Math.min(value, levelAngle), 0, 90));
}

/**
 * packetToPatientAngles — patient_exercise.html:875
 * Maps raw BLE packet values through the patient's personal min/max calibration
 * range, returning angles in the same 0–targetMax space.
 */
function packetToPatientAngles(packet) {
  const targets = getTargetAngles();
  return packet.map((raw, index) => {
    const min    = Number(_patientCalibration.min[index]);
    const max    = Number(_patientCalibration.max[index]);
    const target = Number(targets[index]);

    if (
      !Number.isFinite(raw) ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min === max ||
      !Number.isFinite(target)
    ) {
      return null;
    }

    const t = clamp((raw - min) / (max - min), 0, 1);
    return t * target;
  });
}

/**
 * computeLoopAngles — patient_exercise.html:1276
 * Cosine wave that drives the 3D hand: min → targets → min continuously.
 * When the loop is stopped, it holds the current animated position.
 */
function computeLoopAngles(nowMs) {
  const targets = getTargetAngles();

  if (!_isLoopRunning) {
    return [..._animatedAngles];
  }

  const cycleMs = clamp(_doctorData.cycleMs, 1000, 10000);
  const phase   = ((nowMs - _loopStartMs) % cycleMs) / cycleMs;
  const wave    = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);

  return targets.map((target) => target * wave);
}

// ═══════════════════════════════════════════════════════════════════════════════
// THREE.JS POSE BUILDER — patient_exercise.html:1298
// ═══════════════════════════════════════════════════════════════════════════════

function buildPoseFromAngles(angles) {
  return FINGER_MAPPING_TABLE.map((row, index) => {
    const sourceAngle = Number.isFinite(angles[index]) ? angles[index] : 0;
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

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT DATA — patient_exercise.html:518
// ═══════════════════════════════════════════════════════════════════════════════

function defaultDoctorData() {
  return {
    level:       4,
    cycleMs:     3200,
    calibMin:    [20, 18, 16, 15, 14],
    calibMax:    [210, 220, 222, 226, 230],
    exerciseMax: [65, 70, 68, 66, 62],
    targetReps:  null,
    targetSets:  null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATIENT CALIBRATION — patient_exercise.html:776
// ═══════════════════════════════════════════════════════════════════════════════

function loadPatientCalibrationFromStorage() {
  try {
    const raw = localStorage.getItem(PATIENT_CALIB_KEY);
    if (!raw) {
      _patientCalibration = { min: [null,null,null,null,null], max: [null,null,null,null,null], capturedAt: null, ready: false };
      return;
    }
    const parsed = JSON.parse(raw);
    const min    = Array.isArray(parsed.finalMin) ? parsed.finalMin : [null,null,null,null,null];
    const max    = Array.isArray(parsed.finalMax) ? parsed.finalMax : [null,null,null,null,null];
    const ready  = min.every(Number.isFinite) && max.every(Number.isFinite);
    _patientCalibration = { min, max, capturedAt: parsed.capturedAt || null, ready };
  } catch (error) {
    console.warn('[PreloadedCtrl] Failed to load patient calibration:', error);
    _patientCalibration = { min: [null,null,null,null,null], max: [null,null,null,null,null], capturedAt: null, ready: false };
  }
}

/**
 * _resolveCalibration
 * Priority: GloveState.patientCalibration (already DB-hydrated by the calibration view)
 * before localStorage, so a patient who calibrated this session gets their data
 * immediately without a page reload.
 */
function _resolveCalibration() {
  const sc = _state?.patientCalibration;
  if (sc?.ready && Array.isArray(sc.finalMin) && Array.isArray(sc.finalMax)) {
    _patientCalibration = {
      min:       sc.finalMin,
      max:       sc.finalMax,
      capturedAt: sc.capturedAt || null,
      ready:     true,
    };
  } else {
    loadPatientCalibrationFromStorage();
  }
}

/**
 * _renderCalibrationBanner
 * Shows a dismissible amber banner when patient calibration is missing.
 * Uses the 'spa:navigate' custom event to route to Calibration without
 * coupling to the router object directly.
 * Safe to call repeatedly — removes any previous instance first.
 */
function _renderCalibrationBanner() {
  _container?.querySelector('.calib-warning-banner')?.remove();
  if (_patientCalibration.ready) return;

  const banner = document.createElement('div');
  banner.className = 'calib-warning-banner';
  banner.innerHTML = `
    <span class="calib-warning-icon" aria-hidden="true">⚠️</span>
    <div class="calib-warning-body">
      <strong>Glove not calibrated.</strong>
      Patient angles cannot be computed until calibration data is available.
      Match bars will appear once calibration is complete.
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

async function hydratePatientCalibrationFromDatabase() {
  try {
    let resp = await fetch(
      `${_state.apiBase}/api/patient-cal/${encodeURIComponent(_state.patientId)}`,
      { headers: _state.getAuthHeaders() }
    );
    
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

    if (!doc || isCalibrationEmpty(doc)) return;

    const min    = doc?.min || {};
    const max    = doc?.max || {};

    // patient_exercise.html:848 — verbatim mapping
    const finalMin = [min.thumb, min.index, min.middle, min.ring, min.pinky]
      .map((v) => Number(v))
      .map((v) => (Number.isFinite(v) ? v : null));
    const finalMax = [max.thumb, max.index, max.middle, max.ring, max.pinky]
      .map((v) => Number(v))
      .map((v) => (Number.isFinite(v) ? v : null));

    const ready = finalMin.every(Number.isFinite) && finalMax.every(Number.isFinite);
    _patientCalibration = { min: finalMin, max: finalMax, capturedAt: doc?.updatedAt || null, ready };

    // Also sync into the shared GloveState for other views
    _state.patientCalibration = {
      finalMin, finalMax, ready, capturedAt: doc?.updatedAt || null,
    };

    renderPatientCalibrationStatus();
  } catch (error) {
    console.error('[PreloadedCtrl] Failed to fetch patient calibration from DB:', error);
  }
}

function renderPatientCalibrationStatus() {
  if (!patientCalibStatusEl) return;
  patientCalibStatusEl.textContent = _patientCalibration.ready
    ? `Patient calibration status: Ready (captured: ${_patientCalibration.capturedAt || 'unknown'}).`
    : 'Patient calibration status: Missing. Open patient calibration page and capture min/max first.';
}

// ═══════════════════════════════════════════════════════════════════════════════
// API FETCH CHAINS — patient_exercise.html:613-693
// ═══════════════════════════════════════════════════════════════════════════════

async function loadExercisesForPatient() {
  if (!exerciseSelectEl) return;

  exerciseSelectEl.innerHTML = '<option value="">-- Loading exercises... --</option>';
  exerciseSelectEl.disabled  = true;

  try {
    const url = `${_state.apiBase}/api/exercises?patient_id=${encodeURIComponent(_state.patientId)}`;
    let resp = await fetch(url, { headers: _state.getAuthHeaders() });

    if (resp.status === 401 || resp.status === 403) {
      localStorage.removeItem('auth_token');
      resp = await fetch(url);
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data      = await resp.json();
    const exercises = Array.isArray(data.exercises) ? data.exercises : [];

    if (!exercises.length) {
      exerciseSelectEl.innerHTML = '<option value="">-- No exercises found --</option>';
      return;
    }

    const options = ['<option value="">-- Select exercise --</option>'];
    exercises.forEach((exercise) => {
      const id   = exercise.exercise_id;
      const desc = exercise.description || 'No description';
      options.push(`<option value="${id}">${id} - ${desc}</option>`);
    });
    exerciseSelectEl.innerHTML          = options.join('');
    exerciseSelectEl.dataset.exercises  = JSON.stringify(exercises);
  } catch (error) {
    console.error('[PreloadedCtrl] Failed to load exercises:', error);
    exerciseSelectEl.innerHTML = '<option value="">-- Failed to load exercises --</option>';
    setStatus('Failed to load exercises for patient.');
  } finally {
    exerciseSelectEl.disabled = false;
  }
}

async function loadExerciseMaxAngles(exerciseId) {
  try {
    const resp = await fetch(
      `${_state.apiBase}/api/exercise-max/${encodeURIComponent(exerciseId)}`,
      { headers: _state.getAuthHeaders() }
    );
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.error('[PreloadedCtrl] Failed to load exercise max angles:', error);
    return null;
  }
}

async function loadDoctorCalibration(doctorId) {
  try {
    const resp = await fetch(
      `${_state.apiBase}/api/doctor-cal/${encodeURIComponent(doctorId)}`,
      { headers: _state.getAuthHeaders() }
    );
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.error('[PreloadedCtrl] Failed to load doctor calibration:', error);
    return null;
  }
}

/**
 * applyExerciseSelection — patient_exercise.html:695
 * Loads doctor calibration + exercise max angles for the selected exercise.
 */
function normalizeForceLevel(level) {
  const value = Number(level);
  if (!Number.isFinite(value)) return null;
  return clamp(Math.round(value), 1, 10);
}

function updateMotorControlState() {
  if (!sendExerciseMotorBtn) return;

  const forceLevel = normalizeForceLevel(exerciseForceLevelEl?.value);
  sendExerciseMotorBtn.disabled = !_state?.isConnected || !forceLevel;
}

function setExerciseForceLevel(level) {
  const forceLevel = normalizeForceLevel(level);

  if (exerciseForceLevelEl) {
    exerciseForceLevelEl.value = forceLevel ? String(forceLevel) : '';
  }

  if (exerciseMotorStatusEl) {
    exerciseMotorStatusEl.textContent = forceLevel
      ? `Assigned force level ${forceLevel}. Connect the patient glove, then test motor.`
      : 'Select an exercise to load its force level.';
  }

  updateMotorControlState();
}

async function sendSelectedExerciseMotorLevel() {
  const forceLevel = normalizeForceLevel(exerciseForceLevelEl?.value);

  if (!forceLevel) {
    if (exerciseMotorStatusEl) exerciseMotorStatusEl.textContent = 'Select an exercise with a valid force level first.';
    return;
  }

  if (!_state?.isConnected) {
    if (exerciseMotorStatusEl) exerciseMotorStatusEl.textContent = 'Connect the patient glove before testing motor force.';
    return;
  }

  if (sendExerciseMotorBtn) sendExerciseMotorBtn.disabled = true;
  if (exerciseMotorStatusEl) exerciseMotorStatusEl.textContent = `Sending force level ${forceLevel} to glove...`;

  try {
    await _state.bleClient.sendMotorLevel(forceLevel);
    if (exerciseMotorStatusEl) exerciseMotorStatusEl.textContent = `Force level ${forceLevel} sent to glove.`;
  } catch (error) {
    console.error('[PreloadedCtrl] Motor command failed:', error);
    if (exerciseMotorStatusEl) {
      exerciseMotorStatusEl.textContent = `Motor command failed: ${error.message}`;
    }
  } finally {
    updateMotorControlState();
  }
}

async function applyExerciseSelection(exerciseId) {
  if (!exerciseId) {
    if (exerciseDetailsEl) exerciseDetailsEl.textContent = 'Select an exercise to view details.';
    setExerciseForceLevel(null);
    return;
  }

  const raw      = exerciseSelectEl?.dataset?.exercises;
  const list     = raw ? JSON.parse(raw) : [];
  const exercise = list.find((item) => item.exercise_id === exerciseId);

  if (!exercise) {
    if (exerciseDetailsEl) exerciseDetailsEl.textContent = 'Selected exercise not found.';
    setExerciseForceLevel(null);
    return;
  }

  if (exerciseDetailsEl) {
    exerciseDetailsEl.textContent = `${exercise.description || 'No description'} | Doctor: ${exercise.doctor_id || '--'} | Sets: ${exercise.target_sets || '--'} | Reps: ${exercise.target_reps || '--'} | Level: ${exercise.level || '--'} | ${exercise.start_date || '--'} → ${exercise.end_date || '--'}`;
  }

  const forceLevel = normalizeForceLevel(exercise.level);
  setExerciseForceLevel(forceLevel);

  _doctorData.level      = forceLevel ? clamp(forceLevel, 1, 6) : _doctorData.level;
  _doctorData.targetReps = Number(exercise.target_reps) || null;
  _doctorData.targetSets = Number(exercise.target_sets) || null;
  if (levelSelect) levelSelect.value = String(_doctorData.level);

  if (exercise.doctor_id) {
    const doctorDoc = await loadDoctorCalibration(exercise.doctor_id);
    if (doctorDoc && doctorDoc.min && doctorDoc.max) {
      const min = doctorDoc.min;
      const max = doctorDoc.max;
      // patient_exercise.html:727-730
      _doctorData.calibMin = [min.thumb, min.index, min.middle, min.ring, min.pinky]
        .map((value) => Number(value) || 0);
      _doctorData.calibMax = [max.thumb, max.index, max.middle, max.ring, max.pinky]
        .map((value) => Number(value) || 255);
    } else {
      _doctorData.calibMin = emptyArray(0);
      _doctorData.calibMax = emptyArray(255);
    }
  }

  const maxDoc = await loadExerciseMaxAngles(exerciseId);
  if (maxDoc && maxDoc.max_angles) {
    // patient_exercise.html:739-745
    _doctorData.exerciseMax = [
      Number(maxDoc.max_angles.thumb)  || 0,
      Number(maxDoc.max_angles.index)  || 0,
      Number(maxDoc.max_angles.middle) || 0,
      Number(maxDoc.max_angles.ring)   || 0,
      Number(maxDoc.max_angles.pinky)  || 0,
    ];
  }

  applyStateToInputs();
  _currentReps = 0;
  _currentSets = 0;
  _repLatched  = false;
  updateRepSetStatus();
  renderMatchGrid();
  setStatus('Exercise details loaded from database.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function updateRepSetStatus() {
  if (!repSetStatusEl) return;
  const targetReps = _doctorData.targetReps ?? '--';
  const targetSets = _doctorData.targetSets ?? '--';
  repSetStatusEl.textContent = `Reps: ${_currentReps} / ${targetReps} | Sets: ${_currentSets} / ${targetSets}`;
}

function setLoopBadge() {
  if (!loopBadgeEl) return;
  // patient_exercise.html:1063
  loopBadgeEl.textContent       = _isLoopRunning ? 'Loop Running' : 'Loop Stopped';
  loopBadgeEl.style.color       = _isLoopRunning ? '#166f3f' : '#9a6700';
  loopBadgeEl.style.background  = _isLoopRunning ? '#e8f7ef' : '#fff7e0';
  loopBadgeEl.style.borderColor = _isLoopRunning ? '#b7e3c9' : '#f0d491';
}

function getMatchBarColor(actual, target) {
  if (!Number.isFinite(actual) || target <= 0) return '#3b82f6';
  const ratio = actual / target;
  if (ratio > 1.05) return '#dc2626';
  if (ratio >= 0.95) return '#22c55e';
  return '#3b82f6';
}

/**
 * renderMatchGrid — patient_exercise.html:917
 * Full match grid including per-finger bars, rep/set counting, and overall badge.
 * Preserved verbatim — only _patientCalibration, _patientPacket, _doctorData
 * references changed from the module-local names to the view-controller-local names.
 */
function renderMatchGrid() {
  if (!matchGridEl || !overallMatchBadgeEl) return;

  if (!_patientCalibration.ready) {
    matchGridEl.innerHTML             = '';
    overallMatchBadgeEl.textContent   = 'Overall Match: Need Patient Calibration';
    overallMatchBadgeEl.style.color       = '#9a6700';
    overallMatchBadgeEl.style.background  = '#fff7e0';
    overallMatchBadgeEl.style.borderColor = '#f0d491';
    return;
  }

  const patientAngles   = packetToPatientAngles(_patientPacket);
  const targetMaxAngles = _doctorData.exerciseMax;
  const perFingerReached = [];
  matchGridEl.innerHTML = '';

  let sumScore  = 0;
  let validCount = 0;

  for (let i = 0; i < FINGER_LABELS.length; i += 1) {
    const target = Number(targetMaxAngles[i]) || 0;
    const actual = patientAngles[i];

    let score = 0;

    if (Number.isFinite(actual)) {
      const tolerance = Math.max(5, target * 0.1);
      const diff      = Math.max(0, target - actual);
      score           = clamp(1 - diff / (tolerance * 2), 0, 1);
      const reached   = actual >= (target - tolerance);
      perFingerReached[i] = reached;
      sumScore   += score;
      validCount += 1;
    }

    const row = document.createElement('div');
    row.className = 'match-row';

    const fill = document.createElement('div');
    fill.className = 'match-bar-fill';
    const fillPercent = Number.isFinite(actual) && target > 0
      ? clamp((actual / (target * 1.2)) * 100, 0, 100)
      : 0;
    fill.style.width = `${fillPercent.toFixed(0)}%`;
    fill.style.backgroundColor = getMatchBarColor(actual, target);

    const track = document.createElement('div');
    track.className = 'match-bar-track';
    track.appendChild(fill);
    track.insertAdjacentHTML('beforeend', '<div class="match-ceiling-line"></div>');

    row.innerHTML = `<span class="match-label">${FINGER_LABELS[i]}</span>`;
    row.appendChild(track);
    row.insertAdjacentHTML(
      'beforeend',
      `<span class="match-value">${Number.isFinite(actual) ? actual.toFixed(1) : '--'}&deg; / ${target.toFixed(1)}&deg;</span>`
    );
    matchGridEl.appendChild(row);
  }

  // ── Rep / set counting — patient_exercise.html:972 ──────────────────────
  if (validCount > 0) {
    const allReached = perFingerReached.length === FINGER_LABELS.length && perFingerReached.every(Boolean);
    const anyBelowReset = patientAngles.some((value, index) => {
      const target    = Number(targetMaxAngles[index]) || 0;
      const tolerance = Math.max(5, target * 0.1);
      return !Number.isFinite(value) || value < (target - tolerance);
    });

    if (allReached && !_repLatched) {
      _currentReps += 1;
      _repLatched   = true;
      const targetReps = Number(_doctorData.targetReps) || 0;
      const targetSets = Number(_doctorData.targetSets) || 0;
      if (targetReps > 0 && _currentReps >= targetReps) {
        _currentReps = 0;
        _currentSets += 1;
        if (targetSets > 0 && _currentSets >= targetSets) {
          setStatus('Target sets reached.');
          _isLoopRunning = false;
          setLoopBadge();
        }
      }
      updateRepSetStatus();
    }

    if (anyBelowReset && _repLatched) {
      _repLatched = false;
    }
  }

  if (validCount === 0) {
    overallMatchBadgeEl.textContent       = 'Overall Match: --';
    overallMatchBadgeEl.style.color       = '#9a6700';
    overallMatchBadgeEl.style.background  = '#fff7e0';
    overallMatchBadgeEl.style.borderColor = '#f0d491';
    return;
  }

  // patient_exercise.html:1011-1015
  const overall = sumScore / validCount;
  overallMatchBadgeEl.textContent       = `Overall Max Reached: ${(overall * 100).toFixed(0)}%`;
  overallMatchBadgeEl.style.color       = overall >= 0.75 ? '#166f3f' : (overall >= 0.45 ? '#9a6700' : '#8a1f1f');
  overallMatchBadgeEl.style.background  = overall >= 0.75 ? '#e8f7ef' : (overall >= 0.45 ? '#fff7e0' : '#fdecec');
  overallMatchBadgeEl.style.borderColor = overall >= 0.75 ? '#b7e3c9' : (overall >= 0.45 ? '#f0d491' : '#f2b7b7');
}

/**
 * renderTargetGrid — patient_exercise.html:891
 */
function renderTargetGrid() {
  if (!targetGridEl || !levelInfoEl) return;
  const levelAngle = getCurrentLevelAngle();
  const targets    = getTargetAngles();

  levelInfoEl.textContent = `Selected doctor level target angle: ${levelAngle}deg.`;
  targetGridEl.innerHTML  = '';

  for (let i = 0; i < FINGER_LABELS.length; i += 1) {
    const card = document.createElement('div');
    card.className = 'mini-card';
    card.innerHTML = `<strong>${FINGER_LABELS[i]}</strong><div>Exercise Max: ${_doctorData.exerciseMax[i].toFixed(1)}deg</div><div>Loop Target: ${targets[i].toFixed(1)}deg</div>`;
    targetGridEl.appendChild(card);
  }

  renderMatchGrid();
}

/**
 * buildDoctorTable — patient_exercise.html:1018
 */
function buildDoctorTable() {
  if (!doctorDataBody) return;
  doctorDataBody.innerHTML = '';
  for (let i = 0; i < FINGER_LABELS.length; i += 1) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${FINGER_LABELS[i]}</td>
      <td><input type="number" data-kind="min"      data-index="${i}" min="0"   max="255" step="1"   value="${_doctorData.calibMin[i]}"    /></td>
      <td><input type="number" data-kind="max"      data-index="${i}" min="0"   max="255" step="1"   value="${_doctorData.calibMax[i]}"    /></td>
      <td><input type="number" data-kind="exercise" data-index="${i}" min="0"   max="90"  step="0.1" value="${_doctorData.exerciseMax[i]}" /></td>
    `;
    doctorDataBody.appendChild(row);
  }
}

/**
 * pullInputsIntoState — patient_exercise.html:1032
 */
function pullInputsIntoState() {
  if (!doctorDataBody) return;
  doctorDataBody.querySelectorAll('input[data-kind]').forEach((input) => {
    const kind  = input.dataset.kind;
    const index = Number(input.dataset.index);
    const value = Number(input.value);
    if (kind === 'min')      _doctorData.calibMin[index]    = clamp(value, 0, 255);
    if (kind === 'max')      _doctorData.calibMax[index]    = clamp(value, 0, 255);
    if (kind === 'exercise') _doctorData.exerciseMax[index] = clamp(value, 0, 90);
  });
  if (levelSelect)  _doctorData.level   = clamp(Number(levelSelect.value), 1, 6);
  if (cycleMsInput) _doctorData.cycleMs = clamp(Number(cycleMsInput.value), 1000, 10000);
}

/**
 * applyStateToInputs — patient_exercise.html:1056
 */
function applyStateToInputs() {
  if (levelSelect)  levelSelect.value  = String(_doctorData.level);
  if (cycleMsInput) cycleMsInput.value = String(_doctorData.cycleMs);
  buildDoctorTable();
  renderTargetGrid();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED LIFECYCLE — mount() and unmount()
// ═══════════════════════════════════════════════════════════════════════════════

export function mount(container, gloveState, threeEngine) {
  _container = container;
  _state     = gloveState;
  _engine    = threeEngine;

  // Reset per-visit state
  _doctorData     = defaultDoctorData();
  _isLoopRunning  = true;
  _loopStartMs    = performance.now();
  _animatedAngles = [0, 0, 0, 0, 0];
  _patientPacket  = [...(_state.latestPacket || [0,0,0,0,0])];
  _currentReps    = 0;
  _currentSets    = 0;
  _repLatched     = false;

  // Priority: use GloveState's in-memory calibration (set by calibration view),
  // falling back to localStorage if the user hasn't calibrated in this session.
  _resolveCalibration();

  // ── Bind DOM refs (ALL via container.querySelector) ──────────────────
  statusEl             = container.querySelector('#exerciseStatus');
  levelInfoEl          = container.querySelector('#levelInfo');
  loopBadgeEl          = container.querySelector('#loopBadge');
  repSetStatusEl       = container.querySelector('#repSetStatus');
  doctorDataBody       = container.querySelector('#doctorDataBody');
  targetGridEl         = container.querySelector('#targetGrid');
  matchGridEl          = container.querySelector('#matchGrid');
  overallMatchBadgeEl  = container.querySelector('#overallMatchBadge');
  gloveStatusEl        = container.querySelector('#gloveStatus');
  patientCalibStatusEl = container.querySelector('#patientCalibStatus');
  connectGloveBtn      = container.querySelector('#connectGloveBtn');
  loadPatientCalibBtn  = container.querySelector('#loadPatientCalibBtn');
  startLoopBtn         = container.querySelector('#startLoopBtn');
  stopLoopBtn          = container.querySelector('#stopLoopBtn');
  resetPoseBtn         = container.querySelector('#resetPoseBtn');
  levelSelect          = container.querySelector('#levelSelect');
  cycleMsInput         = container.querySelector('#cycleMsInput');
  exerciseSelectEl     = container.querySelector('#exerciseSelect');
  exerciseDetailsEl    = container.querySelector('#exerciseDetails');
  exerciseForceLevelEl = container.querySelector('#exerciseForceLevel');
  sendExerciseMotorBtn = container.querySelector('#sendExerciseMotorBtn');
  exerciseMotorStatusEl = container.querySelector('#exerciseMotorStatus');

  // ── Reflect existing BLE connection state ─────────────────────────────
  if (_state.isConnected && connectGloveBtn) {
    connectGloveBtn.textContent = 'Glove Connected';
    connectGloveBtn.disabled    = true;
    if (gloveStatusEl) gloveStatusEl.textContent = 'Patient glove status: Connected.';
    updateMotorControlState();
  }

  // ── Wire GloveState callbacks ─────────────────────────────────────────

  _state.onPacket = (packet) => {
    // patient_exercise.html:1147-1148
    _patientPacket = packet;
    renderMatchGrid();
  };

  _state.onStatus = (msg) => {
    // patient_exercise.html:1136-1143
    if (gloveStatusEl) gloveStatusEl.textContent = `Patient glove status: ${msg}`;
    if (msg === 'Disconnected' && connectGloveBtn) {
      connectGloveBtn.disabled    = false;
      connectGloveBtn.textContent = 'Reconnect Patient Glove';
    }
    updateMotorControlState();
  };

  // ── Wire ThreeEngine tick — cosine wave loop animation ────────────────

  _engine.onTick = (nowMs) => {
    // patient_exercise.html:1290-1317 (renderLoop, excluding renderer/controls calls)
    const computedAngles = computeLoopAngles(nowMs);
    _animatedAngles = _animatedAngles.map((angle, index) =>
      _engine.THREE.MathUtils.lerp(angle, computedAngles[index], 0.2)
    );
    _engine.setPose(buildPoseFromAngles(_animatedAngles));
  };

  // ── Event listeners ───────────────────────────────────────────────────

  connectGloveBtn?.addEventListener('click', async () => {
    connectGloveBtn.disabled    = true;
    connectGloveBtn.textContent = 'Connecting...';
    try {
      await _state.connect();
      _state.isConnected          = true;
      connectGloveBtn.textContent = 'Glove Connected';
      if (gloveStatusEl) gloveStatusEl.textContent = 'Patient glove status: Connected.';
      updateMotorControlState();
      await hydratePatientCalibrationFromDatabase();
      setStatus('Patient glove connected. Follow the movement and watch match bars.');
    } catch (error) {
      console.error('[PreloadedCtrl] BLE connect failed:', error);
      _state.isConnected          = false;
      connectGloveBtn.textContent = 'Connect Patient Glove';
      connectGloveBtn.disabled    = false;
      updateMotorControlState();
      setStatus(`Patient glove connection failed: ${error?.name || 'Error'} - ${error?.message || 'Unknown'}`);
    }
  });

  loadPatientCalibBtn?.addEventListener('click', () => {
    // patient_exercise.html:1074-1081
    _resolveCalibration();  // Re-read from GloveState first, then localStorage
    renderPatientCalibrationStatus();
    _renderCalibrationBanner();  // Remove banner if calibration is now ready
    renderMatchGrid();
    setStatus(
      _patientCalibration.ready
        ? 'Patient calibration loaded. Match bars now use patient calibration values.'
        : 'Patient calibration not found. Please calibrate patient hand first.'
    );
  });

  exerciseSelectEl?.addEventListener('change', (event) => {
    applyExerciseSelection(event.target.value);
  });

  sendExerciseMotorBtn?.addEventListener('click', sendSelectedExerciseMotorLevel);

  levelSelect?.addEventListener('change', () => {
    pullInputsIntoState();
    renderTargetGrid();
    renderMatchGrid();
  });

  cycleMsInput?.addEventListener('change', () => {
    pullInputsIntoState();
    setStatus('Loop cycle updated.');
    renderMatchGrid();
  });

  doctorDataBody?.addEventListener('input', () => {
    pullInputsIntoState();
    renderTargetGrid();
    renderMatchGrid();
  });

  startLoopBtn?.addEventListener('click', () => {
    _isLoopRunning = true;
    _loopStartMs   = performance.now();
    setLoopBadge();
    setStatus('Exercise loop started.');
    renderMatchGrid();
  });

  stopLoopBtn?.addEventListener('click', () => {
    _isLoopRunning = false;
    setLoopBadge();
    setStatus('Exercise loop stopped.');
    renderMatchGrid();
  });

  resetPoseBtn?.addEventListener('click', () => {
    _animatedAngles = [0, 0, 0, 0, 0];
    setStatus('Pose reset to minimum angles.');
    renderMatchGrid();
  });

  // ── Initial render ────────────────────────────────────────────────────
  applyStateToInputs();
  renderPatientCalibrationStatus();
  _renderCalibrationBanner();     // Show immediately if not calibrated
  setLoopBadge();
  renderMatchGrid();
  updateRepSetStatus();
  setExerciseForceLevel(null);
  setStatus('Load an assigned exercise and start the loop.');

  // Load exercise list from API (non-blocking)
  loadExercisesForPatient();
}

export function unmount() {
  // ── Memory-leak contract ──────────────────────────────────────────────
  // 1. Null GloveState callbacks — prevents stale closures firing into a gone view
  if (_state) {
    _state.onPacket           = null;
    _state.onStatus           = null;
    _state.onConnectionChange = null;
  }
  // 2. Null ThreeEngine callbacks — stops cosine wave animation and pose updates
  if (_engine) {
    _engine.onTick        = null;
    _engine.onModelStatus = null;
    _engine.clearPose();
  }
  // 3. No window-level event listeners were added by this controller.
  //    (popstate, hashchange, spa:navigate are owned by router.js)
  //    DOM listeners are automatically GC'd when innerHTML is replaced.

  // 4. Null all DOM refs to break stale closure chains
  statusEl = levelInfoEl = loopBadgeEl = repSetStatusEl = null;
  doctorDataBody = targetGridEl = matchGridEl = overallMatchBadgeEl = null;
  gloveStatusEl = patientCalibStatusEl = null;
  connectGloveBtn = loadPatientCalibBtn = null;
  startLoopBtn = stopLoopBtn = resetPoseBtn = null;
  levelSelect = cycleMsInput = null;
  exerciseSelectEl = exerciseDetailsEl = null;
  exerciseForceLevelEl = sendExerciseMotorBtn = exerciseMotorStatusEl = null;
  _container = null;
}
