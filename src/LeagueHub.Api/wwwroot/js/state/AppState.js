import { SPORT_FORMATS } from "../core/constants.js";

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
  templates = { formats: [], strategies: [], scheduleSystems: [] };
  openGame = null;
  lineup = [];
  // Drużyny poza ligą i zaproszenia do nich (powiadomienia).
  ownTeams = [];
  openOwnTeam = null;
  ownRoster = { members: [], invitations: [] };
  invitations = [];
  // Zaproszenia do lig (dla właściciela drużyny), powiadomienia informacyjne, oczekujące zaproszenia ligi (dla organizatora).
  leagueInvitations = [];
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

  // ---------- Szablony kadry meczowej ----------
  defaultFormat() { return SPORT_FORMATS.find(([re]) => re.test(this.league?.sport ?? ""))?.[1] ?? "football11"; }
  formatOf(id) { return this.templates.formats.find((f) => f.id === id); }
  strategyOf(id) { return this.templates.strategies.find((s) => s.id === id); }

  setNotifications({ invitations = [], leagueInvitations = [], messages = [] }) {
    Object.assign(this, { invitations, leagueInvitations, messages });
  }
}
