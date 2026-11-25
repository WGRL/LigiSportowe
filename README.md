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

## Model danych (`database/schema.sql`)

```text
users ──< leagues (organizator) ──< seasons ──< games >── teams (gospodarz/gość)
                                └─< teams ──< team_members >── users  (is_captain)
```

- **Liga** to trwały byt; **sezon** ma własne parametry (daty, punktacja Z/R/P) i stan: `preparation → ongoing → finished`.
- Drużyny należą do ligi; tabela sezonu obejmuje drużyny, które mają mecze w terminarzu tego sezonu.
- Baza wymusza spójność: obie drużyny meczu należą do ligi sezonu (złożone FK), zawodnik gra w jednej drużynie na ligę,
  drużyna ma maks. jednego kapitana i jest on jej zawodnikiem, mecz jest rozegrany ⇔ ma oba wyniki.

## Role i uprawnienia

| Rola | Może |
|---|---|
| Gość | przeglądać ligi, sezony, drużyny, terminarz, wyniki i tabelę |
| Zawodnik | j.w. + widzieć składy i swoje drużyny |
| Kapitan | j.w. + zmieniać nazwę drużyny, dodawać/usuwać zawodników |
| Organizator (twórca ligi) | wszystko w swojej lidze: edycja ligi, sezony i ich stan, drużyny, kapitanowie, terminarz, wyniki |

Reguły sezonu: parametry edytowalne tylko w przygotowaniu; wyniki wpisywane/poprawiane tylko w trwającym sezonie;
zakończony sezon jest tylko do odczytu; zmiana stanu tylko do przodu.

## Bezpieczeństwo

- Hasła: BCrypt (cost 12); min. 8 znaków, 1 wielka litera, 1 cyfra (maks. 72 bajty — limit BCrypt).
- Sesja: cookie `HttpOnly`, `SameSite=Strict`, `Secure` przy HTTPS; API przyjmuje tylko JSON → ochrona przed CSRF.
- Logowanie w stałym czasie (brak wycieku, czy konto istnieje), limit 10 prób/min/IP dla logowania i rejestracji.
- Uprawnienia sprawdzane w tym samym zapytaniu SQL co zmiana danych; wszystkie zapytania parametryzowane.
- Nagłówki: CSP `default-src 'self'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`; frontend escapuje dane.
- Hasło do bazy tylko w zmiennej środowiskowej. Na produkcji uruchom za reverse proxy z HTTPS.
