"use strict";

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STATUS = { preparation: "Przygotowanie", ongoing: "Trwający", finished: "Zakończony" };
const NEXT_STATUS = { preparation: "Rozpocznij sezon", ongoing: "Zakończ sezon" };

const state = {
  user: null, myTeams: [], leagues: [], league: null, seasons: [], season: null,
  teams: [], games: [], standings: [], openTeam: null, players: []
};

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
  const me = await api("/api/auth/me");
  state.user = me.authenticated ? me : null;
  state.myTeams = state.user ? await api("/api/me/teams") : [];
  await loadLeagues(state.league?.id);
}

async function loadLeagues(selectId) {
  state.leagues = await api("/api/leagues");
  const league = state.leagues.find((l) => l.id === selectId) ?? state.leagues[0];
  league ? await selectLeague(league.id) : render();
}

async function selectLeague(id, seasonId) {
  if (state.league?.id !== id) state.openTeam = null;
  state.league = state.leagues.find((l) => l.id === id);
  [state.seasons, state.teams] = await Promise.all([
    api(`/api/leagues/${id}/seasons`), api(`/api/leagues/${id}/teams`)
  ]);
  await selectSeason(seasonId);
}

async function selectSeason(id) {
  const s = state.season = state.seasons.find((x) => x.id === id) ?? state.seasons[0] ?? null;
  [state.games, state.standings] = s
    ? await Promise.all([api(`/api/seasons/${s.id}/games`), api(`/api/seasons/${s.id}/standings`)])
    : [[], []];
  await loadPlayers();
}

async function loadPlayers() {
  state.players = state.openTeam && state.user ? await api(`/api/teams/${state.openTeam}/players`) : [];
  render();
}

async function reload() {
  state.myTeams = state.user ? await api("/api/me/teams") : [];
  await selectLeague(state.league.id, state.season?.id);
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
  $("#user-label").textContent = user?.username ?? "";
  $("#user-label").hidden = !user;
  $("#login-button").hidden = !!user;
  $("#logout-button").hidden = !user;
  $("#league-count").textContent = state.leagues.length;
  $("#upcoming-count").textContent = state.games.filter((g) => g.homeScore === null).length;
  $("#my-teams").textContent = user ? state.myTeams.length : "—";
  $("[data-action=new-league]").hidden = !user;
  $("[data-action=edit-league]").hidden = !isOrganizer();
  $("[data-action=new-team]").hidden = !isOrganizer();
  $("[data-action=new-game]").hidden = !(isOrganizer() && season && season.status !== "finished" && state.teams.length > 1);
  renderLeagues();
  renderLeague();
  renderStandings();
  renderGames();
  renderTeams();
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
  const item = (g, actions) => `<div class="list-item">
      <span><strong>${esc(g.homeTeam)} — ${esc(g.awayTeam)}</strong>
        <small>${formatDate(g.startsAt)}${g.venue ? ` · ${esc(g.venue)}` : ""}</small></span>
      <span class="toolbar">${actions}</span></div>`;
  const upcoming = state.games.filter((g) => g.homeScore === null);
  const played = state.games.filter((g) => g.homeScore !== null).reverse();

  $("#schedule-list").innerHTML = upcoming.length
    ? `<div class="list">${upcoming.map((g) => item(g,
        (canScore ? btn("set-result", g.id, "Wynik", true) : "") +
        (canEdit ? btn("edit-game", g.id, "Edytuj") + btn("delete-game", g.id, "Usuń") : ""))).join("")}</div>`
    : empty("◷", "Brak zaplanowanych spotkań.");

  $("#result-list").innerHTML = played.length
    ? `<div class="list">${played.map((g) => item(g,
        `<strong class="score">${g.homeScore}:${g.awayScore}</strong>` +
        (canScore ? btn("set-result", g.id, "Popraw") : ""))).join("")}</div>`
    : empty("✓", status === "preparation" ? "Wyniki można wpisywać po rozpoczęciu sezonu." : "Brak rozegranych spotkań.");
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
              <small>Kapitan: ${t.captain ? esc(t.captain) : "brak"} · zawodników: ${t.players}</small></span>
            <span class="toolbar">
              ${manage ? btn("rename-team", t.id, "Zmień nazwę") : ""}
              ${state.user ? btn("toggle-team", t.id, open ? "Ukryj skład" : "Skład") : ""}
            </span>
          </div>
          ${open ? renderRoster(t.id, org, manage) : ""}
        </div>`;
      }).join("")}</div>`
    : empty("◎", org ? "Dodaj drużyny przyciskiem +." : "Brak drużyn w tej lidze.");
}

function renderRoster(teamId, org, manage) {
  const rows = state.players.map((p) => `<li>
      <span>${esc(p.username)}${p.isCaptain ? ' <span class="status-pill">Kapitan</span>' : ""}</span>
      <span class="toolbar">
        ${org && !p.isCaptain ? btn("make-captain", teamId, "Ustaw kapitanem", false, p.id) : ""}
        ${manage ? btn("remove-player", teamId, "Usuń", false, p.id) : ""}
      </span></li>`).join("");
  return `<ul class="roster">${rows || '<li class="muted">Brak zawodników.</li>'}</ul>
    ${manage ? `<div class="toolbar roster-actions">${btn("add-player", teamId, "Dodaj zawodnika", true)}</div>` : ""}`;
}

// ---------- Uniwersalny formularz ----------
let formSubmit = null;

function openForm(title, fields, submit) {
  $("#form-title").textContent = title;
  $("#form-message").textContent = "";
  $("#form-fields").replaceChildren(...fields.map((f) => {
    const label = document.createElement("label");
    const input = document.createElement(f.options ? "select" : "input");
    label.append(f.label, input);
    input.name = f.name;
    if (f.options) input.append(...f.options.map(([value, text]) => new Option(text, value)));
    else input.type = f.type ?? "text";
    for (const key of ["required", "min", "max", "maxLength"]) if (f[key] !== undefined) input[key] = f[key];
    input.value = f.value ?? "";
    return label;
  }));
  formSubmit = async (data) => { await submit(data); await reload(); };
  $("#form-dialog").showModal();
}

$("#edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = {};
  for (const el of event.currentTarget.elements) {
    if (!el.name) continue;
    const numeric = el.type === "number" || el.tagName === "SELECT";
    data[el.name] = el.value === "" ? null : numeric ? Number(el.value) : el.value;
  }
  try {
    await formSubmit(data);
    $("#form-dialog").close();
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

function gameForm(title, g, save) {
  const teams = state.teams.map((t) => [t.id, t.name]);
  openForm(title, [
    { name: "homeTeamId", label: "Gospodarz", options: teams, value: g.homeTeamId ?? teams[0]?.[0] },
    { name: "awayTeamId", label: "Gość", options: teams, value: g.awayTeamId ?? teams[1]?.[0] },
    { name: "startsAt", label: "Termin", type: "datetime-local", required: true, value: g.startsAt?.slice(0, 16) },
    { name: "venue", label: "Miejsce (opcjonalnie)", maxLength: 120, value: g.venue }
  ], save);
}

// ---------- Akcje ----------
const actions = {
  "login": () => openAuth("login"),
  "show-register": () => setAuthView("register"),
  "show-login": () => setAuthView("login"),
  "close-dialog": (_, el) => el.closest("dialog").close(),
  "logout": async () => {
    await api("/api/auth/logout", "POST");
    state.openTeam = null;
    await refreshSession();
  },
  "select-league": ({ id }) => selectLeague(id),
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
  "new-game": () => gameForm("Nowy mecz", {}, (d) => api(`/api/seasons/${state.season.id}/games`, "POST", d)),
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

async function run(fn) {
  try {
    await fn();
  } catch (error) {
    const notice = $("#notice");
    notice.textContent = error.message;
    notice.hidden = false;
    clearTimeout(run.timer);
    run.timer = setTimeout(() => (notice.hidden = true), 5000);
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
    await api("/api/auth/register", "POST", { username, password });
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
