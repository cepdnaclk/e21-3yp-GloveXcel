/**
 * doctorsController.js
 *
 * Patient-facing directory of doctors and their hospitals.
 */

let _container = null;
let _state = null;
let doctorsListEl = null;
let doctorSearchInput = null;
let doctorProfileSection = null;
let doctorProfileContent = null;
let backToDoctorsBtn = null;
let toggleOtherDoctorsBtn = null;
let _doctors = [];
let _selectedDoctor = null;
let _showOtherHospitals = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDoctors(doctors) {
  if (!doctorsListEl) return;

  if (!Array.isArray(doctors) || doctors.length === 0) {
    doctorsListEl.innerHTML = '<div class="doctor-empty">No doctors found.</div>';
    return;
  }

  doctorsListEl.innerHTML = doctors.map((doctor) => {
    const name = escapeHtml(doctor.name || 'Unnamed doctor');
    const hospital = escapeHtml(doctor.hospital_name || doctor.hospital_id || 'Hospital not listed');
    const doctorId = escapeHtml(doctor.doctor_id || '');
    const status = doctor.channel_status
      ? `<div class="doctor-channel-status">${escapeHtml(doctor.channel_status)}</div>`
      : '';

    return `
      <article class="doctor-card" data-doctor-id="${doctorId}" tabindex="0" role="button" aria-label="View ${name}'s profile">
        <div class="doctor-name">${name}</div>
        <div class="doctor-hospital">${hospital}</div>
        ${status}
      </article>
    `;
  }).join('');

  doctorsListEl.querySelectorAll('.doctor-card').forEach((card) => {
    const doctorId = card.dataset.doctorId;
    card.addEventListener('click', () => showDoctorProfile(doctorId));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showDoctorProfile(doctorId);
      }
    });
  });
}

function profileField(label, value) {
  return `
    <div class="doctor-profile-field">
      <div class="doctor-profile-label">${escapeHtml(label)}</div>
      <div class="doctor-profile-value">${escapeHtml(value || '--')}</div>
    </div>
  `;
}

function getAuthRole() {
  return String(localStorage.getItem('auth_role') || '').trim().toLowerCase();
}

function showDoctorProfile(doctorId) {
  const doctor = _doctors.find((item) => item.doctor_id === doctorId);
  if (!doctor || !doctorProfileSection || !doctorProfileContent) return;

  _selectedDoctor = doctor;
  const hospitalName = doctor.hospital_name || doctor.hospital_id || 'Hospital not listed';
  const channelStatus = String(doctor.channel_status || '').trim().toLowerCase();
  const requestButtonText = channelStatus === 'approved'
    ? 'Already in your doctors'
    : (channelStatus === 'pending' ? 'Request sent' : 'Request to channel the doctor');
  const requestButtonDisabled = ['approved', 'pending'].includes(channelStatus) ? 'disabled' : '';

  doctorProfileContent.innerHTML = `
    <div class="doctor-profile-name">${escapeHtml(doctor.name || 'Unnamed doctor')}</div>
    <div class="doctor-profile-subtitle">${escapeHtml(hospitalName)}</div>
    <div class="doctor-profile-grid">
      ${profileField('Doctor ID', doctor.doctor_id)}
      ${profileField('Name', doctor.name)}
      ${profileField('Email', doctor.email)}
      ${profileField('Hospital', hospitalName)}
      ${profileField('Hospital ID', doctor.hospital_id)}
      ${profileField('Hospital Location', doctor.hospital_location)}
    </div>
    <button id="requestDoctorChannelBtn" class="btn-primary doctor-request-btn" type="button" ${requestButtonDisabled}>
      ${escapeHtml(requestButtonText)}
    </button>
    <div id="requestDoctorChannelStatus" class="doctor-request-status" aria-live="polite"></div>
  `;

  doctorProfileSection.hidden = false;
  doctorProfileSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  doctorProfileContent.querySelector('#requestDoctorChannelBtn')?.addEventListener('click', sendChannelRequest);
}

function hideDoctorProfile() {
  if (doctorProfileSection) doctorProfileSection.hidden = true;
  if (doctorProfileContent) doctorProfileContent.innerHTML = '';
  _selectedDoctor = null;
}

async function sendChannelRequest() {
  if (!_state || !_selectedDoctor?.doctor_id || !doctorProfileContent) return;

  const button = doctorProfileContent.querySelector('#requestDoctorChannelBtn');
  const statusEl = doctorProfileContent.querySelector('#requestDoctorChannelStatus');

  if (getAuthRole() !== 'patient') {
    if (statusEl) {
      statusEl.textContent = 'Please login as a patient before sending a channeling request.';
    }
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Sending request...';
  }
  if (statusEl) statusEl.textContent = '';

  try {
    const resp = await fetch(`${_state.apiBase}/api/channel-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ..._state.getAuthHeaders(),
      },
      body: JSON.stringify({ doctor_id: _selectedDoctor.doctor_id }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const message = resp.status === 403
        ? 'Please login as a patient before sending a channeling request.'
        : data.message || `HTTP ${resp.status}`;
      throw new Error(message);
    }

    const requestStatus = data.request?.status;
    if (button) button.textContent = requestStatus === 'approved' ? 'Already in your doctors' : 'Request sent';
    if (statusEl) {
      statusEl.textContent = requestStatus === 'approved'
        ? 'This doctor has already approved you.'
        : 'Your channeling request was sent to this doctor.';
    }
  } catch (error) {
    console.error('[Doctors] Failed to send channeling request:', error);
    if (button) {
      button.disabled = false;
      button.textContent = 'Request to channel the doctor';
    }
    if (statusEl) statusEl.textContent = `Failed to send request: ${error.message}`;
  }
}

function applySearch() {
  const term = (doctorSearchInput?.value || '').trim().toLowerCase();

  if (!term) {
    renderDoctors(_doctors);
    return;
  }

  const filtered = _doctors.filter((doctor) => {
    const name = String(doctor.name || '').toLowerCase();
    const hospital = String(doctor.hospital_name || doctor.hospital_id || '').toLowerCase();
    return name.includes(term) || hospital.includes(term);
  });

  renderDoctors(filtered);
}

async function loadDoctors() {
  if (!doctorsListEl || !_state) return;

  doctorsListEl.textContent = _showOtherHospitals
    ? 'Loading other hospital doctors...'
    : 'Loading same hospital doctors...';

  try {
    const query = _showOtherHospitals ? '?include_other_hospitals=true' : '';
    const resp = await fetch(`${_state.apiBase}/api/auth/doctors${query}`, {
      headers: _state.getAuthHeaders()
    });

    if (!resp.ok) {
      let message = `HTTP ${resp.status}`;
      try {
        const errorBody = await resp.json();
        if (errorBody?.message) message = errorBody.message;
      } catch { /* keep status message */ }
      throw new Error(message);
    }

    const data = await resp.json();
    _doctors = Array.isArray(data.doctors) ? data.doctors : [];
    if (toggleOtherDoctorsBtn) {
      toggleOtherDoctorsBtn.textContent = _showOtherHospitals
        ? 'Show Same Hospital Doctors'
        : 'Show Other Hospital Doctors';
    }
    hideDoctorProfile();
    applySearch();
  } catch (error) {
    console.error('[Doctors] Failed to load doctors:', error);
    if (doctorsListEl) {
      doctorsListEl.innerHTML = `<div class="doctor-error">Failed to load doctors: ${escapeHtml(error.message)}</div>`;
    }
  }
}

export function mount(container, gloveState) {
  _container = container;
  _state = gloveState;
  doctorsListEl = _container.querySelector('#doctorsList');
  doctorSearchInput = _container.querySelector('#doctorSearchInput');
  doctorProfileSection = _container.querySelector('#doctorProfileSection');
  doctorProfileContent = _container.querySelector('#doctorProfileContent');
  backToDoctorsBtn = _container.querySelector('#backToDoctorsBtn');
  toggleOtherDoctorsBtn = _container.querySelector('#toggleOtherDoctorsBtn');
  doctorSearchInput?.addEventListener('input', applySearch);
  backToDoctorsBtn?.addEventListener('click', hideDoctorProfile);
  toggleOtherDoctorsBtn?.addEventListener('click', () => {
    _showOtherHospitals = !_showOtherHospitals;
    loadDoctors();
  });
  loadDoctors();
}

export function unmount() {
  _container = null;
  _state = null;
  doctorsListEl = null;
  doctorSearchInput = null;
  doctorProfileSection = null;
  doctorProfileContent = null;
  backToDoctorsBtn = null;
  toggleOtherDoctorsBtn = null;
  _doctors = [];
  _selectedDoctor = null;
  _showOtherHospitals = false;
}
