/**
 * Cały stan aplikacji w jednym miejscu oraz zapytania o niego (selektory).
 * Uprawnienia liczone tutaj służą tylko do ukrywania przycisków — serwer i tak sprawdza je ponownie.
 */
export class AppState {
  user = null;
  myTeams = [];
  leagues = [];
  league = null;
  seasons = [];
  season = null;
  teams = [];
  games = [];
  standings = [];
  openTeam = null;
  players = [];
  teamPending = [];       // oczekujące zaproszenia do otwartej drużyny ligowej (dla kapitana/organizatora)
  templates = { strategies: [], scheduleSystems: [] };
  openGame = null;
  lineup = [];
  // Drużyny poza ligą i zaproszenia do nich (powiadomienia).
  ownTeams = [];
  openOwnTeam = null;
  ownRoster = { members: [], invitations: [] };
  invitations = [];
  // Zaproszenia do lig (dla właściciela drużyny), powiadomienia informacyjne, oczekujące zaproszenia ligi (dla organizatora).
  leagueInvitations = [];
  teamInvitations = [];   // zaproszenia zalogowanego zawodnika do drużyn w ligach
  messages = [];
  leagueTeamInvites = [];

  // ---------- Uprawnienia ----------
  isOrganizer() { return !!this.user && this.league?.organizerId === this.user.id; }
  canManageTeam(teamId) { return this.isOrganizer() || this.myTeams.some((t) => t.id === teamId && t.isCaptain); }
  isOwner(t) { return !!this.user && t.ownerId === this.user.id; }

  // ---------- Wyszukiwanie ----------
  team(id) { return this.teams.find((t) => t.id === id); }
  game(id) { return this.games.find((g) => g.id === id); }
  ownTeam(id) { return this.ownTeams.find((t) => t.id === id); }

  // ---------- Kadra meczowa ----------
  /** Czy sezon dzieli kadrę na pierwszy skład i rezerwowych (organizator podał rozmiar składu). */
  hasSquadSize() { return this.season?.teamSize != null; }
  strategyOf(id) { return this.templates.strategies.find((s) => s.id === id); }

  setNotifications({ invitations = [], leagueInvitations = [], teamInvitations = [], messages = [] }) {
    Object.assign(this, { invitations, leagueInvitations, teamInvitations, messages });
  }

  notificationCount() {
    return this.invitations.length + this.leagueInvitations.length + this.teamInvitations.length + this.messages.length;
  }
}
