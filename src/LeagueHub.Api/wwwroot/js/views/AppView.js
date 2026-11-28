import { GamesView } from "./GamesView.js";
import { HeaderView } from "./HeaderView.js";
import { LeaguesView } from "./LeaguesView.js";
import { LeagueView } from "./LeagueView.js";
import { NotificationsView } from "./NotificationsView.js";
import { OwnTeamsView } from "./OwnTeamsView.js";
import { StandingsView } from "./StandingsView.js";
import { TeamsView } from "./TeamsView.js";

/** Cała strona: składa widoki paneli i rysuje je wszystkie naraz. Poszczególne widoki są dostępne też osobno. */
export class AppView {
  constructor(state) {
    this.header = new HeaderView(state);
    this.notifications = new NotificationsView(state);
    this.leagues = new LeaguesView(state);
    this.league = new LeagueView(state);
    this.standings = new StandingsView(state);
    this.games = new GamesView(state);
    this.teams = new TeamsView(state);
    this.ownTeams = new OwnTeamsView(state);
  }

  render() {
    for (const view of [this.header, this.notifications, this.leagues, this.league,
      this.standings, this.games, this.teams, this.ownTeams]) view.render();
  }
}
