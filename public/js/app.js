/**
 * ResQ Wheels — Premium Roadside Assistance Marketplace
 * Interactive Frontend Controller & State Machine
 */

// Platform service catalog
const SERVICE_CATALOG = [
  { id: 'puncture-repair', name: 'Puncture Repair', priceText: 'from Rs 150', basePrice: 150, icon: 'disc', tag: 'Fast Response' },
  { id: 'battery-jumpstart', name: 'Battery Jump-Start', priceText: 'from Rs 350', basePrice: 350, icon: 'battery-charging', tag: 'High Voltage Cables' },
  { id: 'vehicle-towing', name: 'Vehicle Towing', priceText: 'from Rs 800', basePrice: 800, icon: 'truck', tag: 'Hydraulic Flatbed' },
  { id: 'car-mechanic', name: 'Car Mechanic', priceText: 'from Rs 500', basePrice: 500, icon: 'wrench', tag: 'Engine & Electricals' },
  { id: 'bike-mechanic', name: 'Bike Mechanic', priceText: 'from Rs 300', basePrice: 300, icon: 'bike', tag: 'On-Spot Quick Fix' },
  { id: 'battery-replacement', name: 'Battery Replacement', priceText: 'from Rs 2,800', basePrice: 2800, icon: 'zap', tag: 'Warranty Batteries' },
  { id: 'spare-parts', name: 'Spare Parts Delivery', priceText: 'from Rs 200', basePrice: 200, icon: 'package', tag: 'Genuine OEM Parts' },
  { id: 'emergency-assistance', name: 'Emergency Vehicle Assistance', priceText: 'from Rs 400', basePrice: 400, icon: 'alert-triangle', tag: 'Accident Triage & Winch' },
  { id: 'authorized-fuel', name: 'Authorized Fuel Assistance', priceText: 'from Rs 250', basePrice: 250, icon: 'droplet', tag: 'Statutory Authorized Emergency Fuel' }
];

const PROVIDER_SEARCH_RADIUS_KM = 20;

// Global State
const State = {
  user: {
    isLoggedIn: false,
    id: '',
    name: '',
    email: '',
    phone: '',
    role: ''
  },
  currentPlaceName: 'your location',
  currentLocation: null,
  currentRole: '',
  currentView: 'home',
  services: SERVICE_CATALOG,
  platformPricing: null,
  providers: [], // Initially empty: platform just launched, workshops appear as they register!
  activeEmergency: null,
  emergencyPollTimer: null,
  emergencyPollCount: 0,
  trackingPollTimer: null,
  trackingPollErrorNotified: false,
  activeBooking: null,
  bookingsList: [],
  providerLocationWatchId: null,
  providerLocationBookingId: null,
  providerLocationLastSentAt: 0,
  providerLocationErrorNotified: false,
  providerProfile: null,
  selectedProviderId: null,
  providerOnline: true,
  filters: {
    category: 'all',
    availableOnly: false,
    ratingMin: 0,
    maxPrice: 100000,
    verifiedOnly: false
  },
  emergencyForm: {
    vehicleType: '',
    category: '',
    description: '',
    urgency: 'Urgent now',
    location: '',
    lat: null,
    lng: null,
    photos: []
  }
};

let providerMap = null;
let providerMarkers = null;
let providerMapLastLocation = null;

// Web Audio API Synthesizer Chimes
const AudioFX = {
  ctx: null,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  playPing() {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch (e) {}
  },
  playEmergencyAlert() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      [0, 0.15, 0.3].forEach((delay, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(idx % 2 === 0 ? 800 : 600, now + delay);
        gain.gain.setValueAtTime(0.25, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.12);
      });
    } catch (e) {}
  }
};

// Toast Notifications
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'alert') icon = '🚨';
  if (type === 'warning') icon = '⚠️';

  const iconElement = document.createElement('span');
  iconElement.textContent = icon;
  const messageElement = document.createElement('span');
  messageElement.textContent = message;
  toast.append(iconElement, document.createTextNode(' '), messageElement);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Authentication and app initialization
document.addEventListener('DOMContentLoaded', () => {
  setupAuthentication();
  restoreSession();
});

let applicationStarted = false;

function setupAuthentication() {
  const form = document.getElementById('auth-form');
  const roleButtons = document.querySelectorAll('[data-auth-role]');
  const modeButtons = document.querySelectorAll('[data-auth-mode]');
  let selectedRole = 'user';
  let selectedMode = 'login';

  const updateFormMode = () => {
    const isSignup = selectedMode === 'signup';
    const nameLabel = document.getElementById('auth-name-label');
    const phoneLabel = document.getElementById('auth-phone-label');
    const nameInput = document.getElementById('auth-name');
    const phoneInput = document.getElementById('auth-phone');
    const signupButton = document.querySelector('[data-auth-mode="signup"]');
    const modeSelector = document.getElementById('auth-mode-selector');
    const isAdmin = selectedRole === 'admin';

    if (isAdmin && isSignup) selectedMode = 'login';
    nameLabel.hidden = selectedMode !== 'signup';
    phoneLabel.hidden = selectedMode !== 'signup';
    nameInput.required = selectedMode === 'signup';
    phoneInput.required = selectedMode === 'signup' && selectedRole === 'provider';
    document.getElementById('auth-title').textContent = selectedMode === 'signup' ? 'Create your account' : 'Welcome back';
    document.getElementById('auth-submit').textContent = selectedMode === 'signup' ? 'Create account' : 'Continue securely';
    document.getElementById('auth-password').autocomplete = selectedMode === 'signup' ? 'new-password' : 'current-password';
    document.getElementById('auth-note').textContent = isAdmin
      ? 'Admin accounts are provisioned privately by the system owner.'
      : selectedMode === 'signup' && selectedRole === 'provider'
        ? 'Your service profile becomes visible after you complete registration.'
        : 'Your account is protected with secure sign-in.';
    signupButton.hidden = isAdmin;
    modeSelector.hidden = isAdmin;

    modeButtons.forEach(button => {
      const active = button.dataset.authMode === selectedMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  roleButtons.forEach(button => {
    button.addEventListener('click', () => {
      selectedRole = button.dataset.authRole;
      roleButtons.forEach(roleButton => {
        const active = roleButton === button;
        roleButton.classList.toggle('active', active);
        roleButton.setAttribute('aria-pressed', String(active));
      });
      document.getElementById('auth-feedback').hidden = true;
      updateFormMode();
    });
  });

  modeButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (selectedRole === 'admin' && button.dataset.authMode === 'signup') return;
      selectedMode = button.dataset.authMode;
      document.getElementById('auth-feedback').hidden = true;
      updateFormMode();
    });
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = document.getElementById('auth-feedback');
    const submitButton = document.getElementById('auth-submit');
    const isSignup = selectedMode === 'signup';
    const payload = {
      role: selectedRole,
      email: document.getElementById('auth-email').value.trim(),
      password: document.getElementById('auth-password').value
    };
    if (isSignup) {
      payload.name = document.getElementById('auth-name').value.trim();
      payload.phone = document.getElementById('auth-phone').value.trim();
    }

    feedback.hidden = true;
    submitButton.disabled = true;
    try {
      const response = await fetch(`/api/auth/${isSignup ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Sign-in failed.');
      await startApplication(result.user);
    } catch (error) {
      feedback.textContent = error.message || 'Unable to reach the sign-in service.';
      feedback.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  updateFormMode();
}

async function restoreSession() {
  try {
    const response = await fetch('/api/auth/me');
    if (response.status === 401) return;
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not restore the session.');
    await startApplication(result.user);
  } catch (error) {
    const feedback = document.getElementById('auth-feedback');
    feedback.textContent = 'Could not connect to the account service. Please try again.';
    feedback.hidden = false;
    console.error('Session restore failed:', error);
  }
}

async function startApplication(user) {
  if (applicationStarted) return;
  applicationStarted = true;
  State.user = { ...State.user, ...user, isLoggedIn: true };
  State.currentRole = user.role === 'user' ? 'customer' : user.role;
  State.currentView = user.role === 'admin' ? 'admin' : (user.role === 'provider' ? 'provider' : 'home');
  document.getElementById('nav-user-name').textContent = user.name;
  document.getElementById('btn-open-partner-reg').hidden = user.role !== 'provider';
  document.querySelectorAll('[data-role-only]').forEach(element => {
    element.hidden = element.dataset.roleOnly !== user.role;
  });
  document.body.classList.remove('auth-required');

  setupNavigation();
  setupEmergencyModalEvents();
  setupFilterEvents();
  setupProviderViewToggles();
  setupTrackingControls();
  setupPartnerRegistration();
  setupDirectBooking();
  setupProviderCompletionModal();
  setupProviderUnregisterModal();
  document.getElementById('btn-user-logout').onclick = async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Could not sign out.');
      window.location.reload();
    } catch (error) {
      showToast(error.message || 'Could not sign out.', 'warning');
    }
  };

  await tryFetchApiData();
  renderCurrentView();
  renderLeafletMap('emergency-modal-map', State.emergencyForm.lat, State.emergencyForm.lng, []);
  renderFindProvidersMap();
  if (user.role === 'provider') {
    try {
      const profileResponse = await fetch('/api/providers/mine');
      const profileResult = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profileResult.message || 'Could not load provider profile.');
      State.providerProfile = profileResult.provider;
      State.providerOnline = Boolean(profileResult.provider && profileResult.provider.available);
      renderProviderPortal();
    } catch (error) {
      console.error('Provider profile load failed:', error);
      showToast('Could not load your provider profile. Please refresh and try again.', 'warning');
    }
  }
  requestCustomerLocation('hero-location-input', null, { silent: true });
}

// Setup Navigation
function setupNavigation() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = el.getAttribute('data-view');
      navigateToView(targetView);
    });
  });

  // Emergency Assistance Trigger Buttons
  document.querySelectorAll('.open-emergency-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openEmergencyModal();
    });
  });
}

function setPlatformRole(role) {
  const targetRole = role === 'customer' ? 'user' : role;
  if (targetRole !== State.user.role) {
    showToast('Sign in with the appropriate account to access that portal.', 'warning');
    return;
  }
  navigateToView(targetRole === 'user' ? 'home' : targetRole);
}

// View Router
function navigateToView(viewName) {
  const requiredRole = viewName === 'provider' ? 'provider' :
    (viewName === 'admin' ? 'admin' : (['dashboard', 'track'].includes(viewName) ? 'user' : null));
  if (requiredRole && State.user.role !== requiredRole) {
    showToast('Your account does not have access to that page.', 'warning');
    return;
  }

  State.currentView = viewName;
  if (viewName === 'track') {
    startTrackingUpdates();
  } else {
    stopTrackingUpdates();
  }

  // Update header links
  document.querySelectorAll('.nav-link').forEach(link => {
    const isTarget = link.getAttribute('data-view') === viewName;
    link.classList.toggle('active', isTarget);
  });

  // Toggle view containers
  document.querySelectorAll('.app-view').forEach(viewEl => {
    const isMatching = viewEl.id === `view-${viewName}`;
    viewEl.style.display = isMatching ? 'block' : 'none';
  });

  // Render view-specific content
  if (viewName === 'home') renderHomeView();
  if (viewName === 'providers') {
    renderFindProvidersView();
    window.setTimeout(() => {
      if (providerMap) providerMap.invalidateSize();
    }, 100);
  }
  if (viewName === 'track') renderTrackingView();
  if (viewName === 'dashboard') renderCustomerDashboard();
  if (viewName === 'provider') renderProviderPortal();
  if (viewName === 'admin') renderAdminPortal();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Try Fetching Backend Data if Available
async function tryFetchApiData() {
  try {
    const [resServices, resProviders, resBookings, resPricing] = await Promise.all([
      fetch('/api/services').then(r => r.ok ? r.json() : null),
      fetch('/api/providers').then(r => r.ok ? r.json() : null),
      fetch('/api/bookings').then(r => r.ok ? r.json() : null),
      fetch('/api/platform/pricing').then(r => r.ok ? r.json() : null)
    ]);

    if (resServices && resServices.success) State.services = resServices.services;
    if (resProviders && resProviders.success) State.providers = resProviders.providers;
    if (resBookings && resBookings.success) {
      State.bookingsList = resBookings.bookings;
      State.activeBooking = resBookings.bookings.find(booking => !['COMPLETED', 'CANCELLED'].includes(booking.status)) || null;
    }
    if (resPricing && resPricing.success) {
      State.platformPricing = resPricing.pricing;
      updateProviderCommissionDisclosure();
    } else {
      const disclosure = document.getElementById('provider-commission-rate');
      if (disclosure) disclosure.textContent = 'Current commission settings could not be loaded. Refresh before registering.';
    }
  } catch (err) {
    console.error('Platform data load failed:', err);
    showToast('Could not load platform data. Please refresh and try again.', 'warning');
  }
}

function updateProviderCommissionDisclosure() {
  const disclosure = document.getElementById('provider-commission-rate');
  if (disclosure && State.platformPricing) {
    disclosure.textContent = `Admin-set commission: ${State.platformPricing.commissionRate}% of the total booking amount, deducted from provider credits after service completion.`;
  }
}

function renderCurrentView() {
  navigateToView(State.currentView);
}

/* ==========================================================================
   Home View Rendering
   ========================================================================== */
function renderHomeView() {
  // Setup quick category clicks
  document.querySelectorAll('.service-quick-card').forEach(card => {
    card.onclick = () => {
      const cat = card.getAttribute('data-category');
      State.filters.category = cat;
      const select = document.getElementById('filter-category-select');
      if (select) select.value = cat;
      navigateToView('providers');
    };
  });

  // Search box action
  const searchBtn = document.getElementById('btn-hero-search');
  if (searchBtn) {
    searchBtn.onclick = async () => {
      const locInput = document.getElementById('hero-location-input');
      const locationQuery = locInput ? locInput.value.trim() : '';
      if (locationQuery) {
        searchBtn.disabled = true;
        const originalLabel = searchBtn.textContent;
        searchBtn.textContent = 'Finding location...';
        try {
          if (!await applyManualCustomerLocation(locationQuery)) return;
        } finally {
          searchBtn.disabled = false;
          searchBtn.textContent = originalLabel;
        }
      }
      navigateToView('providers');
    };
  }
  const locationInput = document.getElementById('hero-location-input');
  if (locationInput && searchBtn) {
    locationInput.onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchBtn.click();
      }
    };
  }

  // Current location action via Browser Geolocation API
  const currLocBtn = document.getElementById('btn-use-current-loc');
  if (currLocBtn) {
    currLocBtn.onclick = () => {
      requestCustomerLocation('hero-location-input', (lat, lng, address) => {
        showToast(`📍 GPS Locked: ${address}`, 'success');
      });
    };
  }

  // Nearby providers are only shown once the customer location is available.
  const nearbyContainer = document.querySelector('.nearby-providers-row');
  if (nearbyContainer) {
    const nearbyProviders = getProvidersWithinSearchRadius()
      .filter(provider => provider.available)
      .slice(0, 3);
    if (!State.currentLocation) {
      nearbyContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px; text-align: center; background: #F8FAFC; border-radius: 8px; border: 1.5px dashed #D1D5DB;">
          <div style="font-weight: 800; font-size: 14px; color: #111827; margin-bottom: 4px;">Share your location to see nearby providers</div>
          <button type="button" class="btn-apply-filters" onclick="requestCustomerLocation()">Use current location</button>
        </div>
      `;
    } else if (nearbyProviders.length === 0) {
      nearbyContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px; text-align: center; background: #F8FAFC; border-radius: 8px; border: 1.5px dashed #D1D5DB;">
          <div style="font-weight: 800; font-size: 14px; color: #111827; margin-bottom: 4px;">No available providers within ${PROVIDER_SEARCH_RADIUS_KM} km of ${escapeHtml(State.currentPlaceName)} yet</div>
          <p style="font-size: 12px; color: #6B7280; margin-bottom: 12px;">Providers will appear here as service centers register in your area.</p>
        </div>
      `;
    } else {
      nearbyContainer.innerHTML = nearbyProviders.slice(0, 3).map(p => `
        <div class="provider-mini-card" onclick="State.selectedProviderId = '${escapeHtml(p.id)}'; navigateToView('providers');">
          <div class="provider-mini-thumb">
            <img src="${escapeHtml(getProviderImage(p))}" alt="${escapeHtml(p.name)}" onerror="this.src='/images/crop_hero.jpg'">
          </div>
          <div class="provider-mini-body">
            <div class="provider-mini-name">${escapeHtml(p.name)}</div>
            <div class="provider-mini-meta">
              ${p.rating ? `<span class="star">★</span> ${escapeHtml(p.rating)} · ` : 'New provider · '}${escapeHtml(p.distance)}
            </div>
            <div class="arrival-pill">
              <span class="arrival-dot"></span> ETA ${escapeHtml(p.eta)}
            </div>
          </div>
        </div>
      `).join('');
    }
  }
}

async function applyManualCustomerLocation(query) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) throw new Error('The location search service is unavailable right now.');
    const results = await response.json();
    const result = Array.isArray(results) ? results[0] : null;
    const lat = Number(result && result.lat);
    const lng = Number(result && result.lon);
    if (!result || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      showToast('We could not find that location. Try a nearby area, city, or full address.', 'warning');
      return false;
    }

    const address = result.address || {};
    const placeName = address.suburb || address.neighbourhood || address.city_district ||
      address.village || address.town || address.city || address.county || query;
    const addressText = result.display_name || query;
    State.currentLocation = { lat, lng };
    State.currentPlaceName = placeName;
    State.emergencyForm.lat = lat;
    State.emergencyForm.lng = lng;
    State.emergencyForm.location = addressText;

    updateFindSubheaderTitle();
    updateMapLocationLabel(addressText);
    recalculateProviderDistances(lat, lng);
    if (State.currentView === 'home') renderHomeView();
    if (State.currentView === 'providers') {
      applyProviderFilters();
      renderFindProvidersMap();
    }
    showToast(`Showing registered providers near ${placeName}.`, 'success');
    return true;
  } catch (error) {
    console.error('Manual location search failed:', error);
    showToast(error.message || 'Could not search that location. Please try again.', 'warning');
    return false;
  }
}

// Request Customer Location with Geolocation API & Reverse Geocoding
async function requestCustomerLocation(targetInputId = 'hero-location-input', callback = null, options = {}) {
  const silent = options.silent === true;
  if (!silent) {
    AudioFX.playPing();
    showToast('Requesting GPS location access from browser...', 'info');
  }

  if (!navigator.geolocation) {
    if (!silent) showToast('Geolocation is not supported by your browser', 'warning');
    updateMapLocationLabel('Location unavailable');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = Math.round(pos.coords.accuracy || 15);

      State.emergencyForm.lat = lat;
      State.emergencyForm.lng = lng;
      State.currentLocation = { lat, lng };

      let addressText = `Current location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      let placeName = 'Your location';
      try {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
          headers: { 'Accept': 'application/json' }
        });
        if (geoRes.ok) {
          const data = await geoRes.json();
          if (data && data.display_name) {
            const parts = data.display_name.split(',');
            addressText = parts.slice(0, 3).join(',').trim();
            const address = data.address || {};
            placeName = address.suburb || address.neighbourhood || address.city_district ||
              address.village || address.town || address.city || address.county || placeName;
          }
        }
      } catch (e) {
        console.warn('Reverse geocoding failed:', e.message);
      }

      const input = document.getElementById(targetInputId);
      if (input) input.value = addressText;
      State.emergencyForm.location = addressText;

      State.currentPlaceName = placeName;
      updateFindSubheaderTitle();
      updateMapLocationLabel(State.currentPlaceName);

      // Update provider distances from customer's real coordinates!
      recalculateProviderDistances(lat, lng);
      if (State.currentView === 'home') renderHomeView();

      if (!silent) showToast(`Location access granted! Found nearby providers (±${accuracy}m)`, 'success');
      if (callback) callback(lat, lng, addressText);
    },
    (err) => {
      console.warn('Geolocation error or permission denied:', err.message);
      updateMapLocationLabel('Location unavailable');
      if (!silent) showToast('Could not access your location. Allow location access or enter it manually.', 'warning');
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

function updateMapLocationLabel(label) {
  const locationEl = document.getElementById('providers-map-location');
  if (locationEl) locationEl.textContent = label;
}

function recalculateProviderDistances(userLat, userLng) {
  State.providers.forEach(p => {
    if (Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
      const d = calcHaversine(userLat, userLng, p.lat, p.lng);
      p.distance = d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;
      const etaMins = Math.max(8, Math.round(d * 4 + 6));
      p.eta = `${etaMins} min`;
    }
  });
  if (State.currentView === 'providers') applyProviderFilters();
  else renderFindProvidersMap();
}

function calcHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function getProvidersWithinSearchRadius(location = State.currentLocation) {
  if (!location) return [];
  return State.providers.filter(provider =>
    Number.isFinite(Number(provider.lat)) &&
    Number.isFinite(Number(provider.lng)) &&
    calcHaversine(location.lat, location.lng, Number(provider.lat), Number(provider.lng)) <= PROVIDER_SEARCH_RADIUS_KM
  ).sort((a, b) =>
    calcHaversine(location.lat, location.lng, Number(a.lat), Number(a.lng)) -
    calcHaversine(location.lat, location.lng, Number(b.lat), Number(b.lng))
  );
}

function getProviderImage(provider) {
  return provider.image && !['/images/crop_hero.jpg', '/images/provider-service.svg'].includes(provider.image)
    ? provider.image
    : '/images/crop_hero.jpg';
}

// Service Center / Partner Self-Registration Handler
function setupPartnerRegistration() {
  const openBtn = document.getElementById('btn-open-partner-reg');
  const modal = document.getElementById('partner-reg-modal');
  if (openBtn && modal) {
    openBtn.onclick = async () => {
      const updating = Boolean(State.providerProfile);
      const serviceFields = document.getElementById('provider-service-registration-fields');
      const title = document.querySelector('#partner-reg-modal h3');
      const submitLabel = document.getElementById('provider-registration-submit-label');
      if (serviceFields) {
        serviceFields.hidden = updating;
        serviceFields.querySelectorAll('input, select').forEach(input => {
          input.disabled = updating;
        });
      }
      if (title) title.textContent = updating ? 'Update Provider UPI ID' : 'Register Your Service Center / Workshop';
      if (submitLabel) submitLabel.textContent = updating ? 'Save UPI ID' : 'Register Service Center';
      modal.classList.add('active');
      const phoneInput = document.getElementById('reg-phone');
      if (phoneInput && !phoneInput.value) phoneInput.value = State.user.phone || '';
      const upiInput = document.getElementById('reg-upi-id');
      if (upiInput) upiInput.value = updating ? State.providerProfile.upiId || '' : '';
      State.platformPricing = null;
      const disclosure = document.getElementById('provider-commission-rate');
      if (disclosure) disclosure.textContent = 'Loading current commission settings...';
      AudioFX.playPing();
      try {
        const response = await fetch('/api/platform/pricing');
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Could not load current commission settings.');
        }
        State.platformPricing = result.pricing;
        updateProviderCommissionDisclosure();
      } catch (error) {
        console.error('Provider pricing load failed:', error);
        if (disclosure) disclosure.textContent = 'Current commission settings could not be loaded. Refresh before registering.';
        showToast('Could not load current commission settings. Please try again.', 'warning');
      }
    };
  }
  const detectGpsBtn = document.getElementById('btn-detect-workshop-gps');
  if (detectGpsBtn) {
    detectGpsBtn.onclick = () => {
      requestCustomerLocation('reg-address', (lat, lng, address) => {
        const latInput = document.getElementById('reg-lat');
        const lngInput = document.getElementById('reg-lng');
        if (latInput) latInput.value = lat;
        if (lngInput) lngInput.value = lng;
        const addressInput = document.getElementById('reg-address');
        if (addressInput) addressInput.value = address;
      });
    };
  }

  const addressInput = document.getElementById('reg-address');
  const latInput = document.getElementById('reg-lat');
  const lngInput = document.getElementById('reg-lng');
  const openLocationPickerBtn = document.getElementById('btn-geocode-workshop-address');
  const locationPicker = document.getElementById('provider-location-picker');
  const locationPickerMap = document.getElementById('provider-location-picker-map');
  const locationPickerAddress = document.getElementById('provider-location-picker-address');
  const confirmLocationBtn = document.getElementById('btn-confirm-location-picker');
  const closeLocationPickerBtn = document.getElementById('btn-close-location-picker');
  const cancelLocationPickerBtn = document.getElementById('btn-cancel-location-picker');
  let pickerMap = null;
  let pickerMarker = null;
  let selectedLocation = null;
  let reverseLookupId = 0;

  if (addressInput && latInput && lngInput) {
    addressInput.oninput = () => {
      latInput.value = '';
      lngInput.value = '';
    };
  }

  const closeLocationPicker = () => {
    if (locationPicker) locationPicker.classList.remove('active');
    reverseLookupId += 1;
  };
  if (closeLocationPickerBtn) closeLocationPickerBtn.onclick = closeLocationPicker;
  if (cancelLocationPickerBtn) cancelLocationPickerBtn.onclick = closeLocationPicker;
  if (locationPicker) {
    locationPicker.onclick = event => {
      if (event.target === locationPicker) closeLocationPicker();
    };
  }

  const reverseGeocodePickerLocation = async (lat, lng) => {
    const lookupId = ++reverseLookupId;
    selectedLocation = null;
    confirmLocationBtn.disabled = true;
    locationPickerAddress.textContent = 'Finding the address for this location...';
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!response.ok) throw new Error('The address lookup service is unavailable right now.');
      const result = await response.json();
      if (lookupId !== reverseLookupId) return;
      if (!result || !result.display_name) {
        throw new Error('No address was found for this map location. Try another point.');
      }
      selectedLocation = { lat, lng, address: result.display_name.slice(0, 250) };
      locationPickerAddress.textContent = selectedLocation.address;
      confirmLocationBtn.disabled = false;
    } catch (error) {
      if (lookupId !== reverseLookupId) return;
      locationPickerAddress.textContent = error.message || 'Could not find an address here. Try another point.';
      showToast(locationPickerAddress.textContent, 'warning');
    }
  };

  if (openLocationPickerBtn && locationPicker && locationPickerMap && locationPickerAddress &&
      confirmLocationBtn && addressInput && latInput && lngInput) {
    openLocationPickerBtn.onclick = async () => {
      locationPicker.classList.add('active');
      reverseLookupId += 1;
      selectedLocation = null;
      confirmLocationBtn.disabled = true;
      locationPickerAddress.textContent = 'Click the map to choose a location.';
      if (pickerMarker) {
        pickerMap.removeLayer(pickerMarker);
        pickerMarker = null;
      }

      let center = [20.5937, 78.9629];
      let zoom = 5;
      const currentLat = Number(latInput.value);
      const currentLng = Number(lngInput.value);
      if (Number.isFinite(currentLat) && Number.isFinite(currentLng) && latInput.value && lngInput.value) {
        center = [currentLat, currentLng];
        zoom = 16;
      } else if (State.currentLocation) {
        center = [State.currentLocation.lat, State.currentLocation.lng];
        zoom = 13;
      }

      if (!pickerMap) {
        pickerMap = window.L.map(locationPickerMap).setView(center, zoom);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19
        }).addTo(pickerMap);
        pickerMap.on('click', event => {
          const { lat, lng } = event.latlng;
          if (pickerMarker) pickerMarker.setLatLng(event.latlng);
          else pickerMarker = window.L.marker(event.latlng).addTo(pickerMap);
          reverseGeocodePickerLocation(lat, lng);
        });
      } else {
        pickerMap.setView(center, zoom);
      }

      window.setTimeout(() => pickerMap.invalidateSize(), 0);

      const query = addressInput.value.trim();
      if (query.length >= 4 && !latInput.value && !lngInput.value) {
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
            { headers: { Accept: 'application/json' } }
          );
          if (!response.ok) throw new Error('The address search service is unavailable right now.');
          const results = await response.json();
          const result = Array.isArray(results) ? results[0] : null;
          const lat = Number(result && result.lat);
          const lng = Number(result && result.lon);
          if (result && Number.isFinite(lat) && Number.isFinite(lng) &&
              locationPicker.classList.contains('active') && !pickerMarker) {
            pickerMap.setView([lat, lng], 16);
          } else if (!result) {
            showToast('Address not found; choose the service-center location directly on the map.', 'info');
          }
        } catch (error) {
          showToast(error.message || 'Could not center the map on the entered address.', 'warning');
        }
      }
    };

    confirmLocationBtn.onclick = () => {
      if (!selectedLocation) return;
      addressInput.value = selectedLocation.address;
      latInput.value = String(selectedLocation.lat);
      lngInput.value = String(selectedLocation.lng);
      closeLocationPicker();
      showToast('Service-center address and map pin selected.', 'success');
    };
  }

  const form = document.getElementById('partner-registration-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const updating = Boolean(State.providerProfile);
      if (!updating && !State.platformPricing) {
        showToast('Current commission settings are unavailable. Refresh before registering.', 'warning');
        return;
      }
      const payload = updating
        ? { upiId: document.getElementById('reg-upi-id').value.trim() }
        : {
          providerName: document.getElementById('reg-business-name').value.trim(),
          phone: document.getElementById('reg-phone').value.trim(),
          upiId: document.getElementById('reg-upi-id').value.trim(),
          serviceCategory: document.getElementById('reg-category').value,
          address: document.getElementById('reg-address').value.trim(),
          lat: parseFloat(document.getElementById('reg-lat').value),
          lng: parseFloat(document.getElementById('reg-lng').value),
          price: parseFloat(document.getElementById('reg-price').value)
        };

      try {
        const res = await fetch(updating ? '/api/providers/mine/upi' : '/api/providers/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.success || !data.provider) {
          throw new Error(data.message || (updating ? 'Could not update provider UPI ID.' : 'Service center registration failed.'));
        }

        State.providerProfile = data.provider;
        State.providerOnline = Boolean(data.provider.available);
        const publicProvider = { ...data.provider };
        State.providers = [publicProvider, ...State.providers.filter(provider => provider.id !== data.provider.id)];

        if (modal) modal.classList.remove('active');
        AudioFX.playPing();
        if (updating) {
          showToast('Provider UPI ID updated.', 'success');
        } else {
          showToast(`"${payload.providerName}" is now registered and visible to nearby customers.`, 'success');
        }

        navigateToView('provider');
        renderProviderPortal();
        applyProviderFilters();
      } catch (error) {
        showToast(error.message || 'Service center registration failed.', 'warning');
      }
    };
  }

}

/* ==========================================================================
   Find Providers View (Matching Right Pane of Screenshot)
   ========================================================================== */
function renderFindProvidersView() {
  applyProviderFilters();
}

function setupFilterEvents() {
  const catSelect = document.getElementById('filter-category-select');
  if (catSelect) {
    catSelect.onchange = (e) => {
      State.filters.category = e.target.value;
      updateFindSubheaderTitle();
      applyProviderFilters();
    };
  }

  const availCheck = document.getElementById('filter-available-check');
  if (availCheck) {
    availCheck.onchange = (e) => {
      State.filters.availableOnly = e.target.checked;
      applyProviderFilters();
    };
  }

  const ratingCheck = document.getElementById('filter-rating-check');
  if (ratingCheck) {
    ratingCheck.onchange = (e) => {
      State.filters.ratingMin = e.target.checked ? 4.5 : 0;
      applyProviderFilters();
    };
  }

  const verifiedCheck = document.getElementById('filter-verified-check');
  if (verifiedCheck) {
    verifiedCheck.onchange = (e) => {
      State.filters.verifiedOnly = e.target.checked;
      applyProviderFilters();
    };
  }

  const priceSlider = document.getElementById('filter-price-slider');
  const priceDisplay = document.getElementById('price-slider-display');
  if (priceSlider) {
    priceSlider.oninput = (e) => {
      State.filters.maxPrice = parseInt(e.target.value);
      if (priceDisplay) priceDisplay.innerText = `Rs 500 - Rs ${State.filters.maxPrice.toLocaleString()}`;
    };
  }

  const applyBtn = document.getElementById('btn-apply-filters');
  if (applyBtn) {
    applyBtn.onclick = () => {
      AudioFX.playPing();
      applyProviderFilters();
      showToast('Filters applied', 'info');
    };
  }

  const clearBtn = document.getElementById('btn-clear-filters');
  if (clearBtn) {
    clearBtn.onclick = () => {
      State.filters = { category: 'all', availableOnly: false, ratingMin: 0, maxPrice: 100000, verifiedOnly: false };
      if (catSelect) catSelect.value = 'all';
      if (availCheck) availCheck.checked = false;
      if (ratingCheck) ratingCheck.checked = false;
      if (verifiedCheck) verifiedCheck.checked = false;
      if (priceSlider) priceSlider.value = 100000;
      if (priceDisplay) priceDisplay.innerText = 'Rs 500 - Rs 100,000';
      applyProviderFilters();
      showToast('Filters cleared', 'info');
    };
  }
}

function updateFindSubheaderTitle() {
  const titleEl = document.getElementById('find-subbar-title');
  if (!titleEl) return;
  const catNames = {
    'vehicle-towing': 'Vehicle Towing',
    'puncture-repair': 'Puncture Repair',
    'battery-jumpstart': 'Battery Jump-Start',
    'car-mechanic': 'Car Mechanics',
    'bike-mechanic': 'Bike Mechanics',
    'battery-replacement': 'Battery Replacement',
    'spare-parts': 'Spare Parts Delivery',
    'emergency-assistance': 'Emergency Vehicle Assistance',
    'authorized-fuel': 'Authorized Fuel Assistance',
    'all': 'All Roadside Providers'
  };
  titleEl.textContent = `${catNames[State.filters.category] || 'Roadside Assistance'} near ${State.currentPlaceName}`;
}

function setupProviderViewToggles() {
  const layout = document.querySelector('.find-layout-grid');
  const listButton = document.getElementById('btn-provider-list-view');
  const mapButton = document.getElementById('btn-provider-map-view');
  if (!layout || !listButton || !mapButton) return;

  const setView = (showMapOnly) => {
    layout.classList.toggle('map-only', showMapOnly);
    listButton.classList.toggle('active', !showMapOnly);
    mapButton.classList.toggle('active', showMapOnly);
    listButton.setAttribute('aria-pressed', String(!showMapOnly));
    mapButton.setAttribute('aria-pressed', String(showMapOnly));
    window.setTimeout(() => {
      if (providerMap) providerMap.invalidateSize();
    }, 100);
  };

  listButton.addEventListener('click', () => setView(false));
  mapButton.addEventListener('click', () => setView(true));
}

function applyProviderFilters() {
  updateFindSubheaderTitle();

  let filtered = getProvidersWithinSearchRadius();
  if (State.filters.category && State.filters.category !== 'all') {
    filtered = filtered.filter(p => p.category === State.filters.category);
  }
  if (State.filters.availableOnly) {
    filtered = filtered.filter(p => p.available);
  }
  if (State.filters.ratingMin > 0) {
    filtered = filtered.filter(p => p.rating >= State.filters.ratingMin);
  }
  if (State.filters.verifiedOnly) {
    filtered = filtered.filter(p => p.badge.includes('Verified'));
  }
  if (State.filters.maxPrice) {
    filtered = filtered.filter(p => p.price <= State.filters.maxPrice);
  }

  const countBadge = document.getElementById('providers-count-meta');
  if (countBadge) countBadge.innerText = `${filtered.length} providers in range`;

  const grid = document.getElementById('providers-results-grid');
  if (!grid) return;

  if (filtered.length === 0) {
    const place = State.currentPlaceName || 'your area';
    const message = State.currentLocation
      ? `No registered service centers within ${PROVIDER_SEARCH_RADIUS_KM} km of ${place} yet. As businesses near ${place} register, they will show up automatically.`
      : 'Share your current location to find registered service centers near you.';
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px 24px; text-align: center; background: #fff; border-radius: 12px; border: 1.5px dashed #D1D5DB;">
        <div style="font-size: 36px; margin-bottom: 12px;">📍</div>
        <h4 style="font-size: 18px; font-weight: 800; color: #111827; margin-bottom: 8px;">${escapeHtml(message)}</h4>
        ${State.currentLocation ? '' : '<button type="button" class="btn-apply-filters" onclick="requestCustomerLocation()">Use current location</button>'}
      </div>
    `;
    renderFindProvidersMap();
    return;
  }

  grid.innerHTML = filtered.map(provider => `
    <div class="provider-card ${State.selectedProviderId === provider.id ? 'selected' : ''}" data-provider-id="${escapeHtml(provider.id)}" onclick="selectProvider('${escapeHtml(provider.id)}')">
      <div class="provider-card-img">
        <img src="${escapeHtml(getProviderImage(provider))}" alt="${escapeHtml(provider.name)}" onerror="this.src='/images/crop_hero.jpg'">
      </div>
      <div class="provider-card-body">
        <div class="provider-card-name">${escapeHtml(provider.name)}</div>
        <div class="provider-rating-dist-row">
          <div class="rating-badge">${provider.rating ? `<span class="star">★</span> ${escapeHtml(provider.rating)} (${escapeHtml(provider.reviews)})` : 'New provider'}</div>
          <div class="dist-badge">📍 ${escapeHtml(provider.distance)}</div>
          <div class="arrival-pill"><span class="arrival-dot"></span> ${provider.available ? escapeHtml(provider.eta) : 'Offline'}</div>
        </div>
        <div class="provider-badges-row">
          <span class="badge-verified">✓ ${escapeHtml(provider.badge)}</span>
            <span class="${provider.available ? 'badge-available' : 'badge-offline'}">${provider.available ? '● Available now' : '● Offline'}</span>
        </div>
        <div class="provider-footer-row">
          <div class="provider-price-from">From Rs ${escapeHtml(provider.price)}</div>
            <button class="btn-book-provider" ${provider.available ? '' : 'disabled'} onclick="event.stopPropagation(); directBookProvider('${escapeHtml(provider.id)}')">Book Now</button>
        </div>
      </div>
    </div>
  `).join('');

  renderFindProvidersMap();
}

function selectProvider(id) {
  State.selectedProviderId = id;
  document.querySelectorAll('.provider-card').forEach(card => {
    card.classList.toggle('selected', card.getAttribute('data-provider-id') === id);
  });
  renderFindProvidersMap();
}

let pendingDirectBookingProviderId = null;

function setupDirectBooking() {
  const modal = document.getElementById('direct-booking-modal');
  const form = document.getElementById('direct-booking-form');
  const vehicleInput = document.getElementById('direct-booking-vehicle');
  const providerName = document.getElementById('direct-booking-provider');
  const locationDisplay = document.getElementById('direct-booking-location');
  const priceDisplay = document.getElementById('direct-booking-price');
  const submitButton = document.getElementById('btn-submit-direct-booking');

  const closeModal = () => {
    if (modal) modal.classList.remove('active');
    pendingDirectBookingProviderId = null;
  };
  const closeButton = document.getElementById('btn-close-direct-booking');
  const cancelButton = document.getElementById('btn-cancel-direct-booking');
  if (closeButton) closeButton.onclick = closeModal;
  if (cancelButton) cancelButton.onclick = closeModal;
  if (modal) {
    modal.onclick = event => {
      if (event.target === modal) closeModal();
    };
  }
  if (!form || !vehicleInput || !providerName || !locationDisplay || !priceDisplay || !submitButton) return;

  form.onsubmit = async event => {
    event.preventDefault();
    const provider = State.providers.find(item => item.id === pendingDirectBookingProviderId);
    if (!provider || !provider.available) {
      closeModal();
      showToast('This provider is no longer available. Refresh the provider list and try again.', 'warning');
      return;
    }
    const vehicleDetails = vehicleInput.value.trim();
    if (!vehicleDetails) {
      showToast('Enter your vehicle details before confirming the booking.', 'warning');
      vehicleInput.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Sending booking...';
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          serviceId: provider.category,
          vehicleDetails,
          location: State.emergencyForm.location,
          lat: State.currentLocation.lat,
          lng: State.currentLocation.lng
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.booking) {
        throw new Error(result.message || 'Could not create the booking.');
      }

      State.activeBooking = result.booking;
      State.bookingsList.unshift(result.booking);
      closeModal();
      showToast(`Booking created with ${provider.name}.`, 'success');
      navigateToView('track');
    } catch (error) {
      showToast(error.message || 'Could not create the booking.', 'warning');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Confirm booking';
    }
  };
}

function setupProviderCompletionModal() {
  const modal = document.getElementById('provider-completion-modal');
  const form = document.getElementById('provider-completion-form');
  const otpInput = document.getElementById('provider-completion-otp');
  const errorMessage = document.getElementById('provider-completion-error');
  const submitButton = document.getElementById('btn-submit-provider-completion');
  if (!modal || !form || !otpInput || !errorMessage || !submitButton) return;

  const closeModal = () => {
    modal.classList.remove('active');
    form.reset();
    errorMessage.hidden = true;
    errorMessage.textContent = '';
  };
  const closeButton = document.getElementById('btn-close-provider-completion');
  const cancelButton = document.getElementById('btn-cancel-provider-completion');
  if (closeButton) closeButton.onclick = closeModal;
  if (cancelButton) cancelButton.onclick = closeModal;
  modal.onclick = event => {
    if (event.target === modal) closeModal();
  };

  form.onsubmit = async event => {
    event.preventDefault();
    const booking = State.activeBooking;
    if (!booking || booking.status !== 'IN_PROGRESS') {
      errorMessage.textContent = 'The service must be in progress before it can be completed.';
      errorMessage.hidden = false;
      return;
    }

    const otp = otpInput.value.trim();
    if (!/^\d{4}$/.test(otp)) {
      errorMessage.textContent = 'Enter the 4-digit OTP shared by the customer.';
      errorMessage.hidden = false;
      otpInput.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Verifying...';
    errorMessage.hidden = true;
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(booking.id)}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp })
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.booking) {
        throw new Error(result.message || 'OTP verification failed.');
      }
      State.activeBooking = result.booking;
      State.bookingsList = State.bookingsList.map(item =>
        item.id === result.booking.id ? result.booking : item);
      AudioFX.playPing();
      closeModal();
      showToast('OTP verified. The booking is complete.', 'success');
      renderProviderPortal();
    } catch (error) {
      errorMessage.textContent = error.message || 'OTP verification failed.';
      errorMessage.hidden = false;
      showToast(errorMessage.textContent, 'warning');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Verify OTP & Complete';
    }
  };
}

function setupProviderUnregisterModal() {
  const modal = document.getElementById('provider-unregister-modal');
  const confirmButton = document.getElementById('btn-confirm-provider-unregister');
  const errorMessage = document.getElementById('provider-unregister-error');
  if (!modal || !confirmButton || !errorMessage) return;

  const closeModal = () => {
    modal.classList.remove('active');
    errorMessage.hidden = true;
    errorMessage.textContent = '';
  };
  const closeButton = document.getElementById('btn-close-provider-unregister');
  const cancelButton = document.getElementById('btn-cancel-provider-unregister');
  if (closeButton) closeButton.onclick = closeModal;
  if (cancelButton) cancelButton.onclick = closeModal;
  modal.onclick = event => {
    if (event.target === modal) closeModal();
  };

  confirmButton.onclick = async () => {
    confirmButton.disabled = true;
    confirmButton.textContent = 'Unregistering...';
    errorMessage.hidden = true;
    try {
      const response = await fetch('/api/providers/mine', { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success || !result.providerId) {
        throw new Error(result.message || 'Could not unregister your service center.');
      }
      State.providers = State.providers.filter(provider => provider.id !== result.providerId);
      if (State.selectedProviderId === result.providerId) State.selectedProviderId = null;
      State.providerProfile = null;
      State.providerOnline = false;
      closeModal();
      renderProviderPortal();
      if (State.currentView === 'home') renderHomeView();
      if (State.currentView === 'providers') applyProviderFilters();
      renderFindProvidersMap();
      showToast('Your service center has been unregistered. You can register again at any time.', 'success');
    } catch (error) {
      errorMessage.textContent = error.message || 'Could not unregister your service center.';
      errorMessage.hidden = false;
      showToast(errorMessage.textContent, 'warning');
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = 'Unregister';
    }
  };
}

// Open the direct-booking form for an available provider.
async function directBookProvider(providerId) {
  const provider = State.providers.find(p => p.id === providerId);
  if (!provider) {
    showToast('This provider is no longer available. Refresh the provider list and try again.', 'warning');
    return;
  }
  if (!State.user.isLoggedIn || State.user.role !== 'user') {
    showToast('Sign in with a customer account to book a provider.', 'warning');
    return;
  }
  if (!provider.available) {
    showToast('This provider is currently offline. Choose another available provider.', 'warning');
    return;
  }
  if (!State.currentLocation || !State.emergencyForm.location) {
    const locationInput = document.getElementById('hero-location-input');
    const locationQuery = locationInput ? locationInput.value.trim() : '';
    if (!locationQuery || !await applyManualCustomerLocation(locationQuery)) {
      showToast('Share your current location or search for your pickup address before booking.', 'warning');
      return;
    }
  }
  const modal = document.getElementById('direct-booking-modal');
  const vehicleInput = document.getElementById('direct-booking-vehicle');
  const providerName = document.getElementById('direct-booking-provider');
  const locationDisplay = document.getElementById('direct-booking-location');
  const priceDisplay = document.getElementById('direct-booking-price');
  if (!modal || !vehicleInput || !providerName || !locationDisplay || !priceDisplay) {
    showToast('The booking form is unavailable. Please refresh and try again.', 'warning');
    return;
  }

  pendingDirectBookingProviderId = providerId;
  providerName.textContent = provider.name;
  locationDisplay.textContent = State.emergencyForm.location;
  priceDisplay.textContent = `Rs ${provider.price}`;
  vehicleInput.value = '';
  modal.classList.add('active');
  vehicleInput.focus();
}

/* ==========================================================================
   Emergency Assistance Modal (Step 2 of 3)
   ========================================================================== */
function openEmergencyModal() {
  const modal = document.getElementById('emergency-modal');
  if (modal) {
    modal.classList.add('active');
    AudioFX.playPing();
    const location = State.currentLocation;
    const nearbyProviderMarkers = location
      ? getProvidersWithinSearchRadius(location).map(provider => ({
        lat: provider.lat,
        lng: provider.lng,
        label: `${provider.name} (${provider.available ? 'Available' : 'Offline'})`
      }))
      : [];
    renderLeafletMap('emergency-modal-map', location && location.lat, location && location.lng,
      location ? [
        { lat: location.lat, lng: location.lng, label: 'Your location', type: 'customer' },
        ...nearbyProviderMarkers
      ] : [], location ? PROVIDER_SEARCH_RADIUS_KM : null);
  }
}

function closeEmergencyModal() {
  const modal = document.getElementById('emergency-modal');
  if (modal) modal.classList.remove('active');
}

function setupEmergencyModalEvents() {
  // Close buttons
  const closeBtn = document.getElementById('btn-close-emergency-modal');
  if (closeBtn) closeBtn.onclick = closeEmergencyModal;

  const modalOverlay = document.getElementById('emergency-modal');
  if (modalOverlay) {
    modalOverlay.onclick = (e) => {
      if (e.target === modalOverlay) closeEmergencyModal();
    };
  }
  const closeQuotesBtn = document.getElementById('btn-close-quotes-modal');
  if (closeQuotesBtn) {
    closeQuotesBtn.onclick = () => {
      document.getElementById('quotes-modal').classList.remove('active');
      stopEmergencyQuotePolling();
    };
  }

  // Vehicle type tiles
  document.querySelectorAll('.vehicle-tile').forEach(tile => {
    tile.onclick = () => {
      document.querySelectorAll('.vehicle-tile').forEach(t => {
        t.classList.remove('active');
        const badge = t.querySelector('.tile-check-badge');
        if (badge) badge.remove();
      });
      tile.classList.add('active');
      const check = document.createElement('span');
      check.className = 'tile-check-badge';
      check.innerHTML = '✓';
      tile.appendChild(check);
      State.emergencyForm.vehicleType = tile.getAttribute('data-vehicle');
    };
  });

  // Emergency category tiles
  document.querySelectorAll('.emg-category-tile').forEach(tile => {
    tile.onclick = () => {
      document.querySelectorAll('.emg-category-tile').forEach(t => {
        t.classList.remove('active');
        const badge = t.querySelector('.tile-check-badge');
        if (badge) badge.remove();
      });
      tile.classList.add('active');
      const check = document.createElement('span');
      check.className = 'tile-check-badge';
      check.innerHTML = '✓';
      tile.appendChild(check);
      State.emergencyForm.category = tile.getAttribute('data-cat');
    };
  });

  // Character counter for textarea
  const textarea = document.getElementById('emg-problem-desc');
  const counter = document.getElementById('char-count');
  if (textarea && counter) {
    textarea.oninput = (e) => {
      counter.innerText = `${e.target.value.length} / 500`;
      State.emergencyForm.description = e.target.value;
    };
  }

  // Urgency pills
  document.querySelectorAll('.urgency-pill').forEach(pill => {
    pill.onclick = () => {
      document.querySelectorAll('.urgency-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      State.emergencyForm.urgency = pill.getAttribute('data-urgency');
    };
  });

  // Adjust pin button with GPS Location Access
  const adjustPinBtn = document.getElementById('btn-adjust-pin');
  if (adjustPinBtn) {
    adjustPinBtn.onclick = () => {
      requestCustomerLocation('emg-problem-desc', (lat, lng, address) => {
        State.emergencyForm.lat = lat;
        State.emergencyForm.lng = lng;
        const nearbyProviderMarkers = getProvidersWithinSearchRadius({ lat, lng }).map(provider => ({
          lat: provider.lat,
          lng: provider.lng,
          label: `${provider.name} (${provider.available ? 'Available' : 'Offline'})`
        }));
        renderLeafletMap('emergency-modal-map', lat, lng, [
          { lat, lng, label: 'Live GPS Pin', type: 'customer' },
          ...nearbyProviderMarkers
        ], PROVIDER_SEARCH_RADIUS_KM);
        showToast(`Breakdown GPS pinned: ${address}`, 'success');
      });
    };
  }

  // Photo upload trigger & file input handler (Optional)
  const uploadBtn = document.getElementById('btn-upload-photo');
  const fileInput = document.getElementById('photo-file-input');
  const previewContainer = document.getElementById('photo-previews-container');

  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target.result;
          State.emergencyForm.photos.push(dataUrl);

          const thumb = document.createElement('div');
          thumb.className = 'photo-thumb-box';
          thumb.innerHTML = `
            <img src="${dataUrl}" alt="Breakdown photo">
            <button type="button" class="btn-remove-thumb">✕</button>
          `;
          thumb.querySelector('.btn-remove-thumb').onclick = (ev2) => {
            ev2.stopPropagation();
            thumb.remove();
            const idx = State.emergencyForm.photos.indexOf(dataUrl);
            if (idx > -1) State.emergencyForm.photos.splice(idx, 1);
            showToast('Photo removed', 'info');
          };
          previewContainer.insertBefore(thumb, uploadBtn);
        };
        reader.readAsDataURL(file);
      });
      showToast(`${files.length} photo(s) selected (optional)`, 'info');
    };
  }

  // SEND EMERGENCY REQUEST (Main Action)
  const sendBtn = document.getElementById('btn-send-emergency');
  if (sendBtn) {
    sendBtn.onclick = handleSendEmergencyRequest;
  }
}

// Broadcast Simulation & Submission
async function handleSendEmergencyRequest() {
  if (!State.emergencyForm.category) {
    showToast('Choose an emergency category before sending your request.', 'warning');
    return;
  }
  if (!State.emergencyForm.location ||
    !Number.isFinite(Number(State.emergencyForm.lat)) ||
    !Number.isFinite(Number(State.emergencyForm.lng))) {
    showToast('Share your current location before sending your request.', 'warning');
    return;
  }

  AudioFX.playEmergencyAlert();
  const broadcastOverlay = document.getElementById('broadcast-overlay');
  if (broadcastOverlay) {
    broadcastOverlay.classList.add('active');
  }

  try {
    const response = await fetch('/api/emergencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...State.emergencyForm,
        customerName: State.user.name,
        customerPhone: State.user.phone
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not send your request.');
    State.activeEmergency = result.emergency;
    closeEmergencyModal();
    if (broadcastOverlay) broadcastOverlay.classList.remove('active');
    State.emergencyPollCount = 0;
    openQuotesComparisonModal(result.emergency.quotes || [], true);
    await refreshEmergencyQuotes();
    if (State.activeEmergency.status === 'OPEN') {
      State.emergencyPollTimer = window.setInterval(refreshEmergencyQuotes, 3000);
    }
  } catch (error) {
    if (broadcastOverlay) broadcastOverlay.classList.remove('active');
    showToast(error.message || 'Could not send your request.', 'warning');
  }
}

function openQuotesComparisonModal(quotes = [], waiting = false) {
  const modal = document.getElementById('quotes-modal');
  if (!modal) return;
  modal.classList.add('active');

  const quotesList = document.getElementById('incoming-quotes-list');
  if (!quotesList) return;
  quotesList.replaceChildren();
  if (quotes.length === 0) {
    const message = document.createElement('p');
    message.style.color = 'var(--text-muted)';
    message.textContent = waiting
      ? 'Your request was sent. Waiting for registered providers to respond...'
      : 'No providers have submitted a quote for this request.';
    quotesList.appendChild(message);
    return;
  }

  quotes.forEach(quote => {
    const card = document.createElement('div');
    card.className = 'section-card';
    card.style.marginBottom = '12px';
    const providerName = document.createElement('strong');
    providerName.textContent = quote.providerName;
    const notes = document.createElement('p');
    notes.style.cssText = 'margin: 8px 0; color: var(--text-muted);';
    notes.textContent = quote.notes || '';
    const priceAndEta = document.createElement('p');
    priceAndEta.textContent = `Rs ${quote.amount} · ETA ${quote.eta}`;
    const acceptButton = document.createElement('button');
    acceptButton.type = 'button';
    acceptButton.className = 'btn-apply-filters';
    acceptButton.textContent = 'Accept offer';
    acceptButton.onclick = () => acceptEmergencyQuote(quote.id);
    card.append(providerName, notes, priceAndEta, acceptButton);
    quotesList.appendChild(card);
  });
}

async function refreshEmergencyQuotes() {
  const emergency = State.activeEmergency;
  if (!emergency || emergency.status !== 'OPEN') {
    stopEmergencyQuotePolling();
    return;
  }
  try {
    const response = await fetch('/api/emergencies');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not refresh provider offers.');
    const latest = result.emergencies.find(item => item.id === emergency.id);
    if (!latest) return;
    State.activeEmergency = latest;
    openQuotesComparisonModal(latest.quotes || [], State.emergencyPollCount < 20);
    if (latest.status !== 'OPEN' || State.emergencyPollCount >= 20) {
      stopEmergencyQuotePolling();
    }
    State.emergencyPollCount += 1;
  } catch (error) {
    console.error('Provider offers refresh failed:', error);
    stopEmergencyQuotePolling();
    showToast(error.message || 'Could not refresh provider offers.', 'warning');
  }
}

function stopEmergencyQuotePolling() {
  if (State.emergencyPollTimer) {
    window.clearInterval(State.emergencyPollTimer);
    State.emergencyPollTimer = null;
  }
}

async function acceptEmergencyQuote(quoteId) {
  const emergency = State.activeEmergency;
  if (!emergency) return;
  try {
    const response = await fetch(`/api/emergencies/${encodeURIComponent(emergency.id)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not accept this provider offer.');
    stopEmergencyQuotePolling();
    document.getElementById('quotes-modal').classList.remove('active');
    State.activeEmergency = { ...emergency, status: 'ASSIGNED' };
    State.activeBooking = result.booking;
    State.bookingsList.unshift(result.booking);
    showToast('Provider offer accepted. Your booking is ready to track.', 'success');
    navigateToView('track');
  } catch (error) {
    showToast(error.message || 'Could not accept this provider offer.', 'warning');
  }
}

/* ==========================================================================
   Live Tracking & Execution View
   ========================================================================== */
function renderTrackingView() {
  const b = State.activeBooking && !['COMPLETED', 'CANCELLED'].includes(State.activeBooking.status)
    ? State.activeBooking
    : State.bookingsList.find(booking => !['COMPLETED', 'CANCELLED'].includes(booking.status));
  const emptyState = document.getElementById('tracking-empty-state');
  const header = document.getElementById('tracking-header-card');
  const details = document.getElementById('tracking-main-grid');
  if (!b) {
    if (emptyState) emptyState.hidden = false;
    if (header) header.hidden = true;
    if (details) details.hidden = true;
    return;
  }
  if (emptyState) emptyState.hidden = true;
  if (header) header.hidden = false;
  if (details) details.hidden = false;

  const titleEl = document.getElementById('track-booking-title');
  if (titleEl) titleEl.textContent = `Booking #${b.id} — ${b.serviceName}`;

  const nameEl = document.getElementById('track-provider-name');
  if (nameEl) nameEl.innerText = b.providerName;
  const callProviderLink = document.getElementById('btn-call-provider');
  const providerPhoneDisplay = document.getElementById('track-provider-phone');
  if (callProviderLink) {
    const dialNumber = getTelNumber(b.providerPhone);
    if (dialNumber) {
      callProviderLink.href = `tel:${dialNumber}`;
      callProviderLink.setAttribute('aria-label', `Call ${b.providerName} at ${b.providerPhone}`);
      callProviderLink.removeAttribute('aria-disabled');
      if (providerPhoneDisplay) providerPhoneDisplay.textContent = `Provider phone: ${b.providerPhone}`;
    } else {
      callProviderLink.href = '#';
      callProviderLink.setAttribute('aria-disabled', 'true');
      callProviderLink.removeAttribute('aria-label');
      if (providerPhoneDisplay) providerPhoneDisplay.textContent = 'Provider phone is unavailable for this booking.';
    }
  }

  const ratingEl = document.getElementById('track-provider-rating');
  if (ratingEl) ratingEl.innerText = b.providerRating ? `★ ${b.providerRating} · Registered provider` : 'Registered provider';

  const imageEl = document.getElementById('track-provider-image');
  if (imageEl && b.providerImage) imageEl.src = getProviderImage({ image: b.providerImage });

  const otpEl = document.getElementById('track-otp-display');
  if (otpEl) otpEl.innerText = b.otp || '';

  const statusText = document.getElementById('track-status-badge');
  if (statusText) statusText.innerText = (b.status || '').replace(/_/g, ' ');
  const liveLocationStatus = document.getElementById('track-live-location-status');
  if (liveLocationStatus) {
    if (b.status === 'PROVIDER_EN_ROUTE') {
      liveLocationStatus.textContent = b.liveProviderLocation
        ? `Provider live location · ${formatLiveLocationAge(b.liveProviderLocation.updatedAt)}`
        : 'Provider is en route. Waiting for live location...';
    } else if (['ARRIVED', 'IN_PROGRESS'].includes(b.status)) {
      liveLocationStatus.textContent = 'Provider has arrived at your location.';
    } else if (b.status === 'COMPLETED') {
      liveLocationStatus.textContent = 'Service completed.';
    } else {
      liveLocationStatus.textContent = 'Live route updates will appear when the provider starts driving.';
    }
  }

  const pricing = b.pricing || {};
  const fields = {
    'track-service-charge': pricing.serviceCharge,
    'track-platform-fee': pricing.platformFee,
    'track-gst': pricing.gst,
    'track-total': pricing.total
  };
  Object.entries(fields).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value == null ? '' : `Rs ${value}`;
  });
  const paymentStatus = b.paymentMethod === 'DIRECT_UPI'
    ? 'Direct UPI (not tracked)'
    : b.paymentStatus || 'Not recorded';
  const paymentStatusElement = document.getElementById('track-payment-status');
  const paymentNote = document.getElementById('track-payment-note');
  if (paymentStatusElement) paymentStatusElement.textContent = paymentStatus;
  if (paymentNote) {
    paymentNote.textContent = 'ResQ Wheels does not collect customer payments. Pay the provider directly by UPI.';
  }
  const commissionRate = document.getElementById('track-commission-rate');
  if (commissionRate) {
    commissionRate.textContent = `${Number(pricing.commissionRate || 0)}%`;
  }
  const commission = document.getElementById('track-commission');
  if (commission) commission.textContent = `Rs ${Number(pricing.commission || 0)}`;
  const providerUpi = document.getElementById('track-provider-upi');
  if (providerUpi) {
    providerUpi.textContent = b.providerUpiId ? `Provider UPI ID: ${b.providerUpiId}` : '';
  }
  const payButton = document.getElementById('btn-direct-upi-pay');
  if (payButton) {
    payButton.hidden = !b.providerUpiId || ['PENDING', 'CANCELLED'].includes(b.status);
    payButton.disabled = false;
    payButton.textContent = `Pay Rs ${Number(pricing.total || 0).toLocaleString('en-IN')} by UPI`;
  }

  updateTrackingStepper(b.status);
  renderTrackingRouteMap();
}

function getTelNumber(phone) {
  const value = String(phone || '').trim();
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `${value.startsWith('+') ? '+' : ''}${digits}`;
}

function formatLiveLocationAge(updatedAt) {
  const updatedTime = Date.parse(updatedAt);
  if (!Number.isFinite(updatedTime)) return 'location update time unavailable';
  const seconds = Math.max(0, Math.floor((Date.now() - updatedTime) / 1000));
  if (seconds < 60) return `updated ${seconds} sec ago`;
  return `updated ${Math.floor(seconds / 60)} min ago`;
}

function stopTrackingUpdates() {
  if (State.trackingPollTimer !== null) {
    window.clearInterval(State.trackingPollTimer);
    State.trackingPollTimer = null;
  }
}

function startTrackingUpdates() {
  stopTrackingUpdates();
  State.trackingPollErrorNotified = false;
  const refreshBooking = async () => {
    const booking = State.activeBooking || State.bookingsList.find(item =>
      !['COMPLETED', 'CANCELLED'].includes(item.status));
    if (!booking || ['COMPLETED', 'CANCELLED'].includes(booking.status)) {
      stopTrackingUpdates();
      return;
    }
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(booking.id)}`);
      const result = await response.json();
      if (!response.ok || !result.success || !result.booking) {
        throw new Error(result.message || 'Could not refresh the live booking status.');
      }
      State.activeBooking = result.booking;
      const bookingIndex = State.bookingsList.findIndex(item => item.id === result.booking.id);
      if (bookingIndex >= 0) State.bookingsList[bookingIndex] = result.booking;
      else State.bookingsList.unshift(result.booking);
      State.trackingPollErrorNotified = false;
      if (State.currentView === 'track') renderTrackingView();
      if (['COMPLETED', 'CANCELLED'].includes(result.booking.status)) stopTrackingUpdates();
    } catch (error) {
      console.error('Live booking refresh failed:', error);
      if (!State.trackingPollErrorNotified) {
        showToast(error.message || 'Could not refresh the live booking status.', 'warning');
        State.trackingPollErrorNotified = true;
      }
    }
  };
  State.trackingPollTimer = window.setInterval(refreshBooking, 5000);
  refreshBooking();
}

function updateTrackingStepper(status) {
  const stages = ['PENDING', 'ACCEPTED', 'PROVIDER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];
  const curIdx = stages.indexOf(status);

  document.querySelectorAll('.stepper-node').forEach(node => {
    const nodeStatus = node.getAttribute('data-step');
    const nodeIdx = stages.indexOf(nodeStatus);

    node.classList.remove('active', 'done');
    if (nodeIdx < curIdx) {
      node.classList.add('done');
    } else if (nodeIdx === curIdx) {
      node.classList.add('active');
    }
  });
}

function setupTrackingControls() {
  const callBtn = document.getElementById('btn-call-provider');
  if (callBtn) {
    callBtn.onclick = event => {
      if (callBtn.getAttribute('aria-disabled') === 'true') {
        event.preventDefault();
        showToast('Provider contact details are not available for this booking.', 'warning');
      }
    };
  }

  const payButton = document.getElementById('btn-direct-upi-pay');
  if (payButton) {
    payButton.onclick = () => {
      const booking = State.activeBooking;
      if (!booking || !booking.providerUpiId || !Number.isFinite(Number(booking.pricing && booking.pricing.total))) {
        showToast('The provider UPI payment details are not available for this booking.', 'warning');
        return;
      }
      const parameters = new URLSearchParams({
        pa: booking.providerUpiId,
        pn: booking.providerName || 'ResQ Wheels Provider',
        am: Number(booking.pricing.total).toFixed(2),
        cu: 'INR',
        tn: `ResQ Wheels booking ${booking.id}`
      });
      window.location.href = `upi://pay?${parameters.toString()}`;
    };
  }

  const chatInput = document.getElementById('chat-msg-input');
  const chatSendBtn = document.getElementById('btn-send-chat');
  if (chatSendBtn && chatInput) {
    chatSendBtn.onclick = async () => {
      const text = chatInput.value.trim();
      if (!text) return;
      const booking = State.activeBooking;
      if (!booking) {
        showToast('There is no active booking to message about.', 'warning');
        return;
      }
      try {
        const response = await fetch(`/api/bookings/${encodeURIComponent(booking.id)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Message could not be sent.');
        appendChatMessage('customer', result.message.text);
        chatInput.value = '';
      } catch (error) {
        showToast(error.message || 'Message could not be sent.', 'warning');
      }
    };
  }
}

function appendChatMessage(sender, text) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  const bubble = document.createElement('div');
  bubble.style.maxWidth = '80%';
  bubble.style.padding = '8px 12px';
  bubble.style.borderRadius = '10px';
  bubble.style.fontSize = '12px';
  bubble.style.marginBottom = '8px';

  if (sender === 'customer') {
    bubble.style.marginLeft = 'auto';
    bubble.style.background = 'var(--primary-orange)';
    bubble.style.color = '#fff';
  } else {
    bubble.style.marginRight = 'auto';
    bubble.style.background = '#F3F4F6';
    bubble.style.color = '#111827';
  }

  bubble.innerText = text;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

/* ==========================================================================
   Customer Dashboard View
   ========================================================================== */
function renderCustomerDashboard() {
  const dashName = document.getElementById('dashboard-user-name');
  if (dashName) dashName.innerText = State.user.name || '';

  const listEl = document.getElementById('customer-bookings-list');
  if (!listEl) return;

  listEl.innerHTML = State.bookingsList.map(b => `
    <tr>
      <td style="font-weight: 700;">#${escapeHtml(b.id)}</td>
      <td>${escapeHtml(b.serviceName)}</td>
      <td>${escapeHtml(b.providerName)}</td>
      <td>${escapeHtml(b.pickupLocation)}</td>
      <td style="font-weight: 700;">Rs ${escapeHtml(b.pricing.total)}</td>
      <td>${escapeHtml(b.paymentMethod === 'DIRECT_UPI' ? 'Direct UPI (not tracked)' : b.paymentStatus || 'Not recorded')}</td>
      <td>
        <span style="font-size: 11px; padding: 3px 8px; border-radius: 12px; font-weight: 700; ${b.status === 'COMPLETED' ? 'background: #DEF7EC; color: #03543F;' : 'background: #FFF4ED; color: #C2410C;'}">
          ${escapeHtml(b.status.replace(/_/g, ' '))}
        </span>
      </td>
      <td>
        <button onclick="State.activeBooking = State.bookingsList.find(x => x.id === '${escapeHtml(b.id)}'); navigateToView('track');" style="color: var(--primary-orange); font-size: 12px; font-weight: 600;">Track / Invoice</button>
        ${['PENDING', 'ACCEPTED'].includes(b.status) ? `<button onclick="cancelCustomerBooking('${escapeHtml(b.id)}')" style="color: #B91C1C; font-size: 12px; font-weight: 600; margin-left: 8px;">Cancel</button>` : ''}
      </td>
    </tr>
  `).join('');
}

async function cancelCustomerBooking(bookingId) {
  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, {
      method: 'POST'
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Could not cancel this booking.');
    }
    State.bookingsList = State.bookingsList.map(booking =>
      booking.id === result.booking.id ? result.booking : booking);
    if (State.activeBooking && State.activeBooking.id === result.booking.id) {
      State.activeBooking = State.bookingsList.find(booking =>
        !['COMPLETED', 'CANCELLED'].includes(booking.status)) || result.booking;
    }
    renderCustomerDashboard();
    showToast('Booking cancelled. Any reserved provider credits have been released.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not cancel this booking.', 'warning');
  }
}

/* ==========================================================================
   Service Provider Portal View
   ========================================================================== */
function updateProviderLiveLocationStatus(bookingId, message, canRetry = false) {
  if (State.providerLocationBookingId !== bookingId) return;
  const status = document.getElementById('provider-live-location-status');
  if (status) status.textContent = message;
  const retryButton = document.getElementById('btn-retry-provider-live-location');
  if (retryButton) retryButton.hidden = !canRetry;
}

function stopProviderLocationSharing() {
  if (State.providerLocationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(State.providerLocationWatchId);
  }
  State.providerLocationWatchId = null;
  State.providerLocationBookingId = null;
  State.providerLocationLastSentAt = 0;
  State.providerLocationErrorNotified = false;
}

function startProviderLocationSharing(bookingId, force = false) {
  if (!force && State.providerLocationBookingId === bookingId &&
    (State.providerLocationWatchId !== null || State.providerLocationErrorNotified)) {
    return;
  }
  if (State.providerLocationWatchId !== null) stopProviderLocationSharing();
  State.providerLocationBookingId = bookingId;
  State.providerLocationErrorNotified = false;
  State.providerLocationLastSentAt = 0;

  if (!navigator.geolocation) {
    State.providerLocationErrorNotified = true;
    updateProviderLiveLocationStatus(bookingId, 'This browser cannot share GPS location.', true);
    showToast('GPS location is not available in this browser.', 'warning');
    return;
  }

  updateProviderLiveLocationStatus(bookingId, 'Waiting for GPS location to share with the customer...');
  try {
    State.providerLocationWatchId = navigator.geolocation.watchPosition(async position => {
      const activeBooking = State.activeBooking;
      if (!activeBooking || activeBooking.id !== bookingId ||
        activeBooking.status !== 'PROVIDER_EN_ROUTE') return;
      const now = Date.now();
      if (now - State.providerLocationLastSentAt < 5000) return;
      State.providerLocationLastSentAt = now;
      try {
        const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          })
        });
        const result = await response.json();
        if (!response.ok || !result.success || !result.booking) {
          throw new Error(result.message || 'Could not share your live location.');
        }
        State.activeBooking = { ...State.activeBooking, liveProviderLocation: result.booking.liveProviderLocation };
        State.bookingsList = State.bookingsList.map(item =>
          item.id === bookingId
            ? { ...item, liveProviderLocation: result.booking.liveProviderLocation }
            : item);
        State.providerLocationErrorNotified = false;
        updateProviderLiveLocationStatus(bookingId, 'Your live location is being shared with this customer.');
      } catch (error) {
        console.error('Provider live location update failed:', error);
        updateProviderLiveLocationStatus(bookingId, 'Could not sync GPS. Live updates will retry.');
        if (!State.providerLocationErrorNotified) {
          showToast(error.message || 'Could not share your live location.', 'warning');
          State.providerLocationErrorNotified = true;
        }
      }
    }, error => {
      const message = error.code === error.PERMISSION_DENIED
        ? 'Allow location access to share your live route.'
        : error.code === error.TIMEOUT
          ? 'Waiting for a GPS signal. Keep location services enabled.'
          : 'Could not read your GPS location.';
      updateProviderLiveLocationStatus(bookingId, message, error.code === error.PERMISSION_DENIED);
      if (error.code === error.PERMISSION_DENIED) {
        if (State.providerLocationWatchId !== null) {
          navigator.geolocation.clearWatch(State.providerLocationWatchId);
          State.providerLocationWatchId = null;
        }
        State.providerLocationErrorNotified = true;
      }
      if (!State.providerLocationErrorNotified) {
        showToast(message, 'warning');
        State.providerLocationErrorNotified = true;
      }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  } catch (error) {
    State.providerLocationErrorNotified = true;
    updateProviderLiveLocationStatus(bookingId, 'Could not start GPS sharing. Check your location settings.', true);
    showToast(error.message || 'Could not start GPS sharing.', 'warning');
  }
}

function renderProviderPortal() {
  const hasProfile = Boolean(State.providerProfile);
  const registrationNavButton = document.getElementById('btn-open-partner-reg');
  if (registrationNavButton) {
    registrationNavButton.hidden = !hasProfile;
    registrationNavButton.innerHTML = `<span>🏢</span> ${hasProfile ? 'Update Provider UPI ID' : 'Register Service Center'}`;
  }
  const registrationPrompt = document.getElementById('provider-registration-prompt');
  const dashboard = document.getElementById('provider-dashboard-grid');
  const statusWrap = document.getElementById('provider-status-wrap');
  if (registrationPrompt) registrationPrompt.hidden = hasProfile;
  if (dashboard) dashboard.hidden = !hasProfile;
  if (statusWrap) statusWrap.hidden = !hasProfile;
  const name = document.getElementById('provider-profile-name');
  const meta = document.getElementById('provider-profile-meta');
  const address = document.getElementById('provider-address-display');
  if (hasProfile) {
    if (name) name.textContent = State.providerProfile.name;
    if (meta) meta.textContent = State.providerProfile.category.replace(/-/g, ' ');
    if (address) address.textContent = State.providerProfile.address;
  } else {
    if (name) name.textContent = 'No service center registered';
    if (meta) meta.textContent = 'Register a service center to appear in nearby searches.';
    if (address) address.textContent = 'Not registered';
  }
  const statusToggle = document.getElementById('provider-status-toggle');
  const statusLabel = document.getElementById('provider-status-label');
  const providerUpiInput = document.getElementById('provider-upi-id');
  if (providerUpiInput && hasProfile) providerUpiInput.value = State.providerProfile.upiId || '';
  const providerUpiForm = document.getElementById('provider-upi-form');
  if (providerUpiForm && hasProfile) {
    providerUpiForm.onsubmit = async event => {
      event.preventDefault();
      const upiId = providerUpiInput.value.trim();
      try {
        const response = await fetch('/api/providers/mine/upi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upiId })
        });
        const result = await response.json();
        if (!response.ok || !result.success || !result.provider) {
          throw new Error(result.message || 'Could not update provider UPI ID.');
        }
        State.providerProfile = result.provider;
        const providerIndex = State.providers.findIndex(provider => provider.id === result.provider.id);
        if (providerIndex >= 0) State.providers[providerIndex] = result.provider;
        showToast('Provider UPI ID updated. Customers can now pay you directly.', 'success');
      } catch (error) {
        showToast(error.message || 'Could not update provider UPI ID.', 'warning');
      }
    };
  }

  if (statusToggle && hasProfile) {
    statusToggle.classList.toggle('active', State.providerOnline);
    statusToggle.setAttribute('aria-checked', String(State.providerOnline));
    if (statusLabel) {
      statusLabel.innerText = State.providerOnline ? 'Online (Available)' : 'Offline (Paused)';
      statusLabel.style.color = State.providerOnline ? '#10B981' : '#94A3B8';
    }
    statusToggle.onclick = async () => {
      const available = !State.providerOnline;
      statusToggle.disabled = true;
      statusToggle.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch('/api/providers/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ available })
        });
        const result = await response.json();
        if (!response.ok || !result.success || !result.provider) {
          throw new Error(result.message || 'Could not update provider availability.');
        }
        State.providerProfile = result.provider;
        State.providerOnline = result.provider.available;
        State.providers = State.providers.map(provider =>
          provider.id === result.provider.id ? result.provider : provider);
        renderProviderPortal();
        showToast(State.providerOnline ? 'Your service center is now online.' : 'Your service center is now offline.', 'info');
      } catch (error) {
        showToast(error.message || 'Could not update provider availability.', 'warning');
      } finally {
        statusToggle.disabled = false;
        statusToggle.removeAttribute('aria-busy');
      }
    };
  }

  const unregisterButton = document.getElementById('btn-unregister-provider');
  if (unregisterButton) {
    unregisterButton.onclick = () => {
      const modal = document.getElementById('provider-unregister-modal');
      const errorMessage = document.getElementById('provider-unregister-error');
      if (!modal || !errorMessage) {
        showToast('The confirmation form is unavailable. Please refresh and try again.', 'warning');
        return;
      }
      errorMessage.hidden = true;
      errorMessage.textContent = '';
      modal.classList.add('active');
    };
  }

  const updateLocationButton = document.getElementById('btn-update-provider-location');
  if (updateLocationButton && hasProfile) {
    updateLocationButton.onclick = () => {
      if (!navigator.geolocation) {
        showToast('GPS location is not available in this browser.', 'warning');
        return;
      }
      updateLocationButton.disabled = true;
      updateLocationButton.textContent = 'Getting service-center location...';
      navigator.geolocation.getCurrentPosition(async position => {
        try {
          const { latitude: lat, longitude: lng } = position.coords;
          const geocodeResponse = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
            { headers: { Accept: 'application/json' } }
          );
          if (!geocodeResponse.ok) throw new Error('Could not resolve your GPS location to an address.');
          const geocodeResult = await geocodeResponse.json();
          const address = typeof geocodeResult.display_name === 'string'
            ? geocodeResult.display_name.slice(0, 250)
            : '';
          if (!address) throw new Error('No address was found for your GPS location.');

          const response = await fetch('/api/providers/location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng, address })
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || 'Could not update the service-center pin.');
          State.providerProfile = result.provider;
          const providerIndex = State.providers.findIndex(provider => provider.id === result.provider.id);
          if (providerIndex >= 0) State.providers[providerIndex] = result.provider;
          renderProviderPortal();
          renderFindProvidersMap();
          showToast('Service-center address and map pin updated from GPS.', 'success');
        } catch (error) {
          showToast(error.message || 'Could not update the service-center pin.', 'warning');
        } finally {
          updateLocationButton.disabled = false;
          updateLocationButton.textContent = 'Update service-center pin from GPS';
        }
      }, error => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Allow location access to update your service-center pin.'
          : error.code === error.TIMEOUT
            ? 'GPS location timed out. Please try again.'
            : 'Could not get your GPS location. Please try again.';
        showToast(message, 'warning');
        updateLocationButton.disabled = false;
        updateLocationButton.textContent = 'Update service-center pin from GPS';
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    };
  }

  const b = State.activeBooking || State.bookingsList[0];
  const activeJobEl = document.getElementById('provider-active-job-details');
  if (activeJobEl && b) {
    activeJobEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
        <div>
          <h4 style="font-size: 17px; font-weight: 800; color: #111827;">${escapeHtml(b.customerName)} — ${escapeHtml(b.vehicleDetails)}</h4>
          <p style="font-size: 13px; color: #4B5563;">📍 ${escapeHtml(b.pickupLocation)}</p>
        </div>
        <span style="background: var(--primary-orange-light); color: var(--primary-orange); font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 6px;">
          Job #${escapeHtml(b.id)}
        </span>
      </div>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
          <span>Customer Phone:</span>
          ${getTelNumber(b.customerPhone)
            ? `<a href="tel:${getTelNumber(b.customerPhone)}" style="font-weight: 700; color: #1E293B;">${escapeHtml(b.customerPhone)}</a>`
            : '<span>Unavailable</span>'}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
          <span>Customer service price:</span>
          <span style="font-weight: 700; color: #1E293B;">Rs ${escapeHtml(b.pricing.serviceCharge)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
          <span>Virtual commission (${escapeHtml(b.pricing.commissionRate || 0)}% of total):</span>
          <span style="font-weight: 700; color: #1E293B;">Rs ${escapeHtml(b.pricing.commission)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
          <span>Customer UPI amount:</span>
          <span style="font-weight: 700; color: #1E293B;">Rs ${escapeHtml(b.pricing.total)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
          <span>Commission credits ${b.status === 'COMPLETED' ? 'deducted' : 'reserved'}:</span>
          <span style="font-weight: 700; color: #1E293B;">Rs ${escapeHtml(b.pricing.commission)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px;">
          <span>Current Job Stage:</span>
          <span style="font-weight: 800; color: var(--primary-orange);">${escapeHtml(b.status.replace(/_/g, ' '))}</span>
        </div>
      </div>
      ${b.status === 'PROVIDER_EN_ROUTE' ? `
        <p id="provider-live-location-status" style="margin: 0 0 8px; color: #475569; font-size: 12px;" aria-live="polite">
          Waiting for GPS location to share with the customer...
        </p>
        <button type="button" id="btn-retry-provider-live-location" hidden
          onclick="startProviderLocationSharing('${escapeHtml(b.id)}', true)"
          style="margin-bottom: 12px; background: #EFF6FF; color: #1D4ED8; padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 700;">
          Enable / retry live location
        </button>
      ` : ''}

      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        ${b.status === 'PENDING' && b.canAccept ? '<button onclick="providerUpdateStatus(&#39;ACCEPTED&#39;)" style="background: #059669; color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;">Accept request</button>' : ''}
        ${b.status === 'PENDING' && !b.canAccept ? '<span style="font-size: 12px; color: #B91C1C;">Add a valid UPI ID and recharge enough credits before accepting.</span>' : ''}
        ${['PENDING', 'ACCEPTED'].includes(b.status) ? '<button onclick="cancelProviderBooking()" style="background: #FEF2F2; color: #B91C1C; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;">Cancel booking</button>' : ''}
        ${b.status === 'ACCEPTED' ? '<button onclick="providerUpdateStatus(&#39;PROVIDER_EN_ROUTE&#39;)" style="background: #2563EB; color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;">Start Driving & Share Location</button>' : ''}
        ${b.status === 'PROVIDER_EN_ROUTE' ? '<button onclick="providerUpdateStatus(&#39;ARRIVED&#39;)" style="background: #0D9488; color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;">Mark Arrived</button>' : ''}
        ${b.status === 'ARRIVED' ? '<button onclick="providerUpdateStatus(&#39;IN_PROGRESS&#39;)" style="background: #D97706; color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;">Start Service</button>' : ''}
        ${b.status === 'IN_PROGRESS' ? '<button onclick="providerCompleteJobModal()" style="background: var(--green-text); color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;">Verify OTP & Complete</button>' : ''}
      </div>
    `;
    if (b.status === 'PROVIDER_EN_ROUTE') {
      startProviderLocationSharing(b.id);
    } else {
      stopProviderLocationSharing();
    }
  } else if (activeJobEl) {
    activeJobEl.textContent = 'No active jobs.';
    stopProviderLocationSharing();
  }
  renderProviderBookingOverview();
  if (hasProfile) loadProviderCredits();

  const refreshBookingsButton = document.getElementById('btn-refresh-provider-bookings');
  if (refreshBookingsButton) {
    refreshBookingsButton.onclick = async () => {
      refreshBookingsButton.disabled = true;
      refreshBookingsButton.textContent = 'Refreshing...';
      try {
        const response = await fetch('/api/bookings');
        const result = await response.json();
        if (!response.ok || !result.success || !Array.isArray(result.bookings)) {
          throw new Error(result.message || 'Could not refresh provider bookings.');
        }
        State.bookingsList = result.bookings;
        State.activeBooking = result.bookings.find(booking =>
          !['COMPLETED', 'CANCELLED'].includes(booking.status)) || null;
        renderProviderPortal();
        showToast('Booking overview refreshed.', 'success');
      } catch (error) {
        showToast(error.message || 'Could not refresh provider bookings.', 'warning');
      } finally {
        refreshBookingsButton.disabled = false;
        refreshBookingsButton.textContent = 'Refresh jobs';
      }
    };
  }

  const inboxButton = document.getElementById('btn-open-provider-emergency-inbox');
  const inboxModal = document.getElementById('provider-emergency-inbox');
  const closeInboxButton = document.getElementById('btn-close-provider-emergency-inbox');
  if (inboxButton) inboxButton.onclick = () => loadProviderEmergencies();
  if (closeInboxButton && inboxModal) {
    closeInboxButton.onclick = () => inboxModal.classList.remove('active');
    inboxModal.onclick = event => {
      if (event.target === inboxModal) inboxModal.classList.remove('active');
    };
  }
}

async function loadProviderCredits() {
  const summary = document.getElementById('provider-credit-summary');
  if (!summary) return;
  const money = value => `Rs ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
  try {
    const response = await fetch('/api/providers/mine/credits');
    const result = await response.json();
    if (!response.ok || !result.success || !result.credits) {
      throw new Error(result.message || 'Could not load provider credit balance.');
    }
    const credits = result.credits;
    const upiInput = document.getElementById('provider-upi-id');
    const adminUpiNote = document.getElementById('provider-admin-upi-note');
    if (upiInput) upiInput.value = result.providerUpiId || '';
    const renderAdminUpiNote = () => {
      if (!adminUpiNote) return;
      const amount = Number(document.getElementById('provider-credit-amount').value);
      const parameters = new URLSearchParams({
        pa: result.adminUpiId,
        pn: 'ResQ Wheels',
        cu: 'INR',
        tn: 'Provider credit deposit'
      });
      if (Number.isFinite(amount) && amount >= 200) parameters.set('am', amount.toFixed(2));
      adminUpiNote.innerHTML = `Transfer to <strong>${escapeHtml(result.adminUpiId)}</strong> before submitting. ` +
        `Commission: <strong>${escapeHtml(result.commissionRate)}%</strong> of the total booking amount. ` +
        `<a href="upi://pay?${parameters.toString()}">Open UPI app</a>`;
    };
    renderAdminUpiNote();
    const depositAmountInput = document.getElementById('provider-credit-amount');
    if (depositAmountInput) depositAmountInput.oninput = renderAdminUpiNote;
    summary.innerHTML = `
      <div class="provider-payment-metrics">
        <div><span>Available credits</span><strong>${money(credits.available)}</strong></div>
        <div><span>Total balance</span><strong>${money(credits.balance)}</strong></div>
        <div><span>Reserved for accepted work</span><strong>${money(credits.reserved)}</strong></div>
      </div>
    `;
    const depositList = document.getElementById('provider-credit-deposits');
    if (depositList) {
      depositList.innerHTML = `<strong style="font-size: 13px;">Your deposits</strong>` +
        (credits.deposits.length
          ? `<div class="credit-history-list">${credits.deposits.map(deposit => `
              <div><span>${money(deposit.amount)} · UTR ${escapeHtml(deposit.utr)}</span>
                <strong>${escapeHtml(deposit.status)}</strong>
                ${deposit.admin_note ? `<small>${escapeHtml(deposit.admin_note)}</small>` : ''}
              </div>`).join('')}</div>`
          : '<p style="font-size: 12px; color: var(--text-muted);">No deposits submitted yet.</p>');
    }
    const history = document.getElementById('provider-credit-history');
    if (history) {
      history.innerHTML = `<strong style="font-size: 13px;">Credit history</strong>` +
        (credits.transactions.length
          ? `<div class="credit-history-list">${credits.transactions.map(transaction => `
              <div>
                <span>${escapeHtml(transaction.kind)} · ${escapeHtml(transaction.reason)}</span>
                <strong>${money(transaction.creditDelta)}${transaction.reservedDelta ? ` · reserved ${money(transaction.reservedDelta)}` : ''}</strong>
                <small>${new Date(transaction.created_at).toLocaleString()}</small>
              </div>`).join('')}</div>`
          : '<p style="font-size: 12px; color: var(--text-muted);">No credit transactions yet.</p>');
    }
  } catch (error) {
    summary.textContent = error.message || 'Could not load provider credits.';
  }

  const depositForm = document.getElementById('provider-credit-deposit-form');
  if (depositForm) {
    depositForm.onsubmit = async event => {
      event.preventDefault();
      const amountInput = document.getElementById('provider-credit-amount');
      const utrInput = document.getElementById('provider-credit-utr');
      const screenshotInput = document.getElementById('provider-credit-screenshot');
      const file = screenshotInput && screenshotInput.files[0];
      if (!file || file.size > 3 * 1024 * 1024 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        showToast('Choose a JPEG, PNG, or WebP screenshot up to 3 MB.', 'warning');
        return;
      }
      const submit = depositForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const screenshotDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read the payment screenshot.'));
          reader.readAsDataURL(file);
        });
        const response = await fetch('/api/providers/mine/credit-deposits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: Number(amountInput.value),
            utr: utrInput.value.trim(),
            screenshotDataUrl
          })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Could not submit the deposit for review.');
        }
        depositForm.reset();
        await loadProviderCredits();
        showToast('Deposit submitted. Credits are added after admin approval.', 'success');
      } catch (error) {
        showToast(error.message || 'Could not submit the deposit.', 'warning');
      } finally {
        submit.disabled = false;
      }
    };
  }
}

function renderProviderBookingOverview() {
  const summary = document.getElementById('provider-booking-summary');
  if (!summary) return;
  const bookings = State.bookingsList;
  const activeCount = bookings.filter(booking =>
    !['COMPLETED', 'CANCELLED'].includes(booking.status)).length;
  const completedCount = bookings.filter(booking => booking.status === 'COMPLETED').length;
  const stats = [
    { label: 'Total bookings', value: bookings.length },
    { label: 'Active jobs', value: activeCount },
    { label: 'Completed jobs', value: completedCount }
  ];
  summary.replaceChildren();
  stats.forEach(stat => {
    const card = document.createElement('div');
    card.className = 'provider-booking-stat';
    const label = document.createElement('span');
    label.textContent = stat.label;
    const value = document.createElement('strong');
    value.textContent = String(stat.value);
    card.append(label, value);
    summary.appendChild(card);
  });
  const note = document.createElement('p');
  note.style.cssText = 'grid-column: 1 / -1; margin: 4px 0 0; color: var(--text-muted); font-size: 13px;';
  note.textContent = bookings.length
    ? 'Refresh this overview to check for the latest booking updates.'
    : 'No bookings yet. Customer bookings will appear here.';
  summary.appendChild(note);
}

async function loadProviderEmergencies() {
  const modal = document.getElementById('provider-emergency-inbox');
  const container = document.getElementById('provider-emergency-inbox-list');
  if (!modal || !container) return;
  modal.classList.add('active');
  container.textContent = 'Loading nearby emergency requests...';
  try {
    const response = await fetch('/api/emergencies');
    const result = await response.json();
    if (!response.ok || !result.success || !Array.isArray(result.emergencies)) {
      throw new Error(result.message || 'Could not load nearby emergency requests.');
    }

    container.replaceChildren();
    if (result.emergencies.length === 0) {
      const empty = document.createElement('p');
      empty.style.color = 'var(--text-muted)';
      empty.textContent = 'No open customer requests are available near your service center.';
      container.appendChild(empty);
      return;
    }

    result.emergencies.forEach(emergency => {
      const card = document.createElement('div');
      card.className = 'section-card provider-emergency-request';
      const description = document.createElement('p');
      description.textContent = `${emergency.category} · ${emergency.vehicleType} · ${emergency.location}`;
      const form = document.createElement('form');
      form.className = 'provider-emergency-request-form';
      const amount = document.createElement('input');
      amount.type = 'number';
      amount.min = '1';
      amount.max = '100000';
      amount.required = true;
      amount.placeholder = 'Your quote (Rs)';
      const eta = document.createElement('input');
      eta.type = 'text';
      eta.maxLength = 50;
      eta.required = true;
      eta.placeholder = 'Estimated arrival time';
      const notes = document.createElement('input');
      notes.type = 'text';
      notes.maxLength = 500;
      notes.placeholder = 'Optional message';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'btn-apply-filters';
      submit.textContent = 'Send quote';
      form.append(amount, eta, notes, submit);
      form.onsubmit = async event => {
        event.preventDefault();
        await submitProviderQuote(emergency.id, {
          amount: Number(amount.value),
          eta: eta.value.trim(),
          notes: notes.value.trim()
        }, submit);
      };
      card.append(description, form);
      container.appendChild(card);
    });
  } catch (error) {
    console.error('Emergency request inbox load failed:', error);
    container.textContent = 'Could not load nearby emergency requests.';
    showToast(error.message || 'Could not load nearby emergency requests.', 'warning');
  }
}

async function submitProviderQuote(emergencyId, quote, submitButton) {
  submitButton.disabled = true;
  submitButton.textContent = 'Sending quote...';
  try {
    const response = await fetch(`/api/emergencies/${encodeURIComponent(emergencyId)}/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quote)
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Could not send your quote.');
    showToast('Your quote was sent to the customer.', 'success');
    await loadProviderEmergencies();
  } catch (error) {
    showToast(error.message || 'Could not send your quote.', 'warning');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Send quote';
  }
}

async function providerUpdateStatus(status) {
  const booking = State.activeBooking;
  if (!booking) {
    showToast('There is no active booking to update.', 'warning');
    return;
  }
  AudioFX.playPing();
  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(booking.id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not update booking status.');
    State.activeBooking = result.booking;
    State.bookingsList = State.bookingsList.map(item => item.id === booking.id ? result.booking : item);
    showToast(`Status updated to ${status.replace(/_/g, ' ')}.`, 'success');
    renderProviderPortal();
  } catch (error) {
    showToast(error.message || 'Could not update booking status.', 'warning');
  }
}

async function cancelProviderBooking() {
  const booking = State.activeBooking;
  if (!booking) {
    showToast('There is no active booking to cancel.', 'warning');
    return;
  }
  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(booking.id)}/cancel`, {
      method: 'POST'
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Could not cancel this booking.');
    }
    State.bookingsList = State.bookingsList.map(item =>
      item.id === booking.id ? result.booking : item);
    State.activeBooking = State.bookingsList.find(item =>
      !['COMPLETED', 'CANCELLED'].includes(item.status)) || null;
    showToast('Booking cancelled and reserved credits released.', 'success');
    renderProviderPortal();
  } catch (error) {
    showToast(error.message || 'Could not cancel this booking.', 'warning');
  }
}

async function providerCompleteJobModal() {
  const booking = State.activeBooking;
  if (!booking || booking.status !== 'IN_PROGRESS') {
    showToast('The service must be in progress before it can be completed.', 'warning');
    return;
  }
  const modal = document.getElementById('provider-completion-modal');
  const otpInput = document.getElementById('provider-completion-otp');
  const errorMessage = document.getElementById('provider-completion-error');
  if (!modal || !otpInput || !errorMessage) {
    showToast('The OTP verification form is unavailable. Please refresh and try again.', 'warning');
    return;
  }
  otpInput.value = '';
  errorMessage.hidden = true;
  errorMessage.textContent = '';
  modal.classList.add('active');
  otpInput.focus();
}

/* ==========================================================================
   Admin Portal View
   ========================================================================== */
async function renderAdminPortal() {
  try {
    const response = await fetch('/api/admin/stats');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not load administrator statistics.');
    const values = {
      'admin-stat-customers': Number(result.stats.totalCustomers || 0).toLocaleString(),
      'admin-stat-providers': Number(result.stats.totalProviders || 0).toLocaleString(),
      'admin-stat-gmv': `Rs ${Number(result.stats.totalGmv || 0).toLocaleString()}`,
      'admin-stat-revenue': `Rs ${Number(result.stats.providerCredits || 0).toLocaleString()}`,
      'admin-stat-commission': `Rs ${Number(result.stats.commissionCredits || 0).toLocaleString()}`,
      'admin-stat-reserved-credits': `Rs ${Number(result.stats.reservedCredits || 0).toLocaleString()}`
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });
    await loadAdminCreditManagement();
  } catch (error) {
    console.error('Administrator data load failed:', error);
    showToast(error.message || 'Could not load administrator data.', 'warning');
  }
}

async function loadAdminCreditManagement() {
  const providerContainer = document.getElementById('admin-credit-providers');
  const depositContainer = document.getElementById('admin-credit-deposits');
  const transactionContainer = document.getElementById('admin-credit-transactions');
  if (!providerContainer || !depositContainer || !transactionContainer) return;
  const response = await fetch('/api/admin/credits');
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || 'Could not load credit management data.');
  }
  const commissionInput = document.getElementById('admin-credit-commission-rate');
  const adminUpiInput = document.getElementById('admin-credit-upi-id');
  if (commissionInput) commissionInput.value = result.config.commissionRate;
  if (adminUpiInput) adminUpiInput.value = result.config.adminUpiId;
  const money = value => `Rs ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
  const timestamp = value => new Date(value).toLocaleString();
  providerContainer.innerHTML = result.providers.length
    ? `<table class="credit-admin-table"><thead><tr><th>Provider</th><th>UPI ID</th><th>Balance</th><th>Reserved</th><th>Adjustment</th></tr></thead><tbody>
        ${result.providers.map(provider => `
          <tr>
            <td>${escapeHtml(provider.name)}<small>${escapeHtml(provider.email)}</small></td>
            <td>${escapeHtml(provider.upiId || 'Not set')}</td>
            <td>${money(provider.balance)}<small>Available ${money(provider.available)}</small></td>
            <td>${money(provider.reserved)}</td>
            <td>
              <form class="credit-adjust-form" data-provider-id="${escapeHtml(provider.id)}">
                <input name="delta" type="number" step="0.01" required placeholder="+/- Rs">
                <input name="reason" type="text" maxlength="300" required placeholder="Reason">
                <button type="submit" class="btn-apply-filters">Apply</button>
              </form>
            </td>
          </tr>`).join('')}
      </tbody></table>`
    : '<p>No registered providers yet.</p>';
  depositContainer.innerHTML = result.deposits.length
    ? `<table class="credit-admin-table"><thead><tr><th>Provider</th><th>Amount</th><th>UTR</th><th>Submitted</th><th>Status</th><th>Receipt / action</th></tr></thead><tbody>
        ${result.deposits.map(deposit => `
          <tr>
            <td>${escapeHtml(deposit.providerName)}<small>${escapeHtml(deposit.providerEmail)}</small></td>
            <td>${money(deposit.amount)}</td>
            <td>${escapeHtml(deposit.utr)}</td>
            <td>${timestamp(deposit.createdAt)}</td>
            <td>${escapeHtml(deposit.status)}${deposit.adminNote ? `<small>${escapeHtml(deposit.adminNote)}</small>` : ''}</td>
            <td>
              <a class="credit-screenshot-link" href="${escapeHtml(deposit.screenshotUrl)}" target="_blank" rel="noopener noreferrer">
                View receipt
              </a>
              ${deposit.status === 'PENDING' ? `
                <div class="credit-review-actions">
                  <button type="button" class="btn-apply-filters" data-review-deposit="${escapeHtml(deposit.id)}" data-review-status="APPROVED">Approve</button>
                  <button type="button" class="btn-apply-filters" data-review-deposit="${escapeHtml(deposit.id)}" data-review-status="REJECTED">Reject</button>
                </div>` : ''}
            </td>
          </tr>`).join('')}
      </tbody></table>`
    : '<p>No deposits submitted.</p>';
  transactionContainer.innerHTML = result.transactions.length
    ? `<table class="credit-admin-table"><thead><tr><th>When</th><th>Provider</th><th>Type</th><th>Credit change</th><th>Reserved change</th><th>Reason</th></tr></thead><tbody>
        ${result.transactions.map(transaction => `
          <tr>
            <td>${timestamp(transaction.createdAt)}</td>
            <td>${escapeHtml(transaction.providerName)}<small>${escapeHtml(transaction.providerEmail)}</small></td>
            <td>${escapeHtml(transaction.kind)}</td>
            <td>${money(transaction.creditDelta)}</td>
            <td>${money(transaction.reservedDelta)}</td>
            <td>${escapeHtml(transaction.reason)}</td>
          </tr>`).join('')}
      </tbody></table>`
    : '<p>No credit transactions yet.</p>';

  const configForm = document.getElementById('admin-credit-config-form');
  if (configForm) {
    configForm.onsubmit = async event => {
      event.preventDefault();
      try {
        const saveResponse = await fetch('/api/admin/credits/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commissionRate: Number(commissionInput.value),
            adminUpiId: adminUpiInput.value.trim()
          })
        });
        const saved = await saveResponse.json();
        if (!saveResponse.ok || !saved.success) {
          throw new Error(saved.message || 'Could not save credit settings.');
        }
        State.platformPricing = {
          ...(State.platformPricing || {}),
          commissionRate: saved.config.commissionRate
        };
        updateProviderCommissionDisclosure();
        showToast('Commission rate and admin UPI ID saved.', 'success');
        await renderAdminPortal();
      } catch (error) {
        showToast(error.message || 'Could not save credit settings.', 'warning');
      }
    };
  }

  providerContainer.querySelectorAll('.credit-adjust-form').forEach(form => {
    form.onsubmit = async event => {
      event.preventDefault();
      const providerId = form.dataset.providerId;
      const formData = new FormData(form);
      try {
        const adjustResponse = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/credits/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            delta: Number(formData.get('delta')),
            reason: String(formData.get('reason') || '').trim()
          })
        });
        const adjusted = await adjustResponse.json();
        if (!adjustResponse.ok || !adjusted.success) {
          throw new Error(adjusted.message || 'Could not adjust provider credits.');
        }
        showToast('Provider credit balance adjusted.', 'success');
        await renderAdminPortal();
      } catch (error) {
        showToast(error.message || 'Could not adjust provider credits.', 'warning');
      }
    };
  });
  depositContainer.querySelectorAll('[data-review-deposit]').forEach(button => {
    button.onclick = async () => {
      const status = button.dataset.reviewStatus;
      if (status === 'APPROVED' && !window.confirm('Verify the payment receipt and approve the deposit?')) return;
      button.disabled = true;
      try {
        const reviewResponse = await fetch(`/api/admin/credit-deposits/${encodeURIComponent(button.dataset.reviewDeposit)}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            note: status === 'REJECTED' ? 'Rejected by administrator' : ''
          })
        });
        const reviewed = await reviewResponse.json();
        if (!reviewResponse.ok || !reviewed.success) {
          throw new Error(reviewed.message || 'Could not review this deposit.');
        }
        showToast(reviewed.message || `Deposit ${status.toLowerCase()}.`, 'success');
        await renderAdminPortal();
      } catch (error) {
        showToast(error.message || 'Could not review this deposit.', 'warning');
        button.disabled = false;
      }
    };
  });
}

/* ==========================================================================
   Interactive provider map
   ========================================================================== */
function renderFindProvidersMap() {
  const container = document.getElementById('find-providers-map-canvas');
  if (!container) return;

  if (!window.L) {
    container.innerHTML = '<div class="map-load-error">The map could not be loaded. Check your connection and reload the page.</div>';
    return;
  }

  const center = State.currentLocation
    ? [State.currentLocation.lat, State.currentLocation.lng]
    : null;
  if (!center) {
    container.innerHTML = '<div class="map-load-error">Share your location or register a provider to display the map.</div>';
    return;
  }

  if (!providerMap) {
    container.innerHTML = '';
    providerMap = window.L.map(container).setView(center, 10);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(providerMap);
    providerMarkers = window.L.layerGroup().addTo(providerMap);
    providerMapLastLocation = { ...State.currentLocation };
  } else if (State.currentLocation &&
    (!providerMapLastLocation ||
      providerMapLastLocation.lat !== State.currentLocation.lat ||
      providerMapLastLocation.lng !== State.currentLocation.lng)) {
    providerMap.setView(center, 10);
    providerMapLastLocation = { ...State.currentLocation };
  }

  providerMarkers.clearLayers();
  let coverageBounds = null;
  if (State.currentLocation) {
    window.L.circleMarker(center, {
      radius: 9,
      color: '#ffffff',
      weight: 3,
      fillColor: '#2563eb',
      fillOpacity: 1
    }).bindPopup('Your current location').addTo(providerMarkers);
    const coverage = window.L.circle(center, {
      radius: PROVIDER_SEARCH_RADIUS_KM * 1000,
      color: '#2563eb',
      weight: 1,
      fillColor: '#60a5fa',
      fillOpacity: 0.08
    }).addTo(providerMarkers);
    coverageBounds = coverage.getBounds();
  }

  const nearbyProviders = getProvidersWithinSearchRadius();
  nearbyProviders.forEach(provider => {
    const lat = Number(provider.lat);
    const lng = Number(provider.lng);

    const isSelected = provider.id === State.selectedProviderId;
    const marker = window.L.circleMarker([lat, lng], {
      radius: isSelected ? 10 : 8,
      color: '#ffffff',
      weight: 2,
      fillColor: isSelected ? '#ff5a1f' : provider.available ? '#16a34a' : '#6b7280',
      fillOpacity: 1
    });
    const popup = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = provider.name;
    const details = document.createElement('div');
    details.textContent = `From Rs ${provider.price} · ${provider.distance} · ${provider.available ? 'Available' : 'Offline'}`;
    popup.append(name, details);
    marker.bindPopup(popup);
    marker.on('click', () => {
      State.selectedProviderId = provider.id;
      document.querySelectorAll('.provider-card').forEach(card => {
        card.classList.toggle('selected', card.getAttribute('data-provider-id') === provider.id);
      });
    });
    marker.addTo(providerMarkers);
  });
  if (coverageBounds) {
    providerMap.fitBounds(coverageBounds, { padding: [20, 20] });
  }
}

function renderTrackingRouteMap() {
  const booking = State.activeBooking || State.bookingsList[0];
  if (!booking || booking.lat == null || booking.lng == null ||
    !Number.isFinite(Number(booking.lat)) || !Number.isFinite(Number(booking.lng))) {
    renderLeafletMap('tracking-map-canvas', null, null, [], null, true);
    return;
  }
  const markers = [{
    lat: Number(booking.lat),
    lng: Number(booking.lng),
    label: 'Customer pickup',
    type: 'customer'
  }];
  const liveLocation = booking.liveProviderLocation;
  if (liveLocation &&
    Number.isFinite(Number(liveLocation.lat)) &&
    Number.isFinite(Number(liveLocation.lng))) {
    markers.push({
      lat: Number(liveLocation.lat),
      lng: Number(liveLocation.lng),
      label: `${booking.providerName} · live location`,
      type: 'provider'
    });
  }
  renderLeafletMap('tracking-map-canvas', Number(booking.lat), Number(booking.lng), markers, null, true);
  const map = appMaps['tracking-map-canvas'];
  if (map && markers.length > 1) {
    const providerPoint = [markers[1].lat, markers[1].lng];
    if (map.trackingBookingId !== booking.id || !map.getBounds().contains(providerPoint)) {
      map.fitBounds(markers.map(marker => [marker.lat, marker.lng]), { padding: [24, 24] });
    }
    map.trackingBookingId = booking.id;
  }
}

const appMaps = Object.create(null);

function renderLeafletMap(elementId, centerLat, centerLng, markers = [], searchRadiusKm = null, preserveView = false) {
  const container = document.getElementById(elementId);
  if (!container) return;
  if (!window.L) {
    container.innerHTML = '<div class="map-load-error">The map could not be loaded. Check your connection and reload the page.</div>';
    return;
  }

  const hasCenter = centerLat != null && centerLng != null &&
    centerLat !== '' && centerLng !== '' &&
    Number.isFinite(Number(centerLat)) && Number.isFinite(Number(centerLng));
  if (!hasCenter) {
    const map = appMaps[elementId];
    if (map) {
      map.remove();
      delete appMaps[elementId];
    }
    container.innerHTML = '<div class="map-load-error">Share your location to display the map.</div>';
    return;
  }

  let map = appMaps[elementId];
  if (!map) {
    container.innerHTML = '';
    map = window.L.map(container).setView([Number(centerLat), Number(centerLng)], searchRadiusKm ? 10 : 14);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.markerLayer = window.L.layerGroup().addTo(map);
    map.rangeLayer = window.L.layerGroup().addTo(map);
    appMaps[elementId] = map;
  } else if (!preserveView) {
    map.setView([Number(centerLat), Number(centerLng)], map.getZoom());
  }

  map.markerLayer.clearLayers();
  map.rangeLayer.clearLayers();
  if (searchRadiusKm) {
    const coverage = window.L.circle([Number(centerLat), Number(centerLng)], {
      radius: searchRadiusKm * 1000,
      color: '#2563eb',
      weight: 1,
      fillColor: '#60a5fa',
      fillOpacity: 0.08
    }).addTo(map.rangeLayer);
    map.fitBounds(coverage.getBounds(), { padding: [20, 20] });
  }
  markers.forEach(marker => {
    const lat = Number(marker.lat);
    const lng = Number(marker.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const icon = marker.type === 'provider'
      ? window.L.divIcon({
          className: 'tracking-live-provider-icon',
          html: '<span></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        })
      : undefined;
    const pin = window.L.marker([lat, lng], icon ? { icon } : {});
    if (marker.label) {
      const popup = document.createElement('span');
      popup.textContent = marker.label;
      pin.bindPopup(popup);
    }
    pin.addTo(map.markerLayer);
  });
  window.setTimeout(() => map.invalidateSize(), 0);
}
