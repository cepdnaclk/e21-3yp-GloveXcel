/**
 * router.js — createRouter Factory
 *
 * Maps route keys to HTML template paths and lazy-loaded JS controller modules.
 *
 * Per-navigation sequence:
 *   1. currentController.unmount()          — detach DOM listeners, null state callbacks
 *   2. fetch(route.template)                — get raw HTML string
 *   3. viewContainer.innerHTML = html       — inject into the shell
 *   4. update [data-route] active classes   — highlight the correct nav button
 *   5. history.pushState                    — update the URL hash
 *   6. dynamic import(route.controller)     — lazy-load the JS module
 *   7. controller.mount(container, state, engine) — hand over control
 */

// ─── Route map ────────────────────────────────────────────────────────────────
const ROUTES = {
  calibration: {
    template:   './views/calibration.html',
    controller: () => import('./viewControllers/calibrationController.js'),
    label:      'Calibration',
  },
  preloaded: {
    template:   './views/exercise_preloaded.html',
    controller: () => import('./viewControllers/exercisePreloadedController.js'),
    label:      'Preloaded Session',
  },
  live: {
    template:   './views/exercise_live.html',
    controller: () => import('./viewControllers/exerciseLiveController.js'),
    label:      'Live Session',
  },
  'doctor-setup': {
    template:   './views/doctor_setup.html',
    controller: () => import('./viewControllers/doctorSetupController.js'),
    label:      'Doctor Setup',
  },
  'doctor-preloaded': {
    template:   './views/doctor_preloaded.html',
    controller: () => import('./viewControllers/doctorPreloadedController.js'),
    label:      'Exercise Builder',
  },
  'doctor-live': {
    template:   './views/doctor_live.html',
    controller: () => import('./viewControllers/doctorLiveController.js'),
    label:      'Live Assessment',
  },
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create and return a router bound to a specific view container.
 *
 * @param {HTMLElement} viewContainer  — The #view-container element in the shell
 * @param {object}      gloveState     — GloveState singleton
 * @param {object}      threeEngine    — ThreeEngine singleton
 * @returns {{ go(route: string): void, initial(): void, routes: object }}
 */
export function createRouter(viewContainer, gloveState, threeEngine) {
  let _currentController = null;
  let _isNavigating      = false;

  // ── Core navigate function ─────────────────────────────────────────────────

  async function navigate(routeKey) {
    // Guard against concurrent navigations (e.g., user double-clicks)
    if (_isNavigating) return;

    const route = ROUTES[routeKey];
    if (!route) {
      console.error(`[Router] Unknown route: "${routeKey}". Valid routes: ${Object.keys(ROUTES).join(', ')}`);
      return;
    }

    _isNavigating = true;

    try {
      // ── Step 1: Unmount the current view controller ─────────────────────
      if (_currentController && typeof _currentController.unmount === 'function') {
        try {
          _currentController.unmount();
        } catch (err) {
          console.warn('[Router] unmount() threw — continuing:', err);
        }
      }
      _currentController = null;

      // ── Step 2: Fetch the HTML template ────────────────────────────────
      let html = '';
      try {
        const resp = await fetch(route.template);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${route.template}`);
        html = await resp.text();
      } catch (err) {
        viewContainer.innerHTML = _errorHtml(
          'Failed to load view template',
          err.message,
          'Make sure you are serving this page via a local HTTP server (not file://)'
        );
        return;
      }

      // ── Step 3: Inject HTML into the view container ─────────────────────
      viewContainer.innerHTML = html;

      // ── Step 4: Update sidebar active state ─────────────────────────────
      document.querySelectorAll('[data-route]').forEach(btn => {
        const isActive = btn.dataset.route === routeKey;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
      });

      // ── Step 5: Push URL hash ────────────────────────────────────────────
      // Always write canonical form: #routeKey (no leading slash)
      const canonicalHash = `#${routeKey}`;
      if (window.location.hash !== canonicalHash) {
        history.pushState({ route: routeKey }, '', canonicalHash);
      } else if (!history.state?.route) {
        // Page was refreshed with hash present but no state object — repair it
        history.replaceState({ route: routeKey }, '', canonicalHash);
      }

      // ── Step 6 & 7: Lazy-import and mount the controller ─────────────────
      try {
        const mod = await route.controller();
        _currentController = mod;

        if (typeof mod.mount === 'function') {
          mod.mount(viewContainer, gloveState, threeEngine);
        } else {
          console.warn(`[Router] Controller for "${routeKey}" has no mount() export.`);
        }
      } catch (err) {
        console.error(`[Router] Controller error for "${routeKey}":`, err);
        viewContainer.innerHTML += _errorHtml('Controller failed to mount', err.message);
      }

    } finally {
      _isNavigating = false;
    }
  }

  // ── Browser back / forward ─────────────────────────────────────────────────
  window.addEventListener('popstate', (event) => {
    const key = event.state?.route || _hashRoute() || 'calibration';
    navigate(key);
  });

  // ── Hashchange fallback ────────────────────────────────────────────────────
  // Fires when the user types a #hash URL directly or follows an <a href="#…"> link.
  // popstate does NOT fire in those cases.
  window.addEventListener('hashchange', () => {
    const key = _hashRoute();
    if (key) navigate(key);
  });

  // ── Internal SPA navigation event ─────────────────────────────────────────
  // View controllers dispatch this to navigate without coupling to the router.
  // Usage: window.dispatchEvent(new CustomEvent('spa:navigate', { detail: { route: 'calibration' } }));
  window.addEventListener('spa:navigate', (event) => {
    const key = event?.detail?.route;
    if (key) navigate(key);
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _hashRoute() {
    // Strip both `#route` and `#/route` so deep-links like `#/live` work correctly.
    const hash = window.location.hash.replace(/^#\/?/, '').trim();
    return ROUTES[hash] ? hash : null;
  }

  function _errorHtml(title, detail = '', hint = '') {
    return `
      <div class="view-error">
        <strong>${title}</strong>
        ${detail ? `<br><code>${detail}</code>` : ''}
        ${hint   ? `<br><small>${hint}</small>` : ''}
      </div>`;
  }

  // ── Public interface ───────────────────────────────────────────────────────
  return {
    /**
     * Navigate to a named route.
     * @param {string} routeKey — one of: 'calibration', 'preloaded', 'live'
     */
    go(routeKey) { navigate(routeKey); },

    /**
     * Navigate to the route encoded in the URL hash, or to 'calibration' if none.
     * Call this once on app startup.
     */
    initial() { navigate(_hashRoute() || 'calibration'); },

    /** Read-only access to the route map (useful for building nav dynamically). */
    get routes() { return ROUTES; },
  };
}
