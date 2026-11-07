/**
 * Glass dropdowns.
 *
 * A native picker cannot be styled, and Android draws its own system dialog over
 * the glass. Each <select> stays in place as the source of truth, so the app keeps
 * reading .value and listening for change, and a glass menu sits in front of it.
 * Without popover support the native control simply stays visible.
 */

import { icon } from "./icons.js";

/** Where the highlight lands after a key press, or null for keys that do not move it. */
export function nextIndex(key, index, count) {
  if (key === "ArrowDown") return Math.min(index + 1, count - 1);
  if (key === "ArrowUp") return Math.max(index - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** Below the trigger when it fits, above when that fits, otherwise as far on screen as it goes. */
export function menuPosition(anchor, menu, viewport, gap = 8) {
  const below = anchor.bottom + gap, above = anchor.top - gap - menu.height;
  const fitsBelow = below + menu.height <= viewport.height - gap;
  const top = fitsBelow || above < gap ? Math.min(below, viewport.height - menu.height - gap) : above;
  const left = Math.min(anchor.right - menu.width, viewport.width - menu.width - gap);
  return { top: Math.max(gap, top), left: Math.max(gap, left) };
}

function enhance(select) {
  const label = select.getAttribute("aria-label") ?? select.labels[0]?.firstChild.textContent.trim() ?? "";
  const trigger = Object.assign(document.createElement("button"), { type: "button", id: `${select.id}-picker`, className: "glass-select" });
  trigger.innerHTML = '<span class="glass-select__value"></span><span class="glass-select__chevron" aria-hidden="true"></span>';
  const menu = Object.assign(document.createElement("div"), { id: `${select.id}-menu`, className: "glass-menu" });
  menu.popover = "auto";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", label);
  const options = [...select.options].map((source, index) => {
    const option = Object.assign(document.createElement("div"), { id: `${menu.id}-${index}`, className: "glass-menu__option" });
    option.setAttribute("role", "option");
    option.innerHTML = icon("check");
    option.append(source.textContent);
    return option;
  });
  menu.append(...options);

  for (const [name, value] of Object.entries({ role: "combobox", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": menu.id, "aria-label": label })) trigger.setAttribute(name, value);
  const described = select.getAttribute("aria-describedby");
  if (described) trigger.setAttribute("aria-describedby", described);
  // The browser keeps its own trigger out of light dismiss, so a second tap closes.
  trigger.popoverTargetElement = menu;

  select.hidden = true;
  select.after(trigger);
  if (select.labels[0]) select.labels[0].htmlFor = trigger.id;
  // A modal dialog makes everything outside it inert, so the menu must live inside.
  (select.closest("dialog") ?? document.body).append(menu);

  const value = trigger.firstElementChild;
  const isOpen = () => menu.matches(":popover-open");
  let active = 0;
  const highlight = (index) => {
    active = index;
    options.forEach((option, position) => option.classList.toggle("is-active", position === index));
    trigger.setAttribute("aria-activedescendant", options[index].id);
  };
  const sync = () => {
    value.textContent = select.selectedOptions[0]?.textContent ?? "";
    trigger.disabled = select.disabled;
    options.forEach((option, index) => option.setAttribute("aria-selected", String(index === select.selectedIndex)));
    if (select.disabled && isOpen()) menu.hidePopover();
  };
  const choose = (index) => {
    const changed = index !== select.selectedIndex;
    select.selectedIndex = index;
    menu.hidePopover();
    trigger.focus();
    sync();
    if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  options.forEach((option, index) => option.addEventListener("click", () => choose(index)));
  menu.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      highlight(Math.max(select.selectedIndex, 0));
      // offset sizes ignore the entry animation's scale.
      const { top, left } = menuPosition(trigger.getBoundingClientRect(), { width: menu.offsetWidth, height: menu.offsetHeight }, { width: innerWidth, height: innerHeight });
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    } else {
      trigger.removeAttribute("aria-activedescendant");
    }
    // Stays invisible until it has been placed, so it never flashes in a corner.
    menu.classList.toggle("is-placed", open);
  });
  trigger.addEventListener("keydown", (event) => {
    if (!isOpen()) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); menu.showPopover(); }
      return;
    }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
    else if (event.key === "Tab") menu.hidePopover();
    else {
      const next = nextIndex(event.key, active, options.length);
      if (next !== null) { event.preventDefault(); highlight(next); }
    }
  });
  // An open menu is placed once, so it closes rather than drift from its trigger.
  for (const type of ["resize", "scroll"]) window.addEventListener(type, () => { if (isOpen()) menu.hidePopover(); }, { capture: true, passive: true });
  new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ["disabled"] });
  sync();
  return sync;
}

/** Returns a function that repaints the pickers after code assigns select.value. */
export function enhanceSelects() {
  if (!("popover" in HTMLElement.prototype)) return () => {};
  const syncs = [...document.querySelectorAll("select")].map(enhance);
  return () => syncs.forEach((sync) => sync());
}
