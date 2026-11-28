import { $ } from "../core/dom.js";
import { View } from "./View.js";

/** Nagłówek (przyciski konta) i karta podsumowania. */
export class HeaderView extends View {
  render() {
    const { state } = this, { user } = state;
    $("#user-label").textContent = user?.displayName ?? "";
    $("#user-label").hidden = !user;
    $("#login-button").hidden = !!user;
    $("#profile-button").hidden = !user;
    $("#logout-button").hidden = !user;
    $("#notifications-button").hidden = !user;
    $("#league-count").textContent = state.leagues.length;
    $("#upcoming-count").textContent = state.games.filter((g) => g.homeScore === null).length;
    $("#my-teams").textContent = user ? state.myTeams.length + state.ownTeams.length : "—";
  }
}
