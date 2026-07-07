/**
 * gloveState.js — GlobalGloveState Singleton
 *
 * Single source of truth for:
 *   - The BleGloveClient instance (persists across all view transitions)
 *   - The latest 5-byte sensor packet
 *   - Patient calibration (loaded from localStorage on construction)
 *   - Cross-page BroadcastChannel for multi-tab sync
 *
 * Usage in view controllers:
 *   GloveState.onPacket = (packet) => { ... };   // mount
 *   GloveState.onPacket = null;                  // unmount
 */

import { BleGloveClient } from './bleGloveClient.js';

// ─── Private constants ────────────────────────────────────────────────────────
const PATIENT_CALIB_KEY      = 'patientCalibrationV1';
const PATIENT_ID_STORAGE_KEY = 'patientId';
const AUTH_TOKEN_STORAGE_KEY = 'auth_token';
const LEGACY_PATIENT_ID      = 'patient_003';
const CROSS_PAGE_CHANNEL_KEY = 'patientCrossPageV1';
const DOCTOR_CALIB_KEY_V2    = 'doctorCalibrationV2';

// ─── Class definition ─────────────────────────────────────────────────────────
class GlobalGloveState {
  constructor() {
    // ── BLE ──────────────────────────────────────────────────────────────────
    this.bleClient   = new BleGloveClient();
    this.isConnected = false;
    this.latestPacket = [0, 0, 0, 0, 0];

    // ── Calibration ───────────────────────────────────────────────────────────
    this.patientCalibration = {
      finalMin:   [null, null, null, null, null],
      finalMax:   [null, null, null, null, null],
      ready:      false,
      capturedAt: null,
    };

    this.doctorCalibration = {
      min: [null, null, null, null, null],
      max: [null, null, null, null, null],
      nonThumbMin: [null, null, null, null, null],
      nonThumbMax: [null, null, null, null, null],
      thumbMin: [null, null, null, null, null],
      thumbMax: [null, null, null, null, null],
      ready: false,
      capturedAt: null,
    };

    // ── Callback slots (view controllers overwrite on mount, null on unmount) ──
    this.onPacket           = null;  // (packet: number[]) => void
    this.onStatus           = null;  // (msg: string) => void
    this.onConnectionChange = null;  // (isConnected: boolean) => void

    // ── Cross-page channel ────────────────────────────────────────────────────
    this._broadcastChannel = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(CROSS_PAGE_CHANNEL_KEY)
      : null;

    // Bootstrap
    this._wireClientCallbacks();
    this._initBroadcastChannel();
    this.loadCalibration();
    this.loadDoctorCalibration();
  }

  // ── Computed getters ────────────────────────────────────────────────────────

  get apiBase() {
    const stored = localStorage.getItem('apiBaseUrl');
    if (stored) return this._normalizeApiBase(stored);
    if (window.location.protocol === 'file:') return 'http://localhost:3000';
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  get patientId() {
    try {
      const profile = JSON.parse(localStorage.getItem('auth_profile') || '{}');
      if (profile?.patient_id) return profile.patient_id;
    } catch { /* fall through */ }

    const storedPatientId = localStorage.getItem(PATIENT_ID_STORAGE_KEY);
    return storedPatientId && storedPatientId !== LEGACY_PATIENT_ID
      ? storedPatientId
      : '';
  }

  /** Expose the channel so controllers can check if cross-page sync is active */
  get broadcastChannel() { return this._broadcastChannel; }

  // ── Auth ────────────────────────────────────────────────────────────────────

  getAuthHeaders() {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!token || !this._isAuthTokenForCurrentSession(token)) {
      return {};
    }
    return { Authorization: `Bearer ${token}` };
  }

  _decodeJwtPayload(token) {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  _isAuthTokenForCurrentSession(token) {
    const payload = this._decodeJwtPayload(token);
    if (!payload) return false;

    if (payload.exp && payload.exp * 1000 <= Date.now()) {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      return false;
    }

    let profile = {};
    try {
      profile = JSON.parse(localStorage.getItem('auth_profile') || '{}');
    } catch {
      profile = {};
    }

    const role = String(localStorage.getItem('auth_role') || '').trim().toLowerCase();
    const tokenRole = String(payload.role || '').trim().toLowerCase();
    if (role && tokenRole && role !== tokenRole) return false;

    if (role === 'patient') return payload.sub === profile.patient_id;
    if (role === 'doctor') return payload.sub === profile.doctor_id;
    if (role === 'admin') return payload.sub === profile.admin_id;

    return true;
  }

  // ── Calibration helpers ───────────────────────────────────────────────────

  /** Load calibration from localStorage into this.patientCalibration. */
  loadCalibration() {
    try {
      const raw = localStorage.getItem(PATIENT_CALIB_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const min = Array.isArray(parsed.finalMin) ? parsed.finalMin : [null, null, null, null, null];
      const max = Array.isArray(parsed.finalMax) ? parsed.finalMax : [null, null, null, null, null];
      const ready = min.every(Number.isFinite) && max.every(Number.isFinite);
      this.patientCalibration = {
        finalMin:   min,
        finalMax:   max,
        ready,
        capturedAt: parsed.capturedAt || null,
      };
    } catch (err) {
      console.warn('[GloveState] Calibration load failed:', err);
    }
  }

  loadDoctorCalibration() {
    try {
      const raw = localStorage.getItem(DOCTOR_CALIB_KEY_V2);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.doctorCalibration = {
          min: Array.isArray(parsed.finalMin) ? parsed.finalMin : [null, null, null, null, null],
          max: Array.isArray(parsed.finalMax) ? parsed.finalMax : [null, null, null, null, null],
          nonThumbMin: Array.isArray(parsed.nonThumbMin) ? parsed.nonThumbMin : [null, null, null, null, null],
          nonThumbMax: Array.isArray(parsed.nonThumbMax) ? parsed.nonThumbMax : [null, null, null, null, null],
          thumbMin: Array.isArray(parsed.thumbMin) ? parsed.thumbMin : [null, null, null, null, null],
          thumbMax: Array.isArray(parsed.thumbMax) ? parsed.thumbMax : [null, null, null, null, null],
          ready: Array.isArray(parsed.finalMin) && Array.isArray(parsed.finalMax) && parsed.finalMin.every(Number.isFinite) && parsed.finalMax.every(Number.isFinite),
          capturedAt: parsed.capturedAt || null
        };
      }
    } catch (err) {
      console.warn('[GloveState] Doctor Calibration load failed:', err);
    }
  }

  /** Fetch calibration from the backend and merge into localStorage + this.patientCalibration. */
  async hydrateCalibrationFromDatabase() {
    try {
      let resp = await fetch(
        `${this.apiBase}/api/patient-cal/${encodeURIComponent(this.patientId)}`,
        { headers: this.getAuthHeaders() }
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

      const min  = doc?.min || {};
      const max  = doc?.max || {};
      const keys = ['thumb', 'index', 'middle', 'ring', 'pinky'];

      const finalMin = keys.map(k => { const v = Number(min[k]); return Number.isFinite(v) ? v : null; });
      const finalMax = keys.map(k => { const v = Number(max[k]); return Number.isFinite(v) ? v : null; });
      const ready    = finalMin.every(Number.isFinite) && finalMax.every(Number.isFinite);

      this.patientCalibration = {
        finalMin,
        finalMax,
        ready,
        capturedAt: doc?.updatedAt || null,
      };

      // Persist merged result to localStorage
      let existing = {};
      try { existing = JSON.parse(localStorage.getItem(PATIENT_CALIB_KEY) || '{}'); } catch { /**/ }
      localStorage.setItem(PATIENT_CALIB_KEY, JSON.stringify({
        ...existing,
        finalMin,
        finalMax,
        capturedAt: doc?.updatedAt || null,
      }));
    } catch (err) {
      console.warn('[GloveState] DB calibration hydration failed:', err);
    }
  }

  // ── BroadcastChannel helpers ─────────────────────────────────────────────

  broadcastCurrentState() {
    if (!this._broadcastChannel) return;
    this._broadcastChannel.postMessage({
      type:         'patient-state',
      connected:    this.isConnected,
      latestPacket: [...this.latestPacket],
      timestamp:    Date.now(),
    });
  }

  // ── BLE wrappers ─────────────────────────────────────────────────────────

  async connect()  { return this.bleClient.connect(); }
  disconnect()     { this.bleClient.disconnect(); }

  // ── Private: wire BleGloveClient callbacks (done once in constructor) ────

  _wireClientCallbacks() {
    this.bleClient.onStatus = (msg) => {
      if (msg === 'Disconnected') {
        this.isConnected = false;
        this.broadcastCurrentState();
      }
      if (typeof this.onStatus === 'function')           this.onStatus(msg);
      if (typeof this.onConnectionChange === 'function') this.onConnectionChange(this.isConnected);
    };

    this.bleClient.onPacket = (packet) => {
      this.latestPacket = packet;
      this.broadcastCurrentState();
      if (typeof this.onPacket === 'function') this.onPacket(packet);
    };
  }

  _initBroadcastChannel() {
    if (!this._broadcastChannel) return;
    this._broadcastChannel.addEventListener('message', (event) => {
      const data = event?.data || {};

      // Another tab asked for our state — reply.
      if (data.type === 'request-patient-state') {
        this.broadcastCurrentState();
        return;
      }

      // Incoming live data from a companion tab — forward to the active view.
      if (data.type === 'patient-state' && data.connected && Array.isArray(data.latestPacket)) {
        this.latestPacket = data.latestPacket.slice(0, 5).map(v => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        });
        if (typeof this.onPacket === 'function') this.onPacket(this.latestPacket);
      }
    });
  }

  _normalizeApiBase(value) {
    let normalized = String(value || '').trim().replace(/\/$/, '');
    normalized = normalized.replace(/\/api\/auth$/i, '');
    normalized = normalized.replace(/\/api$/i, '');
    return normalized || 'http://localhost:3000';
  }
}

// ─── Export singleton instance ────────────────────────────────────────────────
export const GloveState = new GlobalGloveState();
