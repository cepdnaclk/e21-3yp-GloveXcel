const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const FINGER_LABELS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const SELECTED_PATIENT_KEY = 'doctorSelectedPatient';

let _container = null;
let _state = null;
let _patientsById = new Map();
let _selectedPatient = null;
let _exerciseNamesById = new Map();
let _analyticsRecords = [];
let _selectedExerciseId = '';
let _preloadedAnalyticsRecords = [];
let _selectedPreloadedExerciseId = '';

let titleEl = null;
let subtitleEl = null;
let patientSelectEl = null;
let refreshBtnEl = null;
let statusEl = null;
let exerciseCardsEl = null;
let graphTitleEl = null;
let chartEl = null;
let preloadedExerciseCardsEl = null;
let preloadedGraphTitleEl = null;
let preloadedChartEl = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDoctorId() {
  if (_state?.doctorId) return _state.doctorId;

  try {
    const profile = JSON.parse(localStorage.getItem('auth_profile') || '{}');
    if (profile?.doctor_id) return profile.doctor_id;
  } catch { /* fall through */ }

  return localStorage.getItem('doctorId') || '';
}

function getSelectedPatient() {
  try {
    const patient = JSON.parse(localStorage.getItem(SELECTED_PATIENT_KEY) || 'null');
    return patient?.patient_id ? patient : null;
  } catch {
    return null;
  }
}

function saveSelectedPatient(patient) {
  _selectedPatient = patient?.patient_id ? patient : null;
  if (_selectedPatient) {
    localStorage.setItem(SELECTED_PATIENT_KEY, JSON.stringify(_selectedPatient));
  } else {
    localStorage.removeItem(SELECTED_PATIENT_KEY);
  }
  updateHeader();
}

function patientOptionLabel(patient) {
  return patient?.name || patient?.patient_name || patient?.email || patient?.patient_email || patient?.patient_id || 'Unnamed patient';
}

function selectedPatientLabel() {
  return _selectedPatient ? patientOptionLabel(_selectedPatient) : '';
}

function exerciseDisplayName(item, index) {
  const exerciseId = item?.exercise_id || '';
  const mapped = _exerciseNamesById.get(exerciseId);
  if (mapped) return mapped;
  if (exerciseId.startsWith('live_ex_')) {
    const dateLabel = liveExerciseDateFromId(exerciseId) || formatExerciseShortDate(item?.updatedAt || item?.createdAt);
    return dateLabel ? `Live Exercise - ${dateLabel}` : 'Live Exercise';
  }
  return exerciseId || `Exercise ${index + 1}`;
}

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatExerciseShortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function liveExerciseDateFromId(exerciseId) {
  const match = String(exerciseId || '').match(/^live_ex_(\d+)_/);
  if (!match) return '';
  return formatExerciseShortDate(Number(match[1]));
}

function doctorDisplayName(doctorId) {
  if (!doctorId) return '--';

  try {
    const profile = JSON.parse(localStorage.getItem('auth_profile') || '{}');
    if (profile?.doctor_id === doctorId && profile?.name) {
      return profile.name;
    }
  } catch { /* fall through */ }

  return doctorId;
}

function formatAngle(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)} deg` : '--';
}

function setStatus(message, type = '') {
  if (!statusEl) return;
  statusEl.className = `progress-status ${type}`;
  statusEl.textContent = message || '';
}

function setLoading(isLoading) {
  if (refreshBtnEl) {
    refreshBtnEl.disabled = isLoading;
    refreshBtnEl.textContent = isLoading ? 'Loading...' : 'Refresh Progress';
  }
}

function updateHeader() {
  if (!titleEl || !subtitleEl) return;

  if (_selectedPatient) {
    const label = selectedPatientLabel();
    titleEl.textContent = `Patient Progress (Patient - ${label})`;
    subtitleEl.textContent = `Latest completed max angle data for ${label}.`;
    return;
  }

  titleEl.textContent = 'Patient Progress';
  subtitleEl.textContent = 'Latest saved max angle values from completed patient exercise activity.';
}

function renderPatientOptions() {
  if (!patientSelectEl) return;

  patientSelectEl.innerHTML = '';
  patientSelectEl.appendChild(new Option('-- Select patient --', ''));

  const patients = Array.from(_patientsById.values());
  patients.forEach((patient) => {
    patientSelectEl.appendChild(new Option(patientOptionLabel(patient), patient.patient_id));
  });

  if (_selectedPatient?.patient_id && !_patientsById.has(_selectedPatient.patient_id)) {
    patientSelectEl.appendChild(new Option(patientOptionLabel(_selectedPatient), _selectedPatient.patient_id));
  }

  patientSelectEl.value = _selectedPatient?.patient_id || '';
  patientSelectEl.disabled = patientSelectEl.options.length <= 1;
}

function renderChartEmpty(message, targetChartEl = chartEl, targetGraphTitleEl = graphTitleEl, title = 'Max Angles by Exercise') {
  if (!targetChartEl) return;
  targetChartEl.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  if (targetGraphTitleEl) targetGraphTitleEl.textContent = title;
}

function renderCardsEmpty(message, targetCardsEl = exerciseCardsEl) {
  if (!targetCardsEl) return;
  targetCardsEl.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderExerciseCards(analytics) {
  if (!exerciseCardsEl) return;

  if (!Array.isArray(analytics) || analytics.length === 0) {
    renderCardsEmpty('No completed progress data has been saved for this patient yet.');
    return;
  }

  exerciseCardsEl.innerHTML = analytics.map((item, index) => {
    const exerciseId = item?.exercise_id || '';
    const forceLevel = Number(item?.force_level);
    const forceLabel = Number.isFinite(forceLevel) ? forceLevel : '--';
    const isSelected = exerciseId === _selectedExerciseId;

    return `
      <button
        class="progress-exercise-card${isSelected ? ' is-selected' : ''}"
        type="button"
        data-exercise-id="${escapeHtml(exerciseId)}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
      >
        <span class="progress-exercise-card-top">
          <span class="progress-exercise-card-name">${escapeHtml(exerciseDisplayName(item, index))}</span>
          <span class="progress-exercise-force-badge">Level ${escapeHtml(forceLabel)}</span>
        </span>
        <span class="progress-exercise-card-meta">Updated ${escapeHtml(formatDate(item?.updatedAt))}</span>
      </button>
    `;
  }).join('');

  exerciseCardsEl.querySelectorAll('.progress-exercise-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectProgressExercise(card.dataset.exerciseId);
    });
  });
}

function renderPreloadedExerciseCards(analytics) {
  if (!preloadedExerciseCardsEl) return;

  if (!Array.isArray(analytics) || analytics.length === 0) {
    renderCardsEmpty('No completed preloaded progress data has been saved for this patient yet.', preloadedExerciseCardsEl);
    return;
  }

  preloadedExerciseCardsEl.innerHTML = analytics.map((item, index) => {
    const exerciseId = item?.exercise_id || '';
    const forceLevel = Number(item?.force_level);
    const forceLabel = Number.isFinite(forceLevel) ? forceLevel : '--';
    const isSelected = exerciseId === _selectedPreloadedExerciseId;

    return `
      <button
        class="progress-exercise-card${isSelected ? ' is-selected' : ''}"
        type="button"
        data-exercise-id="${escapeHtml(exerciseId)}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
      >
        <span class="progress-exercise-card-top">
          <span class="progress-exercise-card-name">${escapeHtml(exerciseDisplayName(item, index))}</span>
          <span class="progress-exercise-force-badge">Level ${escapeHtml(forceLabel)}</span>
        </span>
        <span class="progress-exercise-card-meta">Updated ${escapeHtml(formatDate(item?.updatedAt))}</span>
      </button>
    `;
  }).join('');

  preloadedExerciseCardsEl.querySelectorAll('.progress-exercise-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectPreloadedProgressExercise(card.dataset.exerciseId);
    });
  });
}

function renderSelectedChart() {
  if (!chartEl) return;

  if (!_analyticsRecords.length) {
    renderChartEmpty('Select an exercise card to view its max angle graph.');
    return;
  }

  const selected = _analyticsRecords.find((item) => item?.exercise_id === _selectedExerciseId) || _analyticsRecords[0];
  if (!selected) {
    renderChartEmpty('Select an exercise card to view its max angle graph.');
    return;
  }

  _selectedExerciseId = selected.exercise_id || '';
  const selectedIndex = _analyticsRecords.indexOf(selected);
  const selectedName = exerciseDisplayName(selected, selectedIndex);
  if (graphTitleEl) graphTitleEl.textContent = `Max Angles - ${selectedName}`;

  const bars = FINGER_KEYS.map((finger, fingerIndex) => {
    const value = Number(selected?.max_angles?.[finger]);
    const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, (value / 90) * 100)) : 0;
    return `
      <div class="progress-bar-cell">
        <div class="progress-bar-track" aria-hidden="true">
          <div
            class="progress-bar-fill"
            style="height:${percent.toFixed(1)}%;"
          ></div>
        </div>
        <div class="progress-bar-value">${escapeHtml(formatAngle(value))}</div>
        <div class="progress-bar-label">${escapeHtml(FINGER_LABELS[fingerIndex])}</div>
      </div>
    `;
  }).join('');

  const forceLevel = Number(selected?.force_level);
  const forceLabel = Number.isFinite(forceLevel) ? `Level ${forceLevel}` : 'Level --';

  chartEl.innerHTML = `
    <article class="progress-selected-exercise">
      <div class="progress-selected-exercise-head">
        <div class="progress-selected-exercise-name">${escapeHtml(selectedName)}</div>
        <div class="progress-selected-exercise-meta">
          <div>${escapeHtml(forceLabel)}</div>
          <div>Updated: ${escapeHtml(formatDate(selected?.updatedAt))}</div>
        </div>
      </div>
      <div class="progress-bars">${bars}</div>
    </article>
  `;
}

function renderPreloadedSelectedChart() {
  if (!preloadedChartEl) return;

  if (!_preloadedAnalyticsRecords.length) {
    renderChartEmpty(
      'Select a preloaded exercise card to view its max angle graph.',
      preloadedChartEl,
      preloadedGraphTitleEl,
      'Max Angles by Preloaded Exercise'
    );
    return;
  }

  const selected = _preloadedAnalyticsRecords.find((item) => item?.exercise_id === _selectedPreloadedExerciseId) || _preloadedAnalyticsRecords[0];
  if (!selected) {
    renderChartEmpty(
      'Select a preloaded exercise card to view its max angle graph.',
      preloadedChartEl,
      preloadedGraphTitleEl,
      'Max Angles by Preloaded Exercise'
    );
    return;
  }

  _selectedPreloadedExerciseId = selected.exercise_id || '';
  const selectedIndex = _preloadedAnalyticsRecords.indexOf(selected);
  const selectedName = exerciseDisplayName(selected, selectedIndex);
  if (preloadedGraphTitleEl) preloadedGraphTitleEl.textContent = `Max Angles - ${selectedName}`;

  const bars = FINGER_KEYS.map((finger, fingerIndex) => {
    const value = Number(selected?.max_angles?.[finger]);
    const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, (value / 90) * 100)) : 0;
    return `
      <div class="progress-bar-cell">
        <div class="progress-bar-track" aria-hidden="true">
          <div
            class="progress-bar-fill"
            style="height:${percent.toFixed(1)}%;"
          ></div>
        </div>
        <div class="progress-bar-value">${escapeHtml(formatAngle(value))}</div>
        <div class="progress-bar-label">${escapeHtml(FINGER_LABELS[fingerIndex])}</div>
      </div>
    `;
  }).join('');

  const forceLevel = Number(selected?.force_level);
  const forceLabel = Number.isFinite(forceLevel) ? `Level ${forceLevel}` : 'Level --';

  preloadedChartEl.innerHTML = `
    <article class="progress-selected-exercise">
      <div class="progress-selected-exercise-head">
        <div class="progress-selected-exercise-name">${escapeHtml(selectedName)}</div>
        <div class="progress-selected-exercise-meta">
          <div>${escapeHtml(forceLabel)}</div>
          <div>Updated: ${escapeHtml(formatDate(selected?.updatedAt))}</div>
        </div>
      </div>
      <div class="progress-bars">${bars}</div>
    </article>
  `;
}

function selectProgressExercise(exerciseId) {
  _selectedExerciseId = exerciseId || '';
  renderExerciseCards(_analyticsRecords);
  renderSelectedChart();
}

function selectPreloadedProgressExercise(exerciseId) {
  _selectedPreloadedExerciseId = exerciseId || '';
  renderPreloadedExerciseCards(_preloadedAnalyticsRecords);
  renderPreloadedSelectedChart();
}

async function loadPatients() {
  if (!patientSelectEl || !_state) return;

  patientSelectEl.innerHTML = '<option value="">-- Loading patients... --</option>';
  patientSelectEl.disabled = true;

  try {
    const resp = await fetch(`${_state.apiBase}/api/auth/patients`, {
      headers: _state.getAuthHeaders()
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const patients = Array.isArray(data.patients) ? data.patients : [];
    _patientsById = new Map(
      patients
        .filter((patient) => patient?.patient_id)
        .map((patient) => [patient.patient_id, patient])
    );

    if (_selectedPatient?.patient_id && _patientsById.has(_selectedPatient.patient_id)) {
      saveSelectedPatient(_patientsById.get(_selectedPatient.patient_id));
    } else {
      updateHeader();
    }

    renderPatientOptions();
  } catch (error) {
    console.error('[DoctorProgress] Failed to load patients:', error);
    _patientsById = new Map();
    renderPatientOptions();
    setStatus('Failed to load patient list. You can still view the previously selected patient.', 'error');
  }
}

async function loadExerciseNames(patientId, doctorId = '') {
  _exerciseNamesById = new Map();
  if (!patientId || !_state) return;

  try {
    const params = new URLSearchParams({ patient_id: patientId });
    if (doctorId) params.set('doctor_id', doctorId);

    const resp = await fetch(`${_state.apiBase}/api/exercises?${params.toString()}`, {
      headers: _state.getAuthHeaders()
    });
    if (!resp.ok) return;

    const data = await resp.json();
    const exercises = Array.isArray(data.exercises) ? data.exercises : [];
    _exerciseNamesById = new Map(
      exercises
        .filter((exercise) => exercise?.exercise_id)
        .map((exercise) => [
          exercise.exercise_id,
          exercise.description || exercise.exercise_name || exercise.exercise_id
        ])
    );
  } catch (error) {
    console.warn('[DoctorProgress] Failed to load exercise names:', error);
  }
}

async function loadProgress() {
  if (!_state || !chartEl) return;

  const patientId = _selectedPatient?.patient_id || '';
  const doctorId = getDoctorId();

  if (!patientId) {
    _analyticsRecords = [];
    _selectedExerciseId = '';
    _preloadedAnalyticsRecords = [];
    _selectedPreloadedExerciseId = '';
    renderCardsEmpty('Select a patient to view saved exercises.');
    renderChartEmpty('Select an exercise card to view its max angle graph.');
    renderCardsEmpty('Select a patient to view saved preloaded exercises.', preloadedExerciseCardsEl);
    renderChartEmpty(
      'Select a preloaded exercise card to view its max angle graph.',
      preloadedChartEl,
      preloadedGraphTitleEl,
      'Max Angles by Preloaded Exercise'
    );
    setStatus('');
    return;
  }

  if (!doctorId) {
    _analyticsRecords = [];
    _selectedExerciseId = '';
    _preloadedAnalyticsRecords = [];
    _selectedPreloadedExerciseId = '';
    renderCardsEmpty('Doctor session was not found. Please log in again.');
    renderChartEmpty('Doctor session was not found. Please log in again.');
    renderCardsEmpty('Doctor session was not found. Please log in again.', preloadedExerciseCardsEl);
    renderChartEmpty(
      'Doctor session was not found. Please log in again.',
      preloadedChartEl,
      preloadedGraphTitleEl,
      'Max Angles by Preloaded Exercise'
    );
    setStatus('Doctor session was not found.', 'error');
    return;
  }

  setLoading(true);
  setStatus(`Loading latest progress for ${selectedPatientLabel() || patientId}...`);

  try {
    await loadExerciseNames(patientId, doctorId);
    const params = new URLSearchParams({
      patient_id: patientId,
      doctor_id: doctorId
    });
    const [liveResp, preloadedResp] = await Promise.all([
      fetch(`${_state.apiBase}/api/live-analytics?${params.toString()}`, {
        headers: _state.getAuthHeaders()
      }),
      fetch(`${_state.apiBase}/api/preloaded-analytics?${params.toString()}`, {
        headers: _state.getAuthHeaders()
      })
    ]);
    const liveData = await liveResp.json().catch(() => ({}));
    const preloadedData = await preloadedResp.json().catch(() => ({}));

    if (!liveResp.ok) {
      throw new Error(liveData.error || liveData.message || `Live analytics HTTP ${liveResp.status}`);
    }
    if (!preloadedResp.ok) {
      throw new Error(preloadedData.error || preloadedData.message || `Preloaded analytics HTTP ${preloadedResp.status}`);
    }

    const analytics = Array.isArray(liveData.analytics) ? liveData.analytics : [];
    const preloadedAnalytics = Array.isArray(preloadedData.analytics) ? preloadedData.analytics : [];
    _analyticsRecords = analytics;
    _preloadedAnalyticsRecords = preloadedAnalytics;
    if (!analytics.some((item) => item?.exercise_id === _selectedExerciseId)) {
      _selectedExerciseId = analytics[0]?.exercise_id || '';
    }
    if (!preloadedAnalytics.some((item) => item?.exercise_id === _selectedPreloadedExerciseId)) {
      _selectedPreloadedExerciseId = preloadedAnalytics[0]?.exercise_id || '';
    }
    renderExerciseCards(analytics);
    renderSelectedChart();
    renderPreloadedExerciseCards(preloadedAnalytics);
    renderPreloadedSelectedChart();
    setStatus(
      analytics.length || preloadedAnalytics.length
        ? `Showing ${analytics.length} live and ${preloadedAnalytics.length} preloaded progress record${analytics.length + preloadedAnalytics.length === 1 ? '' : 's'}.`
        : 'No saved progress data for this patient yet.'
    );
  } catch (error) {
    console.error('[DoctorProgress] Failed to load progress:', error);
    _analyticsRecords = [];
    _selectedExerciseId = '';
    _preloadedAnalyticsRecords = [];
    _selectedPreloadedExerciseId = '';
    renderCardsEmpty('Failed to load patient progress.');
    renderChartEmpty('Failed to load patient progress.');
    renderCardsEmpty('Failed to load preloaded patient progress.', preloadedExerciseCardsEl);
    renderChartEmpty(
      'Failed to load preloaded patient progress.',
      preloadedChartEl,
      preloadedGraphTitleEl,
      'Max Angles by Preloaded Exercise'
    );
    setStatus(`Failed to load progress: ${error.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

export function mount(container, gloveState) {
  _container = container;
  _state = gloveState;
  _patientsById = new Map();
  _selectedPatient = getSelectedPatient();
  _exerciseNamesById = new Map();

  titleEl = container.querySelector('#patientProgressTitle');
  subtitleEl = container.querySelector('#patientProgressSubtitle');
  patientSelectEl = container.querySelector('#progressPatientSelect');
  refreshBtnEl = container.querySelector('#progressRefreshBtn');
  statusEl = container.querySelector('#progressStatus');
  exerciseCardsEl = container.querySelector('#progressExerciseCards');
  graphTitleEl = container.querySelector('#progressGraphTitle');
  chartEl = container.querySelector('#progressChart');
  preloadedExerciseCardsEl = container.querySelector('#progressPreloadedExerciseCards');
  preloadedGraphTitleEl = container.querySelector('#progressPreloadedGraphTitle');
  preloadedChartEl = container.querySelector('#progressPreloadedChart');

  updateHeader();
  renderCardsEmpty(_selectedPatient ? 'Loading saved exercises...' : 'Select a patient to view saved exercises.');
  renderChartEmpty('Select an exercise card to view its max angle graph.');
  renderCardsEmpty(
    _selectedPatient ? 'Loading saved preloaded exercises...' : 'Select a patient to view saved preloaded exercises.',
    preloadedExerciseCardsEl
  );
  renderChartEmpty(
    'Select a preloaded exercise card to view its max angle graph.',
    preloadedChartEl,
    preloadedGraphTitleEl,
    'Max Angles by Preloaded Exercise'
  );

  patientSelectEl?.addEventListener('change', () => {
    const patientId = patientSelectEl.value;
    const patient = patientId
      ? _patientsById.get(patientId) || { patient_id: patientId }
      : null;
    saveSelectedPatient(patient);
    _analyticsRecords = [];
    _selectedExerciseId = '';
    _preloadedAnalyticsRecords = [];
    _selectedPreloadedExerciseId = '';
    renderPatientOptions();
    loadProgress();
  });

  refreshBtnEl?.addEventListener('click', loadProgress);

  loadPatients().finally(() => {
    if (_selectedPatient?.patient_id) {
      loadProgress();
    }
  });
}

export function unmount() {
  _container = null;
  _state = null;
  _patientsById = new Map();
  _selectedPatient = null;
  _exerciseNamesById = new Map();
  _analyticsRecords = [];
  _selectedExerciseId = '';
  _preloadedAnalyticsRecords = [];
  _selectedPreloadedExerciseId = '';
  titleEl = subtitleEl = patientSelectEl = refreshBtnEl = statusEl = null;
  exerciseCardsEl = graphTitleEl = chartEl = null;
  preloadedExerciseCardsEl = preloadedGraphTitleEl = preloadedChartEl = null;
}
