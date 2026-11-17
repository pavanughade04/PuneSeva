
async function readResponse(response) {
  if (response.status === 405) {
    throw new Error(
      'Login is unavailable on this web server (HTTP 405). Open Pune Seva through its Express server, such as http://localhost:3000, not VS Code Live Server or a static hosting URL.'
    );
  }

  const text = await response.text();

  if (!text) {
    throw new Error(`Server returned an empty response (HTTP ${response.status}).`);
  }

  try {
    return JSON.parse(text);
  } catch {
    console.error('Invalid server response:', text);
    throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
  }
}

const dashboardLabels = {
  customer: 'Customer dashboard',
  provider: 'Provider dashboard',
  admin: 'Admin dashboard'
};

function showFormMessage(element, message, isSuccess = false) {
  if (!element) return;

  element.textContent = message;
  element.classList.toggle('is-success', isSuccess);
  element.classList.add('is-visible');
}

async function checkAuthServer(form) {
  const warning = form.querySelector('[data-origin-warning]');
  const submitButton = form.querySelector('[type="submit"]');
  if (!warning || !submitButton) return true;

  submitButton.disabled = true;
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const result = await response.json();
    if (!response.ok || result.status !== 'ok') {
      throw new Error('Pune Seva server is not ready.');
    }

    warning.hidden = true;
    warning.classList.remove('is-visible');
    submitButton.disabled = false;
    return true;
  } catch (error) {
    console.error('Authentication server check failed:', error);
    warning.hidden = false;
    warning.classList.add('is-visible');
    submitButton.disabled = true;
    return false;
  }
}

// LOGIN AND REGISTRATION
for (const form of document.querySelectorAll('[data-auth-form]')) {
  let serverReady = checkAuthServer(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    serverReady = checkAuthServer(form);
    if (!await serverReady) return;

    const message = form.querySelector('[data-form-message]');
    const submitButton = form.querySelector('[type="submit"]');
    const password = form.elements.password;
    const confirmPassword = form.elements.confirmPassword;

    message?.classList.remove('is-visible', 'is-success');

    if (confirmPassword && password.value !== confirmPassword.value) {
      showFormMessage(message, 'Your passwords do not match.');
      confirmPassword.focus();
      return;
    }

    const originalLabel = submitButton.querySelector('span')?.textContent || submitButton.textContent;

    submitButton.disabled = true;

    if (submitButton.querySelector('span')) {
      submitButton.querySelector('span').textContent = 'Please wait…';
    }

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });

      // SAFE JSON RESPONSE
      const result = await readResponse(response);

      if (!response.ok) {
        const detail = result.details?.[0]?.message;
        throw new Error(detail || result.error || 'We could not complete your request.');
      }

      if (form.dataset.authMode === 'admin-login') {
        window.location.assign('/admin-dashboard.html');
        return;
      }

      if (form.dataset.authMode === 'login' || form.action.endsWith('/login')) {
        window.location.assign(result.redirectUrl || '/');
        return;
      }

      showFormMessage(message, result.message, true);
      form.reset();

    } catch (error) {
      console.error('Authentication error:', error);
      showFormMessage(message, error.message || 'A connection error occurred. Please try again.');

    } finally {
      submitButton.disabled = false;

      if (submitButton.querySelector('span')) {
        submitButton.querySelector('span').textContent = originalLabel;
      }
    }
  });
}

// NOT READY LINKS
document.querySelectorAll('[data-not-ready]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();

    const toast = document.querySelector('#auth-toast');
    if (!toast) return;

    toast.textContent = `${link.dataset.notReady} is not available yet.`;
    toast.classList.add('is-visible');

    window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
  });
});

// DASHBOARD AUTHENTICATION
const dashboard = document.querySelector('[data-dashboard-role]');

if (dashboard) {
  fetch('/api/auth/me', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  })
    .then(async (response) => {
      const result = await readResponse(response);

      if (!response.ok) {
        throw new Error(result.error || 'Please log in again.');
      }

      return result.user;
    })
    .then((user) => {
      if (!user) {
        throw new Error('User information not found.');
      }

      document.querySelector('#dashboard-name').textContent = user.fullName;
      document.querySelector('#dashboard-email').textContent = user.email;

      if (user.approvalStatus) {
        const approval = document.querySelector('#provider-approval');

        if (approval) {
          approval.hidden = false;
          approval.textContent = user.approvalStatus === 'approved'
            ? 'Your provider account is approved.'
            : `Your provider account is ${user.approvalStatus}. Service publishing is not available until approval.`;
        }
      }

      document.querySelector('#dashboard-message').textContent =
        `${dashboardLabels[user.role] || 'Dashboard'} features will be available in a future phase.`;
    })
    .catch((error) => {
      console.error('Dashboard authentication error:', error);
      window.location.replace('/login.html');
    });

  // LOGOUT
  document.querySelector('#logout-button')?.addEventListener('click', async () => {
    const button = document.querySelector('#logout-button');

    button.disabled = true;

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      const result = await readResponse(response);

      if (!response.ok) {
        throw new Error(result.error || 'Logout failed. Please try again.');
      }

      window.location.replace('/login.html');

    } catch (error) {
      console.error('Logout error:', error);
      button.disabled = false;

      const message = document.querySelector('#dashboard-message');

      if (message) {
        message.textContent = error.message;
      }
    }
  });
}
