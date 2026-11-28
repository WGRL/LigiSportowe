import { $, esc } from "../core/dom.js";
import { empty } from "./components.js";
import { View } from "./View.js";

/** Lista lig. */
export class LeaguesView extends View {
  render() {
    const { state } = this;
    $("[data-action=new-league]").hidden = !state.user;
    $("#league-list").innerHTML = state.leagues.length
      ? `<div class="list">${state.leagues.map((l) => `
          <button class="list-item list-button${l.id === state.league?.id ? " active" : ""}" type="button" data-action="select-league" data-id="${l.id}">
            <span><strong>${esc(l.name)}</strong><small>${esc(l.sport)} · organizator: ${esc(l.organizer)}</small></span>
          </button>`).join("")}</div>`
      : empty("◇", state.user ? "Brak lig. Utwórz pierwszą przyciskiem +." : "Brak lig. Zaloguj się, aby utworzyć ligę.");
  }
}
