import { $ } from "../core/dom.js";

/** Komunikat na dole ekranu (błąd albo sukces) i bezpieczne uruchamianie akcji. */
export class Notifier {
  #timer;

  show(message, success = false) {
    const notice = $("#notice");
    notice.textContent = message;
    notice.classList.toggle("notice-success", success);
    notice.hidden = false;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => (notice.hidden = true), 6000);
  }

  /** Wykonuje akcję i pokazuje jej błąd użytkownikowi zamiast go połykać. */
  async run(fn) {
    try {
      await fn();
    } catch (error) {
      this.show(error.message);
    }
  }
}
