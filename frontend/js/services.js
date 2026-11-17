const catalogForm = document.querySelector('#catalog-filters');
const catalogResults = document.querySelector('#service-results');
const catalogLoading = document.querySelector('#catalog-loading');
const catalogEmpty = document.querySelector('#catalog-empty');
const catalogError = document.querySelector('#catalog-error');
const serviceDialog = document.querySelector('#service-dialog');
const bookingDialog = document.querySelector('#booking-form-dialog');
let selectedService;

function catalogElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function catalogDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function catalogPrice(service) {
  const amount = Number(service.price);
  if (!Number.isFinite(amount)) return 'Price unavailable';
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(amount);
  if (service.priceType === 'hourly') return `${formatted} / hour`;
  if (service.priceType === 'starting_from') return `Starting from ${formatted}`;
  return formatted;
}

async function catalogRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
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
    const error = new Error(result.error || 'Could not load services.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function renderServiceCard(service) {
  const card = catalogElement('article', 'catalog-card');
  const meta = catalogElement('div', 'catalog-card-meta');
  meta.append(
    catalogElement('span', 'service-category', service.category || 'Local service'),
    catalogElement('span', 'catalog-available', 'Available')
  );
  card.append(meta);
  if (service.image) {
    const image = catalogElement('img', 'catalog-image');
    image.src = service.image;
    image.alt = `${service.serviceName || 'Service'} image`;
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove());
    card.append(image);
  }
  card.append(
    catalogElement('h2', '', service.serviceName || 'Service'),
    catalogElement(
      'p',
      'catalog-business',
      service.businessName && service.providerName && service.businessName !== service.providerName
        ? `${service.businessName} · ${service.providerName}`
        : service.businessName || service.providerName || 'Pune Seva provider'
    )
  );
  if (service.description) {
    card.append(catalogElement('p', 'catalog-description', service.description));
  }

  const footer = catalogElement('div', 'catalog-card-footer');
  const price = catalogElement('strong', 'catalog-price', catalogPrice(service));
  const area = catalogElement('span', 'catalog-area', service.location || service.serviceArea || 'Pune');
  footer.append(price, area);
  card.append(footer);

  const actions = catalogElement('div', 'catalog-card-actions');
  const details = catalogElement('button', 'button button-outline', 'View details');
  details.type = 'button';
  details.dataset.serviceId = service.id;
  const book = catalogElement('button', 'button button-primary', 'Book service');
  book.type = 'button';
  book.dataset.bookServiceId = service.id;
  book.setAttribute('aria-label', `Book ${service.serviceName || 'service'}`);
  actions.append(details, book);
  card.append(actions);
  return card;
}

function renderServices(services) {
  catalogResults.replaceChildren(...services.map(renderServiceCard));
  catalogEmpty.hidden = services.length > 0;
}

async function loadServices() {
  catalogLoading.hidden = false;
  catalogEmpty.hidden = true;
  catalogError.hidden = true;
  const params = new URLSearchParams();
  const search = document.querySelector('#service-search').value.trim();
  const category = document.querySelector('#service-category').value;
  const location = document.querySelector('#service-location').value;
  const sort = document.querySelector('#service-sort').value;
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (location) params.set('location', location);
  if (sort) params.set('sort', sort);

  try {
    const queryString = params.toString();
    const result = await catalogRequest(`/api/services${queryString ? `?${queryString}` : ''}`);
    renderServices(Array.isArray(result.services) ? result.services : []);
  } catch (error) {
    console.error('Public service search failed:', error);
    catalogResults.replaceChildren();
    catalogError.textContent = error.message || 'Could not load services.';
    catalogError.hidden = false;
  } finally {
    catalogLoading.hidden = true;
  }
}

async function loadCategories() {
  const result = await catalogRequest('/api/services/categories');
  const select = document.querySelector('#service-category');
  for (const category of result.categories || []) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.append(option);
  }
}

async function loadLocations() {
  const result = await catalogRequest('/api/services/locations');
  const select = document.querySelector('#service-location');
  for (const location of result.locations || []) {
    const option = document.createElement('option');
    option.value = location;
    option.textContent = location;
    select.append(option);
  }
}

async function showServiceDetails(serviceId) {
  const result = await catalogRequest(`/api/services/${encodeURIComponent(serviceId)}`);
  const service = result.service;
  selectedService = service;
  document.querySelector('#service-dialog-category').textContent = service.category || 'Local service';
  document.querySelector('#service-dialog-title').textContent = service.serviceName || 'Service details';
  document.querySelector('#service-dialog-price').textContent = catalogPrice(service);
  document.querySelector('#service-dialog-description').textContent =
    service.description || 'No description provided.';
  document.querySelector('#service-dialog-business').textContent = service.businessName || 'Pune Seva provider';
  document.querySelector('#service-dialog-provider').textContent = service.providerName || 'Not provided';
  document.querySelector('#service-dialog-location').textContent = service.location || 'Not provided';
  document.querySelector('#service-dialog-area').textContent = service.serviceArea || 'Pune';
  document.querySelector('#service-dialog-availability').textContent =
    service.isAvailable ? 'Available' : 'Unavailable';
  document.querySelector('#service-dialog-created').textContent = catalogDate(service.createdAt);
  const serviceImage = document.querySelector('#service-dialog-image');
  if (service.image) {
    serviceImage.src = service.image;
    serviceImage.alt = `${service.serviceName || 'Service'} image`;
    serviceImage.hidden = false;
  } else {
    serviceImage.removeAttribute('src');
    serviceImage.hidden = true;
  }
  if (!serviceDialog.open) serviceDialog.showModal();
}

function formatBookingDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function openBookingForm() {
  if (!selectedService) return;
  document.querySelector('#booking-form-title').textContent = `Book ${selectedService.serviceName}`;
  document.querySelector('#booking-service-summary').textContent =
    `${selectedService.businessName || selectedService.providerName || 'Pune Seva provider'} · ${selectedService.location || selectedService.serviceArea || 'Pune'}`;
  document.querySelector('#booking-price-summary').textContent = `Listed price: ${catalogPrice(selectedService)}. The server confirms the final price.`;
  document.querySelector('#booking-message').hidden = true;
  document.querySelector('#booking-message').classList.remove('is-success');
  document.querySelector('#booking-login-prompt').hidden = true;
  const form = document.querySelector('#booking-form');
  form.hidden = true;
  form.reset();
  document.querySelector('#booking-date').min = formatBookingDate(new Date());
  if (serviceDialog.open) serviceDialog.close();
  bookingDialog.showModal();

  try {
    const identity = await catalogRequest('/api/auth/me');
    if (identity.user?.role !== 'customer') {
      document.querySelector('#booking-login-prompt').hidden = false;
      return;
    }
    const result = await catalogRequest('/api/customer/profile');
    form.elements.phone.value = result.profile?.phone || '';
    form.hidden = false;
    form.elements.bookingDate.focus();
  } catch (error) {
    if (error.status === 401) {
      document.querySelector('#booking-login-prompt').hidden = false;
      return;
    }
    const message = document.querySelector('#booking-message');
    message.textContent = error.message || 'Could not load booking form.';
    message.hidden = false;
  }
}

async function submitBooking(event) {
  event.preventDefault();
  if (!selectedService) return;
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const message = document.querySelector('#booking-message');
  if (!window.confirm(`Send a booking request for ${selectedService.serviceName}? The provider will confirm availability.`)) return;
  submitButton.disabled = true;
  message.hidden = true;
  message.classList.remove('is-success');
  try {
    const result = await catalogRequest('/api/customer/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        serviceId: selectedService.id,
        bookingDate: form.elements.bookingDate.value,
        bookingTime: form.elements.bookingTime.value,
        address: form.elements.address.value.trim(),
        phone: form.elements.phone.value.trim(),
        notes: form.elements.notes.value.trim()
      })
    });
    message.textContent = `${result.message} Booking #${result.booking.id}.`;
    message.classList.add('is-success');
    message.hidden = false;
    form.reset();
    form.hidden = true;
  } catch (error) {
    message.textContent = error.message || 'Could not submit booking request.';
    message.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
}

catalogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadServices();
});

catalogForm.addEventListener('reset', () => {
  window.setTimeout(loadServices, 0);
});

catalogResults.addEventListener('click', (event) => {
  const bookButton = event.target.closest('[data-book-service-id]');
  if (bookButton) {
    bookButton.disabled = true;
    showServiceDetails(bookButton.dataset.bookServiceId)
      .then(openBookingForm)
      .catch((error) => {
        console.error('Could not open booking form:', error);
        catalogError.textContent = error.message || 'Could not open the booking form.';
        catalogError.hidden = false;
      })
      .finally(() => {
        bookButton.disabled = false;
      });
    return;
  }

  const button = event.target.closest('[data-service-id]');
  if (!button) return;
  showServiceDetails(button.dataset.serviceId).catch((error) => {
    console.error('Could not load service details:', error);
    catalogError.textContent = error.message || 'Could not load service details.';
    catalogError.hidden = false;
  });
});

document.querySelectorAll('[data-service-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => serviceDialog.close());
});
document.querySelector('#book-service-button').addEventListener('click', openBookingForm);
document.querySelector('#booking-form').addEventListener('submit', submitBooking);
document.querySelectorAll('[data-booking-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => bookingDialog.close());
});

const requestedServiceId = new URLSearchParams(window.location.search).get('serviceId');
const openBookingOnLoad = new URLSearchParams(window.location.search).get('book') === '1';

Promise.all([loadCategories(), loadLocations(), loadServices()])
  .then(async () => {
    if (!requestedServiceId) return;
    await showServiceDetails(requestedServiceId);
    if (openBookingOnLoad) await openBookingForm();
  })
  .catch((error) => {
    console.error('Could not initialize public services:', error);
    catalogError.textContent = error.message || 'Could not load service categories.';
    catalogError.hidden = false;
    catalogLoading.hidden = true;
  });
