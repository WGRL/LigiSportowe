# LeagueHub

Prosta aplikacja do prowadzenia amatorskich lig sportowych: ligi, sezony, drużyny, składy, terminarz, wyniki i automatycznie liczona tabela.

**Technologie:** ASP.NET Core Minimal API (.NET 10) + Dapper, MySQL 8 / MariaDB, frontend HTML/CSS/JS bez frameworków.

## Uruchomienie

1. Zainstaluj .NET 10 SDK i MariaDB (Arch: `sudo pacman -S mariadb`), potem jednorazowo:

   ```bash
   sudo mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql
   sudo systemctl enable --now mariadb
   ```

2. Pierwsze uruchomienie — tworzy schemat i użytkownika `leaguehub_app` (tylko SELECT/INSERT/UPDATE/DELETE) z podanym hasłem:

   ```bash
   DB_PASSWORD='wymyśl_hasło' ./run.sh --init-db
   ```

   Kolejne: `DB_PASSWORD='to_samo_hasło' ./run.sh`. Aplikacja działa pod `http://localhost:5000`
   (zmiana: `APP_URL`; pozostałe zmienne: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`).

> Schemat zmienił się względem szkieletu. Jeśli masz starą bazę: `DROP DATABASE leaguehub;` i uruchom z `--init-db`.
> Aby zachować dane, zaktualizuj istniejącą bazę: `DB_PASSWORD='to_samo_hasło' ./run.sh --migrate`.
> Migracje można uruchamiać wielokrotnie, a dotychczasowi użytkownicy dostają nazwę wyświetlaną równą nazwie użytkownika.

## Model danych (`database/schema.sql`)

```text
users ──< leagues (organizator) ──< seasons ──< games >── teams (gospodarz/gość)
                                └─< teams ──< team_members >── users  (is_captain)
games ──< game_lineups >── users   (kadra meczowa: pierwszy skład / rezerwowi)
users ──< independent_teams (właściciel) ──< independent_team_members >── users
                                         ├─< team_invitations >── users   (oczekujące zaproszenia do drużyny)
                                         └─< league_invitations >── leagues (oczekujące zaproszenia do ligi)
teams.independent_team_id → independent_teams   (drużyna ligowa powstała z drużyny poza ligą)
users ──< notifications   (powiadomienia informacyjne)
```

- **Liga** to trwały byt; **sezon** ma własne parametry (daty, punktacja Z/R/P) i stan: `preparation → ongoing → finished`.
- Drużyny należą do ligi; tabela sezonu obejmuje drużyny, które mają mecze w terminarzu tego sezonu.
- Baza wymusza spójność: obie drużyny meczu należą do ligi sezonu (złożone FK), zawodnik gra w jednej drużynie na ligę,
  drużyna ma maks. jednego kapitana i jest on jej zawodnikiem, mecz jest rozegrany ⇔ ma oba wyniki.

## Frontend (`src/LeagueHub.Api/wwwroot/js`)

Natywne moduły ES, bez frameworków i bez kroku budowania. Punkt wejścia to `main.js`, który tworzy obiekty i łączy je ze sobą.

```text
core/      ApiClient (fetch + błędy), dom ($, esc), format (daty), constants
state/     AppState — cały stan aplikacji i zapytania o niego (uprawnienia, wyszukiwanie)
services/  DataLoader (API → stan → widok), NotificationPoller (powiadomienia co 30 s)
views/     widok na każdy panel (View → HeaderView, LeaguesView, …), AppView je składa
ui/        FormDialog (formularz z opisu pól), AuthDialog, Notifier, ActionDispatcher
actions/   kontrolery akcji przycisków data-action: Session, League, Team, Game, OwnTeam, Notification
```

Przepływ: kliknięcie elementu z `data-action` → `ActionDispatcher` → handler kontrolera → `ApiClient` →
`DataLoader.reload()` → `AppView.render()`. Widoki tylko rysują HTML ze stanu i niczego nie pobierają.

## Generator terminarza

W panelu „Terminarz” organizator klika **Ułóż terminarz**. System układa mecze „każdy z każdym” z aktualnych drużyn ligi
metodą Bergera, jak w ligach piłkarskich (`Scheduling/RoundRobin.cs`, `POST /api/seasons/{id}/schedule`).

- **Systemy rozgrywek**: jedna runda, mecz i rewanż (runda jesienna i wiosenna), trzy rundy.
  Rewanże idą w tej samej kolejności, ze zamianą gospodarza.
- **Kolejność drużyn jest losowana**, tak jak przy losowaniu terminarza.
  Gospodarze rozkładają się po równo: różnica wynosi najwyżej 1 mecz u siebie, a drużyna gra maks. 2 kolejki z rzędu w tym samym miejscu.
  Przy nieparzystej liczbie drużyn w każdej kolejce jedna pauzuje.
- **Terminy**: pierwszy mecz, odstęp między kolejkami w dniach (7 = co tydzień, 0 = turniej jednego dnia)
  i odstęp między meczami w kolejce w minutach (0 = wszystkie mecze kolejki o tej samej godzinie).
- Każdy mecz dostaje numer kolejki i od razu kadry meczowe (patrz niżej), dobierane chronologicznie, więc rotacja działa przez cały sezon.
- Działa też w trakcie sezonu. Jeśli sezon ma już mecze, organizator wybiera jedną z dwóch opcji:
  **zostaw i dopisz brakujące pary** (np. po dołączeniu nowej drużyny) albo **ułóż zaplanowane od nowa**.
  Rozegrane mecze zawsze zostają i liczą się jako odbyte pary. Nowe mecze dostają kolejne numery kolejek.

## Drużyny poza ligą i zaproszenia

Każdy zalogowany użytkownik może w panelu **„Moje drużyny”** założyć drużynę, która nie należy do żadnej ligi
(`Endpoints/IndependentTeamEndpoints.cs`). Zakładający zostaje jej właścicielem i zaprasza zawodników po **nazwie użytkownika**.

- Jeśli konto o tej nazwie istnieje, zaproszony dostaje powiadomienie. Przycisk z dzwonkiem jest w nagłówku obok przycisków konta,
  a licznik pokazuje oczekujące zaproszenia (odświeżany co 30 s). Zaproszenie można **zaakceptować** albo **odrzucić**.
- Właściciel widzi oczekujące zaproszenia w składzie i może je wycofać. Może też usuwać zawodników, zmieniać nazwę i usunąć drużynę.
- Zawodnik może sam opuścić drużynę. Skład widzą tylko członkowie drużyny.

### Dołączanie do ligi i usuwanie z ligi (`Endpoints/LeagueInvitationEndpoints.cs`)

- Organizator w panelu „Drużyny” klika **Zaproś drużynę spoza ligi**. Wpisuje nazwę użytkownika kapitana, czyli właściciela drużyny,
  i wybiera jedną z jego drużyn. Kapitan dostaje zaproszenie do ligi w powiadomieniach.
- Po akceptacji w lidze powstaje drużyna o tej samej nazwie i ze wszystkimi zawodnikami. Właściciel zostaje kapitanem.
  Organizator i pozostali zawodnicy dostają powiadomienie, a o odrzuceniu zaproszenia dowiaduje się organizator.
  Skład jest kopiowany jednorazowo: późniejsze zmiany w drużynie poza ligą nie zmieniają drużyny ligowej.
- Akceptacja się nie uda, gdy w lidze jest już drużyna o tej nazwie albo któryś zawodnik gra już w innej drużynie tej ligi.
  Zaproszenie wtedy zostaje i można je przyjąć po usunięciu konfliktu. Organizator może wycofać oczekujące zaproszenie.
- **Usuń z ligi** (organizator): drużyna i jej zaplanowane mecze znikają, a **każdy zawodnik dostaje powiadomienie**.
  Drużyny z rozegranymi meczami nie można usunąć, bo zmieniłoby to historię tabeli. Można najpierw cofnąć wyniki w trwającym sezonie.
- Powiadomienia informacyjne zamyka się przyciskiem „OK” albo „Wyczyść wszystkie”.

## Kadra meczowa (automatyczny dobór zawodników)

Po dodaniu meczu każda drużyna od razu dostaje kadrę: pierwszy skład i rezerwowych, wybranych spośród jej zawodników.
Organizator wybiera dla meczu dwie rzeczy (definicje: `Lineups/LineupTemplates.cs`, API: `GET /api/lineup-templates`).

**Format kadry** to liczebność zgodna z typowymi przepisami. Domyślny format jest zgadywany z dyscypliny ligi.

| Format | Skład | Rezerwa |
|---|---|---|
| Piłka nożna 11-osobowa | 11 | 7 |
| Piłka nożna 7-osobowa (orlik) | 7 | 5 |
| Futsal / piłka halowa | 5 | 9 |
| Koszykówka 5×5 / 3×3 | 5 / 3 | 7 / 1 |
| Siatkówka | 6 | 8 |
| Piłka ręczna | 7 | 9 |
| Hokej na lodzie | 6 | 14 |

**Sposób doboru** decyduje o tym, kogo system wybierze:

- **Rotacja** (domyślnie): w pierwszym składzie grają ci, którzy w sezonie najrzadziej w nim wychodzili. Każdy dostaje równe szanse gry.
- **Podstawowy skład**: pierwszeństwo mają zawodnicy z największą liczbą występów w pierwszym składzie, jak „pierwsza jedenastka” trenera.
- **Staż w drużynie**: pierwszeństwo mają zawodnicy, którzy są w drużynie najdłużej.
- **Losowanie**: kadra losowana spośród całego składu.

Kapitan zawsze wychodzi w pierwszym składzie. Remisy w kryterium rozstrzyga losowanie.
Gdy zawodników jest za mało, kadra jest niepełna i interfejs to oznacza.
Przed rozegraniem meczu kadrę można wylosować ponownie: organizator dla obu drużyn, kapitan dla swojej.
Zmiana drużyn, formatu lub sposobu doboru w edycji meczu też losuje kadry od nowa.
Po wpisaniu wyniku kadra zostaje w historii bez zmian.

## Role i uprawnienia

| Rola | Może |
|---|---|
| Gość | przeglądać ligi, sezony, drużyny, terminarz, wyniki i tabelę |
| Zawodnik | j.w. + widzieć składy i swoje drużyny |
| Kapitan | j.w. + zmieniać nazwę drużyny, dodawać/usuwać zawodników, losować ponownie kadrę meczową swojej drużyny |
| Właściciel drużyny poza ligą | zapraszać zawodników, wycofywać zaproszenia, usuwać zawodników, zmieniać nazwę i usuwać drużynę |
| Organizator (twórca ligi) | wszystko w swojej lidze: edycja ligi, sezony i ich stan, drużyny (dodawanie, zapraszanie spoza ligi, usuwanie), kapitanowie, terminarz, wyniki |

Reguły sezonu: parametry edytowalne tylko w przygotowaniu; wyniki wpisywane/poprawiane tylko w trwającym sezonie;
zakończony sezon jest tylko do odczytu; zmiana stanu tylko do przodu.

## Bezpieczeństwo

- Hasła: BCrypt (cost 12); min. 8 znaków, 1 wielka litera, 1 cyfra (maks. 72 bajty — limit BCrypt).
- Sesja: cookie `HttpOnly`, `SameSite=Strict`, `Secure` przy HTTPS; API przyjmuje tylko JSON → ochrona przed CSRF.
- Logowanie w stałym czasie (brak wycieku, czy konto istnieje), limit 10 prób/min/IP dla logowania i rejestracji.
- Uprawnienia sprawdzane w tym samym zapytaniu SQL co zmiana danych; wszystkie zapytania parametryzowane.
- Nagłówki: CSP `default-src 'self'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`; frontend escapuje dane.
- Hasło do bazy tylko w zmiennej środowiskowej. Na produkcji uruchom za reverse proxy z HTTPS.
