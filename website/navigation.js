const header = document.querySelector('.header');
const shell = header.querySelector('.nav-shell');
const desktopContent = document.querySelector('#desktop-navigation');
const menu = document.querySelector('#mobile-menu');
const trigger = document.querySelector('#nav-toggle');
const desktop = matchMedia('(min-width: 901px) and (hover: hover) and (pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let introTimer, leaveTimer, restoringFocus = false;
let menuScrollY = 0;
function focusTrigger() {
  restoringFocus = true;
  trigger.focus({ preventScroll: true });
  restoringFocus = false;
}
function setExpanded(expanded) {
  header.dataset.expanded = String(expanded);
  desktopContent.inert = !desktop.matches || !expanded;
  trigger.setAttribute('aria-expanded', String(expanded));
  trigger.setAttribute('aria-label', expanded ? 'Close navigation' : 'Open navigation');
  trigger.title = expanded ? 'Close navigation' : 'Open navigation';
}
function collapseDesktop(restoreFocus = false) {
  clearTimeout(introTimer);
  clearTimeout(leaveTimer);
  if (restoreFocus || desktopContent.contains(document.activeElement)) focusTrigger();
  setExpanded(false);
}
function closeMenu(restoreFocus = true) {
  if (!menu.open) return;
  menu.close();
  document.documentElement.classList.remove('menu-open');
  document.documentElement.style.removeProperty('--nav-scroll-top');
  window.scrollTo({ top: menuScrollY, behavior: 'instant' });
  setExpanded(false);
  if (restoreFocus) focusTrigger();
}
function configureNavigation(intro = false) {
  clearTimeout(introTimer);
  clearTimeout(leaveTimer);
  if (menu.open) closeMenu();
  trigger.setAttribute('aria-controls', desktop.matches ? 'desktop-navigation' : 'mobile-menu');
  if (desktop.matches) trigger.removeAttribute('aria-haspopup');
  else trigger.setAttribute('aria-haspopup', 'dialog');
  const reveal = intro && desktop.matches && !reducedMotion.matches;
  if (!reveal && desktopContent.contains(document.activeElement)) focusTrigger();
  setExpanded(reveal);
  if (reveal) introTimer = setTimeout(() => {
    if (!shell.matches(':hover') && !shell.contains(document.activeElement)) collapseDesktop();
  }, 1200);
}
trigger.hidden = false;
header.dataset.navReady = '';
configureNavigation(true);
trigger.addEventListener('click', () => {
  clearTimeout(introTimer);
  if (desktop.matches) {
    if (header.dataset.expanded === 'true') collapseDesktop(true);
    else setExpanded(true);
    return;
  }
  if (menu.open) return closeMenu();
  menuScrollY = scrollY;
  document.documentElement.style.setProperty('--nav-scroll-top', `${-menuScrollY}px`);
  document.documentElement.classList.add('menu-open');
  menu.showModal();
  setExpanded(true);
});
shell.addEventListener('pointerenter', event => {
  if (!desktop.matches || event.pointerType === 'touch') return;
  clearTimeout(introTimer);
  clearTimeout(leaveTimer);
  setExpanded(true);
});
shell.addEventListener('pointerleave', () => {
  if (!desktop.matches) return;
  leaveTimer = setTimeout(() => {
    const active = document.activeElement;
    if (!(shell.contains(active) && active.matches(':focus-visible'))) collapseDesktop();
  }, 180);
});
shell.addEventListener('focusin', event => {
  if (desktop.matches && !restoringFocus && event.target.matches(':focus-visible')) {
    clearTimeout(introTimer);
    clearTimeout(leaveTimer);
    setExpanded(true);
  }
});
shell.addEventListener('focusout', () => requestAnimationFrame(() => {
  if (desktop.matches && !shell.contains(document.activeElement) && !shell.matches(':hover')) collapseDesktop();
}));
header.addEventListener('keydown', event => {
  if (event.key === 'Escape' && desktop.matches) {
    event.preventDefault();
    collapseDesktop(true);
  }
});
menu.querySelector('.menu-close').addEventListener('click', () => closeMenu());
menu.addEventListener('cancel', event => { event.preventDefault(); closeMenu(); });
desktop.addEventListener('change', () => configureNavigation());
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches && desktop.matches) collapseDesktop();
});
function navigate(event) {
  const link = event.target.closest('a');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href);
  if (menu.open) closeMenu(false);
  else collapseDesktop();
  if (url.origin === location.origin && url.pathname === location.pathname && url.hash) {
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    event.preventDefault();
    history.pushState(null, '', url.hash);
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
}
menu.addEventListener('click', navigate);
desktopContent.addEventListener('click', navigate);
