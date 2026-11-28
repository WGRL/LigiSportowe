/**
 * Delegacja zdarzeń: jeden nasłuch kliknięć dla całej strony. Element z data-action="nazwa"
 * uruchamia zarejestrowaną akcję z argumentami { id: data-id, user: data-user } i samym elementem.
 */
export class ActionDispatcher {
  #actions = {};

  constructor(notifier) {
    this.notifier = notifier;
  }

  /** Rejestruje mapę { "nazwa-akcji": handler } (np. z kontrolera jednego obszaru aplikacji). */
  register(handlers) {
    for (const [name, handler] of Object.entries(handlers)) {
      if (name in this.#actions) throw new Error(`Akcja ${name} jest już zarejestrowana.`);
      this.#actions[name] = handler;
    }
    return this;
  }

  listen(root = document) {
    root.addEventListener("click", (event) => {
      const el = event.target.closest("[data-action]");
      if (!el) return;
      const action = this.#actions[el.dataset.action];
      if (action) this.notifier.run(() => action({ id: Number(el.dataset.id), user: Number(el.dataset.user) }, el));
    });
  }
}
