import { Controller } from "./Controller.js";

/** Mecze: dodawanie, edycja, usuwanie, wyniki, generator terminarza i kadry meczowe. */
export class GameController extends Controller {
  handlers() {
    const { state, api, loader, forms } = this;
    return {
      "new-game": () => this.#gameForm("Nowy mecz", {}, async (d) => {
        const { id } = await api(`/api/seasons/${state.season.id}/games`, "POST", d);
        state.openGame = id;
      }),
      "generate-schedule": () => this.#scheduleForm(),
      "toggle-game": ({ id }) => {
        state.openGame = state.openGame === id ? null : id;
        return loader.loadPlayers();
      },
      "draw-lineup": async ({ id, user: teamId }) => {
        const both = !teamId;
        if (!confirm(both ? "Wylosować od nowa kadry obu drużyn?" : `Wylosować od nowa kadrę: ${state.team(teamId)?.name}?`)) return;
        await api(`/api/games/${id}/lineup/draw`, "POST", { teamId: both ? null : teamId });
        await loader.loadPlayers();
      },
      "edit-game": ({ id }) => this.#gameForm("Edytuj mecz", state.game(id), (d) => api(`/api/games/${id}`, "PUT", d)),
      "delete-game": async ({ id }) => {
        if (!confirm("Usunąć mecz z terminarza?")) return;
        await api(`/api/games/${id}`, "DELETE");
        await loader.reload();
      },
      "set-result": ({ id }) => {
        const g = state.game(id);
        forms.open(`Wynik: ${g.homeTeam} — ${g.awayTeam}`, [
          { name: "homeScore", label: g.homeTeam, type: "number", min: 0, max: 999, value: g.homeScore },
          { name: "awayScore", label: g.awayTeam, type: "number", min: 0, max: 999, value: g.awayScore }
        ], (d) => api(`/api/games/${id}/result`, "PUT", d));
      }
    };
  }

  // Sposób doboru ma znaczenie tylko, gdy sezon dzieli kadrę na skład i rezerwowych (rozmiar składu w parametrach sezonu).
  #lineupFields(g) {
    const { state } = this;
    if (!state.hasSquadSize()) return [];
    return [
      { name: "lineupStrategy", label: "Dobór zawodników do składu", text: true, value: g.lineupStrategy ?? "rotation",
        options: state.templates.strategies.map((s) => [s.id, s.name]),
        hint: state.templates.strategies.map((s) => `${s.name}: ${s.description}`).join(" ") +
          " Kapitan zawsze wychodzi w pierwszym składzie." + (g.id ? " Zmiana drużyn lub doboru losuje kadry od nowa." : "") }
    ];
  }

  // Najbliższa sobota 10:00 (a jeśli są już mecze — pierwsza sobota po ostatnim), typowy termin kolejki w lidze amatorskiej.
  #nextSaturday() {
    const last = this.state.games.reduce((max, g) => Math.max(max, new Date(g.startsAt).getTime()), Date.now());
    const d = new Date(last);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
  }

  #scheduleForm() {
    const { state, api, forms, notifier } = this;
    const n = state.teams.length, rounds = n % 2 ? n : n - 1, perRound = Math.floor(n / 2);
    if (n < 2) throw new Error("Do ułożenia terminarza potrzebne są co najmniej 2 drużyny — dodaj je w panelu „Drużyny”.");
    const played = state.games.filter((g) => g.homeScore !== null).length, planned = state.games.length - played;
    forms.open("Ułóż terminarz", [
      { name: "system", label: "System rozgrywek", text: true, value: "double",
        options: state.templates.scheduleSystems.map((s) => [s.id, s.name]),
        hint: `${n} drużyn → ${rounds} kolejek w rundzie po ${perRound} mecz(e)${n % 2 ? ", w każdej kolejce jedna drużyna pauzuje" : ""}. ` +
          "Kolejność drużyn jest losowana, gospodarze rozkładają się po równo. " +
          state.templates.scheduleSystems.map((s) => `${s.name}: ${s.description}`).join(" ") },
      { name: "firstGameAt", label: "Pierwszy mecz", type: "datetime-local", required: true, value: this.#nextSaturday() },
      { name: "roundIntervalDays", label: "Dni między kolejkami", type: "number", min: 0, max: 60, required: true, value: 7,
        hint: "7 = kolejka co tydzień, 14 = co dwa tygodnie, 0 = turniej jednego dnia (kolejki jedna po drugiej)." },
      { name: "gameIntervalMinutes", label: "Minuty między meczami w kolejce", type: "number", min: 0, max: 1440, required: true, value: 90,
        hint: "Mecze kolejki jeden po drugim na jednym boisku; 0 = wszystkie o tej samej godzinie (kilka boisk)." },
      { name: "venue", label: "Miejsce (opcjonalnie)", maxLength: 120 },
      ...this.#lineupFields({}),
      ...(state.games.length ? [{
        name: "existing", label: `Istniejące mecze: ${played} rozegranych, ${planned} zaplanowanych`, text: true, value: "keep",
        options: [
          ["keep", "Zostaw je i dopisz brakujące pary"],
          ["replace", "Usuń zaplanowane i ułóż je od nowa"]
        ],
        hint: "Rozegrane mecze zawsze zostają i liczą się jako odbyte pary. Nowe mecze dostają kolejne numery kolejek."
      }] : [])
    ], async (d) => {
      const r = await api(`/api/seasons/${state.season.id}/schedule`, "POST", d);
      notifier.show(r.games ? `Dodano ${r.games} mecz(e/ów) w ${r.rounds} kolejkach.`
        : "Terminarz jest kompletny — wszystkie pary mają już swoje mecze.", true);
    });
  }

  #gameForm(title, g, save) {
    const teams = this.state.teams.map((t) => [t.id, t.name]);
    this.forms.open(title, [
      { name: "homeTeamId", label: "Gospodarz", options: teams, value: g.homeTeamId ?? teams[0]?.[0] },
      { name: "awayTeamId", label: "Gość", options: teams, value: g.awayTeamId ?? teams[1]?.[0] },
      { name: "startsAt", label: "Termin", type: "datetime-local", required: true, value: g.startsAt?.slice(0, 16) },
      { name: "venue", label: "Miejsce (opcjonalnie)", maxLength: 120, value: g.venue },
      ...this.#lineupFields(g)
    ], save);
  }
}
