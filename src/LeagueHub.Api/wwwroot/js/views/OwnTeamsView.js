import { $, esc } from "../core/dom.js";
import { btn, empty, personName } from "./components.js";
import { View } from "./View.js";

/** Drużyny poza ligą zalogowanego użytkownika, z rozwijanym składem i zaproszeniami. */
export class OwnTeamsView extends View {
  render() {
    const { state } = this;
    $("[data-action=new-own-team]").hidden = !state.user;
    $("#own-team-list").innerHTML = !state.user
      ? empty("◎", "Zaloguj się, aby założyć własną drużynę i zapraszać do niej znajomych.")
      : state.ownTeams.length
        ? `<div class="list">${state.ownTeams.map((t) => {
            const open = t.id === state.openOwnTeam, owner = state.isOwner(t);
            return `<div class="team">
              <div class="list-item">
                <span><strong>${esc(t.name)}</strong>${owner ? ' <span class="status-pill">Właściciel</span>' : ""}
                  <small>Założyciel: ${esc(t.owner)} · zawodników: ${t.players}</small></span>
                <span class="toolbar">
                  ${owner ? btn("rename-own-team", t.id, "Zmień nazwę") + btn("delete-own-team", t.id, "Usuń") : btn("leave-own-team", t.id, "Opuść")}
                  ${btn("toggle-own-team", t.id, open ? "Ukryj skład" : "Skład")}
                </span>
              </div>
              ${open ? this.#roster(t, owner) : ""}
            </div>`;
          }).join("")}</div>`
        : empty("◎", "Nie należysz do żadnej drużyny poza ligą. Załóż ją przyciskiem +.");
  }

  #roster(t, owner) {
    const { members, invitations } = this.state.ownRoster;
    const rows = members.map((p) => `<li>
        <span>${personName(p)}${p.isOwner ? ' <span class="status-pill">Właściciel</span>' : ""}</span>
        ${owner && !p.isOwner ? `<span class="toolbar">${btn("remove-own-member", t.id, "Usuń", false, p.id)}</span>` : ""}</li>`).join("");
    const pending = invitations.map((p) => `<li>
        <span>${personName(p)} <span class="status-pill status-preparation">Zaproszony</span></span>
        <span class="toolbar">${btn("cancel-invitation", t.id, "Wycofaj", false, p.id)}</span></li>`).join("");
    return `<ul class="roster">${rows}${pending}</ul>
      ${owner ? `<div class="toolbar roster-actions">${btn("invite-player", t.id, "Zaproś zawodnika", true)}</div>` : ""}`;
  }
}
