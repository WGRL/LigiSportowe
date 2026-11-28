import { Controller } from "./Controller.js";

/** Drużyny ligi: tworzenie, nazwa, skład, kapitan, zapraszanie drużyn spoza ligi i usuwanie z ligi. */
export class TeamController extends Controller {
  handlers() {
    const { state, api, loader, forms, notifier } = this;
    return {
      "new-team": () => forms.open("Nowa drużyna", [{ name: "name", label: "Nazwa", required: true, maxLength: 60 }],
        (d) => api(`/api/leagues/${state.league.id}/teams`, "POST", d)),
      "rename-team": ({ id }) => forms.open("Zmień nazwę drużyny",
        [{ name: "name", label: "Nazwa", required: true, maxLength: 60, value: state.team(id).name }],
        (d) => api(`/api/teams/${id}`, "PUT", d)),
      "toggle-team": ({ id }) => {
        state.openTeam = state.openTeam === id ? null : id;
        return loader.loadPlayers();
      },
      "add-player": ({ id }) => forms.open(`Dodaj zawodnika — ${state.team(id).name}`,
        [{ name: "username", label: "Nazwa użytkownika (konto musi istnieć)", required: true, maxLength: 32 }],
        (d) => api(`/api/teams/${id}/players`, "POST", d)),
      "remove-player": async ({ id, user }) => {
        if (!confirm("Usunąć zawodnika z drużyny?")) return;
        await api(`/api/teams/${id}/players/${user}`, "DELETE");
        await loader.reload();
      },
      "make-captain": async ({ id, user }) => {
        await api(`/api/teams/${id}/captain`, "PUT", { userId: user });
        await loader.reload();
      },
      "invite-team": () => this.#inviteTeamForm(),
      "cancel-league-invitation": async ({ id }) => {
        await api(`/api/leagues/${state.league.id}/invitations/${id}`, "DELETE");
        await loader.reload();
      },
      "remove-team": async ({ id }) => {
        if (!confirm(`Usunąć drużynę ${state.team(id).name} z ligi? Jej zaplanowane mecze zostaną usunięte, a zawodnicy dostaną powiadomienie.`)) return;
        await api(`/api/teams/${id}`, "DELETE");
        await loader.reload();
        notifier.show(`Usunięto drużynę z ligi.`, true);
      }
    };
  }

  // Formularz dwuetapowy: najpierw nazwa użytkownika kapitana, potem wybór jednej z jego drużyn poza ligą.
  #inviteTeamForm() {
    const { state, api, forms, notifier } = this;
    forms.open(`Zaproś drużynę do ligi ${state.league.name}`,
      [{ name: "username", label: "Nazwa użytkownika kapitana", required: true, maxLength: 32,
         hint: "Kapitan to właściciel drużyny poza ligą. W następnym kroku wybierzesz jego drużynę." }],
      async ({ username }) => {
        const teams = await api(`/api/users/${encodeURIComponent(username.trim())}/independent-teams`);
        if (!teams.length) throw new Error(`Użytkownik ${username} nie jest kapitanem żadnej drużyny poza ligą.`);
        forms.open(`Zaproś drużynę do ligi ${state.league.name}`, [
          { name: "independentTeamId", label: `Drużyna użytkownika ${username}`, value: teams[0].id,
            options: teams.map((t) => [t.id, `${t.name} — zawodników: ${t.players}`]),
            hint: "Kapitan dostanie zaproszenie w powiadomieniach. Po akceptacji drużyna dołączy do ligi z całym składem." }
        ], async (d) => {
          await api(`/api/leagues/${state.league.id}/invitations`, "POST", d);
          notifier.show("Wysłano zaproszenie do ligi.", true);
        });
      });
  }
}
