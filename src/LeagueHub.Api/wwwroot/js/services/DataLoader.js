/**
 * Pobiera dane z API do stanu i po każdym pełnym załadowaniu odświeża widok.
 * Kolejność ładowania: sesja → dane użytkownika → ligi → wybrana liga → sezon → otwarte składy/kadry.
 */
export class DataLoader {
  constructor(api, state, view) {
    this.api = api;
    this.state = state;
    this.view = view;
  }

  async refreshSession() {
    const { api, state } = this;
    if (!state.templates.formats.length) state.templates = await api("/api/lineup-templates");
    const me = await api("/api/auth/me");
    state.user = me.authenticated ? me : null;
    await this.loadMine();
    await this.loadLeagues(state.league?.id);
  }

  // Dane zalogowanego użytkownika: drużyny w ligach, drużyny poza ligą, zaproszenia.
  async loadMine() {
    const { api, state } = this;
    [state.myTeams, state.ownTeams] = state.user
      ? await Promise.all([api("/api/me/teams"), api("/api/independent-teams"), this.loadNotifications()])
      : [[], [], state.setNotifications({})];
    if (!state.ownTeams.some((t) => t.id === state.openOwnTeam)) state.openOwnTeam = null;
    state.ownRoster = state.openOwnTeam
      ? await api(`/api/independent-teams/${state.openOwnTeam}/members`)
      : { members: [], invitations: [] };
  }

  async loadLeagues(selectId) {
    const { api, state } = this;
    state.leagues = await api("/api/leagues");
    const league = state.leagues.find((l) => l.id === selectId) ?? state.leagues[0];
    league ? await this.selectLeague(league.id) : this.view.render();
  }

  async selectLeague(id, seasonId) {
    const { api, state } = this;
    if (state.league?.id !== id) state.openTeam = state.openGame = null;
    state.league = state.leagues.find((l) => l.id === id);
    [state.seasons, state.teams, state.leagueTeamInvites] = await Promise.all([
      api(`/api/leagues/${id}/seasons`), api(`/api/leagues/${id}/teams`),
      state.isOrganizer() ? api(`/api/leagues/${id}/invitations`) : []
    ]);
    if (!state.team(state.openTeam)) state.openTeam = null;
    await this.selectSeason(seasonId);
  }

  async selectSeason(id) {
    const { api, state } = this;
    if (state.season?.id !== id) state.openGame = null;
    const s = state.season = state.seasons.find((x) => x.id === id) ?? state.seasons[0] ?? null;
    [state.games, state.standings] = s
      ? await Promise.all([api(`/api/seasons/${s.id}/games`), api(`/api/seasons/${s.id}/standings`)])
      : [[], []];
    await this.loadPlayers();
  }

  async loadPlayers() {
    const { api, state } = this;
    if (state.openGame && !state.game(state.openGame)) state.openGame = null;
    [state.players, state.lineup] = await Promise.all([
      state.openTeam && state.user ? api(`/api/teams/${state.openTeam}/players`) : [],
      state.openGame && state.user ? api(`/api/games/${state.openGame}/lineup`) : []
    ]);
    this.view.render();
  }

  async loadNotifications() {
    this.state.setNotifications(await this.api("/api/notifications"));
  }

  /** Ponowne pobranie wszystkiego, co mogło się zmienić po akcji użytkownika, z zachowaniem wybranej ligi i sezonu. */
  async reload() {
    const { state } = this;
    await this.loadMine();
    state.league ? await this.selectLeague(state.league.id, state.season?.id) : this.view.render();
  }
}
