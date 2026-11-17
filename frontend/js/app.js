
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#primary-navigation');
const searchForm = document.querySelector('#service-search');
const searchInput = document.querySelector('#search-input');
const categoryCards = [...document.querySelectorAll('.category-card')];
const popularCards = [...document.querySelectorAll('.popular-card')];
const resultsMessage = document.querySelector('#search-results');
const emptySearch = document.querySelector('#empty-search');
const toast = document.querySelector('#site-toast');
let toastTimeout;

function closeNavigation() {
  if (!menuButton || !navigation) return;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation menu');
  navigation.classList.remove('is-open');
  document.body.classList.remove('menu-open');
}

function setCategoryFilter(value, { scroll = false } = {}) {
  const query = value.trim().toLocaleLowerCase();
  let visibleCount = 0;

  for (const card of categoryCards) {
    const searchText = `${card.dataset.category} ${card.dataset.searchTerms}`.toLocaleLowerCase();
    const matches = !query || searchText.includes(query);
    card.hidden = !matches;
    if (matches) visibleCount += 1;
  }

  for (const card of popularCards) {
    const matches = !query || card.dataset.popularCategory.includes(query) ||
      card.querySelector('h3').textContent.toLocaleLowerCase().includes(query);
    card.hidden = !matches;
  }

  const hasResults = visibleCount > 0;
  if (emptySearch) emptySearch.hidden = hasResults;

  if (resultsMessage) {
    resultsMessage.textContent = query && hasResults
      ? `${visibleCount} ${visibleCount === 1 ? 'category' : 'categories'} found for “${value.trim()}”.`
      : '';
  }

  if (scroll) {
    document.querySelector('#categories')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

function showToast(message) {
  if (!toast) return;

  window.clearTimeout(toastTimeout);
  toast.textContent = `${message} is coming in a future phase.`;
  toast.classList.add('is-visible');
  toastTimeout = window.setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

menuButton?.addEventListener('click', () => {
  const isExpanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isExpanded));
  menuButton.setAttribute('aria-label', isExpanded ? 'Open navigation menu' : 'Close navigation menu');
  navigation?.classList.toggle('is-open', !isExpanded);
  document.body.classList.toggle('menu-open', !isExpanded);
});

navigation?.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeNavigation();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeNavigation();
});

searchInput?.addEventListener('input', () => setCategoryFilter(searchInput.value));

searchForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  setCategoryFilter(searchInput.value, { scroll: true });
});

document.querySelectorAll('[data-search-category]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!searchInput) return;
    const category = button.dataset.searchCategory;
    searchInput.value = category;
    setCategoryFilter(category, { scroll: true });
  });
});

document.querySelectorAll('[data-footer-category]').forEach((link) => {
  link.addEventListener('click', () => {
    if (!searchInput) return;
    const category = link.dataset.footerCategory;
    searchInput.value = category;
    setCategoryFilter(category, { scroll: true });
  });
});

document.querySelector('.reset-search')?.addEventListener('click', () => {
  if (!searchInput) return;
  searchInput.value = '';
  setCategoryFilter('');
  searchInput.focus();
});

document.querySelectorAll('[data-coming-soon]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showToast(link.dataset.comingSoon);
    closeNavigation();
  });
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 760) closeNavigation();
});

const currentYear = document.querySelector('#current-year');
if (currentYear) currentYear.textContent = String(new Date().getFullYear());

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const revealItems = document.querySelectorAll('.category-card, .popular-card, .step-item, .benefit-item');
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12 });

  revealItems.forEach((item) => {
    item.classList.add('reveal');
    observer.observe(item);
  });

  document.body.classList.add('motion-ready');
}


// =====================================
// AUTHENTICATION: UPDATE NAVBAR
// =====================================

async function updateNavbar() {
  const navActions = document.querySelector('#nav-actions');

  if (!navActions) return;

  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) return;

    const result = await response.json();
    const user = result.user;

    if (!user) return;

    const dashboardLinks = {
      customer: '/customer-dashboard.html',
      provider: '/provider-dashboard.html',
      admin: '/admin-dashboard.html'
    };

    const dashboardUrl = dashboardLinks[user.role];

    if (!dashboardUrl) return;

    navActions.replaceChildren();

    const userName = document.createElement('span');
    userName.className = 'login-link';
    userName.textContent = `Hi, ${user.fullName}`;

    const dashboard = document.createElement('a');
    dashboard.className = 'button button-small button-outline';
    dashboard.href = dashboardUrl;
    dashboard.textContent = 'Dashboard';

    const logout = document.createElement('button');
    logout.className = 'button button-small button-primary';
    logout.type = 'button';
    logout.textContent = 'Logout';

    logout.addEventListener('click', async () => {
      logout.disabled = true;
      logout.textContent = 'Logging out...';

      try {
        const logoutResponse = await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json'
          }
        });

        if (!logoutResponse.ok) {
          throw new Error('Logout failed');
        }

        window.location.reload();

      } catch (error) {
        logout.disabled = false;
        logout.textContent = 'Logout';
        alert('Could not log out. Please try again.');
      }
    });

    navActions.append(userName, dashboard, logout);

  } catch (error) {
    console.error('Navbar login check failed:', error);
  }
}

updateNavbar();
