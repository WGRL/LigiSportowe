import { $, esc } from "../core/dom.js";
import { day } from "../core/format.js";
import { NEXT_STATUS, STATUS } from "../core/constants.js";
import { btn, empty } from "./components.js";
import { View } from "./View.js";

/** Szczegóły wybranej ligi: opis, wybór sezonu, jego stan i akcje organizatora. */
export class LeagueView extends View {
  render() {
    const { state } = this, { league, season, seasons } = state;
    $("[data-action=edit-league]").hidden = !state.isOrganizer();
    $("#league-name").textContent = league?.name ?? "Wybierz ligę";
    $("#league-sport").textContent = league?.sport ?? "Liga";
    if (!league) {
      $("#league-info").innerHTML = empty("◎", "Nie wybrano ligi.");
      return;
    }
    const dates = season && (season.startsOn || season.endsOn) ? `${day(season.startsOn)} – ${day(season.endsOn)}` : "termin nieustalony";
    const squad = season?.teamSize == null ? "skład: cała drużyna"
      : `skład: ${season.teamSize} + ${season.benchSize == null ? "rezerwowi" : `maks. ${season.benchSize} rez.`}`;
    $("#league-info").innerHTML = `
      ${league.description ? `<p class="muted">${esc(league.description)}</p>` : ""}
      <p class="muted">Organizator: <strong>${esc(league.organizer)}</strong></p>
      ${season ? `
        <label class="field">Sezon
          <select id="season-select">${seasons.map((s) =>
            `<option value="${s.id}"${s.id === season.id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
        </label>
        <div class="toolbar">
          <span class="status-pill status-${esc(season.status)}">${STATUS[season.status]}</span>
          <small class="muted">${dates} · punkty Z/R/P: ${season.pointsWin}/${season.pointsDraw}/${season.pointsLoss} · ${squad}</small>
        </div>` : `<p class="muted">Liga nie ma jeszcze sezonu.</p>`}
      ${state.isOrganizer() ? `<div class="toolbar">
        ${btn("new-season", "", "Nowy sezon")}
        ${season?.status === "preparation" ? btn("edit-season", season.id, "Parametry sezonu") : ""}
        ${season && NEXT_STATUS[season.status] ? btn("advance-season", season.id, NEXT_STATUS[season.status], true) : ""}
      </div>` : ""}`;
  }
}
