// Drobne narzędzia DOM używane w całej aplikacji.

export const $ = (selector) => document.querySelector(selector);

/** Escapuje tekst wstawiany do HTML (ochrona przed XSS). */
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
