const dashboardRoot = document.querySelector('[data-dashboard-role="customer"]');
const dashboardToast = document.querySelector('#dashboard-toast');
const sidebar = document.querySelector('#dashboard-sidebar');
const menuButton = document.querySelector('[data-sidebar-toggle]');
const sidebarScrim = document.querySelector('[data-sidebar-close]');
const bookingDialog = document.querySelector('#booking-dialog');
let toastTimer;
let bookings = [];

function showToast(message, isError = false) {
  if (!dashboardToast) return;
  window.clearTimeout(toastTimer);
  dashboardToast.textContent = message;
  dashboardToast.classList.toggle('is-error', isError);
  dashboardToast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => dashboardToast.classList.remove('is-visible'), 3600);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...options
  });
  const text = await response.text();
  let result;
  if (!text) {
    throw new Error(`The server returned an empty response (HTTP ${response.status}).`);
  }
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function handleRequestError(error) {
  if (error.status === 401) {
    window.location.replace('/login.html');
    return;
  }
  console.error('Customer dashboard request failed:', error);
  showToast(error.message || 'Something went wrong. Please try again.', true);
}

function setLoading(name, isLoading) {
  const indicator = document.querySelector(`[data-loading="${name}"]`);
  if (indicator) indicator.hidden = !isLoading;
}

function setEmptyState(selector, isEmpty) {
  const element = document.querySelector(selector);
  if (element) element.hidden = !isEmpty;
}

function closeSidebar() {
  sidebar?.classList.remove('is-open');
  if (menuButton) {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
  }
  if (sidebarScrim) sidebarScrim.hidden = true;
}

function openView(viewName) {
  const targetView = document.querySelector(`[data-view="${viewName}"]`);
  if (!targetView) return;

  document.querySelectorAll('[data-view]').forEach((view) => {
    const isActive = view === targetView;
    view.hidden = !isActive;
    view.classList.toggle('is-visible', isActive);
  });
  document.querySelectorAll('[data-view-target]').forEach((button) => {
    const isActive = button.dataset.viewTarget === viewName && button.classList.contains('nav-item');
    button.classList.toggle('is-active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function makeElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function formatDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatTime(value) {
  if (!value) return 'Time unavailable';
  const [hours, minutes] = String(value).split(':');
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
}

function statusBadge(status) {
  return makeElement('span', `status-badge status-${String(status || '').toLowerCase()}`, status || 'Unknown');
}

function updateProfileDisplay(profile) {
  const fullName = profile.fullName || 'Customer';
  document.querySelector('#welcome-name').textContent = fullName;
  document.querySelector('#sidebar-name').textContent = fullName;
  document.querySelector('#sidebar-avatar').textContent = fullName.trim().charAt(0).toUpperCase() || 'P';
  document.querySelector('#overview-email').textContent = profile.email || 'Not provided';
  document.querySelector('#overview-phone').textContent = profile.phone || 'Not provided';
  document.querySelector('#overview-area').textContent = profile.area || profile.city || 'Pune';
  document.querySelector('#settings-email').textContent = profile.email || 'Not provided';

  const form = document.querySelector('#profile-form');
  if (form) {
    form.elements.fullName.value = profile.fullName || '';
    form.elements.email.value = profile.email || '';
    form.elements.phone.value = profile.phone || '';
    form.elements.area.value = profile.area || profile.city || 'Pune';
  }
}

function updateBookingStats(counts) {
  document.querySelector('#stat-total').textContent = counts.total ?? 0;
  document.querySelector('#stat-pending').textContent = counts.pending ?? 0;
  document.querySelector('#stat-completed').textContent = counts.completed ?? 0;
  document.querySelector('#stat-cancelled').textContent = counts.cancelled ?? 0;
}

function makeBookingRow(booking, compact = false) {
  const row = document.createElement('tr');
  const serviceCell = document.createElement('td');
  serviceCell.append(
    makeElement('strong', '', booking.serviceName || 'Service'),
    makeElement('small', '', `Booking #${booking.id}`)
  );
  const providerCell = document.createElement('td');
  providerCell.textContent = booking.providerName || 'Provider';
  const dateCell = document.createElement('td');
  dateCell.append(
    makeElement('strong', '', formatDate(booking.bookingDate)),
    makeElement('small', '', formatTime(booking.bookingTime))
  );
  const statusCell = document.createElement('td');
  statusCell.append(statusBadge(booking.status));
  const amountCell = document.createElement('td');
  amountCell.textContent = formatMoney(booking.totalAmount);
  const actionsCell = document.createElement('td');
  const actions = makeElement('div', 'row-actions');
  const detailsButton = makeElement('button', 'row-action', 'Details');
  detailsButton.type = 'button';
  detailsButton.dataset.bookingAction = 'details';
  detailsButton.dataset.bookingId = booking.id;
  actions.append(detailsButton);
  if (['pending', 'accepted'].includes(booking.status)) {
    const cancelButton = makeElement('button', 'row-action row-action-danger', 'Cancel');
    cancelButton.type = 'button';
    cancelButton.dataset.bookingAction = 'cancel';
    cancelButton.dataset.bookingId = booking.id;
    actions.append(cancelButton);
  }
  actionsCell.append(actions);

  if (compact) row.append(serviceCell, providerCell, dateCell, statusCell, amountCell, actionsCell);
  else {
    const bookingCell = document.createElement('td');
    bookingCell.textContent = `#${booking.id}`;
    row.append(bookingCell, serviceCell, providerCell, dateCell, statusCell, amountCell, actionsCell);
  }
  return row;
}

function renderBookings() {
  const recentRows = document.querySelector('#recent-booking-rows');
  const bookingRows = document.querySelector('#booking-rows');
  const filter = document.querySelector('#booking-filter')?.value || 'all';
  const filtered = filter === 'all' ? bookings : bookings.filter((booking) => booking.status === filter);
  const recent = bookings.slice(0, 5);

  recentRows.replaceChildren(...recent.map((booking) => makeBookingRow(booking, true)));
  bookingRows.replaceChildren(...filtered.map((booking) => makeBookingRow(booking)));
  setEmptyState('#recent-bookings-empty', bookings.length === 0);
  setEmptyState('#bookings-empty', filtered.length === 0);
}

function renderReviews(reviews) {
  const list = document.querySelector('#review-list');
  list.replaceChildren();
  for (const review of reviews) {
    const card = makeElement('article', 'review-card');
    const heading = makeElement('div', 'review-card-heading');
    const title = document.createElement('div');
    title.append(
      makeElement('h2', '', review.serviceName || 'Service review'),
      makeElement('p', 'review-meta', `Provider: ${review.providerName || 'Pune Seva provider'} · ${formatDate(review.createdAt)}`)
    );
    const stars = makeElement('span', 'review-stars', `${'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}${'☆'.repeat(5 - Math.max(0, Math.min(5, Number(review.rating) || 0)))}`);
    stars.setAttribute('aria-label', `${review.rating} out of 5 stars`);
    heading.append(title, stars);
    card.append(heading);
    if (review.comment) card.append(makeElement('p', 'review-comment', review.comment));
    list.append(card);
  }
  setEmptyState('#reviews-empty', reviews.length === 0);
}

function renderServices(services) {
  const grid = document.querySelector('#service-grid');
  grid.replaceChildren();
  for (const service of services) {
    const card = makeElement('article', 'service-card');
    card.append(
      makeElement('span', 'service-category', service.category || 'Local service'),
      makeElement('h2', '', service.serviceName || 'Service'),
      makeElement('p', 'service-provider', `By ${service.businessName || service.providerName || 'Pune Seva provider'}`)
    );
    if (service.description) card.append(makeElement('p', 'service-description', service.description));
    const footer = makeElement('div', 'service-card-footer');
    const priceText = service.priceType === 'hourly'
      ? `${formatMoney(service.price)} / hour`
      : service.priceType === 'starting_from'
        ? `From ${formatMoney(service.price)}`
        : formatMoney(service.price);
    footer.append(
      makeElement('span', 'service-price', priceText),
      makeElement('span', 'service-area', service.location || service.serviceArea || 'Pune')
    );
    card.append(footer);
    if (service.id !== undefined && service.id !== null) {
      const bookLink = makeElement('a', 'button button-primary service-card-book', 'Book service');
      bookLink.href = `/services.html?serviceId=${encodeURIComponent(service.id)}&book=1`;
      bookLink.setAttribute('aria-label', `Book ${service.serviceName || 'service'}`);
      card.append(bookLink);
    }
    grid.append(card);
  }
  setEmptyState('#services-empty', services.length === 0);
}

function appendDetail(list, label, value) {
  const item = document.createElement('div');
  item.append(makeElement('dt', '', label), makeElement('dd', '', value || 'Not provided'));
  list.append(item);
}

async function showBookingDetails(bookingId) {
  const result = await requestJson(`/api/customer/bookings/${encodeURIComponent(bookingId)}`);
  const booking = result.booking;
  const details = document.querySelector('#booking-dialog-details');
  details.replaceChildren();
  document.querySelector('#booking-dialog-title').textContent = `Booking #${booking.id}`;
  appendDetail(details, 'Service', booking.serviceName);
  appendDetail(details, 'Category', booking.category);
  appendDetail(details, 'Provider', booking.providerName);
  appendDetail(details, 'Date', formatDate(booking.bookingDate));
  appendDetail(details, 'Time', formatTime(booking.bookingTime));
  appendDetail(details, 'Status', booking.status);
  appendDetail(details, 'Total amount', formatMoney(booking.totalAmount));
  appendDetail(details, 'Contact number', booking.customerPhone);
  appendDetail(details, 'Address', booking.address);
  appendDetail(details, 'Instructions', booking.description);
  if (booking.rejectionReason) appendDetail(details, 'Provider response', booking.rejectionReason);
  const cancelButton = document.querySelector('#dialog-cancel-booking');
  cancelButton.hidden = !['pending', 'accepted'].includes(booking.status);
  cancelButton.dataset.bookingId = booking.id;
  if (!bookingDialog.open) bookingDialog.showModal();
}

async function cancelBooking(bookingId, button) {
  if (!window.confirm('Cancel this booking?')) return;
  if (button) button.disabled = true;
  try {
    const result = await requestJson(`/api/customer/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'PUT' });
    if (bookingDialog.open) bookingDialog.close();
    showToast(result.message || 'Booking cancelled.');
    await Promise.all([loadBookings(), loadDashboard()]);
  } catch (error) {
    handleRequestError(error);
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadDashboard() {
  const result = await requestJson('/api/customer/dashboard');
  updateProfileDisplay(result.user);
  updateBookingStats(result.bookings || {});
}

async function loadBookings() {
  setLoading('bookings', true);
  setLoading('recent-bookings', true);
  try {
    const result = await requestJson('/api/customer/bookings');
    bookings = Array.isArray(result.bookings) ? result.bookings : [];
    renderBookings();
  } finally {
    setLoading('bookings', false);
    setLoading('recent-bookings', false);
  }
}

async function loadReviews() {
  setLoading('reviews', true);
  try {
    const result = await requestJson('/api/customer/reviews');
    renderReviews(Array.isArray(result.reviews) ? result.reviews : []);
  } finally {
    setLoading('reviews', false);
  }
}

async function loadServices(search = '') {
  setLoading('services', true);
  try {
    const url = new URL('/api/services', window.location.origin);
    if (search.trim()) url.searchParams.set('search', search.trim());
    const result = await requestJson(`${url.pathname}${url.search}`);
    renderServices(Array.isArray(result.services) ? result.services : []);
  } finally {
    setLoading('services', false);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const message = form.querySelector('[data-profile-message]');
  message.textContent = '';
  message.classList.remove('is-success');
  submitButton.disabled = true;
  try {
    const result = await requestJson('/api/customer/profile', {
      method: 'PUT',
      body: JSON.stringify({
        fullName: form.elements.fullName.value,
        phone: form.elements.phone.value
      })
    });
    updateProfileDisplay({ ...result.profile, area: form.elements.area.value });
    message.textContent = result.message || 'Your profile has been updated.';
    message.classList.add('is-success');
    showToast(message.textContent);
  } catch (error) {
    message.textContent = error.message || 'Could not save your profile.';
    handleRequestError(error);
  } finally {
    submitButton.disabled = false;
  }
}

async function logout(button) {
  if (button) button.disabled = true;
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login.html');
  } catch (error) {
    if (button) button.disabled = false;
    handleRequestError(error);
  }
}

document.querySelectorAll('[data-view-target]').forEach((button) => {
  button.addEventListener('click', () => openView(button.dataset.viewTarget));
});

document.querySelectorAll('[data-logout]').forEach((button) => {
  button.addEventListener('click', () => logout(button));
});

menuButton?.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('is-open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  sidebarScrim.hidden = !isOpen;
});

sidebarScrim?.addEventListener('click', closeSidebar);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSidebar();
});

document.querySelector('#booking-filter')?.addEventListener('change', renderBookings);
document.querySelector('#profile-form')?.addEventListener('submit', saveProfile);
document.querySelector('#service-search')?.addEventListener('submit', (event) => {
  event.preventDefault();
  loadServices(document.querySelector('#service-query').value).catch(handleRequestError);
});

document.querySelector('#booking-rows')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-booking-action]');
  if (!button) return;
  if (button.dataset.bookingAction === 'cancel') {
    await cancelBooking(button.dataset.bookingId, button);
    return;
  }
  try {
    await showBookingDetails(button.dataset.bookingId);
  } catch (error) {
    handleRequestError(error);
  }
});

document.querySelector('#recent-booking-rows')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-booking-action]');
  if (!button) return;
  if (button.dataset.bookingAction === 'cancel') {
    await cancelBooking(button.dataset.bookingId, button);
    return;
  }
  try {
    await showBookingDetails(button.dataset.bookingId);
  } catch (error) {
    handleRequestError(error);
  }
});

document.querySelectorAll('[data-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => bookingDialog.close());
});

document.querySelector('#dialog-cancel-booking')?.addEventListener('click', (event) => {
  cancelBooking(event.currentTarget.dataset.bookingId, event.currentTarget);
});

document.querySelector('#current-year').textContent = String(new Date().getFullYear());
document.querySelector('#topbar-date').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());

Promise.allSettled([loadDashboard(), loadBookings(), loadReviews(), loadServices()]).then((results) => {
  results.forEach((result) => {
    if (result.status === 'rejected') handleRequestError(result.reason);
  });
});
