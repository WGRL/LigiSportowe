import { $ } from "../core/dom.js";

/** Okno logowania i rejestracji wraz z walidacją formularzy po stronie przeglądarki. */
export class AuthDialog {
  constructor(api, onLogin) {
    this.api = api;
    this.onLogin = onLogin;
    $("#login-form").addEventListener("submit", (event) => this.#login(event));
    $("#register-form").addEventListener("submit", (event) => this.#register(event));
  }

  open(view) {
    this.setView(view);
    $("#auth-dialog").showModal();
  }

  setView(view) {
    $("#login-view").hidden = view !== "login";
    $("#register-view").hidden = view === "login";
    $("#login-message").textContent = $("#register-message").textContent = "";
    $("#login-message").classList.remove("success");
  }

  async #login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    $("#login-message").classList.remove("success");
    if (!username) {
      $("#login-message").textContent = "Podaj nazwę użytkownika.";
      return;
    }
    if (!password) {
      $("#login-message").textContent = "Podaj hasło.";
      return;
    }
    try {
      await this.api("/api/auth/login", "POST", { username, password });
      form.reset();
      $("#auth-dialog").close();
      await this.onLogin();
    } catch (error) {
      $("#login-message").textContent = error.status === 401 ? "Nieprawidłowa nazwa użytkownika lub hasło." : error.message;
    }
  }

  /** Zwraca komunikat o pierwszym błędzie w danych rejestracji albo null. */
  static #registrationError({ username, displayName, password, passwordRepeat }) {
    if (!username) return "Podaj nazwę użytkownika.";
    if (username.length < 3) return "Nazwa użytkownika musi mieć co najmniej 3 znaki.";
    if (username.length > 32) return "Nazwa użytkownika może mieć maksymalnie 32 znaki.";
    if (!/^[A-Za-z0-9_.-]+$/.test(username)) return "Nazwa użytkownika może zawierać tylko litery, cyfry, kropkę, podkreślenie i myślnik.";
    if (!displayName) return "Podaj nazwę wyświetlaną.";
    if (displayName.length > 100) return "Nazwa wyświetlana może mieć maksymalnie 100 znaków.";
    if (password.length < 8) return "Hasło musi mieć co najmniej 8 znaków.";
    if (new TextEncoder().encode(password).length > 72) return "Hasło może mieć maksymalnie 72 bajty.";
    if (!/[A-Z]/.test(password) || !/\d/.test(password)) return "Hasło musi zawierać co najmniej 1 wielką literę i 1 cyfrę.";
    if (password !== passwordRepeat) return "Hasła nie są takie same.";
    return null;
  }

  async #register(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").trim();
    const displayName = String(data.get("displayName") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const passwordRepeat = String(data.get("passwordRepeat") ?? "");
    const message = $("#register-message");
    message.classList.remove("success");
    message.textContent = "";

    const error = AuthDialog.#registrationError({ username, displayName, password, passwordRepeat });
    if (error) {
      message.textContent = error;
      return;
    }
    try {
      await this.api("/api/auth/register", "POST", { username, displayName, password });
      form.reset();
      this.setView("login");
      $("#login-form").elements.username.value = data.get("username");
      $("#login-message").textContent = "Konto utworzone. Możesz się zalogować.";
      $("#login-message").classList.add("success");
    } catch (error) {
      $("#register-message").textContent = error.message;
    }
  }
}
