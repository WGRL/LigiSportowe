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

  // Z rozmiarem składu w sezonie: pierwszy skład i rezerwowi. Bez niego: jedna lista — cała drużyna.
  // Starsze, rozegrane mecze mogą mieć rezerwowych mimo braku rozmiaru — wtedy też pokazujemy podział.
  #lineup(g) {
    const { state } = this, { season } = state;
    const teamSize = season?.teamSize ?? null, benchSize = season?.benchSize ?? null;
    const strategy = state.strategyOf(g.lineupStrategy);
    const canDraw = g.homeScore === null && season?.status !== "finished";
    const noPlayers = '<li class="muted">Brak zawodników — dodaj ich do drużyny i wylosuj kadrę ponownie.</li>';
    const person = (p) => `<li><span title="Nazwa użytkownika: ${esc(p.username)}">${esc(p.displayName || p.username)}${p.isCaptain ? ' <span class="status-pill">Kapitan</span>' : ""}</span></li>`;
    const side = (teamId, name) => {
      const rows = state.lineup.filter((p) => p.teamId === teamId);
      const starters = rows.filter((p) => p.role === "starter"), subs = rows.filter((p) => p.role === "substitute");
      const split = teamSize !== null || subs.length > 0;
      const short = teamSize !== null && starters.length < teamSize;
      const head = `<div class="lineup-head"><strong>${esc(name)}</strong>
          ${canDraw && state.canManageTeam(teamId) ? btn("draw-lineup", g.id, "Losuj ponownie", false, teamId) : ""}</div>`;
      if (!split) return `<div class="lineup-side">${head}
        <p class="lineup-label">Kadra meczowa (${rows.length})</p>
        <ul class="roster">${rows.map(person).join("") || noPlayers}</ul></div>`;
      return `<div class="lineup-side">${head}
        <p class="lineup-label">Pierwszy skład ${teamSize !== null ? `(${starters.length}/${teamSize})` : ""}
          ${short ? '<span class="status-pill status-preparation">Niepełny skład</span>' : ""}</p>
        <ul class="roster">${starters.map(person).join("") || noPlayers}</ul>
        ${subs.length ? `<p class="lineup-label">Rezerwowi (${subs.length}${benchSize !== null ? `/${benchSize}` : ""})</p>
          <ul class="roster">${subs.map(person).join("")}</ul>` : ""}
      </div>`;
    };
    const meta = teamSize === null
      ? "Kadra: cała drużyna (rozmiar składu można ustawić w parametrach sezonu)"
      : `Skład: ${teamSize} + ${benchSize === null ? "rezerwowi" : `maks. ${benchSize} rez.`} · dobór: <span title="${esc(strategy?.description)}">${esc(strategy?.name ?? g.lineupStrategy)}</span>`;
    return `<div class="lineup">
      <p class="muted lineup-meta">${meta}
        ${canDraw && state.isOrganizer() ? btn("draw-lineup", g.id, "Losuj obie kadry") : ""}</p>
      <div class="lineup-grid">${side(g.homeTeamId, g.homeTeam)}${side(g.awayTeamId, g.awayTeam)}</div>
    </div>`;
  }
}
