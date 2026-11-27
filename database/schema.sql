-- LeagueHub — schemat bazy (MySQL 8 / MariaDB 10.5+)
--
-- Model:  liga (organizator) ─┬─ sezony ── mecze
--                             └─ drużyny ── zawodnicy (jeden z nich może być kapitanem)
--
-- Spójność wymusza baza:
--  * mecz należy do sezonu, a obie drużyny muszą należeć do ligi tego sezonu (złożone FK),
--  * zawodnik gra w co najwyżej jednej drużynie danej ligi,
--  * drużyna ma co najwyżej jednego kapitana i musi on być jej zawodnikiem,
--  * mecz jest rozegrany wtedy i tylko wtedy, gdy ma oba wyniki.
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
    UNIQUE KEY uq_seasons_league_name (league_id, name),
    UNIQUE KEY uq_seasons_id_league (id, league_id),          -- cel złożonego FK z games
    CONSTRAINT chk_seasons_dates  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
    CONSTRAINT chk_seasons_points CHECK (points_win >= points_draw AND points_draw >= points_loss),
    CONSTRAINT fk_seasons_league FOREIGN KEY (league_id) REFERENCES leagues (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE teams (
    id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    league_id  BIGINT      NOT NULL,
    name       VARCHAR(60) NOT NULL,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_teams_league_name (league_id, name),
    UNIQUE KEY uq_teams_id_league (id, league_id),            -- cel złożonych FK
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
    KEY ix_games_season_starts (season_id, starts_at),
    CONSTRAINT chk_games_teams CHECK (home_team_id <> away_team_id),
    CONSTRAINT chk_games_score CHECK ((home_score IS NULL) = (away_score IS NULL)),
    CONSTRAINT fk_games_season FOREIGN KEY (season_id, league_id) REFERENCES seasons (id, league_id) ON DELETE CASCADE,
    CONSTRAINT fk_games_home   FOREIGN KEY (home_team_id, league_id) REFERENCES teams (id, league_id),
    CONSTRAINT fk_games_away   FOREIGN KEY (away_team_id, league_id) REFERENCES teams (id, league_id)
) ENGINE=InnoDB;
