import { Controller } from "./Controller.js";

/** Konto: logowanie, rejestracja, profil, wylogowanie oraz zamykanie okien dialogowych. */
export class SessionController extends Controller {
  handlers() {
    const { state, api, loader, forms, auth } = this;
    return {
      "login": () => auth.open("login"),
      "show-register": () => auth.setView("register"),
      "show-login": () => auth.setView("login"),
      "close-dialog": (_, el) => el.closest("dialog").close(),
      "edit-profile": () => forms.open("Edytuj nazwę wyświetlaną",
        [
          { name: "username", label: "Nazwa użytkownika — użyj jej do zaproszeń", value: state.user?.username, readOnly: true },
          { name: "displayName", label: "Nazwa wyświetlana", required: true, maxLength: 100, value: state.user?.displayName }
        ],
        async (d) => {
          await api("/api/auth/profile", "PUT", d);
          await loader.refreshSession();
        }),
      "logout": async () => {
        await api("/api/auth/logout", "POST");
        state.openTeam = state.openOwnTeam = null;
        await loader.refreshSession();
      }
    };
  }
}
