const menu = document.querySelector('#mobile-menu');
const trigger = document.querySelector('#nav-toggle');
const desktop = matchMedia('(min-width: 901px)');
let menuScrollY = 0;
function closeMenu(restoreFocus = true) {
  if (!menu.open) return;
  menu.close();
  document.documentElement.classList.remove('menu-open');
  document.documentElement.style.removeProperty('--nav-scroll-top');
  window.scrollTo({ top: menuScrollY, behavior: 'instant' });
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus({ preventScroll: true });
}
trigger.hidden = false;
trigger.addEventListener('click', () => {
  if (menu.open) return closeMenu();
  menuScrollY = scrollY;
  document.documentElement.style.setProperty('--nav-scroll-top', `${-menuScrollY}px`);
  document.documentElement.classList.add('menu-open');
  menu.showModal();
  trigger.setAttribute('aria-expanded', 'true');
});
menu.querySelector('.menu-close').addEventListener('click', () => closeMenu());
menu.addEventListener('cancel', event => { event.preventDefault(); closeMenu(); });
desktop.addEventListener('change', () => { if (desktop.matches) closeMenu(false); });
menu.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href);
  closeMenu(false);
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
});