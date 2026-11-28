import { $ } from "../core/dom.js";
import { Controller } from "./Controller.js";

/** Okno powiadomień: odpowiedzi na zaproszenia do drużyn i lig oraz zamykanie powiadomień informacyjnych. */
export class NotificationController extends Controller {
  handlers() {
    const { state, api, loader, notifier } = this;
    return {
      "open-notifications": async () => {
        $("#notifications-dialog").showModal();
        await this.#refresh();
      },
      "accept-invitation": async ({ id }) => {
        const invitation = state.invitations.find((i) => i.id === id);
        await api(`/api/invitations/${id}/accept`, "POST");
        state.openOwnTeam = invitation?.teamId ?? state.openOwnTeam;
        await loader.reload();
        notifier.show(`Dołączono do drużyny ${invitation?.team ?? ""}.`, true);
      },
      "reject-invitation": async ({ id }) => {
        await api(`/api/invitations/${id}/reject`, "POST");
        await loader.reload();
      },
      "accept-league-invitation": async ({ id }) => {
        const invitation = state.leagueInvitations.find((i) => i.id === id);
        const { leagueId } = await api(`/api/league-invitations/${id}/accept`, "POST");
        state.league = { id: leagueId };
        await loader.refreshSession();
        notifier.show(`Drużyna ${invitation?.team ?? ""} dołączyła do ligi ${invitation?.league ?? ""}.`, true);
      },
      "reject-league-invitation": async ({ id }) => {
        await api(`/api/league-invitations/${id}/reject`, "POST");
        await loader.reload();
      },
      "dismiss-notification": async ({ id }) => {
        await api(`/api/notifications/${id}`, "DELETE");
        await this.#refresh();
      },
      "dismiss-all-notifications": async () => {
        await api("/api/notifications", "DELETE");
        await this.#refresh();
      }
    };
  }

  async #refresh() {
    await this.loader.loadNotifications();
    this.view.notifications.render();
  }
}
