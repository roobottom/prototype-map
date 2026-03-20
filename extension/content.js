/**
 * Content script — runs inside the prototype pages.
 * Captures form submissions, click targets, and clicks that trigger DOM changes.
 */

// Track clicks that add new DOM elements (e.g. "Add another" links)
// These get included as { action: 'click' } entries in the generated formData
const domMutatingClicks = [];
let mutationObserver = null;
let pendingClickTarget = null;
let pendingClickSelector = null;

function buildClickSelector(element) {
  if (element.id) return `#${element.id}`;
  if (element.getAttribute('data-testid')) return `[data-testid="${element.getAttribute('data-testid')}"]`;

  // Try text-based selector for links and buttons
  const tag = element.tagName.toLowerCase();
  const text = element.textContent?.trim();
  if (text && (tag === 'a' || tag === 'button') && text.length < 60) {
    return `${tag}:has-text("${text}")`;
  }

  // CSS path fallback
  const parts = [];
  let el = element;
  while (el && el !== document.body) {
    let selector = el.tagName.toLowerCase();
    if (el.id) {
      parts.unshift(`#${el.id}`);
      break;
    }
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) selector += `.${cls}`;
    }
    parts.unshift(selector);
    el = el.parentElement;
  }
  return parts.join(' > ');
}

// Watch for DOM mutations after clicks
function startMutationWatch(clickTarget, clickSelector) {
  pendingClickTarget = clickTarget;
  pendingClickSelector = clickSelector;

  if (mutationObserver) mutationObserver.disconnect();

  mutationObserver = new MutationObserver((mutations) => {
    // Check if any mutation added new elements (especially form-related ones)
    let addedElements = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            addedElements = true;
            break;
          }
        }
      }
      if (addedElements) break;
    }

    if (addedElements && pendingClickSelector) {
      domMutatingClicks.push({
        selector: pendingClickSelector,
        text: pendingClickTarget?.textContent?.trim().slice(0, 60) || ''
      });
      pendingClickTarget = null;
      pendingClickSelector = null;
    }

    // Stop observing after processing
    if (mutationObserver) mutationObserver.disconnect();
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Stop watching after 1 second if no mutation happened
  setTimeout(() => {
    if (mutationObserver) mutationObserver.disconnect();
    pendingClickTarget = null;
    pendingClickSelector = null;
  }, 1000);
}

// Track click targets for edge labels AND detect DOM-mutating clicks
document.addEventListener('click', (e) => {
  const target = e.target.closest('a, button, [role="button"], input[type="submit"], .nhsuk-button, .govuk-button');
  if (!target) return;

  const text = target.textContent?.trim().slice(0, 60) ||
               target.getAttribute('aria-label') ||
               target.getAttribute('value') ||
               '';

  if (text) {
    chrome.runtime.sendMessage({
      type: 'click/text',
      payload: {
        clickText: text
      }
    });
  }

  // For non-navigation clicks (links with # or javascript:, or buttons that aren't submit),
  // watch for DOM mutations — these are likely JS-triggered UI changes
  const isSubmit = target.matches('input[type="submit"], button[type="submit"]');
  const isNavLink = target.tagName === 'A' && target.href &&
    !target.href.startsWith('javascript:') &&
    !target.getAttribute('href')?.startsWith('#');

  if (!isSubmit && !isNavLink) {
    const selector = buildClickSelector(target);
    startMutationWatch(target, selector);
  }
}, true);

// Capture form submissions with all field values
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  const fields = [];

  for (const element of form.elements) {
    // Skip buttons and hidden fields
    if (element.type === 'submit' || element.type === 'button' || element.type === 'hidden') continue;
    if (!element.name && !element.id) continue;

    // Build a selector for this field
    const selector = element.id
      ? `#${element.id}`
      : element.name
        ? `[name="${element.name}"]`
        : null;

    if (!selector) continue;

    if (element.type === 'checkbox' || element.type === 'radio') {
      // Only record checked state for checkboxes/radios
      if (element.type === 'radio' && !element.checked) continue;
      fields.push({
        selector,
        type: element.type,
        value: element.value,
        checked: element.checked,
        label: findLabel(element)
      });
    } else if (element.tagName === 'SELECT') {
      fields.push({
        selector,
        type: element.type,
        value: element.value,
        label: findLabel(element)
      });
    } else {
      fields.push({
        selector,
        type: element.type || 'text',
        value: element.value,
        label: findLabel(element)
      });
    }
  }

  // Find the submit button selector
  const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
  const submitSelector = submitBtn
    ? (submitBtn.id ? `#${submitBtn.id}` : null)
    : null;

  // Prepend any DOM-mutating clicks that happened before this submission
  const clickActions = domMutatingClicks.map(c => ({
    selector: c.selector,
    type: 'click',
    value: '',
    label: c.text
  }));

  // Send to background script
  chrome.runtime.sendMessage({
    type: 'form/submit',
    payload: {
      url: window.location.href,
      fields: [...clickActions, ...fields],
      submitSelector
    }
  });

  // Clear the click actions for next form
  domMutatingClicks.length = 0;
}, true);

/**
 * Find the label text for a form element.
 */
function findLabel(element) {
  // Check for associated label
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent.trim().slice(0, 60);
  }

  // Check for wrapping label
  const parentLabel = element.closest('label');
  if (parentLabel) return parentLabel.textContent.trim().slice(0, 60);

  // Check for aria-label
  if (element.getAttribute('aria-label')) return element.getAttribute('aria-label');

  // Fallback to name
  return element.name || '';
}

function currentHeading() {
  const heading = document.querySelector('h1');
  if (!heading) return '';
  return heading.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || '';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'page/heading') return;
  sendResponse({ heading: currentHeading() });
});
