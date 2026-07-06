/**
 * doctorPreloadedController.js
 *
 * View controller for the Exercise Builder.
 * Captures live doctor glove pose as target angles and assigns exercises to patients.
 */

const FINGER_LABELS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const EXERCISE_STORAGE_KEY = 'doctorExercisesV1';
const SELECTED_PATIENT_KEY = 'doctorSelectedPatient';
const BLE_MOTOR_CMD_UUID = '11111111-2222-3333-4444-555555555555';

let _state = null;
let _engine = null;
let _container = null;

let _exercises = [];
let _exerciseDraft = { thumb: null, index: null, middle: null, ring: null, pinky: null };
let _motorLevelApproved = false;
let _selectedPatient = null;

// DOM refs
let exerciseBuilderTitle, exerciseBuilderSubtitle;
let exercisePatientId, exerciseDescription, exerciseMotorLevel, testMotorBtn, resetMotorBtn, motorStatus;
let exerciseTargetSets, exerciseTargetReps, exerciseStartDate, exerciseEndDate;
let exThumb, exIndex, exMiddle, exRing, exPinky;
let capturePoseBtn, resetPoseBtn, saveExerciseBtn, exportExerciseBtn, savedExercisesList;

// ── Math Helpers ──
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function rawToAngle(rawValue, minValue, maxValue) {
  if (minValue === null || maxValue === null || minValue === maxValue) return null;
  const t = (rawValue - minValue) / (maxValue - minValue);
  return clamp(t * 90, 0, 90);
}

function getCurrentAngles() {
  const cal = _state.doctorCalibration;
  if (!cal || !cal.ready) return [null, null, null, null, null];
  
  return FINGER_KEYS.map((_, index) => {
    const angle = rawToAngle(_state.latestPacket[index], cal.min[index], cal.max[index]);
    return angle === null ? null : Number(angle.toFixed(1));
  });
}

// ── Storage Helpers ──
function loadExercises() {
  try {
    const raw = localStorage.getItem(EXERCISE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveExercisesLocally() {
  localStorage.setItem(EXERCISE_STORAGE_KEY, JSON.stringify(_exercises));
}

function generateExerciseId() {
  return `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDoctorId() {
  try {
    const profile = JSON.parse(localStorage.getItem('auth_profile') || '{}');
    if (profile?.doctor_id) return profile.doctor_id;
  } catch { /* fall through */ }

  return localStorage.getItem('doctorId') || 'DOC-1b402238f4ad4c92a7deedbc1a53c813';
}

function getSelectedPatient() {
  try {
    const patient = JSON.parse(localStorage.getItem(SELECTED_PATIENT_KEY) || 'null');
    return patient?.patient_id ? patient : null;
  } catch {
    return null;
  }
}

function selectedPatientLabel() {
  if (!_selectedPatient) return '';
  return _selectedPatient.name || _selectedPatient.patient_id;
}

function updateSelectedPatientHeader() {
  if (!exerciseBuilderTitle || !exerciseBuilderSubtitle) return;

  if (_selectedPatient) {
    const label = selectedPatientLabel();
    exerciseBuilderTitle.textContent = `Exercise Builder (Patient - ${label})`;
    exerciseBuilderSubtitle.textContent = `Creating exercises for ${label} (${_selectedPatient.patient_id}).`;
    return;
  }

  exerciseBuilderTitle.textContent = 'Exercise Builder';
  exerciseBuilderSubtitle.textContent = 'Capture your live glove pose to create and assign exercises to patients.';
}

// ── API Calls ──
async function loadPatients() {
  if (!exercisePatientId) return;
  exercisePatientId.innerHTML = '<option value="">-- Loading patients... --</option>';
  try {
    const resp = await fetch(`${_state.apiBase}/api/auth/patients`, { headers: _state.getAuthHeaders() });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const patients = Array.isArray(data.patients) ? data.patients : [];
    
    let html = '<option value="">-- Select patient --</option>';
    patients.forEach(p => {
      html += `<option value="${p.patient_id}">${p.patient_id} - ${p.name || 'Unnamed'}</option>`;
    });
    exercisePatientId.innerHTML = html;

    if (_selectedPatient?.patient_id) {
      const existingOption = Array.from(exercisePatientId.options).some(option => option.value === _selectedPatient.patient_id);
      if (!existingOption) {
        const option = document.createElement('option');
        option.value = _selectedPatient.patient_id;
        option.textContent = `${_selectedPatient.patient_id} - ${_selectedPatient.name || 'Selected patient'}`;
        exercisePatientId.appendChild(option);
      }
      exercisePatientId.value = _selectedPatient.patient_id;
    }

    exercisePatientId.disabled = false;
  } catch (err) {
    console.error('[DoctorPreloaded] Failed to load patients:', err);
    exercisePatientId.innerHTML = '<option value="">-- Failed to load patients --</option>';
  }
}

// ── UI Updates ──
function updateCaptureUI() {
  const calReady = _state.doctorCalibration && _state.doctorCalibration.ready;
  const canCapture = calReady && _state.isConnected;
  
  capturePoseBtn.disabled = !canCapture;
  
  [exThumb, exIndex, exMiddle, exRing, exPinky].forEach((el, i) => {
    const val = _exerciseDraft[FINGER_KEYS[i]];
    if (el) {
      el.value = val === null ? '' : val.toFixed(1);
      el.dispatchEvent(new Event('input'));
    }
  });
  
  const allCaptured = FINGER_KEYS.every(k => _exerciseDraft[k] !== null);
  saveExerciseBtn.disabled = !allCaptured;
}

function renderExerciseList() {
  if (!savedExercisesList) return;
  savedExercisesList.innerHTML = '';

  const visibleExercises = _selectedPatient?.patient_id
    ? _exercises.filter(ex => ex.patient_id === _selectedPatient.patient_id)
    : _exercises;
  
  if (!visibleExercises.length) {
    savedExercisesList.innerHTML = _selectedPatient?.patient_id
      ? '<li>No exercises saved for this patient yet.</li>'
      : '<li>No exercises saved yet.</li>';
    return;
  }
  
  visibleExercises.forEach(ex => {
    const li = document.createElement('li');
    li.textContent = `${ex.exercise_id} | Pt: ${ex.patient_id} | ${ex.description} | Sets: ${ex.target_sets} | Reps: ${ex.target_reps}`;
    savedExercisesList.appendChild(li);
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
      You cannot capture exercise target angles until the doctor glove is calibrated.
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
  
  _exercises = loadExercises();
  _selectedPatient = getSelectedPatient();
  
  // DOM Bindings
  exerciseBuilderTitle = container.querySelector('#exerciseBuilderTitle');
  exerciseBuilderSubtitle = container.querySelector('#exerciseBuilderSubtitle');
  exercisePatientId   = container.querySelector('#exercisePatientId');
  exerciseDescription = container.querySelector('#exerciseDescription');
  exerciseMotorLevel  = container.querySelector('#exerciseMotorLevel');
  testMotorBtn        = container.querySelector('#testMotorBtn');
  resetMotorBtn       = container.querySelector('#resetMotorBtn');
  motorStatus         = container.querySelector('#motorStatus');
  exerciseTargetSets  = container.querySelector('#exerciseTargetSets');
  exerciseTargetReps  = container.querySelector('#exerciseTargetReps');
  exerciseStartDate   = container.querySelector('#exerciseStartDate');
  exerciseEndDate     = container.querySelector('#exerciseEndDate');
  
  exThumb = container.querySelector('#exThumb');
  exIndex = container.querySelector('#exIndex');
  exMiddle = container.querySelector('#exMiddle');
  exRing = container.querySelector('#exRing');
  exPinky = container.querySelector('#exPinky');
  
  capturePoseBtn = container.querySelector('#capturePoseBtn');
  resetPoseBtn = container.querySelector('#resetPoseBtn');
  saveExerciseBtn = container.querySelector('#saveExerciseBtn');
  exportExerciseBtn = container.querySelector('#exportExerciseBtn');
  savedExercisesList = container.querySelector('#savedExercisesList');
  
  // Init API & UI
  updateSelectedPatientHeader();
  loadPatients();
  renderExerciseList();
  renderCalibrationBanner();
  updateCaptureUI();
  
  // Event Listeners
  capturePoseBtn.addEventListener('click', () => {
    const angles = getCurrentAngles();
    if (angles.some(a => a === null)) {
      alert('Cannot capture: Missing calibration data or disconnected.');
      return;
    }
    FINGER_KEYS.forEach((k, i) => { _exerciseDraft[k] = angles[i]; });
    updateCaptureUI();
  });
  
  resetPoseBtn.addEventListener('click', () => {
    FINGER_KEYS.forEach(k => { _exerciseDraft[k] = null; });
    updateCaptureUI();
  });
  
  exerciseMotorLevel.addEventListener('keydown', (e) => {
    // Only allow numbers and control keys
    if (!/^[0-9]$/.test(e.key) && !['Backspace', 'ArrowLeft', 'ArrowRight', 'Tab', 'Delete'].includes(e.key)) {
      e.preventDefault();
    }
  });

  exerciseMotorLevel.addEventListener('input', (e) => {
    let val = parseInt(e.target.value, 10);
    if (!isNaN(val)) {
      if (val > 10) e.target.value = '10';
      if (val < 1) e.target.value = ''; // Let the user clear it
    } else {
      e.target.value = '';
    }
    _motorLevelApproved = false;
    motorStatus.textContent = 'Motor not tested.';
  });
  
  testMotorBtn.addEventListener('click', async () => {
    const level = Number(exerciseMotorLevel.value);
    if (!Number.isFinite(level) || level < 1 || level > 10) {
      alert('Please enter a valid motor force level (1-10).');
      return;
    }
    try {
      if (!_state.isConnected) {
        throw new Error('Glove is not connected.');
      }
      await _state.bleClient.sendMotorLevel(level);
      _motorLevelApproved = true;
      motorStatus.textContent = `Motor level ${Math.round(level)} applied.`;
    } catch (err) {
      console.error('[DoctorPreloaded] Motor command failed:', err);
      alert(`Motor command failed: ${err.message}`);
    }
  });
  
  resetMotorBtn.addEventListener('click', () => {
    _motorLevelApproved = false;
    motorStatus.textContent = 'Motor reset to 0.';
  });
  
  saveExerciseBtn.addEventListener('click', async () => {
    const patientId = _selectedPatient?.patient_id || exercisePatientId.value;
    const desc = exerciseDescription.value.trim();
    const sets = Number(exerciseTargetSets.value);
    const reps = Number(exerciseTargetReps.value);
    
    if (!patientId || !desc || !sets || !reps) {
      alert('Please fill out all required fields (Patient, Description, Sets, Reps).');
      return;
    }
    if (!_motorLevelApproved) {
      alert('Please test the motor force level before saving.');
      return;
    }
    
    const today = new Date().toISOString().slice(0, 10);
    const startDate = exerciseStartDate.value || today;
    const endDate = exerciseEndDate.value || startDate;

    const payload = {
      exercise_id: generateExerciseId(),
      description: desc,
      level: Number(exerciseMotorLevel.value),
      target_sets: sets,
      target_reps: reps,
      start_date: startDate,
      end_date: endDate,
      patient_id: patientId,
      doctor_id: getDoctorId(),
      max_angles: { ..._exerciseDraft }
    };
    
    try {
      const resp = await fetch(`${_state.apiBase}/api/exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._state.getAuthHeaders() },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      
      const data = await resp.json();
      _exercises.push(data.data || payload);
      saveExercisesLocally();
      renderExerciseList();
      
      // Clear form
      exerciseDescription.value = '';
      exerciseTargetSets.value = '';
      exerciseTargetReps.value = '';
      if (_selectedPatient?.patient_id) exercisePatientId.value = _selectedPatient.patient_id;
      FINGER_KEYS.forEach(k => { _exerciseDraft[k] = null; });
      updateCaptureUI();
      alert('Exercise saved to database successfully.');
    } catch (err) {
      console.error('[DoctorPreloaded] Save failed:', err);
      alert('Failed to save exercise to database.');
    }
  });
  
  exportExerciseBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(_exercises, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'doctor-exercises.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  
  // Wire State
  _state.onPacket = (packet) => {
    // Optional: we don't strictly need to render live data here,
    // we just need it available when clicking "Capture".
  };
  
  _state.onStatus = (msg) => {
    updateCaptureUI();
  };
  
  _state.onConnectionChange = (connected) => {
    updateCaptureUI();
  };
  
  _engine.onTick = null;
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
  
  exerciseBuilderTitle = exerciseBuilderSubtitle = null;
  exercisePatientId = exerciseDescription = exerciseMotorLevel = null;
  testMotorBtn = resetMotorBtn = motorStatus = null;
  exerciseTargetSets = exerciseTargetReps = exerciseStartDate = exerciseEndDate = null;
  exThumb = exIndex = exMiddle = exRing = exPinky = null;
  capturePoseBtn = resetPoseBtn = saveExerciseBtn = exportExerciseBtn = savedExercisesList = null;
  _selectedPatient = null;
  _container = null;
}
