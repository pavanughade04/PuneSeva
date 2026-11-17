const dashboardRoot = document.querySelector('[data-dashboard-role="provider"]');
const dashboardToast = document.querySelector('#dashboard-toast');
const sidebar = document.querySelector('#dashboard-sidebar');
const menuButton = document.querySelector('[data-sidebar-toggle]');
const sidebarScrim = document.querySelector('[data-sidebar-close]');
const bookingDialog = document.querySelector('#booking-dialog');
let toastTimer;
let services = [];
let bookings = [];
let providerApprovalStatus = 'pending';
let servicePreviewUrl;

function showToast(message, isError = false) {
  if (!dashboardToast) return;
  window.clearTimeout(toastTimer);
  dashboardToast.textContent = message;
  dashboardToast.classList.toggle('is-error', isError);
  dashboardToast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => dashboardToast.classList.remove('is-visible'), 3600);
}

async function requestJson(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {})
    },
    ...options
  });
  const text = await response.text();
  if (!text) throw new Error(`The server returned an empty response (HTTP ${response.status}).`);

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = result.details?.[0]?.message;
    const error = new Error(detail || result.error || 'The request could not be completed.');
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
  console.error('Provider dashboard request failed:', error);
  showToast(error.message || 'Something went wrong. Please try again.', true);
}

function makeElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
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

function setApprovalDisplay(status) {
  providerApprovalStatus = String(status || 'pending').toLowerCase();
  const banner = document.querySelector('#approval-banner');
  const title = document.querySelector('#approval-title');
  const copy = document.querySelector('#approval-copy');
  const note = document.querySelector('#service-approval-note');
  banner.hidden = false;
  banner.classList.toggle('is-approved', providerApprovalStatus === 'approved');
  banner.classList.toggle('is-rejected', providerApprovalStatus === 'rejected');

  if (providerApprovalStatus === 'approved') {
    title.textContent = 'Provider account approved';
    copy.textContent = 'Your account is approved. Services still need their own approval before they appear publicly.';
    note.hidden = true;
  } else if (providerApprovalStatus === 'rejected') {
    title.textContent = 'Provider application needs attention';
    copy.textContent = 'Your provider account is not approved. You can maintain service drafts, but cannot activate them.';
    note.textContent = 'Your account is not approved. Services must remain unavailable until an administrator approves your provider account.';
    note.hidden = false;
  } else {
    title.textContent = 'Provider approval pending';
    copy.textContent = 'You can save inactive service drafts while your application is reviewed. Active services are locked until approval.';
    note.textContent = 'Your account is awaiting approval. You can save inactive service drafts, but cannot activate services.';
    note.hidden = false;
  }

  const availability = document.querySelector('#service-form [name="isAvailable"]');
  if (availability && providerApprovalStatus !== 'approved') {
    availability.checked = false;
    availability.disabled = true;
  } else if (availability) {
    availability.disabled = false;
  }

  if (services.length > 0) renderServices();
}

function updateProfileDisplay(profile) {
  const fullName = profile.fullName || 'Provider';
  document.querySelector('#welcome-name').textContent = fullName;
  document.querySelector('#welcome-business').textContent = profile.businessName || 'Your business';
  document.querySelector('#sidebar-name').textContent = fullName;
  document.querySelector('#sidebar-avatar').textContent = fullName.trim().charAt(0).toUpperCase() || 'P';
  document.querySelector('#settings-email').textContent = profile.email || 'Not provided';
  document.querySelector('#overview-business').textContent = profile.businessName || 'Not provided';
  document.querySelector('#overview-experience').textContent = `${Number(profile.experience) || 0} years`;
  document.querySelector('#overview-area').textContent = profile.serviceArea || 'Not provided';

  const form = document.querySelector('#profile-form');
  if (form) {
    form.elements.fullName.value = profile.fullName || '';
    form.elements.email.value = profile.email || '';
    form.elements.phone.value = profile.phone || '';
    form.elements.businessName.value = profile.businessName || '';
    form.elements.experience.value = Number(profile.experience) || 0;
    form.elements.serviceArea.value = profile.serviceArea || '';
    form.elements.description.value = profile.description || '';
  }
  setApprovalDisplay(profile.approvalStatus);
}

function updateDashboardStats(serviceCounts, bookingCounts) {
  document.querySelector('#stat-services').textContent = serviceCounts.total ?? 0;
  document.querySelector('#stat-bookings').textContent = bookingCounts.total ?? 0;
  document.querySelector('#stat-pending').textContent = bookingCounts.pending ?? 0;
  document.querySelector('#stat-completed').textContent = bookingCounts.completed ?? 0;
}

function priceLabel(service) {
  const price = formatMoney(service.price);
  if (service.priceType === 'hourly') return `${price} / hour`;
  if (service.priceType === 'starting_from') return `From ${price}`;
  return price;
}

function makeServiceCard(service) {
  const card = makeElement('article', 'service-card provider-service-card');
  const meta = makeElement('div', 'provider-service-meta');
  meta.append(makeElement('span', 'service-category', service.category || 'Local service'));
  meta.append(statusBadge(service.approvalStatus || 'pending'));
  meta.append(statusBadge(service.isAvailable ? 'active' : 'inactive'));
  const title = makeElement('h2', '', service.serviceName || 'Service');
  const description = makeElement('p', 'service-description', service.description || 'No service description provided.');
  const location = makeElement('p', 'service-description', `Location: ${service.location || 'Not provided'}`);
  const created = makeElement(
    'small',
    'provider-service-created',
    `Added ${formatDate(service.createdAt)}`
  );
  if (service.image) {
    const image = makeElement('img', 'provider-service-image');
    image.src = service.image;
    image.alt = `${service.serviceName || 'Service'} image`;
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove());
    card.append(image);
  }
  card.append(meta, title, description, location, created);

  const footer = makeElement('div', 'provider-service-footer');
  const pricing = makeElement('div', 'service-card-footer');
  pricing.append(makeElement('span', 'service-price', priceLabel(service)));
  footer.append(pricing);

  const actions = makeElement('div', 'service-actions');
  const editButton = makeElement('button', 'row-action', 'Edit');
  editButton.type = 'button';
  editButton.dataset.serviceAction = 'edit';
  editButton.dataset.serviceId = service.id;
  const deleteButton = makeElement('button', 'row-action row-action-danger', 'Delete');
  deleteButton.type = 'button';
  deleteButton.dataset.serviceAction = 'delete';
  deleteButton.dataset.serviceId = service.id;
  const availabilityButton = makeElement(
    'button',
    'row-action',
    service.isAvailable ? 'Deactivate' : 'Activate'
  );
  availabilityButton.type = 'button';
  availabilityButton.dataset.serviceAction = 'availability';
  availabilityButton.dataset.serviceId = service.id;
  availabilityButton.disabled = !service.isAvailable && providerApprovalStatus !== 'approved';
  actions.append(editButton, availabilityButton, deleteButton);
  footer.append(actions);
  card.append(footer);
  return card;
}

function renderServices() {
  const list = document.querySelector('#provider-service-list');
  list.replaceChildren(...services.map(makeServiceCard));
  setEmptyState('#provider-services-empty', services.length === 0);

  const counts = {
    total: services.length,
    approved: services.filter((service) => service.approvalStatus === 'approved').length,
    pending: services.filter((service) => service.approvalStatus === 'pending').length,
    rejected: services.filter((service) => service.approvalStatus === 'rejected').length
  };
  document.querySelector('#service-stat-total').textContent = counts.total;
  document.querySelector('#service-stat-approved').textContent = counts.approved;
  document.querySelector('#service-stat-pending').textContent = counts.pending;
  document.querySelector('#service-stat-rejected').textContent = counts.rejected;
}

function bookingActionButton(label, action, bookingId, style = '') {
  const button = makeElement('button', `row-action ${style}`.trim(), label);
  button.type = 'button';
  button.dataset.bookingAction = action;
  button.dataset.bookingId = bookingId;
  return button;
}

function bookingStatusActions(booking) {
  const actions = makeElement('div', 'row-actions');
  actions.append(bookingActionButton('Details', 'details', booking.id));
  if (booking.status === 'pending') {
    actions.append(bookingActionButton('Accept', 'accept', booking.id));
    actions.append(bookingActionButton('Reject', 'reject', booking.id, 'row-action-danger'));
  } else if (booking.status === 'accepted') {
    actions.append(bookingActionButton('Start', 'start', booking.id));
  } else if (booking.status === 'in_progress') {
    actions.append(bookingActionButton('Complete', 'complete', booking.id));
  }
  return actions;
}

function makeBookingRow(booking, compact = false) {
  const row = document.createElement('tr');
  const customerCell = document.createElement('td');
  customerCell.append(
    makeElement('strong', '', booking.customerName || 'Customer'),
    makeElement('small', '', booking.customerPhone || `Booking #${booking.id}`)
  );
  const serviceCell = document.createElement('td');
  serviceCell.textContent = booking.serviceName || 'Service';
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
  actionsCell.append(bookingStatusActions(booking));

  if (compact) row.append(customerCell, serviceCell, dateCell, statusCell, amountCell, actionsCell);
  else {
    const bookingCell = document.createElement('td');
    bookingCell.textContent = `#${booking.id}`;
    row.append(bookingCell, customerCell, serviceCell, dateCell, statusCell, amountCell, actionsCell);
  }
  return row;
}

function renderBookings() {
  const recentRows = document.querySelector('#recent-booking-rows');
  const bookingRows = document.querySelector('#booking-rows');
  const filter = document.querySelector('#booking-filter').value;
  const filtered = filter === 'all' ? bookings : bookings.filter((booking) => booking.status === filter);
  recentRows.replaceChildren(...bookings.slice(0, 5).map((booking) => makeBookingRow(booking, true)));
  bookingRows.replaceChildren(...filtered.map((booking) => makeBookingRow(booking)));
  setEmptyState('#recent-bookings-empty', bookings.length === 0);
  setEmptyState('#bookings-empty', filtered.length === 0);
}

function appendDetail(list, label, value) {
  const item = document.createElement('div');
  item.append(makeElement('dt', '', label), makeElement('dd', '', value || 'Not provided'));
  list.append(item);
}

async function showBookingDetails(bookingId) {
  const result = await requestJson(`/api/provider/bookings/${encodeURIComponent(bookingId)}`);
  const booking = result.booking;
  const details = document.querySelector('#booking-dialog-details');
  details.replaceChildren();
  document.querySelector('#booking-dialog-title').textContent = `Booking #${booking.id}`;
  appendDetail(details, 'Customer', booking.customerName);
  appendDetail(details, 'Customer phone', booking.customerPhone);
  appendDetail(details, 'Service', booking.serviceName);
  appendDetail(details, 'Category', booking.category);
  appendDetail(details, 'Date', formatDate(booking.bookingDate));
  appendDetail(details, 'Time', formatTime(booking.bookingTime));
  appendDetail(details, 'Status', booking.status);
  appendDetail(details, 'Total amount', formatMoney(booking.totalAmount));
  appendDetail(details, 'Address', booking.address);
  appendDetail(details, 'Instructions', booking.description);
  if (booking.rejectionReason) appendDetail(details, 'Rejection reason', booking.rejectionReason);

  const actions = document.querySelector('#booking-status-actions');
  actions.replaceChildren();
  if (booking.status === 'pending') {
    actions.append(bookingActionButton('Accept', 'accept', booking.id), bookingActionButton('Reject', 'reject', booking.id, 'row-action-danger'));
  } else if (booking.status === 'accepted') {
    actions.append(bookingActionButton('Start service', 'start', booking.id));
  } else if (booking.status === 'in_progress') {
    actions.append(bookingActionButton('Mark complete', 'complete', booking.id));
  }
  if (!bookingDialog.open) bookingDialog.showModal();
}

async function loadDashboard() {
  const result = await requestJson('/api/provider/dashboard');
  updateProfileDisplay(result.user);
  updateDashboardStats(result.services || {}, result.bookings || {});
}

async function loadBookings() {
  setLoading('bookings', true);
  setLoading('recent-bookings', true);
  try {
    const result = await requestJson('/api/provider/bookings');
    bookings = Array.isArray(result.bookings) ? result.bookings : [];
    renderBookings();
  } finally {
    setLoading('bookings', false);
    setLoading('recent-bookings', false);
  }
}

async function loadServices() {
  setLoading('services', true);
  try {
    const result = await requestJson('/api/provider/services');
    services = Array.isArray(result.services) ? result.services : [];
    renderServices();
  } finally {
    setLoading('services', false);
  }
}

function showServiceForm(service) {
  const form = document.querySelector('#service-form');
  const panel = document.querySelector('#service-form-panel');
  const isEditing = Boolean(service);
  form.reset();
  form.elements.serviceId.value = isEditing ? service.id : '';
  form.elements.serviceName.value = service?.serviceName || '';
  form.elements.category.value = service?.category || '';
  form.elements.description.value = service?.description || '';
  form.elements.location.value = service?.location || '';
  form.elements.price.value = service?.price ?? '';
  form.elements.priceType.value = service?.priceType || 'fixed';
  form.elements.isAvailable.checked = providerApprovalStatus === 'approved'
    ? Boolean(service?.isAvailable ?? true)
    : false;
  const imagePreview = document.querySelector('#service-image-preview');
  if (servicePreviewUrl) URL.revokeObjectURL(servicePreviewUrl);
  servicePreviewUrl = null;
  imagePreview.src = service?.image || '';
  imagePreview.hidden = !service?.image;
  document.querySelector('#service-form-title').textContent = isEditing ? 'Edit service' : 'Add a service';
  document.querySelector('#service-form-hint').textContent = providerApprovalStatus === 'approved'
    ? 'New listings and edits are submitted for service approval before appearing publicly.'
    : 'This account is not approved yet. You can save this service as an inactive draft.';
  setApprovalDisplay(providerApprovalStatus);
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.serviceName.focus();
}

function closeServiceForm() {
  const form = document.querySelector('#service-form');
  form.reset();
  form.elements.serviceId.value = '';
  if (servicePreviewUrl) URL.revokeObjectURL(servicePreviewUrl);
  servicePreviewUrl = null;
  document.querySelector('#service-image-preview').hidden = true;
  document.querySelector('#service-form-panel').hidden = true;
  const message = form.querySelector('[data-service-message]');
  message.textContent = '';
  message.classList.remove('is-success');
}

async function saveService(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const message = form.querySelector('[data-service-message]');
  const serviceId = form.elements.serviceId.value;
  message.textContent = '';
  message.classList.remove('is-success');
  submitButton.disabled = true;

  try {
    const payload = new FormData();
    payload.append('serviceName', form.elements.serviceName.value.trim());
    payload.append('category', form.elements.category.value.trim());
    payload.append('description', form.elements.description.value.trim());
    payload.append('location', form.elements.location.value.trim());
    payload.append('price', form.elements.price.value);
    payload.append('priceType', form.elements.priceType.value);
    payload.append('isAvailable', String(form.elements.isAvailable.checked));
    const imageFile = form.elements.image.files[0];
    if (imageFile) payload.append('image', imageFile);
    const result = await requestJson(
      serviceId ? `/api/provider/services/${encodeURIComponent(serviceId)}` : '/api/provider/services',
      { method: serviceId ? 'PUT' : 'POST', body: payload }
    );
    showToast(result.message || 'Service saved.');
    closeServiceForm();
    await Promise.all([loadServices(), loadDashboard()]);
  } catch (error) {
    message.textContent = error.message || 'Could not save this service.';
    handleRequestError(error);
  } finally {
    submitButton.disabled = false;
  }
}

async function deleteService(serviceId, button) {
  if (!window.confirm('Delete this service? Services with booking history cannot be deleted.')) return;
  button.disabled = true;
  try {
    const result = await requestJson(`/api/provider/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE' });
    showToast(result.message || 'Service deleted.');
    await Promise.all([loadServices(), loadDashboard()]);
  } catch (error) {
    handleRequestError(error);
  } finally {
    button.disabled = false;
  }
}

async function updateServiceAvailability(service, button) {
  const isAvailable = !service.isAvailable;
  if (isAvailable && providerApprovalStatus !== 'approved') {
    showToast('Your provider account must be approved before activating a service.', true);
    return;
  }

  button.disabled = true;
  try {
    const result = await requestJson(
      `/api/provider/services/${encodeURIComponent(service.id)}/availability`,
      {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable })
      }
    );
    showToast(result.message || 'Service availability updated.');
    await loadServices();
  } catch (error) {
    handleRequestError(error);
  } finally {
    button.disabled = false;
  }
}

async function updateBookingStatus(bookingId, status, button) {
  const actionLabel = status === 'completed' ? 'mark this booking complete' : `${status} this booking`;
  if (!window.confirm(`Are you sure you want to ${actionLabel}?`)) return;
  let rejectionReason;
  if (status === 'rejected') {
    rejectionReason = window.prompt('Please enter a reason for rejecting this booking:');
    if (rejectionReason === null) return;
    rejectionReason = rejectionReason.trim();
    if (rejectionReason.length < 5 || rejectionReason.length > 1000) {
      showToast('Rejection reason must be between 5 and 1,000 characters.', true);
      return;
    }
  }
  if (button) button.disabled = true;
  try {
    const result = await requestJson(`/api/provider/bookings/${encodeURIComponent(bookingId)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, ...(rejectionReason ? { rejectionReason } : {}) })
    });
    if (bookingDialog.open) bookingDialog.close();
    showToast(result.message || 'Booking status updated.');
    await Promise.all([loadBookings(), loadDashboard()]);
  } catch (error) {
    handleRequestError(error);
  } finally {
    if (button) button.disabled = false;
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
    const result = await requestJson('/api/provider/profile', {
      method: 'PUT',
      body: JSON.stringify({
        fullName: form.elements.fullName.value.trim(),
        phone: form.elements.phone.value.trim(),
        businessName: form.elements.businessName.value.trim(),
        experience: Number(form.elements.experience.value),
        serviceArea: form.elements.serviceArea.value.trim(),
        description: form.elements.description.value.trim()
      })
    });
    updateProfileDisplay(result.profile);
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

document.querySelector('#booking-filter').addEventListener('change', renderBookings);
document.querySelector('#profile-form').addEventListener('submit', saveProfile);
document.querySelector('#service-form').addEventListener('submit', saveService);
document.querySelector('#service-form').elements.image.addEventListener('change', (event) => {
  const imagePreview = document.querySelector('#service-image-preview');
  if (servicePreviewUrl) URL.revokeObjectURL(servicePreviewUrl);
  servicePreviewUrl = null;
  const [file] = event.currentTarget.files;
  if (!file) {
    imagePreview.hidden = true;
    return;
  }
  servicePreviewUrl = URL.createObjectURL(file);
  imagePreview.src = servicePreviewUrl;
  imagePreview.hidden = false;
});
document.querySelector('#add-service-button').addEventListener('click', () => showServiceForm(null));
document.querySelector('#cancel-service-edit').addEventListener('click', closeServiceForm);
document.querySelector('#discard-service').addEventListener('click', closeServiceForm);
document.querySelectorAll('[data-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => bookingDialog.close());
});

document.querySelector('#provider-service-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-service-action]');
  if (!button) return;
  const service = services.find((item) => String(item.id) === button.dataset.serviceId);
  if (!service) return;
  if (button.dataset.serviceAction === 'edit') showServiceForm(service);
  if (button.dataset.serviceAction === 'delete') deleteService(service.id, button);
  if (button.dataset.serviceAction === 'availability') updateServiceAvailability(service, button);
});

async function handleBookingAction(button) {
  const { bookingAction, bookingId } = button.dataset;
  if (bookingAction === 'details') {
    try {
      await showBookingDetails(bookingId);
    } catch (error) {
      handleRequestError(error);
    }
    return;
  }
  const nextStatus = {
    accept: 'accepted',
    reject: 'rejected',
    start: 'in_progress',
    complete: 'completed'
  }[bookingAction];
  if (nextStatus) await updateBookingStatus(bookingId, nextStatus, button);
}

document.querySelector('#booking-rows').addEventListener('click', (event) => {
  const button = event.target.closest('[data-booking-action]');
  if (button) handleBookingAction(button);
});

document.querySelector('#recent-booking-rows').addEventListener('click', (event) => {
  const button = event.target.closest('[data-booking-action]');
  if (button) handleBookingAction(button);
});

document.querySelector('#booking-status-actions').addEventListener('click', (event) => {
  const button = event.target.closest('[data-booking-action]');
  if (button) handleBookingAction(button);
});

document.querySelector('#current-year').textContent = String(new Date().getFullYear());
document.querySelector('#topbar-date').textContent = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short'
}).format(new Date());

if (dashboardRoot) {
  Promise.allSettled([loadDashboard(), loadBookings(), loadServices()]).then((results) => {
    results.forEach((result) => {
      if (result.status === 'rejected') handleRequestError(result.reason);
    });
  });
}
