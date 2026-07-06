let _container = null;
let _state = null;
let requestsListEl = null;
let patientsListEl = null;

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
    item.patient_email ? `Email: ${item.patient_email}` : '',
    item.patient_age !== null && item.patient_age !== undefined ? `Age: ${item.patient_age}` : '',
    item.hospital_name || item.primary_hospital_id ? `Hospital: ${item.hospital_name || item.primary_hospital_id}` : '',
  ].filter(Boolean);

  return parts.map(escapeHtml).join('<br>');
}

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
    patientsListEl.innerHTML = '<div class="empty-state">No approved patients yet.</div>';
    return;
  }

  patientsListEl.innerHTML = patients.map((patient) => `
    <article class="patient-card">
      <div class="patient-name">${escapeHtml(patientName(patient))}</div>
      <div class="patient-meta">
        ${patientMeta(patient)}
        <br>Approved: ${escapeHtml(formatDate(patient.responded_at))}
      </div>
    </article>
  `).join('');
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

    renderRequests(data.requests || []);
    renderPatients(data.patients || []);
  } catch (error) {
    console.error('[DoctorPatients] Failed to load data:', error);
    const message = escapeHtml(error.message);
    requestsListEl.innerHTML = `<div class="error-state">Failed to load requests: ${message}</div>`;
    patientsListEl.innerHTML = `<div class="error-state">Failed to load patients: ${message}</div>`;
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
  loadDoctorPatients();
}

export function unmount() {
  _container = null;
  _state = null;
  requestsListEl = null;
  patientsListEl = null;
}
