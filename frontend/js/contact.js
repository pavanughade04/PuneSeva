const contactForm = document.querySelector('#contact-form');

contactForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = contactForm.querySelector('[type="submit"]');
  const message = contactForm.querySelector('[data-contact-message]');
  const formValues = Object.fromEntries(new FormData(contactForm));

  message.textContent = '';
  message.classList.remove('is-success');
  submitButton.disabled = true;

  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(formValues)
    });
    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      const detail = result.details?.[0]?.message;
      throw new Error(detail || result.error || 'Your message could not be sent.');
    }

    contactForm.reset();
    message.textContent = result.message || 'Thanks. Your message has been received.';
    message.classList.add('is-success');
  } catch (error) {
    console.error('Contact form submission failed:', error);
    message.textContent = error.message || 'Could not send your message. Please try again.';
  } finally {
    submitButton.disabled = false;
  }
});
