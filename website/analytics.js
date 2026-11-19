// The website's optional analytics never runs in the dock or embedded demo.
const consentKey = 'tara-website-analytics-v1';
const notice = document.querySelector('#analytics-notice');
const preferences = document.querySelector('#analytics-preferences');
const choiceLabel = document.querySelector('#analytics-choice');
const feedback = document.querySelector('#analytics-feedback');
const allow = document.querySelector('#analytics-allow');
const decline = document.querySelector('#analytics-decline');
const production = location.hostname === 'windock.vercel.app';
let script;
let returnFocus;

function readChoice() {
  try {
    const value = localStorage.getItem(consentKey);
    return value === 'allowed' || value === 'declined' ? value : null;
  } catch {
    return null;
  }
}

let choice = readChoice();

function filterEvent(event) {
  // Check every event, including after withdrawal in this or another tab.
  if (choice !== 'allowed') return null;
  try {
    const url = new URL(event.url);
    url.search = '';
    url.hash = '';
    return { ...event, url: url.href };
  } catch {
    return null;
  }
}

function startAnalytics() {
  if (!production || choice !== 'allowed' || script) return;
  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };
  // Register before appending the script so the first page view is gated too.
  window.va('beforeSend', filterEvent);
  script = document.createElement('script');
  script.src = '/_vercel/insights/script.js';
  script.defer = true;
  script.addEventListener('error', () => {
    script.remove();
    script = null;
  }, { once: true });
  document.head.append(script);
}

function showNotice({ focus = false } = {}) {
  choiceLabel.hidden = !choice;
  choiceLabel.textContent = choice === 'allowed' ? 'Your choice: analytics allowed.' : 'Your choice: analytics off.';
  decline.textContent = choice === 'allowed' ? 'Turn off analytics' : 'No thanks';
  notice.hidden = false;
  preferences.setAttribute('aria-expanded', 'true');
  if (focus) {
    returnFocus = document.activeElement;
    decline.focus({ preventScroll: true });
  }
}

function hideNotice() {
  const focusedInside = notice.contains(document.activeElement);
  notice.hidden = true;
  notice.querySelector('details').open = false;
  preferences.setAttribute('aria-expanded', 'false');
  if (focusedInside) (returnFocus || preferences).focus({ preventScroll: true });
  returnFocus = null;
}

function saveChoice(value) {
  choice = value;
  let persisted = true;
  try {
    localStorage.setItem(consentKey, choice);
  } catch {
    persisted = false;
  }
  hideNotice();
  feedback.textContent = `${choice === 'allowed' ? 'Analytics allowed.' : 'Analytics is off.'}${persisted ? ' You can change this in Analytics preferences.' : ' Your browser could not save this choice; it applies to this page only.'}`;
  startAnalytics();
}

allow.addEventListener('click', () => saveChoice('allowed'));
decline.addEventListener('click', () => saveChoice('declined'));
preferences.addEventListener('click', () => {
  if (notice.hidden) showNotice({ focus: true });
  else hideNotice();
});
notice.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  // Dismissing an unanswered notice leaves analytics off.
  hideNotice();
});
window.addEventListener('storage', event => {
  if (event.key !== consentKey && event.key !== null) return;
  choice = readChoice();
  if (choice) hideNotice();
  else showNotice();
  startAnalytics();
});

preferences.hidden = false;
if (!choice) showNotice();
startAnalytics();
