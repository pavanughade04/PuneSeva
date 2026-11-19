
const adminSections = ['customers', 'providers', 'services', 'bookings', 'reviews', 'messages'];
const sectionState = Object.fromEntries(adminSections.map((name) => [name, {
  page: 1,
  totalPages: 1,
  total: 0,
  loaded: false,
  records: new Map()
}]));

const sectionRoutes = {
  customers: { url: '/api/admin/customers', key: 'customers' },
  providers: { url: '/api/admin/providers', key: 'providers' },
  services: { url: '/api/admin/services', key: 'services' },
  bookings: { url: '/api/admin/bookings', key: 'bookings' },
  reviews: { url: '/api/admin/reviews', key: 'reviews' },
  messages: { url: '/api/admin/messages', key: 'messages' }
};

const adminToast = document.querySelector('#admin-toast');
const detailDialog = document.querySelector('#admin-detail-dialog');
const reasonDialog = document.querySelector('#admin-reason-dialog');
const sidebar = document.querySelector('#admin-sidebar');
const menuButton = document.querySelector('[data-sidebar-toggle]');
const sidebarScrim = document.querySelector('[data-sidebar-close]');
let toastTimer;
let currentSection = 'overview';
let reasonResolver;

function element(tagName, className = '', text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function setToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  adminToast.textContent = message;
  adminToast.classList.toggle('is-error', isError);
  adminToast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => adminToast.classList.remove('is-visible'), 3600);
}

async function adminRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    ...options
  });

  const text = await response.text();
  let result;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const error = new Error(result.details?.[0]?.message || result.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }

  return result;
}

function handleAdminError(error, section = currentSection) {
  if (error.status === 401 || error.status === 403) {
    window.location.replace('/admin-dashboard.html');
    return;
  }

  console.error('Admin dashboard request failed:', error);

  if (section === 'overview') {
    const message = document.querySelector('#overview-error');
    message.textContent = error.message || 'Could not load the dashboard overview.';
    message.hidden = false;
  } else {
    const message = document.querySelector(`[data-error="${section}"]`);
    if (message) {
      message.textContent = error.message || 'Could not load this section.';
      message.hidden = false;
    }
  }

  setToast(error.message || 'The request could not be completed.', true);
}

function formatStatus(value) {
  return String(value || 'unknown').replace(/_/g, ' ');
}

function statusBadge(value) {
  const status = String(value || 'unknown');
  const allowed = ['pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'rejected', 'approved', 'active', 'blocked', 'new', 'resolved'];
  const safeClass = allowed.includes(status) ? `status-${status}` : '';
  return element('span', `status-badge ${safeClass}`.trim(), formatStatus(status));
}

function formatDate(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatAppointmentDate(value) {
  if (!value) return 'Unavailable';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatTime(value) {
  if (!value) return 'Unavailable';
  const [hours, minutes] = String(value).split(':');
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(amount);
}

function formatServicePrice(service) {
  const amount = formatMoney(service.price);
  if (service.priceType === 'hourly') return `${amount} / hour`;
  if (service.priceType === 'starting_from') return `From ${amount}`;
  return amount;
}

function addCell(row, value, className = '') {
  const cell = element('td', className);
  if (value instanceof Node) cell.append(value);
  else cell.textContent = value === undefined || value === null || value === '' ? '—' : String(value);
  row.append(cell);
  return cell;
}

function actionButton(label, action, id, className = '') {
  const button = element('button', `row-action ${className}`.trim(), label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function actionsCell(row, ...buttons) {
  const cell = element('td');
  const wrap = element('div', 'admin-row-actions');
  wrap.append(...buttons.filter(Boolean));
  cell.append(wrap);
  row.append(cell);
}

function renderCustomers(rows) {
  const target = document.querySelector('#customers-rows');
  const state = sectionState.customers;
  target.replaceChildren();
  state.records.clear();

  rows.forEach((customer) => {
    state.records.set(String(customer.customerId), customer);
    const row = document.createElement('tr');
    const nameCell = element('td');
    nameCell.append(element('strong', '', customer.fullName), element('small', '', `#${customer.customerId}`));
    addCell(row, nameCell);

    const contact = element('td');
    contact.append(element('span', '', customer.email), element('small', '', customer.phone || 'No phone'));
    addCell(row, contact);
    addCell(row, customer.bookingCount ?? 0);
    addCell(row, statusBadge(customer.accountStatus));
    addCell(row, formatDate(customer.createdAt));

    const nextStatus = customer.accountStatus === 'active' ? 'blocked' : 'active';
    actionsCell(
      row,
      actionButton('Details', 'details', customer.customerId),
      actionButton(nextStatus === 'active' ? 'Activate' : 'Deactivate', 'customer-status', customer.customerId, nextStatus === 'blocked' ? 'row-action-danger' : '')
    );

    target.append(row);
  });

  updateTableState('customers', rows.length);
}

function renderProviders(rows) {
  const target = document.querySelector('#providers-rows');
  const state = sectionState.providers;
  target.replaceChildren();
  state.records.clear();

  rows.forEach((provider) => {
    state.records.set(String(provider.providerId), provider);
    const row = document.createElement('tr');
    const identity = element('td');
    identity.append(element('strong', '', provider.businessName), element('small', '', `${provider.fullName || 'Provider'} · #${provider.providerId}`));
    addCell(row, identity);

    const contact = element('td');
    contact.append(element('span', '', provider.email), element('small', '', provider.phone || 'No phone'));
    addCell(row, contact);
    addCell(row, provider.serviceArea);
    addCell(row, statusBadge(provider.approvalStatus));
    addCell(row, statusBadge(provider.accountStatus));

    const buttons = [actionButton('Details', 'details', provider.providerId)];

    if (provider.approvalStatus !== 'approved') {
      buttons.push(actionButton('Approve', 'provider-approve', provider.providerId));
    }

    if (provider.approvalStatus === 'pending') {
      buttons.push(actionButton('Reject', 'provider-reject', provider.providerId, 'row-action-danger'));
    }

    const nextStatus = provider.accountStatus === 'active' ? 'blocked' : 'active';
    buttons.push(actionButton(nextStatus === 'active' ? 'Activate' : 'Block', 'provider-status', provider.providerId, nextStatus === 'blocked' ? 'row-action-danger' : ''));

    actionsCell(row, ...buttons);
    target.append(row);
  });

  updateTableState('providers', rows.length);
}

function renderServices(rows) {
  const target = document.querySelector('#services-rows');
  const state = sectionState.services;
  target.replaceChildren();
  state.records.clear();

  rows.forEach((service) => {
    state.records.set(String(service.id), service);
    const row = document.createElement('tr');
    const title = element('td');
    title.append(element('strong', '', service.serviceName), element('small', '', `#${service.id}`));
    addCell(row, title);
    addCell(row, `${service.providerName || 'Provider'} · #${service.providerId}`);
    addCell(row, `${service.category || '—'} · ${service.location || '—'}`);
    addCell(row, formatServicePrice(service));
    addCell(row, statusBadge(service.isAvailable ? 'active' : 'blocked'));
    addCell(row, statusBadge(service.approvalStatus));

    const buttons = [actionButton('Details', 'details', service.id)];
    if (service.approvalStatus !== 'approved') buttons.push(actionButton('Approve', 'service-approve', service.id));
    if (service.approvalStatus === 'pending') buttons.push(actionButton('Reject', 'service-reject', service.id, 'row-action-danger'));
    buttons.push(actionButton(service.isAvailable ? 'Deactivate' : 'Activate', 'service-status', service.id, service.isAvailable ? 'row-action-danger' : ''));

    actionsCell(row, ...buttons);
    target.append(row);
  });

  updateTableState('services', rows.length);
}

function renderBookings(rows) {
  const target = document.querySelector('#bookings-rows');
  const state = sectionState.bookings;
  target.replaceChildren();
  state.records.clear();

  rows.forEach((booking) => {
    state.records.set(String(booking.id), booking);
    const row = document.createElement('tr');
    addCell(row, `#${booking.id}`);
    addCell(row, booking.customerName);
    addCell(row, booking.providerName);
    addCell(row, booking.serviceName);
    addCell(row, `${formatAppointmentDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)}`);
    addCell(row, formatMoney(booking.totalAmount));

    const buttons = [actionButton('Details', 'details', booking.id)];
    if (['pending', 'accepted', 'in_progress'].includes(booking.status)) {
      buttons.push(actionButton('Cancel', 'booking-cancel', booking.id, 'row-action-danger'));
    }

    const cell = element('td');
    cell.append(statusBadge(booking.status));
    const wrap = element('div', 'admin-row-actions');
    wrap.append(...buttons);
    cell.append(wrap);
    row.append(cell);
    target.append(row);
  });

  updateTableState('bookings', rows.length);
}

function renderReviews(rows) {
  const target = document.querySelector('#reviews-rows');
  const state = sectionState.reviews;
  target.replaceChildren();
  state.records.clear();

  rows.forEach((review) => {
    state.records.set(String(review.id), review);
    const row = document.createElement('tr');
    const reviewCell = element('td');
    reviewCell.append(element('strong', '', `Review #${review.id}`), element('small', 'admin-review-preview', review.comment || 'No written comment'));
    addCell(row, reviewCell);
    addCell(row, review.customerName);
    addCell(row, `${review.providerName || 'Provider'} · ${review.serviceName || 'Service'}`);
    addCell(row, `${review.rating} / 5`);
    addCell(row, formatDate(review.createdAt));
    actionsCell(row, actionButton('Details', 'details', review.id), actionButton('Remove', 'review-remove', review.id, 'row-action-danger'));
    target.append(row);
  });

  updateTableState('reviews', rows.length);
}

function renderMessages(rows) {
  const target = document.querySelector('#messages-rows');
  const state = sectionState.messages;
  target.replaceChildren();
  state.records.clear();

  rows.forEach((message) => {
    state.records.set(String(message.id), message);
    const row = document.createElement('tr');
    const sender = element('td');
    sender.append(element('strong', '', message.name), element('small', '', message.email));
    addCell(row, sender);

    const subject = element('td');
    subject.append(element('strong', '', message.subject), element('small', 'admin-review-preview', message.message));
    addCell(row, subject);
    addCell(row, formatDate(message.createdAt));
    addCell(row, statusBadge(message.status));

    const statusSelect = document.createElement('select');
    statusSelect.className = 'admin-status-select';
    statusSelect.dataset.messageStatus = message.id;

    for (const [value, label] of [['new', 'New'], ['in_progress', 'In progress'], ['resolved', 'Resolved']]) {
      const option = element('option', '', label);
      option.value = value;
      option.selected = message.status === value;
      statusSelect.append(option);
    }

    actionsCell(row, actionButton('Details', 'details', message.id), statusSelect);
    target.append(row);
  });

  updateTableState('messages', rows.length);
}

function updateTableState(name, rowCount) {
  const state = sectionState[name];
  document.querySelector(`[data-empty="${name}"]`).hidden = rowCount !== 0;
  const pagination = document.querySelector(`[data-pagination="${name}"]`);
  pagination.hidden = state.totalPages <= 1;
  pagination.querySelector('[data-page-label]').textContent =
    `${state.page} of ${state.totalPages} · ${state.total} total`;
  pagination.querySelector('[data-page="previous"]').disabled = state.page <= 1;
  pagination.querySelector('[data-page="next"]').disabled = state.page >= state.totalPages;
}

function getFilterParams(name) {
  const form = document.querySelector(`[data-filter-form="${name}"]`);
  const params = new URLSearchParams({ page: String(sectionState[name].page), limit: '20' });

  for (const [key, value] of new FormData(form)) {
    if (String(value).trim()) params.set(key, String(value).trim());
  }

  return params;
}

async function loadSection(name) {
  const state = sectionState[name];
  const config = sectionRoutes[name];
  const loading = document.querySelector(`[data-loading="${name}"]`);
  const error = document.querySelector(`[data-error="${name}"]`);
  loading.hidden = false;
  error.hidden = true;

  try {
    const result = await adminRequest(`${config.url}?${getFilterParams(name)}`);
    const pagination = result.pagination || {};
    state.total = Number(pagination.total || 0);
    state.totalPages = Math.max(1, Number(pagination.totalPages || 1));

    if (state.page > state.totalPages) {
      state.page = state.totalPages;
      return loadSection(name);
    }

    state.loaded = true;

    const renderers = {
      customers: renderCustomers,
      providers: renderProviders,
      services: renderServices,
      bookings: renderBookings,
      reviews: renderReviews,
      messages: renderMessages
    };

    renderers[name](Array.isArray(result[config.key]) ? result[config.key] : []);
  } catch (requestError) {
    handleAdminError(requestError, name);
  } finally {
    loading.hidden = true;
  }
}

function renderRecentRows(rows, type) {
  const target = document.querySelector(`#recent-${type}`);
  target.replaceChildren();

  if (!rows.length) {
    const row = document.createElement('tr');
    addCell(row, 'No recent activity found.');
    target.append(row);
    return;
  }

  rows.forEach((item) => {
    const row = document.createElement('tr');

    if (type === 'bookings') {
      addCell(row, `#${item.id} · ${formatDate(item.createdAt)}`);
      addCell(row, item.customerName);
      addCell(row, item.providerName);
      addCell(row, item.serviceName);
      addCell(row, statusBadge(item.status));
    } else if (type === 'providers') {
      addCell(row, item.fullName);
      addCell(row, `${item.businessName || 'Business'} · ${formatDate(item.createdAt)}`);
      addCell(row, statusBadge(item.approvalStatus));
    } else {
      addCell(row, `${item.serviceName || 'Service'} · #${item.id}`);
      addCell(row, item.providerName);
      addCell(row, item.category);
      addCell(row, statusBadge(item.approvalStatus));
    }

    target.append(row);
  });
}

async function loadOverview() {
  const error = document.querySelector('#overview-error');
  error.hidden = true;

  try {
    const result = await adminRequest('/api/admin/dashboard/stats');
    const stats = result.stats;

    const values = {
      'stat-customers': stats.customers?.total,
      'stat-providers': stats.providers?.total,
      'stat-services': stats.services?.total,
      'stat-provider-pending': stats.providers?.pending,
      'stat-service-pending': stats.services?.pending,
      'stat-bookings': stats.bookings?.total,
      'stat-booking-pending': stats.bookings?.pending,
      'stat-booking-completed': stats.bookings?.completed,
      'stat-booking-cancelled': stats.bookings?.cancelled,
      'stat-reviews': stats.reviews?.total
    };

    for (const [id, value] of Object.entries(values)) {
      document.getElementById(id).textContent = Number(value || 0).toLocaleString();
    }

    const recent = result.recentActivity || {};
    renderRecentRows(recent.recentBookings || [], 'bookings');
    renderRecentRows(recent.recentProviders || [], 'providers');
    renderRecentRows(recent.recentServices || [], 'services');
  } catch (error) {
    handleAdminError(error, 'overview');
  }
}

function addDetail(list, label, value) {
  const item = document.createElement('div');
  item.append(element('dt', '', label), element('dd', '', value ?? 'Not provided'));
  list.append(item);
}

function addHistoryTable(container, title, rows, columns) {
  container.append(element('h3', 'admin-detail-subtitle', title));

  if (!rows?.length) {
    container.append(element('p', 'admin-detail-empty', 'No records found.'));
    return;
  }

  const wrap = element('div', 'table-wrap');
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  columns.forEach((column) => headerRow.append(element('th', '', column.label)));
  head.append(headerRow);

  const body = document.createElement('tbody');
  rows.forEach((record) => {
    const row = document.createElement('tr');
    columns.forEach((column) => addCell(row, column.value(record)));
    body.append(row);
  });

  table.append(head, body);
  wrap.append(table);
  container.append(wrap);
}

function showDetailContent(title, entries, history = []) {
  document.querySelector('#admin-detail-title').textContent = title;
  const content = document.querySelector('#admin-detail-content');
  content.replaceChildren();
  const list = element('dl', 'dialog-details');
  entries.forEach(([label, value]) => addDetail(list, label, value));
  content.append(list);
  history.forEach(({ title: historyTitle, rows, columns }) => addHistoryTable(content, historyTitle, rows, columns));
  if (!detailDialog.open) detailDialog.showModal();
}

async function showDetails(name, id) {
  const cached = sectionState[name].records.get(String(id));

  if (name === 'reviews') {
    showDetailContent(`Review #${cached.id}`, [
      ['Customer', cached.customerName],
      ['Provider', cached.providerName],
      ['Service', cached.serviceName],
      ['Rating', `${cached.rating} / 5`],
      ['Review', cached.comment || 'No written comment'],
      ['Submitted', formatDate(cached.createdAt)]
    ]);
    return;
  }

  const routeByName = {
    customers: `/api/admin/customers/${encodeURIComponent(id)}`,
    providers: `/api/admin/providers/${encodeURIComponent(id)}`,
    services: `/api/admin/services/${encodeURIComponent(id)}`,
    bookings: `/api/admin/bookings/${encodeURIComponent(id)}`,
    messages: `/api/admin/messages/${encodeURIComponent(id)}`
  };

  const result = await adminRequest(routeByName[name]);

  if (name === 'customers') {
    const customer = result.customer;

    showDetailContent(`Customer #${customer.customerId}`, [
      ['Name', customer.fullName], ['Email', customer.email], ['Phone', customer.phone],
      ['Account status', formatStatus(customer.accountStatus)], ['Address', customer.address],
      ['Area', customer.area], ['City', customer.city], ['Joined', formatDate(customer.createdAt)]
    ], [{
      title: 'Booking history',
      rows: result.recentBookings || [],
      columns: [
        { label: 'Booking', value: (item) => `#${item.id}` },
        { label: 'Service', value: (item) => item.serviceName },
        { label: 'Provider', value: (item) => item.providerName },
        { label: 'Date', value: (item) => formatAppointmentDate(item.bookingDate) },
        { label: 'Status', value: (item) => formatStatus(item.status) },
        { label: 'Amount', value: (item) => formatMoney(item.totalAmount) }
      ]
    }]);
  } else if (name === 'providers') {
    const provider = result.provider;

    showDetailContent(`Provider #${provider.providerId}`, [
      ['Name', provider.fullName], ['Email', provider.email], ['Phone', provider.phone],
      ['Business', provider.businessName], ['Experience', `${provider.experience ?? 0} years`],
      ['Service area', provider.serviceArea], ['Description', provider.description],
      ['Address', provider.address], ['City', provider.city],
      ['Application status', formatStatus(provider.approvalStatus)],
      ['Account status', formatStatus(provider.accountStatus)],
      ['Rejection reason', provider.rejectionReason], ['Joined', formatDate(provider.createdAt)]
    ], [
      {
        title: 'Services',
        rows: result.services || [],
        columns: [
          { label: 'Service', value: (item) => item.serviceName },
          { label: 'Category', value: (item) => item.category },
          { label: 'Location', value: (item) => item.location },
          { label: 'Approval', value: (item) => formatStatus(item.approvalStatus) }
        ]
      },
      {
        title: 'Recent booking history',
        rows: result.recentBookings || [],
        columns: [
          { label: 'Booking', value: (item) => `#${item.id}` },
          { label: 'Customer', value: (item) => item.customerName },
          { label: 'Service', value: (item) => item.serviceName },
          { label: 'Date', value: (item) => formatAppointmentDate(item.bookingDate) },
          { label: 'Status', value: (item) => formatStatus(item.status) },
          { label: 'Amount', value: (item) => formatMoney(item.totalAmount) }
        ]
      }
    ]);
  } else if (name === 'services') {
    const service = result.service;
    const entries = [
      ['Service', service.serviceName], ['Provider', `${service.providerName} · #${service.providerId}`],
      ['Business', service.businessName], ['Category', service.category], ['Description', service.description],
      ['Location', service.location], ['Price', formatServicePrice(service)],
      ['Approval status', formatStatus(service.approvalStatus)],
      ['Rejection reason', service.rejectionReason],
      ['Availability', service.isAvailable ? 'Active' : 'Inactive'], ['Submitted', formatDate(service.createdAt)]
    ];

    showDetailContent(`Service #${service.id}`, entries);

    // Supports both old local image paths and Cloudinary HTTPS URLs.
    if (service.image) {
      const image = element('img', 'admin-detail-image');
      image.src = service.image;
      image.alt = `${service.serviceName || 'Service'} image`;
      contentImageAppend(image);
    }
  } else if (name === 'bookings') {
    const booking = result.booking;

    showDetailContent(`Booking #${booking.id}`, [
      ['Status', formatStatus(booking.status)], ['Customer', booking.customerName],
      ['Customer email', booking.customerEmail], ['Customer phone', booking.customerPhone],
      ['Provider', booking.providerName], ['Service', booking.serviceName],
      ['Category', booking.serviceCategory], ['Appointment date', formatAppointmentDate(booking.bookingDate)],
      ['Appointment time', formatTime(booking.bookingTime)], ['Address', booking.address],
      ['Instructions', booking.description], ['Price', formatMoney(booking.totalAmount)],
      ['Provider response', booking.rejectionReason], ['Admin cancellation reason', booking.cancellationReason],
      ['Created', formatDate(booking.createdAt)], ['Last status update', formatDate(booking.statusUpdatedAt)]
    ]);
  } else {
    const message = result.message;

    showDetailContent(`Contact message #${message.id}`, [
      ['Sender', message.name], ['Email', message.email], ['Subject', message.subject],
      ['Message', message.message], ['Status', formatStatus(message.status)],
      ['Received', formatDate(message.createdAt)], ['Last updated', formatDate(message.updatedAt)]
    ]);
  }
}

function contentImageAppend(image) {
  document.querySelector('#admin-detail-content').append(image);
}

function requestReason(title) {
  return new Promise((resolve) => {
    reasonResolver = resolve;
    document.querySelector('#admin-reason-title').textContent = title;
    document.querySelector('#admin-action-reason').value = '';
    document.querySelector('#admin-reason-error').hidden = true;
    reasonDialog.showModal();
    document.querySelector('#admin-action-reason').focus();
  });
}

function finishReason(value) {
  if (!reasonResolver) return;
  const resolve = reasonResolver;
  reasonResolver = null;
  reasonDialog.close();
  resolve(value);
}

function queryError(status) {
  const error = new Error(status >= 500 ? 'The server could not complete the request.' : 'The request could not be completed.');
  error.status = status;
  return error;
}

async function runAction(button) {
  const { action, id } = button.dataset;
  const body = (value) => JSON.stringify(value);

  const refresh = async (name) => {
    sectionState[name].loaded = false;
    await loadSection(name);
    await loadOverview();
  };

  button.disabled = true;

  try {
    if (action === 'details') {
      await showDetails(currentSection, id);
      return;
    }

    if (action === 'customer-status') {
      const customer = sectionState.customers.records.get(String(id));
      const status = customer.accountStatus === 'active' ? 'blocked' : 'active';
      if (!window.confirm(`${status === 'blocked' ? 'Deactivate' : 'Activate'} this customer account?`)) return;
      await adminRequest(`/api/admin/customers/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: body({ status }) });
      setToast(`Customer account ${status}.`);
      await refresh('customers');
    } else if (action === 'provider-approve' || action === 'provider-reject') {
      const approved = action === 'provider-approve';
      const reason = approved ? null : await requestReason('Reason for rejecting provider');
      if (!approved && reason === null) return;
      if (approved && !window.confirm('Approve this provider application?')) return;

      await adminRequest(`/api/admin/providers/${encodeURIComponent(id)}/${approved ? 'approve' : 'reject'}`, {
        method: 'PATCH',
        ...(reason ? { body: body({ reason }) } : {})
      });

      setToast(approved ? 'Provider approved.' : 'Provider rejected. Reason recorded.');
      await refresh('providers');
    } else if (action === 'provider-status') {
      const provider = sectionState.providers.records.get(String(id));
      const status = provider.accountStatus === 'active' ? 'blocked' : 'active';
      if (!window.confirm(`${status === 'blocked' ? 'Block' : 'Activate'} this provider account?`)) return;

      await adminRequest(`/api/admin/providers/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: body({ status }) });
      setToast(`Provider account ${status}.`);
      await refresh('providers');
    } else if (action === 'service-approve' || action === 'service-reject') {
      const approved = action === 'service-approve';
      const reason = approved ? null : await requestReason('Reason for rejecting service');
      if (!approved && reason === null) return;
      if (approved && !window.confirm('Approve this service listing?')) return;

      await adminRequest(`/api/admin/services/${encodeURIComponent(id)}/${approved ? 'approve' : 'reject'}`, {
        method: 'PATCH',
        ...(reason ? { body: body({ reason }) } : {})
      });

      setToast(approved ? 'Service approved.' : 'Service rejected. Reason recorded.');
      await refresh('services');
    } else if (action === 'service-status') {
      const service = sectionState.services.records.get(String(id));
      const isAvailable = !service.isAvailable;
      if (!window.confirm(`${isAvailable ? 'Activate' : 'Deactivate'} this service?`)) return;

      await adminRequest(`/api/admin/services/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: body({ isAvailable })
      });

      setToast(`Service ${isAvailable ? 'activated' : 'deactivated'}.`);
      await refresh('services');
    } else if (action === 'booking-cancel') {
      const reason = await requestReason('Reason for cancelling booking');
      if (reason === null) return;

      await adminRequest(`/api/admin/bookings/${encodeURIComponent(id)}/cancel`, {
        method: 'PATCH',
        body: body({ reason })
      });

      setToast('Booking cancelled. Reason recorded.');
      await refresh('bookings');
    } else if (action === 'review-remove') {
      const reason = await requestReason('Reason for removing review');
      if (reason === null) return;

      await adminRequest(`/api/admin/reviews/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: body({ reason })
      });

      setToast('Review removed. Reason recorded.');
      await refresh('reviews');
    }
  } catch (error) {
    handleAdminError(error);
  } finally {
    button.disabled = false;
  }
}

async function updateMessageStatus(select) {
  const id = select.dataset.messageStatus;
  const previous = sectionState.messages.records.get(String(id))?.status;
  select.disabled = true;

  try {
    await adminRequest(`/api/admin/messages/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: select.value })
    });

    setToast('Message status updated.');
    await loadSection('messages');
  } catch (error) {
    if (previous) select.value = previous;
    handleAdminError(error, 'messages');
  } finally {
    select.disabled = false;
  }
}

function closeSidebar() {
  sidebar.classList.remove('is-open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
  sidebarScrim.hidden = true;
}

function showSection(name) {
  const target = document.querySelector(`[data-section="${name}"]`);
  if (!target) return;

  currentSection = name;

  document.querySelectorAll('.dashboard-content > .dashboard-view').forEach((section) => {
    const active = section === target;
    section.hidden = !active;
    section.classList.toggle('is-visible', active);
  });

  document.querySelectorAll('[data-section-target]').forEach((button) => {
    const active = button.dataset.sectionTarget === name && button.classList.contains('nav-item');
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  document.querySelector('#topbar-section').textContent = name === 'messages'
    ? 'Contact messages'
    : `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

  closeSidebar();

  if (name !== 'overview' && !sectionState[name].loaded) loadSection(name);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadIdentity() {
  const result = await adminRequest('/api/auth/me');

  if (result.user?.role !== 'admin') {
    window.location.replace('/admin-dashboard.html');
    throw queryError(403);
  }

  const fullName = result.user.fullName || 'Admin';
  document.querySelector('#admin-name').textContent = fullName;
  document.querySelector('#admin-email').textContent = result.user.email || 'Administrator';
  document.querySelector('#admin-avatar').textContent = fullName.trim().charAt(0).toUpperCase() || 'A';
}

document.querySelectorAll('[data-section-target]').forEach((button) => {
  button.addEventListener('click', () => showSection(button.dataset.sectionTarget));
});

document.querySelectorAll('[data-filter-form]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = form.dataset.filterForm;
    sectionState[name].page = 1;
    loadSection(name);
  });
});

document.querySelectorAll('[data-pagination]').forEach((container) => {
  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    const name = container.dataset.pagination;
    sectionState[name].page += button.dataset.page === 'next' ? 1 : -1;
    loadSection(name);
  });
});

document.querySelector('.dashboard-content').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) runAction(button);
  const refresh = event.target.closest('[data-refresh="overview"]');
  if (refresh) loadOverview();
});

document.querySelector('#messages-rows').addEventListener('change', (event) => {
  const select = event.target.closest('[data-message-status]');
  if (select) updateMessageStatus(select);
});

document.querySelector('#admin-logout').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;

  try {
    await adminRequest('/api/auth/logout', { method: 'POST' });
    window.location.replace('/admin-dashboard.html');
  } catch (error) {
    button.disabled = false;
    handleAdminError(error);
  }
});

menuButton.addEventListener('click', () => {
  const open = sidebar.classList.toggle('is-open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  sidebarScrim.hidden = !open;
});

sidebarScrim.addEventListener('click', closeSidebar);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSidebar();
});

reasonDialog.addEventListener('submit', (event) => {
  event.preventDefault();
  const reason = document.querySelector('#admin-action-reason').value.trim();

  if (reason.length < 5 || reason.length > 1000) {
    const error = document.querySelector('#admin-reason-error');
    error.textContent = 'Enter a reason between 5 and 1,000 characters.';
    error.hidden = false;
    return;
  }

  finishReason(reason);
});

reasonDialog.addEventListener('close', () => {
  if (reasonResolver) {
    const resolve = reasonResolver;
    reasonResolver = null;
    resolve(null);
  }
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

document.querySelector('#current-year').textContent = String(new Date().getFullYear());

loadIdentity()
  .then(() => loadOverview())
  .catch((error) => {
    if (error.status === 401 || error.status === 403) return;
    handleAdminError(error, 'overview');
  });

const initialSection = document.querySelector(`[data-section="${window.location.hash.slice(1)}"]`);
if (initialSection) showSection(initialSection.dataset.section);
