"use strict";

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STATUS = { preparation: "Przygotowanie", ongoing: "Trwający", finished: "Zakończony" };
const NEXT_STATUS = { preparation: "Rozpocznij sezon", ongoing: "Zakończ sezon" };

const state = {
  user: null, myTeams: [], leagues: [], league: null, seasons: [], season: null,
  teams: [], games: [], standings: [], openTeam: null, players: [],
  templates: { formats: [], strategies: [], scheduleSystems: [] }, openGame: null, lineup: [],
  // Drużyny poza ligą i zaproszenia do nich (powiadomienia).
  ownTeams: [], openOwnTeam: null, ownRoster: { members: [], invitations: [] }, invitations: [],
  // Zaproszenia do lig (dla właściciela drużyny), powiadomienia informacyjne, oczekujące zaproszenia ligi (dla organizatora).
  leagueInvitations: [], messages: [], leagueTeamInvites: []
};

// Domyślny format kadry zgadywany z dyscypliny ligi (organizator może go zmienić).
const SPORT_FORMATS = [
  [/3\s*[x×]\s*3/i, "basketball3x3"], [/kosz|basket/i, "basketball"], [/siatk|volley/i, "volleyball"],
  [/futsal|hal/i, "futsal"], [/orlik|szóst|siódem|7/i, "football7"], [/ręczn|handball/i, "handball"],
  [/hokej|hockey/i, "hockey"]
];
const defaultFormat = () => SPORT_FORMATS.find(([re]) => re.test(state.league?.sport ?? ""))?.[1] ?? "football11";
const formatOf = (id) => state.templates.formats.find((f) => f.id === id);
const strategyOf = (id) => state.templates.strategies.find((s) => s.id === id);

// ---------- API ----------
async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const fallback = { 401: "Zaloguj się, aby to zrobić.", 429: "Zbyt wiele prób — spróbuj za minutę." }[res.status];
    throw Object.assign(new Error(data?.message || fallback || "Nie udało się wykonać operacji."), { status: res.status });
  }
  return data;
}

// ---------- Uprawnienia (serwer i tak sprawdza je ponownie) ----------
const isOrganizer = () => !!state.user && state.league?.organizerId === state.user.id;
const canManageTeam = (teamId) => isOrganizer() || state.myTeams.some((t) => t.id === teamId && t.isCaptain);
const team = (id) => state.teams.find((t) => t.id === id);
const game = (id) => state.games.find((g) => g.id === id);

// ---------- Ładowanie danych ----------
async function refreshSession() {
  if (!state.templates.formats.length) state.templates = await api("/api/lineup-templates");
  const me = await api("/api/auth/me");
  state.user = me.authenticated ? me : null;
  await loadMine();
  await loadLeagues(state.league?.id);
}

// Dane zalogowanego użytkownika: drużyny w ligach, drużyny poza ligą, zaproszenia.
async function loadMine() {
  [state.myTeams, state.ownTeams] = state.user
    ? await Promise.all([api("/api/me/teams"), api("/api/independent-teams"), loadNotifications()])
    : [[], [], setNotifications({})];
  if (!state.ownTeams.some((t) => t.id === state.openOwnTeam)) state.openOwnTeam = null;
  state.ownRoster = state.openOwnTeam
    ? await api(`/api/independent-teams/${state.openOwnTeam}/members`)
    : { members: [], invitations: [] };
}

async function loadLeagues(selectId) {
  state.leagues = await api("/api/leagues");
  const league = state.leagues.find((l) => l.id === selectId) ?? state.leagues[0];
  league ? await selectLeague(league.id) : render();
}

async function selectLeague(id, seasonId) {
  if (state.league?.id !== id) state.openTeam = state.openGame = null;
  state.league = state.leagues.find((l) => l.id === id);
  [state.seasons, state.teams, state.leagueTeamInvites] = await Promise.all([
    api(`/api/leagues/${id}/seasons`), api(`/api/leagues/${id}/teams`),
    isOrganizer() ? api(`/api/leagues/${id}/invitations`) : []
  ]);
  if (!team(state.openTeam)) state.openTeam = null;
  await selectSeason(seasonId);
}

async function selectSeason(id) {
  if (state.season?.id !== id) state.openGame = null;
  const s = state.season = state.seasons.find((x) => x.id === id) ?? state.seasons[0] ?? null;
  [state.games, state.standings] = s
    ? await Promise.all([api(`/api/seasons/${s.id}/games`), api(`/api/seasons/${s.id}/standings`)])
    : [[], []];
  await loadPlayers();
}

async function loadPlayers() {
  if (state.openGame && !game(state.openGame)) state.openGame = null;
  [state.players, state.lineup] = await Promise.all([
    state.openTeam && state.user ? api(`/api/teams/${state.openTeam}/players`) : [],
    state.openGame && state.user ? api(`/api/games/${state.openGame}/lineup`) : []
  ]);
  render();
}

async function loadNotifications() {
  setNotifications(await api("/api/notifications"));
}

function setNotifications({ invitations = [], leagueInvitations = [], messages = [] }) {
  Object.assign(state, { invitations, leagueInvitations, messages });
}

async function reload() {
  await loadMine();
  state.league ? await selectLeague(state.league.id, state.season?.id) : render();
}

// ---------- Widok ----------
const empty = (icon, text) =>
  `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><p>${esc(text)}</p></div>`;
const btn = (action, id, label, primary = false, user = "") =>
  `<button class="button button-${primary ? "primary" : "ghost"} button-small" type="button" data-action="${action}" data-id="${id}" data-user="${user}">${label}</button>`;
const formatDate = (value) =>
  new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const day = (value) => value?.slice(0, 10) ?? "…";

function render() {
  const { user, season } = state;
  $("#user-label").textContent = user?.displayName ?? "";
  $("#user-label").hidden = !user;
  $("#login-button").hidden = !!user;
  $("#profile-button").hidden = !user;
  $("#logout-button").hidden = !user;
  $("#notifications-button").hidden = !user;
  renderNotifications();
  $("#league-count").textContent = state.leagues.length;
  $("#upcoming-count").textContent = state.games.filter((g) => g.homeScore === null).length;
  $("#my-teams").textContent = user ? state.myTeams.length + state.ownTeams.length : "—";
  $("[data-action=new-league]").hidden = !user;
  $("[data-action=new-own-team]").hidden = !user;
  $("[data-action=edit-league]").hidden = !isOrganizer();
  $("[data-action=new-team]").hidden = !isOrganizer();
  $("[data-action=invite-team]").hidden = !isOrganizer();
  $("[data-action=new-game]").hidden = !(isOrganizer() && season && season.status !== "finished" && state.teams.length > 1);
  $("[data-action=generate-schedule]").hidden = !(isOrganizer() && season && season.status !== "finished");
  renderLeagues();
  renderLeague();
  renderStandings();
  renderGames();
  renderTeams();
  renderOwnTeams();
}

function renderLeagues() {
  $("#league-list").innerHTML = state.leagues.length
    ? `<div class="list">${state.leagues.map((l) => `
        <button class="list-item list-button${l.id === state.league?.id ? " active" : ""}" type="button" data-action="select-league" data-id="${l.id}">
          <span><strong>${esc(l.name)}</strong><small>${esc(l.sport)} · organizator: ${esc(l.organizer)}</small></span>
        </button>`).join("")}</div>`
    : empty("◇", state.user ? "Brak lig. Utwórz pierwszą przyciskiem +." : "Brak lig. Zaloguj się, aby utworzyć ligę.");
}

function renderLeague() {
  const { league, season, seasons } = state;
  $("#league-name").textContent = league?.name ?? "Wybierz ligę";
  $("#league-sport").textContent = league?.sport ?? "Liga";
  if (!league) {
    $("#league-info").innerHTML = empty("◎", "Nie wybrano ligi.");
    return;
  }
  const dates = season && (season.startsOn || season.endsOn) ? `${day(season.startsOn)} – ${day(season.endsOn)}` : "termin nieustalony";
  $("#league-info").innerHTML = `
    ${league.description ? `<p class="muted">${esc(league.description)}</p>` : ""}
    <p class="muted">Organizator: <strong>${esc(league.organizer)}</strong></p>
    ${season ? `
      <label class="field">Sezon
        <select id="season-select">${seasons.map((s) =>
          `<option value="${s.id}"${s.id === season.id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      </label>
      <div class="toolbar">
        <span class="status-pill status-${esc(season.status)}">${STATUS[season.status]}</span>
        <small class="muted">${dates} · punkty Z/R/P: ${season.pointsWin}/${season.pointsDraw}/${season.pointsLoss}</small>
      </div>` : `<p class="muted">Liga nie ma jeszcze sezonu.</p>`}
    ${isOrganizer() ? `<div class="toolbar">
      ${btn("new-season", "", "Nowy sezon")}
      ${season?.status === "preparation" ? btn("edit-season", season.id, "Parametry sezonu") : ""}
      ${season && NEXT_STATUS[season.status] ? btn("advance-season", season.id, NEXT_STATUS[season.status], true) : ""}
    </div>` : ""}`;
}

function renderStandings() {
  const rows = state.standings;
  $("#standings-table").innerHTML = rows.length
    ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>#</th><th class="left">Drużyna</th><th title="Mecze">M</th><th title="Zwycięstwa">Z</th>
          <th title="Remisy">R</th><th title="Porażki">P</th><th>Bramki</th><th title="Różnica bramek">+/−</th><th>Pkt</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr>
          <td>${i + 1}</td><td class="left">${esc(r.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td>
          <td>${r.lost}</td><td>${r.goalsFor}:${r.goalsAgainst}</td><td>${r.goalsFor - r.goalsAgainst}</td><td><strong>${r.points}</strong></td>
        </tr>`).join("")}</tbody></table></div>`
    : empty("▤", state.season ? "Tabela pojawi się po dodaniu meczów do terminarza." : "Brak sezonu.");
}

function renderGames() {
  const status = state.season?.status;
  const canEdit = isOrganizer() && status !== "finished";
  const canScore = isOrganizer() && status === "ongoing";
  const lineupBtn = (g) => state.user ? btn("toggle-game", g.id, g.id === state.openGame ? "Ukryj kadrę" : "Kadra") : "";
  const item = (g, actions) => `<div class="team"><div class="list-item">
      <span><strong>${esc(g.homeTeam)} — ${esc(g.awayTeam)}</strong>
        <small>${g.round ? `Kolejka ${g.round} · ` : ""}${formatDate(g.startsAt)}${g.venue ? ` · ${esc(g.venue)}` : ""}</small></span>
      <span class="toolbar">${actions}${lineupBtn(g)}</span></div>
      ${g.id === state.openGame ? renderLineup(g) : ""}</div>`;
  const upcoming = state.games.filter((g) => g.homeScore === null);
  const played = state.games.filter((g) => g.homeScore !== null).reverse();

  $("#schedule-list").innerHTML = upcoming.length
    ? `<div class="list">${upcoming.map((g) => item(g,
        (canScore ? btn("set-result", g.id, "Wynik", true) : "") +
        (canEdit ? btn("edit-game", g.id, "Edytuj") + btn("delete-game", g.id, "Usuń") : ""))).join("")}</div>`
    : empty("◷", isOrganizer() && state.teams.length > 1 && status !== "finished"
        ? "Brak zaplanowanych spotkań. Użyj „Ułóż terminarz”, aby wygenerować mecze każdy z każdym."
        : "Brak zaplanowanych spotkań.");

  $("#result-list").innerHTML = played.length
    ? `<div class="list">${played.map((g) => item(g,
        `<strong class="score">${g.homeScore}:${g.awayScore}</strong>` +
        (canScore ? btn("set-result", g.id, "Popraw") : ""))).join("")}</div>`
    : empty("✓", status === "preparation" ? "Wyniki można wpisywać po rozpoczęciu sezonu." : "Brak rozegranych spotkań.");
}

function renderLineup(g) {
  const format = formatOf(g.lineupFormat), strategy = strategyOf(g.lineupStrategy);
  const canDraw = g.homeScore === null && state.season?.status !== "finished";
  const person = (p) => `<li><span title="Nazwa użytkownika: ${esc(p.username)}">${esc(p.displayName || p.username)}${p.isCaptain ? ' <span class="status-pill">Kapitan</span>' : ""}</span></li>`;
  const side = (teamId, name) => {
    const rows = state.lineup.filter((p) => p.teamId === teamId);
    const starters = rows.filter((p) => p.role === "starter"), subs = rows.filter((p) => p.role === "substitute");
    const short = format && starters.length < format.starters;
    return `<div class="lineup-side">
      <div class="lineup-head"><strong>${esc(name)}</strong>
        ${canDraw && canManageTeam(teamId) ? btn("draw-lineup", g.id, "Losuj ponownie", false, teamId) : ""}</div>
      <p class="lineup-label">Pierwszy skład ${format ? `(${starters.length}/${format.starters})` : ""}
        ${short ? '<span class="status-pill status-preparation">Niepełny skład</span>' : ""}</p>
      <ul class="roster">${starters.map(person).join("") || '<li class="muted">Brak zawodników — dodaj ich do drużyny i wylosuj kadrę ponownie.</li>'}</ul>
      ${subs.length ? `<p class="lineup-label">Rezerwowi (${subs.length}/${format?.substitutes ?? "?"})</p>
        <ul class="roster">${subs.map(person).join("")}</ul>` : ""}
    </div>`;
  };
  return `<div class="lineup">
    <p class="muted lineup-meta">${esc(format?.name ?? g.lineupFormat)} · dobór: <span title="${esc(strategy?.description)}">${esc(strategy?.name ?? g.lineupStrategy)}</span>
      ${canDraw && isOrganizer() ? btn("draw-lineup", g.id, "Losuj obie kadry") : ""}</p>
    <div class="lineup-grid">${side(g.homeTeamId, g.homeTeam)}${side(g.awayTeamId, g.awayTeam)}</div>
  </div>`;
}

function renderTeams() {
  const org = isOrganizer();
  $("#team-list").innerHTML = state.teams.length
    ? `<div class="list">${state.teams.map((t) => {
        const open = t.id === state.openTeam, manage = canManageTeam(t.id);
        const mine = state.myTeams.some((m) => m.id === t.id);
        return `<div class="team">
          <div class="list-item">
            <span><strong>${esc(t.name)}</strong>${mine ? ' <span class="status-pill">Moja drużyna</span>' : ""}
              ${t.independentTeamId ? ' <span class="status-pill status-muted" title="Dołączyła z zaproszenia do ligi">Spoza ligi</span>' : ""}
              <small>Kapitan: ${t.captain ? esc(t.captain) : "brak"} · zawodników: ${t.players}</small></span>
            <span class="toolbar">
              ${manage ? btn("rename-team", t.id, "Zmień nazwę") : ""}
              ${org ? btn("remove-team", t.id, "Usuń z ligi") : ""}
              ${state.user ? btn("toggle-team", t.id, open ? "Ukryj skład" : "Skład") : ""}
            </span>
          </div>
          ${open ? renderRoster(t.id, org, manage) : ""}
        </div>`;
      }).join("")}</div>`
    : empty("◎", org ? "Dodaj drużyny przyciskiem + albo zaproś drużynę spoza ligi." : "Brak drużyn w tej lidze.");
  if (org && state.leagueTeamInvites.length) $("#team-list").insertAdjacentHTML("beforeend", `
    <p class="lineup-label">Zaproszone drużyny — czekają na odpowiedź kapitana</p>
    <div class="list">${state.leagueTeamInvites.map((i) => `<div class="list-item">
      <span><strong>${esc(i.team)}</strong> <span class="status-pill status-preparation">Zaproszona</span>
        <small>Kapitan: <span title="Nazwa użytkownika: ${esc(i.captainUsername)}">${esc(i.captain)}</span> · ${formatDate(i.createdAt)}</small></span>
      <span class="toolbar">${btn("cancel-league-invitation", i.id, "Wycofaj")}</span></div>`).join("")}</div>`);
}

function renderRoster(teamId, org, manage) {
  const rows = state.players.map((p) => `<li>
      <span title="Nazwa użytkownika: ${esc(p.username)}">${esc(p.displayName || p.username)}${p.isCaptain ? ' <span class="status-pill">Kapitan</span>' : ""}</span>
      <span class="toolbar">
        ${org && !p.isCaptain ? btn("make-captain", teamId, "Ustaw kapitanem", false, p.id) : ""}
        ${manage ? btn("remove-player", teamId, "Usuń", false, p.id) : ""}
      </span></li>`).join("");
  return `<ul class="roster">${rows || '<li class="muted">Brak zawodników.</li>'}</ul>
    ${manage ? `<div class="toolbar roster-actions">${btn("add-player", teamId, "Dodaj zawodnika", true)}</div>` : ""}`;
}

// ---------- Drużyny poza ligą ----------
const isOwner = (t) => !!state.user && t.ownerId === state.user.id;
const ownTeam = (id) => state.ownTeams.find((t) => t.id === id);
const personName = (p) => `<span title="Nazwa użytkownika: ${esc(p.username)}">${esc(p.displayName || p.username)}</span>`;

function renderOwnTeams() {
  $("#own-team-list").innerHTML = !state.user
    ? empty("◎", "Zaloguj się, aby założyć własną drużynę i zapraszać do niej znajomych.")
    : state.ownTeams.length
      ? `<div class="list">${state.ownTeams.map((t) => {
          const open = t.id === state.openOwnTeam, owner = isOwner(t);
          return `<div class="team">
            <div class="list-item">
              <span><strong>${esc(t.name)}</strong>${owner ? ' <span class="status-pill">Właściciel</span>' : ""}
                <small>Założyciel: ${esc(t.owner)} · zawodników: ${t.players}</small></span>
              <span class="toolbar">
                ${owner ? btn("rename-own-team", t.id, "Zmień nazwę") + btn("delete-own-team", t.id, "Usuń") : btn("leave-own-team", t.id, "Opuść")}
                ${btn("toggle-own-team", t.id, open ? "Ukryj skład" : "Skład")}
              </span>
            </div>
            ${open ? renderOwnRoster(t, owner) : ""}
          </div>`;
        }).join("")}</div>`
      : empty("◎", "Nie należysz do żadnej drużyny poza ligą. Załóż ją przyciskiem +.");
}

function renderOwnRoster(t, owner) {
  const { members, invitations } = state.ownRoster;
  const rows = members.map((p) => `<li>
      <span>${personName(p)}${p.isOwner ? ' <span class="status-pill">Właściciel</span>' : ""}</span>
      ${owner && !p.isOwner ? `<span class="toolbar">${btn("remove-own-member", t.id, "Usuń", false, p.id)}</span>` : ""}</li>`).join("");
  const pending = invitations.map((p) => `<li>
      <span>${personName(p)} <span class="status-pill status-preparation">Zaproszony</span></span>
      <span class="toolbar">${btn("cancel-invitation", t.id, "Wycofaj", false, p.id)}</span></li>`).join("");
  return `<ul class="roster">${rows}${pending}</ul>
    ${owner ? `<div class="toolbar roster-actions">${btn("invite-player", t.id, "Zaproś zawodnika", true)}</div>` : ""}`;
}

// ---------- Powiadomienia (zaproszenia) ----------
function renderNotifications() {
  const { invitations, leagueInvitations, messages } = state;
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

// Sprawdzanie nowych zaproszeń w tle (bez komunikatów o błędach, np. po wygaśnięciu sesji).
setInterval(async () => {
  if (!state.user || document.hidden) return;
  try {
    await loadNotifications();
    renderNotifications();
  } catch { /* spróbujemy przy następnym odświeżeniu */ }
}, 30000);

// ---------- Uniwersalny formularz ----------
let formSubmit = null, formGeneration = 0;

function openForm(title, fields, submit) {
  formGeneration++;
  $("#form-title").textContent = title;
  $("#form-message").textContent = "";
  $("#form-fields").replaceChildren(...fields.map((f) => {
    const label = document.createElement("label");
    const input = document.createElement(f.options ? "select" : "input");
    label.append(f.label, input);
    if (f.hint) label.append(Object.assign(document.createElement("small"), { className: "hint", textContent: f.hint }));
    input.name = f.name;
    if (f.options) input.append(...f.options.map(([value, text]) => new Option(text, value)));
    else input.type = f.type ?? "text";
    if (f.text) input.dataset.text = "1";
    for (const key of ["required", "min", "max", "maxLength", "readOnly"]) if (f[key] !== undefined) input[key] = f[key];
    if (input.type === "checkbox") {
      input.checked = !!f.value;
      label.classList.add("checkbox");
      label.prepend(input);
    } else input.value = f.value ?? "";
    return label;
  }));
  formSubmit = async (data) => { await submit(data); await reload(); };
  $("#form-dialog").showModal();
}

$("#edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = {};
  for (const el of event.currentTarget.elements) {
    if (!el.name || el.readOnly) continue;
    if (el.type === "checkbox") { data[el.name] = el.checked; continue; }
    const numeric = el.type === "number" || (el.tagName === "SELECT" && !el.dataset.text);
    data[el.name] = el.value === "" ? null : numeric ? Number(el.value) : el.value;
  }
  const generation = formGeneration;
  try {
    await formSubmit(data);
    if (generation === formGeneration) $("#form-dialog").close();
  } catch (error) {
    $("#form-message").textContent = error.message;
  }
});

const leagueForm = (title, l, save) => openForm(title, [
  { name: "name", label: "Nazwa", required: true, maxLength: 100, value: l.name },
  { name: "sport", label: "Dyscyplina", required: true, maxLength: 60, value: l.sport },
  { name: "description", label: "Opis (opcjonalnie)", maxLength: 500, value: l.description }
], save);

const seasonForm = (title, s, save) => openForm(title, [
  { name: "name", label: "Nazwa sezonu (np. Wiosna 2026)", required: true, maxLength: 80, value: s.name },
  { name: "startsOn", label: "Początek", type: "date", value: s.startsOn?.slice(0, 10) },
  { name: "endsOn", label: "Koniec", type: "date", value: s.endsOn?.slice(0, 10) },
  { name: "pointsWin", label: "Punkty za zwycięstwo", type: "number", min: 0, max: 10, required: true, value: s.pointsWin },
  { name: "pointsDraw", label: "Punkty za remis", type: "number", min: 0, max: 10, required: true, value: s.pointsDraw },
  { name: "pointsLoss", label: "Punkty za porażkę", type: "number", min: 0, max: 10, required: true, value: s.pointsLoss }
], save);

const lineupFields = (g) => [
  { name: "lineupFormat", label: "Format kadry meczowej", text: true, value: g.lineupFormat ?? defaultFormat(),
    options: state.templates.formats.map((f) => [f.id, `${f.name} — ${f.starters} + ${f.substitutes} rez.`]) },
  { name: "lineupStrategy", label: "Dobór zawodników", text: true, value: g.lineupStrategy ?? "rotation",
    options: state.templates.strategies.map((s) => [s.id, s.name]),
    hint: state.templates.strategies.map((s) => `${s.name}: ${s.description}`).join(" ") +
      " Kapitan zawsze wychodzi w pierwszym składzie." + (g.id ? " Zmiana drużyn, formatu lub doboru losuje kadry od nowa." : "") }
];

// Najbliższa sobota 10:00 (a jeśli są już mecze — pierwsza sobota po ostatnim), typowy termin kolejki w lidze amatorskiej.
function nextSaturday() {
  const last = state.games.reduce((max, g) => Math.max(max, new Date(g.startsAt).getTime()), Date.now());
  const d = new Date(last);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

function scheduleForm() {
  const n = state.teams.length, rounds = n % 2 ? n : n - 1, perRound = Math.floor(n / 2);
  if (n < 2) throw new Error("Do ułożenia terminarza potrzebne są co najmniej 2 drużyny — dodaj je w panelu „Drużyny”.");
  const played = state.games.filter((g) => g.homeScore !== null).length, planned = state.games.length - played;
  openForm("Ułóż terminarz", [
    { name: "system", label: "System rozgrywek", text: true, value: "double",
      options: state.templates.scheduleSystems.map((s) => [s.id, s.name]),
      hint: `${n} drużyn → ${rounds} kolejek w rundzie po ${perRound} mecz(e)${n % 2 ? ", w każdej kolejce jedna drużyna pauzuje" : ""}. ` +
        "Kolejność drużyn jest losowana, gospodarze rozkładają się po równo. " +
        state.templates.scheduleSystems.map((s) => `${s.name}: ${s.description}`).join(" ") },
    { name: "firstGameAt", label: "Pierwszy mecz", type: "datetime-local", required: true, value: nextSaturday() },
    { name: "roundIntervalDays", label: "Dni między kolejkami", type: "number", min: 0, max: 60, required: true, value: 7,
      hint: "7 = kolejka co tydzień, 14 = co dwa tygodnie, 0 = turniej jednego dnia (kolejki jedna po drugiej)." },
    { name: "gameIntervalMinutes", label: "Minuty między meczami w kolejce", type: "number", min: 0, max: 1440, required: true, value: 90,
      hint: "Mecze kolejki jeden po drugim na jednym boisku; 0 = wszystkie o tej samej godzinie (kilka boisk)." },
    { name: "venue", label: "Miejsce (opcjonalnie)", maxLength: 120 },
    ...lineupFields({}),
    ...(state.games.length ? [{
      name: "existing", label: `Istniejące mecze: ${played} rozegranych, ${planned} zaplanowanych`, text: true, value: "keep",
      options: [
        ["keep", "Zostaw je i dopisz brakujące pary"],
        ["replace", "Usuń zaplanowane i ułóż je od nowa"]
      ],
      hint: "Rozegrane mecze zawsze zostają i liczą się jako odbyte pary. Nowe mecze dostają kolejne numery kolejek."
    }] : [])
  ], async (d) => {
    const r = await api(`/api/seasons/${state.season.id}/schedule`, "POST", d);
    notify(r.games ? `Dodano ${r.games} mecz(e/ów) w ${r.rounds} kolejkach.`
      : "Terminarz jest kompletny — wszystkie pary mają już swoje mecze.", true);
  });
}

function gameForm(title, g, save) {
  const teams = state.teams.map((t) => [t.id, t.name]);
  openForm(title, [
    { name: "homeTeamId", label: "Gospodarz", options: teams, value: g.homeTeamId ?? teams[0]?.[0] },
    { name: "awayTeamId", label: "Gość", options: teams, value: g.awayTeamId ?? teams[1]?.[0] },
    { name: "startsAt", label: "Termin", type: "datetime-local", required: true, value: g.startsAt?.slice(0, 16) },
    { name: "venue", label: "Miejsce (opcjonalnie)", maxLength: 120, value: g.venue },
    ...lineupFields(g)
  ], save);
}

// ---------- Akcje ----------
const actions = {
  "login": () => openAuth("login"),
  "show-register": () => setAuthView("register"),
  "show-login": () => setAuthView("login"),
  "close-dialog": (_, el) => el.closest("dialog").close(),
  "edit-profile": () => openForm("Edytuj nazwę wyświetlaną",
    [
      { name: "username", label: "Nazwa użytkownika — użyj jej do zaproszeń", value: state.user?.username, readOnly: true },
      { name: "displayName", label: "Nazwa wyświetlana", required: true, maxLength: 100, value: state.user?.displayName }
    ],
    async (d) => {
      await api("/api/auth/profile", "PUT", d);
      await refreshSession();
    }),
  "logout": async () => {
    await api("/api/auth/logout", "POST");
    state.openTeam = state.openOwnTeam = null;
    await refreshSession();
  },
  "select-league": ({ id }) => selectLeague(id),
  "open-notifications": async () => {
    $("#notifications-dialog").showModal();
    await loadNotifications();
    renderNotifications();
  },
  "accept-league-invitation": async ({ id }) => {
    const invitation = state.leagueInvitations.find((i) => i.id === id);
    const { leagueId } = await api(`/api/league-invitations/${id}/accept`, "POST");
    state.league = { id: leagueId };
    await refreshSession();
    notify(`Drużyna ${invitation?.team ?? ""} dołączyła do ligi ${invitation?.league ?? ""}.`, true);
  },
  "reject-league-invitation": async ({ id }) => {
    await api(`/api/league-invitations/${id}/reject`, "POST");
    await reload();
  },
  "dismiss-notification": async ({ id }) => {
    await api(`/api/notifications/${id}`, "DELETE");
    await loadNotifications();
    renderNotifications();
  },
  "dismiss-all-notifications": async () => {
    await api("/api/notifications", "DELETE");
    await loadNotifications();
    renderNotifications();
  },
  "invite-team": () => openForm(`Zaproś drużynę do ligi ${state.league.name}`,
    [{ name: "username", label: "Nazwa użytkownika kapitana", required: true, maxLength: 32,
       hint: "Kapitan to właściciel drużyny poza ligą. W następnym kroku wybierzesz jego drużynę." }],
    async ({ username }) => {
      const teams = await api(`/api/users/${encodeURIComponent(username.trim())}/independent-teams`);
      if (!teams.length) throw new Error(`Użytkownik ${username} nie jest kapitanem żadnej drużyny poza ligą.`);
      openForm(`Zaproś drużynę do ligi ${state.league.name}`, [
        { name: "independentTeamId", label: `Drużyna użytkownika ${username}`, value: teams[0].id,
          options: teams.map((t) => [t.id, `${t.name} — zawodników: ${t.players}`]),
          hint: "Kapitan dostanie zaproszenie w powiadomieniach. Po akceptacji drużyna dołączy do ligi z całym składem." }
      ], async (d) => {
        await api(`/api/leagues/${state.league.id}/invitations`, "POST", d);
        notify("Wysłano zaproszenie do ligi.", true);
      });
    }),
  "cancel-league-invitation": async ({ id }) => {
    await api(`/api/leagues/${state.league.id}/invitations/${id}`, "DELETE");
    await reload();
  },
  "remove-team": async ({ id }) => {
    if (!confirm(`Usunąć drużynę ${team(id).name} z ligi? Jej zaplanowane mecze zostaną usunięte, a zawodnicy dostaną powiadomienie.`)) return;
    await api(`/api/teams/${id}`, "DELETE");
    await reload();
    notify(`Usunięto drużynę z ligi.`, true);
  },
  "accept-invitation": async ({ id }) => {
    const invitation = state.invitations.find((i) => i.id === id);
    await api(`/api/invitations/${id}/accept`, "POST");
    state.openOwnTeam = invitation?.teamId ?? state.openOwnTeam;
    await reload();
    notify(`Dołączono do drużyny ${invitation?.team ?? ""}.`, true);
  },
  "reject-invitation": async ({ id }) => {
    await api(`/api/invitations/${id}/reject`, "POST");
    await reload();
  },
  "new-own-team": () => openForm("Nowa drużyna poza ligą", [{ name: "name", label: "Nazwa", required: true, maxLength: 60,
      hint: "Zostaniesz jej właścicielem i będziesz zapraszać zawodników po nazwie użytkownika." }],
    async (d) => { state.openOwnTeam = (await api("/api/independent-teams", "POST", d)).id; }),
  "rename-own-team": ({ id }) => openForm("Zmień nazwę drużyny",
    [{ name: "name", label: "Nazwa", required: true, maxLength: 60, value: ownTeam(id).name }],
    (d) => api(`/api/independent-teams/${id}`, "PUT", d)),
  "delete-own-team": async ({ id }) => {
    if (!confirm(`Usunąć drużynę ${ownTeam(id).name}? Zawodnicy i zaproszenia zostaną usunięci.`)) return;
    await api(`/api/independent-teams/${id}`, "DELETE");
    await reload();
  },
  "leave-own-team": async ({ id }) => {
    if (!confirm(`Opuścić drużynę ${ownTeam(id).name}?`)) return;
    await api(`/api/independent-teams/${id}/members/${state.user.id}`, "DELETE");
    await reload();
  },
  "toggle-own-team": ({ id }) => {
    state.openOwnTeam = state.openOwnTeam === id ? null : id;
    return reload();
  },
  "invite-player": ({ id }) => openForm(`Zaproś zawodnika — ${ownTeam(id).name}`,
    [{ name: "username", label: "Nazwa użytkownika", required: true, maxLength: 32,
       hint: "Zaproszenie trafi do powiadomień tej osoby — może je zaakceptować lub odrzucić." }],
    async (d) => {
      await api(`/api/independent-teams/${id}/invitations`, "POST", d);
      notify(`Wysłano zaproszenie do ${d.username}.`, true);
    }),
  "cancel-invitation": async ({ id, user }) => {
    await api(`/api/independent-teams/${id}/invitations/${user}`, "DELETE");
    await reload();
  },
  "remove-own-member": async ({ id, user }) => {
    if (!confirm("Usunąć zawodnika z drużyny?")) return;
    await api(`/api/independent-teams/${id}/members/${user}`, "DELETE");
    await reload();
  },
  "new-league": () => leagueForm("Nowa liga", {}, async (d) => {
    const { id } = await api("/api/leagues", "POST", d);
    state.leagues = await api("/api/leagues");
    state.league = { id };
  }),
  "edit-league": () => leagueForm("Edytuj ligę", state.league, async (d) => {
    await api(`/api/leagues/${state.league.id}`, "PUT", d);
    state.leagues = await api("/api/leagues");
  }),
  "new-season": () => seasonForm("Nowy sezon", { pointsWin: 3, pointsDraw: 1, pointsLoss: 0 }, async (d) => {
    const { id } = await api(`/api/leagues/${state.league.id}/seasons`, "POST", d);
    state.season = { id };
  }),
  "edit-season": ({ id }) => seasonForm("Parametry sezonu", state.season, (d) => api(`/api/seasons/${id}`, "PUT", d)),
  "advance-season": async ({ id }) => {
    if (!confirm(`${NEXT_STATUS[state.season.status]}? Tej zmiany nie można cofnąć.`)) return;
    await api(`/api/seasons/${id}/advance`, "POST");
    await reload();
  },
  "new-team": () => openForm("Nowa drużyna", [{ name: "name", label: "Nazwa", required: true, maxLength: 60 }],
    (d) => api(`/api/leagues/${state.league.id}/teams`, "POST", d)),
  "rename-team": ({ id }) => openForm("Zmień nazwę drużyny",
    [{ name: "name", label: "Nazwa", required: true, maxLength: 60, value: team(id).name }],
    (d) => api(`/api/teams/${id}`, "PUT", d)),
  "toggle-team": ({ id }) => {
    state.openTeam = state.openTeam === id ? null : id;
    return loadPlayers();
  },
  "add-player": ({ id }) => openForm(`Dodaj zawodnika — ${team(id).name}`,
    [{ name: "username", label: "Nazwa użytkownika (konto musi istnieć)", required: true, maxLength: 32 }],
    (d) => api(`/api/teams/${id}/players`, "POST", d)),
  "remove-player": async ({ id, user }) => {
    if (!confirm("Usunąć zawodnika z drużyny?")) return;
    await api(`/api/teams/${id}/players/${user}`, "DELETE");
    await reload();
  },
  "make-captain": async ({ id, user }) => {
    await api(`/api/teams/${id}/captain`, "PUT", { userId: user });
    await reload();
  },
  "new-game": () => gameForm("Nowy mecz", {}, async (d) => {
    const { id } = await api(`/api/seasons/${state.season.id}/games`, "POST", d);
    state.openGame = id;
  }),
  "generate-schedule": () => scheduleForm(),
  "toggle-game": ({ id }) => {
    state.openGame = state.openGame === id ? null : id;
    return loadPlayers();
  },
  "draw-lineup": async ({ id, user: teamId }) => {
    const both = !teamId;
    if (!confirm(both ? "Wylosować od nowa kadry obu drużyn?" : `Wylosować od nowa kadrę: ${team(teamId)?.name}?`)) return;
    await api(`/api/games/${id}/lineup/draw`, "POST", { teamId: both ? null : teamId });
    await loadPlayers();
  },
  "edit-game": ({ id }) => gameForm("Edytuj mecz", game(id), (d) => api(`/api/games/${id}`, "PUT", d)),
  "delete-game": async ({ id }) => {
    if (!confirm("Usunąć mecz z terminarza?")) return;
    await api(`/api/games/${id}`, "DELETE");
    await reload();
  },
  "set-result": ({ id }) => {
    const g = game(id);
    openForm(`Wynik: ${g.homeTeam} — ${g.awayTeam}`, [
      { name: "homeScore", label: g.homeTeam, type: "number", min: 0, max: 999, value: g.homeScore },
      { name: "awayScore", label: g.awayTeam, type: "number", min: 0, max: 999, value: g.awayScore }
    ], (d) => api(`/api/games/${id}/result`, "PUT", d));
  }
};

function notify(message, success = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.classList.toggle("notice-success", success);
  notice.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => (notice.hidden = true), 6000);
}

async function run(fn) {
  try {
    await fn();
  } catch (error) {
    notify(error.message);
  }
}

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const action = actions[el.dataset.action];
  if (action) run(() => action({ id: Number(el.dataset.id), user: Number(el.dataset.user) }, el));
});

document.addEventListener("change", (event) => {
  if (event.target.id === "season-select") run(() => selectSeason(Number(event.target.value)));
});

for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}

// ---------- Logowanie i rejestracja ----------
function openAuth(view) {
  setAuthView(view);
  $("#auth-dialog").showModal();
}

function setAuthView(view) {
  $("#login-view").hidden = view !== "login";
  $("#register-view").hidden = view === "login";
  $("#login-message").textContent = $("#register-message").textContent = "";
  $("#login-message").classList.remove("success");
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const username = String(data.get("username") ?? "").trim();
  const password = String(data.get("password") ?? "");
  $("#login-message").classList.remove("success");
  if (!username) {
    $("#login-message").textContent = "Podaj nazwę użytkownika.";
    return;
  }
  if (!password) {
    $("#login-message").textContent = "Podaj hasło.";
    return;
  }
  try {
    await api("/api/auth/login", "POST", { username, password });
    form.reset();
    $("#auth-dialog").close();
    await refreshSession();
  } catch (error) {
    $("#login-message").textContent = error.status === 401 ? "Nieprawidłowa nazwa użytkownika lub hasło." : error.message;
  }
});

$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const username = String(data.get("username") ?? "").trim();
  const displayName = String(data.get("displayName") ?? "").trim();
  const password = String(data.get("password") ?? "");
  const passwordRepeat = String(data.get("passwordRepeat") ?? "");
  const message = $("#register-message");
  message.classList.remove("success");
  message.textContent = "";

  if (!username) {
    message.textContent = "Podaj nazwę użytkownika.";
    return;
  }
  if (username.length < 3) {
    message.textContent = "Nazwa użytkownika musi mieć co najmniej 3 znaki.";
    return;
  }
  if (username.length > 32) {
    message.textContent = "Nazwa użytkownika może mieć maksymalnie 32 znaki.";
    return;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    message.textContent = "Nazwa użytkownika może zawierać tylko litery, cyfry, kropkę, podkreślenie i myślnik.";
    return;
  }
  if (!displayName) {
    message.textContent = "Podaj nazwę wyświetlaną.";
    return;
  }
  if (displayName.length > 100) {
    message.textContent = "Nazwa wyświetlana może mieć maksymalnie 100 znaków.";
    return;
  }
  if (password.length < 8) {
    message.textContent = "Hasło musi mieć co najmniej 8 znaków.";
    return;
  }
  if (new TextEncoder().encode(password).length > 72) {
    message.textContent = "Hasło może mieć maksymalnie 72 bajty.";
    return;
  }
  if (!/[A-Z]/.test(password) || !/\d/.test(password)) {
    message.textContent = "Hasło musi zawierać co najmniej 1 wielką literę i 1 cyfrę.";
    return;
  }
  if (password !== passwordRepeat) {
    message.textContent = "Hasła nie są takie same.";
    return;
  }
  try {
    await api("/api/auth/register", "POST", { username, displayName, password });
    form.reset();
    setAuthView("login");
    $("#login-form").elements.username.value = data.get("username");
    $("#login-message").textContent = "Konto utworzone. Możesz się zalogować.";
    $("#login-message").classList.add("success");
  } catch (error) {
    $("#register-message").textContent = error.message;
  }
});

run(refreshSession);
