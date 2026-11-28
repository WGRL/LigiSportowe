import { $, esc } from "../core/dom.js";
import { formatDate } from "../core/format.js";
import { btn, empty } from "./components.js";
import { View } from "./View.js";

/** Terminarz (mecze nierozegrane) i wyniki (rozegrane), z rozwijaną kadrą meczową. */
export class GamesView extends View {
  render() {
    const { state } = this, { season } = state;
    const status = season?.status;
    const organizer = state.isOrganizer();
    $("[data-action=new-game]").hidden = !(organizer && season && season.status !== "finished" && state.teams.length > 1);
    $("[data-action=generate-schedule]").hidden = !(organizer && season && season.status !== "finished");

    const canEdit = organizer && status !== "finished";
    const canScore = organizer && status === "ongoing";
    const lineupBtn = (g) => state.user ? btn("toggle-game", g.id, g.id === state.openGame ? "Ukryj kadrę" : "Kadra") : "";
    const item = (g, actions) => `<div class="team"><div class="list-item">
        <span><strong>${esc(g.homeTeam)} — ${esc(g.awayTeam)}</strong>
          <small>${g.round ? `Kolejka ${g.round} · ` : ""}${formatDate(g.startsAt)}${g.venue ? ` · ${esc(g.venue)}` : ""}</small></span>
        <span class="toolbar">${actions}${lineupBtn(g)}</span></div>
        ${g.id === state.openGame ? this.#lineup(g) : ""}</div>`;
    const upcoming = state.games.filter((g) => g.homeScore === null);
    const played = state.games.filter((g) => g.homeScore !== null).reverse();

    $("#schedule-list").innerHTML = upcoming.length
      ? `<div class="list">${upcoming.map((g) => item(g,
          (canScore ? btn("set-result", g.id, "Wynik", true) : "") +
          (canEdit ? btn("edit-game", g.id, "Edytuj") + btn("delete-game", g.id, "Usuń") : ""))).join("")}</div>`
      : empty("◷", organizer && state.teams.length > 1 && status !== "finished"
          ? "Brak zaplanowanych spotkań. Użyj „Ułóż terminarz”, aby wygenerować mecze każdy z każdym."
          : "Brak zaplanowanych spotkań.");

    $("#result-list").innerHTML = played.length
      ? `<div class="list">${played.map((g) => item(g,
          `<strong class="score">${g.homeScore}:${g.awayScore}</strong>` +
          (canScore ? btn("set-result", g.id, "Popraw") : ""))).join("")}</div>`
      : empty("✓", status === "preparation" ? "Wyniki można wpisywać po rozpoczęciu sezonu." : "Brak rozegranych spotkań.");
  }

  #lineup(g) {
    const { state } = this;
    const format = state.formatOf(g.lineupFormat), strategy = state.strategyOf(g.lineupStrategy);
    const canDraw = g.homeScore === null && state.season?.status !== "finished";
    const person = (p) => `<li><span title="Nazwa użytkownika: ${esc(p.username)}">${esc(p.displayName || p.username)}${p.isCaptain ? ' <span class="status-pill">Kapitan</span>' : ""}</span></li>`;
    const side = (teamId, name) => {
      const rows = state.lineup.filter((p) => p.teamId === teamId);
      const starters = rows.filter((p) => p.role === "starter"), subs = rows.filter((p) => p.role === "substitute");
      const short = format && starters.length < format.starters;
      return `<div class="lineup-side">
        <div class="lineup-head"><strong>${esc(name)}</strong>
          ${canDraw && state.canManageTeam(teamId) ? btn("draw-lineup", g.id, "Losuj ponownie", false, teamId) : ""}</div>
        <p class="lineup-label">Pierwszy skład ${format ? `(${starters.length}/${format.starters})` : ""}
          ${short ? '<span class="status-pill status-preparation">Niepełny skład</span>' : ""}</p>
        <ul class="roster">${starters.map(person).join("") || '<li class="muted">Brak zawodników — dodaj ich do drużyny i wylosuj kadrę ponownie.</li>'}</ul>
        ${subs.length ? `<p class="lineup-label">Rezerwowi (${subs.length}/${format?.substitutes ?? "?"})</p>
          <ul class="roster">${subs.map(person).join("")}</ul>` : ""}
      </div>`;
    };
    return `<div class="lineup">
      <p class="muted lineup-meta">${esc(format?.name ?? g.lineupFormat)} · dobór: <span title="${esc(strategy?.description)}">${esc(strategy?.name ?? g.lineupStrategy)}</span>
        ${canDraw && state.isOrganizer() ? btn("draw-lineup", g.id, "Losuj obie kadry") : ""}</p>
      <div class="lineup-grid">${side(g.homeTeamId, g.homeTeam)}${side(g.awayTeamId, g.awayTeam)}</div>
    </div>`;
  }
}
