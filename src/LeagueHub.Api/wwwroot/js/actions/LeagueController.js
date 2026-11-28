import { NEXT_STATUS } from "../core/constants.js";
import { Controller } from "./Controller.js";

/** Ligi i sezony: wybór, tworzenie, edycja, zmiana stanu sezonu. */
export class LeagueController extends Controller {
  handlers() {
    const { state, api, loader } = this;
    return {
      "select-league": ({ id }) => loader.selectLeague(id),
      "new-league": () => this.#leagueForm("Nowa liga", {}, async (d) => {
        const { id } = await api("/api/leagues", "POST", d);
        state.leagues = await api("/api/leagues");
        state.league = { id };
      }),
      "edit-league": () => this.#leagueForm("Edytuj ligę", state.league, async (d) => {
        await api(`/api/leagues/${state.league.id}`, "PUT", d);
        state.leagues = await api("/api/leagues");
      }),
      "new-season": () => this.#seasonForm("Nowy sezon", { pointsWin: 3, pointsDraw: 1, pointsLoss: 0 }, async (d) => {
        const { id } = await api(`/api/leagues/${state.league.id}/seasons`, "POST", d);
        state.season = { id };
      }),
      "edit-season": ({ id }) => this.#seasonForm("Parametry sezonu", state.season, (d) => api(`/api/seasons/${id}`, "PUT", d)),
      "advance-season": async ({ id }) => {
        if (!confirm(`${NEXT_STATUS[state.season.status]}? Tej zmiany nie można cofnąć.`)) return;
        await api(`/api/seasons/${id}/advance`, "POST");
        await loader.reload();
      }
    };
  }

  /** Wybór sezonu z listy rozwijanej (zdarzenie change, nie kliknięcie). */
  selectSeason(id) {
    return this.loader.selectSeason(id);
  }

  #leagueForm(title, l, save) {
    this.forms.open(title, [
      { name: "name", label: "Nazwa", required: true, maxLength: 100, value: l.name },
      { name: "sport", label: "Dyscyplina", required: true, maxLength: 60, value: l.sport },
      { name: "description", label: "Opis (opcjonalnie)", maxLength: 500, value: l.description }
    ], save);
  }

  #seasonForm(title, s, save) {
    this.forms.open(title, [
      { name: "name", label: "Nazwa sezonu (np. Wiosna 2026)", required: true, maxLength: 80, value: s.name },
      { name: "startsOn", label: "Początek", type: "date", value: s.startsOn?.slice(0, 10) },
      { name: "endsOn", label: "Koniec", type: "date", value: s.endsOn?.slice(0, 10) },
      { name: "pointsWin", label: "Punkty za zwycięstwo", type: "number", min: 0, max: 10, required: true, value: s.pointsWin },
      { name: "pointsDraw", label: "Punkty za remis", type: "number", min: 0, max: 10, required: true, value: s.pointsDraw },
      { name: "pointsLoss", label: "Punkty za porażkę", type: "number", min: 0, max: 10, required: true, value: s.pointsLoss }
    ], save);
  }
}
