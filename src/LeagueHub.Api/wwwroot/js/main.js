// Punkt wejścia: tworzy obiekty aplikacji, łączy je zależnościami i uruchamia pierwsze ładowanie.
//
//   core/      — narzędzia bez stanu: DOM, formatowanie, stałe, klient API
//   state/     — AppState: dane aplikacji i zapytania o nie
//   services/  — DataLoader (API → stan → widok), NotificationPoller
//   views/     — widoki paneli (tylko renderowanie HTML ze stanu)
//   ui/        — elementy interaktywne: formularz, logowanie, komunikaty, dyspozytor akcji
//   actions/   — kontrolery: co robi każdy przycisk z data-action

import { ApiClient } from "./core/ApiClient.js";
import { $ } from "./core/dom.js";
import { NOTIFICATIONS_POLL_MS } from "./core/constants.js";
import { AppState } from "./state/AppState.js";
import { DataLoader } from "./services/DataLoader.js";
import { NotificationPoller } from "./services/NotificationPoller.js";
import { AppView } from "./views/AppView.js";
import { ActionDispatcher } from "./ui/ActionDispatcher.js";
import { AuthDialog } from "./ui/AuthDialog.js";
import { FormDialog } from "./ui/FormDialog.js";
import { Notifier } from "./ui/Notifier.js";
import { SessionController } from "./actions/SessionController.js";
import { LeagueController } from "./actions/LeagueController.js";
import { TeamController } from "./actions/TeamController.js";
import { GameController } from "./actions/GameController.js";
import { OwnTeamController } from "./actions/OwnTeamController.js";
import { NotificationController } from "./actions/NotificationController.js";

const client = new ApiClient();
const api = (url, method, body) => client.request(url, method, body);
const state = new AppState();
const view = new AppView(state);
const loader = new DataLoader(api, state, view);
const notifier = new Notifier();
const forms = new FormDialog(() => loader.reload());
const auth = new AuthDialog(api, () => loader.refreshSession());

const context = { state, api, loader, view, forms, notifier, auth };
const leagues = new LeagueController(context);
const dispatcher = new ActionDispatcher(notifier);
for (const controller of [new SessionController(context), leagues, new TeamController(context),
  new GameController(context), new OwnTeamController(context), new NotificationController(context)]) {
  dispatcher.register(controller.handlers());
}
dispatcher.listen(document);

document.addEventListener("change", (event) => {
  if (event.target.id === "season-select") notifier.run(() => leagues.selectSeason(Number(event.target.value)));
});

// Kliknięcie w tło okna dialogowego zamyka je.
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}

new NotificationPoller(state, loader, view, NOTIFICATIONS_POLL_MS).start();
notifier.run(() => loader.refreshSession());
