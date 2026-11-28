import { esc } from "../core/dom.js";

// Wspólne fragmenty HTML używane przez widoki.

export const empty = (icon, text) =>
  `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><p>${esc(text)}</p></div>`;

/** Przycisk akcji obsługiwany przez ActionDispatcher (data-action, data-id, data-user). */
export const btn = (action, id, label, primary = false, user = "") =>
  `<button class="button button-${primary ? "primary" : "ghost"} button-small" type="button" data-action="${action}" data-id="${id}" data-user="${user}">${label}</button>`;

export const personName = (p) => `<span title="Nazwa użytkownika: ${esc(p.username)}">${esc(p.displayName || p.username)}</span>`;
