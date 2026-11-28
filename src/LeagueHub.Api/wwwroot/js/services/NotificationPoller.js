/** Sprawdza nowe powiadomienia w tle (bez komunikatów o błędach, np. po wygaśnięciu sesji). */
export class NotificationPoller {
  constructor(state, loader, view, intervalMs) {
    Object.assign(this, { state, loader, view, intervalMs });
  }

  start() {
    setInterval(() => this.tick(), this.intervalMs);
  }

  async tick() {
    if (!this.state.user || document.hidden) return;
    try {
      await this.loader.loadNotifications();
      this.view.notifications.render();
    } catch { /* spróbujemy przy następnym odświeżeniu */ }
  }
}
