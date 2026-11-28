import { $, esc } from "../core/dom.js";
import { formatDate } from "../core/format.js";
import { btn, empty } from "./components.js";
import { View } from "./View.js";

/** Licznik na przycisku z dzwonkiem i lista w oknie powiadomień. */
export class NotificationsView extends View {
  render() {
    const { invitations, leagueInvitations, messages } = this.state;
    const count = invitations.length + leagueInvitations.length + messages.length;
    $("#notifications-badge").textContent = count > 9 ? "9+" : count;
    $("#notifications-badge").hidden = !count;
    $("#notifications-button").setAttribute("aria-label", count ? `Powiadomienia: ${count} nowe` : "Powiadomienia");
    const section = (title, items, extra = "") => items.length
      ? `<div class="notifications-head"><p class="lineup-label">${title}</p>${extra}</div><div class="list">${items.join("")}</div>` : "";
    const item = (title, text, at, actions) => `<div class="list-item invitation">
        <span><strong>${title}</strong><small>${text} · ${formatDate(at)}</small></span>
        <span class="toolbar">${actions}</span></div>`;
    $("#notifications-list").innerHTML = count
      ? section("Zaproszenia do drużyn", invitations.map((i) => item(esc(i.team), `${esc(i.invitedBy)} zaprasza Cię do drużyny`, i.createdAt,
          btn("accept-invitation", i.id, "Akceptuj", true) + btn("reject-invitation", i.id, "Odrzuć")))) +
        section("Zaproszenia do lig", leagueInvitations.map((i) => item(esc(i.league),
          `${esc(i.invitedBy)} zaprasza Twoją drużynę <strong>${esc(i.team)}</strong> do ligi (${esc(i.sport)})`, i.createdAt,
          btn("accept-league-invitation", i.id, "Akceptuj", true) + btn("reject-league-invitation", i.id, "Odrzuć")))) +
        section("Powiadomienia", messages.map((m) => item(esc(m.message), "", m.createdAt, btn("dismiss-notification", m.id, "OK"))),
          messages.length > 1 ? `<button class="text-button" type="button" data-action="dismiss-all-notifications">Wyczyść wszystkie</button>` : "")
      : empty("✉", "Brak nowych powiadomień.");
  }
}
