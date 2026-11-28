-- LeagueHub — schemat bazy (MySQL 8 / MariaDB 10.5+)
--
-- Model:  liga (organizator) ─┬─ sezony ── mecze
--                             └─ drużyny ── zawodnicy (jeden z nich może być kapitanem)
--
-- Spójność wymusza baza:
--  * mecz należy do sezonu, a obie drużyny muszą należeć do ligi tego sezonu (złożone FK),
--  * zawodnik gra w co najwyżej jednej drużynie danej ligi,
--  * drużyna ma co najwyżej jednego kapitana i musi on być jej zawodnikiem,
--  * mecz jest rozegrany wtedy i tylko wtedy, gdy ma oba wyniki,
--  * zawodnik występuje w kadrze meczu co najwyżej raz.
--
-- Uruchom raz jako administrator: mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS leaguehub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE leaguehub;

CREATE TABLE users (
    id            BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(32) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    password_hash CHAR(60)    NOT NULL,                       -- BCrypt
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_username (username)                   -- collation *_ci: bez rozróżniania wielkości liter
) ENGINE=InnoDB;

CREATE TABLE leagues (
    id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    organizer_id BIGINT       NOT NULL,
    name         VARCHAR(100) NOT NULL,
    sport        VARCHAR(60)  NOT NULL,
    description  VARCHAR(500) NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_leagues_organizer FOREIGN KEY (organizer_id) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE seasons (
    id          BIGINT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    league_id   BIGINT           NOT NULL,
    name        VARCHAR(80)      NOT NULL,
    starts_on   DATE             NULL,
    ends_on     DATE             NULL,
    points_win  TINYINT UNSIGNED NOT NULL DEFAULT 3,
    points_draw TINYINT UNSIGNED NOT NULL DEFAULT 1,
    points_loss TINYINT UNSIGNED NOT NULL DEFAULT 0,
    status      ENUM ('preparation', 'ongoing', 'finished') NOT NULL DEFAULT 'preparation',
    team_size   TINYINT UNSIGNED NULL,                         -- zawodników w pierwszym składzie; NULL = bez podziału, w kadrze cała drużyna
    bench_size  TINYINT UNSIGNED NULL,                         -- maks. rezerwowych; NULL = wszyscy pozostali
    UNIQUE KEY uq_seasons_league_name (league_id, name),
    UNIQUE KEY uq_seasons_id_league (id, league_id),          -- cel złożonego FK z games
    CONSTRAINT chk_seasons_dates  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
    CONSTRAINT chk_seasons_points CHECK (points_win >= points_draw AND points_draw >= points_loss),
    CONSTRAINT chk_seasons_squad  CHECK ((team_size IS NULL OR team_size BETWEEN 1 AND 50)
                                         AND (bench_size IS NULL OR (team_size IS NOT NULL AND bench_size <= 50))),
    CONSTRAINT fk_seasons_league FOREIGN KEY (league_id) REFERENCES leagues (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE teams (
    id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    league_id  BIGINT      NOT NULL,
    name       VARCHAR(60) NOT NULL,
    independent_team_id BIGINT NULL,                          -- drużyna poza ligą, z której powstała (zaproszenie do ligi); FK niżej
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_teams_league_name (league_id, name),
    UNIQUE KEY uq_teams_id_league (id, league_id),            -- cel złożonych FK
    UNIQUE KEY uq_teams_league_independent (league_id, independent_team_id), -- drużyna poza ligą gra w lidze co najwyżej raz
    CONSTRAINT fk_teams_league FOREIGN KEY (league_id) REFERENCES leagues (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE team_members (
    team_id      BIGINT   NOT NULL,
    league_id    BIGINT   NOT NULL,
    user_id      BIGINT   NOT NULL,
    is_captain   BOOLEAN  NOT NULL DEFAULT FALSE,
    captain_slot TINYINT  AS (IF(is_captain, 1, NULL)) STORED, -- NULL dla zwykłych zawodników
    joined_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id),
    UNIQUE KEY uq_members_one_team_per_league (league_id, user_id),
    UNIQUE KEY uq_members_one_captain (team_id, captain_slot),
    CONSTRAINT fk_members_team FOREIGN KEY (team_id, league_id) REFERENCES teams (id, league_id) ON DELETE CASCADE,
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE games (
    id           BIGINT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
    season_id    BIGINT            NOT NULL,
    league_id    BIGINT            NOT NULL,
    home_team_id BIGINT            NOT NULL,
    away_team_id BIGINT            NOT NULL,
    starts_at    DATETIME          NOT NULL,
    venue        VARCHAR(120)      NULL,
    home_score   SMALLINT UNSIGNED NULL,                       -- NULL = mecz nierozegrany
    away_score   SMALLINT UNSIGNED NULL,
    round_no     SMALLINT UNSIGNED NULL,                       -- numer kolejki (terminarz generowany); NULL = mecz dodany ręcznie
    lineup_strategy VARCHAR(20)    NOT NULL DEFAULT 'rotation',   -- sposób doboru zawodników (rozmiar kadry: seasons.team_size)
    KEY ix_games_season_starts (season_id, starts_at),
    CONSTRAINT chk_games_teams CHECK (home_team_id <> away_team_id),
    CONSTRAINT chk_games_score CHECK ((home_score IS NULL) = (away_score IS NULL)),
    CONSTRAINT fk_games_season FOREIGN KEY (season_id, league_id) REFERENCES seasons (id, league_id) ON DELETE CASCADE,
    CONSTRAINT fk_games_home   FOREIGN KEY (home_team_id, league_id) REFERENCES teams (id, league_id),
    CONSTRAINT fk_games_away   FOREIGN KEY (away_team_id, league_id) REFERENCES teams (id, league_id)
) ENGINE=InnoDB;

-- Kadra meczowa: dobierana automatycznie przy tworzeniu meczu, można ją wylosować ponownie przed rozegraniem.
-- Zostaje w historii nawet, gdy zawodnik później odejdzie z drużyny.
CREATE TABLE game_lineups (
    game_id BIGINT           NOT NULL,
    team_id BIGINT           NOT NULL,
    user_id BIGINT           NOT NULL,
    role    ENUM ('starter', 'substitute') NOT NULL,
    slot    TINYINT UNSIGNED NOT NULL,                         -- kolejność w kadrze (1 = kapitan, jeśli jest)
    PRIMARY KEY (game_id, user_id),
    KEY ix_lineups_team_user (team_id, user_id),
    CONSTRAINT fk_lineups_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
    CONSTRAINT fk_lineups_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_lineups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Drużyny poza ligą: zakłada je dowolny zalogowany użytkownik (właściciel) i zaprasza do nich innych po nazwie użytkownika.
-- Właściciel jest zawsze członkiem swojej drużyny. Zaproszenie czeka, aż zaproszony je przyjmie albo odrzuci.
CREATE TABLE independent_teams (
    id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_id   BIGINT      NOT NULL,
    name       VARCHAR(60) NOT NULL,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_independent_teams_owner_name (owner_id, name),
    CONSTRAINT fk_independent_teams_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE independent_team_members (
    team_id   BIGINT   NOT NULL,
    user_id   BIGINT   NOT NULL,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id),
    KEY ix_independent_members_user (user_id),
    CONSTRAINT fk_independent_members_team FOREIGN KEY (team_id) REFERENCES independent_teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_independent_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE team_invitations (
    id         BIGINT   NOT NULL AUTO_INCREMENT PRIMARY KEY,
    team_id    BIGINT   NOT NULL,
    user_id    BIGINT   NOT NULL,                              -- zaproszony
    invited_by BIGINT   NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_invitations_team_user (team_id, user_id),    -- jedno oczekujące zaproszenie na osobę
    KEY ix_invitations_user (user_id),
    CONSTRAINT fk_invitations_team    FOREIGN KEY (team_id) REFERENCES independent_teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_invitations_user    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_invitations_inviter FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE teams ADD CONSTRAINT fk_teams_independent
    FOREIGN KEY (independent_team_id) REFERENCES independent_teams (id) ON DELETE SET NULL;

-- Zaproszenie drużyny poza ligą do ligi: wysyła organizator, przyjmuje albo odrzuca właściciel (kapitan) drużyny.
-- Po przyjęciu w lidze powstaje drużyna o tej samej nazwie i składzie, a właściciel zostaje jej kapitanem.
CREATE TABLE league_invitations (
    id                  BIGINT   NOT NULL AUTO_INCREMENT PRIMARY KEY,
    league_id           BIGINT   NOT NULL,
    independent_team_id BIGINT   NOT NULL,
    invited_by          BIGINT   NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_league_invitations_team (league_id, independent_team_id),
    KEY ix_league_invitations_team (independent_team_id),
    CONSTRAINT fk_league_invitations_league  FOREIGN KEY (league_id) REFERENCES leagues (id) ON DELETE CASCADE,
    CONSTRAINT fk_league_invitations_team    FOREIGN KEY (independent_team_id) REFERENCES independent_teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_league_invitations_inviter FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Powiadomienia informacyjne (np. „drużyna została usunięta z ligi”) — użytkownik je odczytuje i zamyka.
CREATE TABLE notifications (
    id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id    BIGINT       NOT NULL,
    message    VARCHAR(300) NOT NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_notifications_user (user_id, created_at),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Zaproszenie zawodnika do drużyny w lidze: wysyła kapitan albo organizator, zawodnik przyjmuje je albo odrzuca.
-- Dopiero po przyjęciu zawodnik trafia do team_members (wtedy też obowiązuje zasada „jedna drużyna na ligę”).
CREATE TABLE league_team_invitations (
    id         BIGINT   NOT NULL AUTO_INCREMENT PRIMARY KEY,
    team_id    BIGINT   NOT NULL,
    league_id  BIGINT   NOT NULL,
    user_id    BIGINT   NOT NULL,                              -- zaproszony
    invited_by BIGINT   NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_team_invitations_team_user (team_id, user_id),
    KEY ix_team_invitations_user (user_id),
    CONSTRAINT fk_team_invitations_team    FOREIGN KEY (team_id, league_id) REFERENCES teams (id, league_id) ON DELETE CASCADE,
    CONSTRAINT fk_team_invitations_user    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_team_invitations_inviter FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
