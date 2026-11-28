/**
 * Bazowa klasa kontrolera: grupa akcji jednego obszaru aplikacji.
 * Zależności dostaje z kontekstu (wstrzykiwanie przez konstruktor), a handlers() zwraca mapę
 * { "nazwa-akcji": handler } rejestrowaną w ActionDispatcher.
 */
export class Controller {
  constructor({ state, api, loader, view, forms, notifier, auth }) {
    Object.assign(this, { state, api, loader, view, forms, notifier, auth });
  }

  handlers() {
    throw new Error(`${this.constructor.name} musi zaimplementować handlers().`);
  }
}
