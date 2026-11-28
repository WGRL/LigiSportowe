import { $, esc } from "../core/dom.js";
import { formatDate } from "../core/format.js";
import { btn, empty, personName } from "./components.js";
import { View } from "./View.js";

/** Drużyny wybranej ligi, rozwijany skład i (dla organizatora) oczekujące zaproszenia drużyn spoza ligi. */
export class TeamsView extends View {
  render() {
    const { state } = this, org = state.isOrganizer();
    $("[data-action=new-team]").hidden = !org;
    $("[data-action=invite-team]").hidden = !org;
    $("#team-list").innerHTML = state.teams.length
      ? `<div class="list">${state.teams.map((t) => {
          const open = t.id === state.openTeam, manage = state.canManageTeam(t.id);
          const mine = state.myTeams.some((m) => m.id === t.id);
          return `<div class="team">
            <div class="list-item">
              <span><strong>${esc(t.name)}</strong>${mine ? ' <span class="status-pill">Moja drużyna</span>' : ""}
                ${t.independentTeamId ? ' <span class="status-pill status-muted" title="Dołączyła z zaproszenia do ligi">Spoza ligi</span>' : ""}
                <small>Kapitan: ${t.captain ? esc(t.captain) : "brak"} · zawodników: ${t.players}</small></span>
              <span class="toolbar">
                ${manage ? btn("rename-team", t.id, "Zmień nazwę") : ""}
                ${org ? btn("remove-team", t.id, "Usuń z ligi") : ""}
                ${state.user ? btn("toggle-team", t.id, open ? "Ukryj skład" : "Skład") : ""}
              </span>
            </div>
            ${open ? this.#roster(t.id, org, manage) : ""}
          </div>`;
        }).join("")}</div>`
      : empty("◎", org ? "Dodaj drużyny przyciskiem + albo zaproś drużynę spoza ligi." : "Brak drużyn w tej lidze.");
    if (org && state.leagueTeamInvites.length) $("#team-list").insertAdjacentHTML("beforeend", this.#pendingInvitations());
  }

  #roster(teamId, org, manage) {
    const { players, teamPending } = this.state;
    const pending = manage ? teamPending.map((p) => `<li>
        <span>${personName(p)} <span class="status-pill status-preparation">Zaproszony</span></span>
        <span class="toolbar">${btn("cancel-team-invitation", teamId, "Wycofaj", false, p.id)}</span></li>`).join("") : "";
    const rows = players.map((p) => `<li>
        <span title="Nazwa użytkownika: ${esc(p.username)}">${esc(p.displayName || p.username)}${p.isCaptain ? ' <span class="status-pill">Kapitan</span>' : ""}</span>
        <span class="toolbar">
          ${org && !p.isCaptain ? btn("make-captain", teamId, "Ustaw kapitanem", false, p.id) : ""}
          ${manage ? btn("remove-player", teamId, "Usuń", false, p.id) : ""}
        </span></li>`).join("");
    return `<ul class="roster">${rows || '<li class="muted">Brak zawodników.</li>'}${pending}</ul>
      ${manage ? `<div class="toolbar roster-actions">${btn("add-player", teamId, "Zaproś zawodnika", true)}</div>` : ""}`;
  }

  #pendingInvitations() {
    return `
      <p class="lineup-label">Zaproszone drużyny — czekają na odpowiedź kapitana</p>
      <div class="list">${this.state.leagueTeamInvites.map((i) => `<div class="list-item">
        <span><strong>${esc(i.team)}</strong> <span class="status-pill status-preparation">Zaproszona</span>
          <small>Kapitan: <span title="Nazwa użytkownika: ${esc(i.captainUsername)}">${esc(i.captain)}</span> · ${formatDate(i.createdAt)}</small></span>
        <span class="toolbar">${btn("cancel-league-invitation", i.id, "Wycofaj")}</span></div>`).join("")}</div>`;
  }
}
