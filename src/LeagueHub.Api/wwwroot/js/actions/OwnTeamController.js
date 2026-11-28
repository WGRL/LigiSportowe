import { Controller } from "./Controller.js";

/** Drużyny poza ligą: zakładanie, nazwa, usuwanie, opuszczanie, skład i zaproszenia zawodników. */
export class OwnTeamController extends Controller {
  handlers() {
    const { state, api, loader, forms, notifier } = this;
    return {
      "new-own-team": () => forms.open("Nowa drużyna poza ligą", [{ name: "name", label: "Nazwa", required: true, maxLength: 60,
          hint: "Zostaniesz jej właścicielem i będziesz zapraszać zawodników po nazwie użytkownika." }],
        async (d) => { state.openOwnTeam = (await api("/api/independent-teams", "POST", d)).id; }),
      "rename-own-team": ({ id }) => forms.open("Zmień nazwę drużyny",
        [{ name: "name", label: "Nazwa", required: true, maxLength: 60, value: state.ownTeam(id).name }],
        (d) => api(`/api/independent-teams/${id}`, "PUT", d)),
      "delete-own-team": async ({ id }) => {
        if (!confirm(`Usunąć drużynę ${state.ownTeam(id).name}? Zawodnicy i zaproszenia zostaną usunięci.`)) return;
        await api(`/api/independent-teams/${id}`, "DELETE");
        await loader.reload();
      },
      "leave-own-team": async ({ id }) => {
        if (!confirm(`Opuścić drużynę ${state.ownTeam(id).name}?`)) return;
        await api(`/api/independent-teams/${id}/members/${state.user.id}`, "DELETE");
        await loader.reload();
      },
      "toggle-own-team": ({ id }) => {
        state.openOwnTeam = state.openOwnTeam === id ? null : id;
        return loader.reload();
      },
      "invite-player": ({ id }) => forms.open(`Zaproś zawodnika — ${state.ownTeam(id).name}`,
        [{ name: "username", label: "Nazwa użytkownika", required: true, maxLength: 32,
           hint: "Zaproszenie trafi do powiadomień tej osoby — może je zaakceptować lub odrzucić." }],
        async (d) => {
          await api(`/api/independent-teams/${id}/invitations`, "POST", d);
          notifier.show(`Wysłano zaproszenie do ${d.username}.`, true);
        }),
      "cancel-invitation": async ({ id, user }) => {
        await api(`/api/independent-teams/${id}/invitations/${user}`, "DELETE");
        await loader.reload();
      },
      "remove-own-member": async ({ id, user }) => {
        if (!confirm("Usunąć zawodnika z drużyny?")) return;
        await api(`/api/independent-teams/${id}/members/${user}`, "DELETE");
        await loader.reload();
      }
    };
  }
}
