let _container = null;
let _state = null;
let requestsListEl = null;
let patientsListEl = null;
let patientSearchFormEl = null;
let patientSearchInputEl = null;
let patientsStatusEl = null;
let approvedPatients = [];
let patientSearchTerm = '';
const SELECTED_PATIENT_KEY = 'doctorSelectedPatient';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function patientName(item) {
  return item.patient_name || item.name || item.patient_id || 'Unnamed patient';
}

function patientMeta(item) {
  const parts = [
    item.patient_id ? `ID: ${item.patient_id}` : '',
    item.patient_email || item.email ? `Email: ${item.patient_email || item.email}` : '',
    item.patient_age !== null && item.patient_age !== undefined
      ? `Age: ${item.patient_age}`
      : (item.age !== null && item.age !== undefined ? `Age: ${item.age}` : ''),
    item.hospital_name || item.primary_hospital_id ? `Hospital: ${item.hospital_name || item.primary_hospital_id}` : '',
  ].filter(Boolean);

  return parts.map(escapeHtml).join('<br>');
}

function patientContext(item) {
  return {
    patient_id: item.patient_id || '',
    name: patientName(item),
    email: item.patient_email || item.email || '',
    age: item.patient_age ?? item.age ?? '',
    hospital: item.hospital_name || item.primary_hospital_id || ''
  };
}

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function patientSearchText(item) {
  return [
    patientName(item),
    item.patient_id,
    item.patient_email,
    item.email,
    item.patient_age,
    item.age,
    item.hospital_name,
    item.primary_hospital_id
  ].filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();
}

function filteredPatients() {
  const term = patientSearchTerm.trim().toLowerCase();
  if (!term) return approvedPatients;
  return approvedPatients.filter((patient) => patientSearchText(patient).includes(term));
}

function setPatientStatus(message, isError = false) {
  if (!patientsStatusEl) return;
  patientsStatusEl.textContent = message || '';
  patientsStatusEl.classList.toggle('error-state', Boolean(isError));
}

function getAuthRole() {
  return String(localStorage.getItem('auth_role') || '').trim().toLowerCase();
}

function renderPermissionMessage(message) {
  const html = `<div class="error-state">${escapeHtml(message)}</div>`;
  if (requestsListEl) requestsListEl.innerHTML = html;
  if (patientsListEl) patientsListEl.innerHTML = html;
}

function renderRequests(requests) {
  if (!requestsListEl) return;

  if (!Array.isArray(requests) || requests.length === 0) {
    requestsListEl.innerHTML = '<div class="empty-state">No pending channeling requests.</div>';
    return;
  }

  requestsListEl.innerHTML = requests.map((request) => `
    <article class="patient-card">
      <div class="patient-card-header">
        <div>
          <div class="patient-name">${escapeHtml(patientName(request))}</div>
          <div class="patient-meta">
            ${patientMeta(request)}
            <br>Requested: ${escapeHtml(formatDate(request.requested_at))}
          </div>
        </div>
        <div class="request-actions">
          <button class="btn-success approve-request-btn" type="button" data-request-id="${escapeHtml(request.request_id)}">
            Approve
          </button>
          <button class="btn-secondary reject-request-btn" type="button" data-request-id="${escapeHtml(request.request_id)}">
            Reject
          </button>
        </div>
      </div>
    </article>
  `).join('');

  requestsListEl.querySelectorAll('.approve-request-btn').forEach((button) => {
    button.addEventListener('click', () => updateRequest(button.dataset.requestId, 'approved'));
  });
  requestsListEl.querySelectorAll('.reject-request-btn').forEach((button) => {
    button.addEventListener('click', () => updateRequest(button.dataset.requestId, 'rejected'));
  });
}

function renderPatients(patients) {
  if (!patientsListEl) return;

  if (!Array.isArray(patients) || patients.length === 0) {
    patientsListEl.innerHTML = patientSearchTerm
      ? '<div class="empty-state">No patients match your search.</div>'
      : '<div class="empty-state">No approved patients yet.</div>';
    return;
  }

  patientsListEl.innerHTML = patients.map((patient) => `
    <article class="patient-card">
      <div class="patient-card-header">
        <div>
          <div class="patient-name">${escapeHtml(patientName(patient))}</div>
          <div class="patient-meta">
            ${patientMeta(patient)}
            <br>Approved: ${escapeHtml(formatDate(patient.responded_at))}
          </div>
        </div>
        <div class="request-actions">
          <button
            class="btn-primary patient-action-btn"
            type="button"
            data-route="doctor-preloaded"
            data-patient="${escapeHtml(JSON.stringify(patientContext(patient)))}"
          >
            Build Exercise
          </button>
          <button
            class="btn-secondary patient-action-btn"
            type="button"
            data-route="doctor-live"
            data-patient="${escapeHtml(JSON.stringify(patientContext(patient)))}"
          >
            Live Exercise
          </button>
          <button
            class="btn-secondary remove-patient-btn"
            type="button"
            data-patient-id="${escapeHtml(patient.patient_id || '')}"
            data-patient-name="${escapeHtml(patientName(patient))}"
          >
            Remove Patient
          </button>
        </div>
      </div>
    </article>
  `).join('');

  patientsListEl.querySelectorAll('.patient-action-btn').forEach((button) => {
    button.addEventListener('click', () => {
      try {
        const patient = JSON.parse(button.dataset.patient || '{}');
        if (patient.patient_id) {
          localStorage.setItem(SELECTED_PATIENT_KEY, JSON.stringify(patient));
        }
      } catch (error) {
        console.warn('[DoctorPatients] Failed to store selected patient:', error);
      }
      window.dispatchEvent(new CustomEvent('spa:navigate', { detail: { route: button.dataset.route } }));
    });
  });

  patientsListEl.querySelectorAll('.remove-patient-btn').forEach((button) => {
    button.addEventListener('click', () => removePatient(button));
  });
}

async function loadDoctorPatients() {
  if (!requestsListEl || !patientsListEl || !_state) return;

  const role = getAuthRole();
  if (role && !['doctor', 'admin'].includes(role)) {
    renderPermissionMessage('Please login as a doctor to view channeling requests and patients.');
    return;
  }

  requestsListEl.textContent = 'Loading requests...';
  patientsListEl.textContent = 'Loading patients...';

  try {
    const resp = await fetch(`${_state.apiBase}/api/channel-requests/doctor`, {
      headers: _state.getAuthHeaders(),
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const message = resp.status === 403
        ? 'Please login as a doctor to view channeling requests and patients.'
        : data.message || `HTTP ${resp.status}`;
      throw new Error(message);
    }

    approvedPatients = data.patients || [];
    renderRequests(data.requests || []);
    renderPatients(filteredPatients());
  } catch (error) {
    console.error('[DoctorPatients] Failed to load data:', error);
    const message = escapeHtml(error.message);
    requestsListEl.innerHTML = `<div class="error-state">Failed to load requests: ${message}</div>`;
    patientsListEl.innerHTML = `<div class="error-state">Failed to load patients: ${message}</div>`;
  }
}

async function removePatient(button) {
  const patientId = String(button?.dataset?.patientId || '').trim();
  const patientLabel = button?.dataset?.patientName || patientId || 'this patient';

  if (!patientId || !_state) return;

  const confirmed = window.confirm(`Remove ${patientLabel} from My Patients?`);
  if (!confirmed) return;

  button.disabled = true;
  setPatientStatus(`Removing ${patientLabel}...`);

  try {
    const resp = await fetch(`${_state.apiBase}/api/channel-requests/patients/${encodeURIComponent(patientId)}`, {
      method: 'DELETE',
      headers: _state.getAuthHeaders(),
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);

    try {
      const selectedPatient = JSON.parse(localStorage.getItem(SELECTED_PATIENT_KEY) || 'null');
      if (selectedPatient?.patient_id === patientId) {
        localStorage.removeItem(SELECTED_PATIENT_KEY);
      }
    } catch (error) {
      console.warn('[DoctorPatients] Failed to clear selected patient:', error);
    }

    setPatientStatus(`${patientLabel} was removed from My Patients.`);
    await loadDoctorPatients();
  } catch (error) {
    console.error('[DoctorPatients] Failed to remove patient:', error);
    button.disabled = false;
    setPatientStatus(`Failed to remove patient: ${error.message}`, true);
  }
}

async function updateRequest(requestId, status) {
  if (!requestId || !_state) return;

  try {
    const resp = await fetch(`${_state.apiBase}/api/channel-requests/${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ..._state.getAuthHeaders(),
      },
      body: JSON.stringify({ status }),
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);

    await loadDoctorPatients();
  } catch (error) {
    console.error('[DoctorPatients] Failed to update request:', error);
    if (requestsListEl) {
      requestsListEl.insertAdjacentHTML(
        'afterbegin',
        `<div class="error-state">Failed to update request: ${escapeHtml(error.message)}</div>`
      );
    }
  }
}

export function mount(container, gloveState) {
  _container = container;
  _state = gloveState;
  requestsListEl = _container.querySelector('#channelRequestsList');
  patientsListEl = _container.querySelector('#doctorPatientsList');
  patientSearchFormEl = _container.querySelector('#doctorPatientSearchForm');
  patientSearchInputEl = _container.querySelector('#doctorPatientSearchInput');
  patientsStatusEl = _container.querySelector('#doctorPatientsStatus');
  approvedPatients = [];
  patientSearchTerm = '';

  patientSearchFormEl?.addEventListener('submit', (event) => {
    event.preventDefault();
    patientSearchTerm = patientSearchInputEl?.value || '';
    renderPatients(filteredPatients());
  });

  patientSearchInputEl?.addEventListener('input', () => {
    patientSearchTerm = patientSearchInputEl.value || '';
    renderPatients(filteredPatients());
  });

  loadDoctorPatients();
}

export function unmount() {
  _container = null;
  _state = null;
  requestsListEl = null;
  patientsListEl = null;
  patientSearchFormEl = null;
  patientSearchInputEl = null;
  patientsStatusEl = null;
  approvedPatients = [];
  patientSearchTerm = '';
}
