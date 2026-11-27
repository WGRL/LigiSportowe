-- Migracja istniejącej bazy do aktualnego schematu. Bezpieczna do wielokrotnego uruchamiania (MariaDB 10.5+).
--  * nazwy wyświetlane użytkowników (users.display_name) — dla baz utworzonych przed ich dodaniem,
--  * kadry meczowe (games.lineup_*, game_lineups) i numer kolejki (games.round_no).
--
-- Uruchom: DB_PASSWORD=... ./run.sh --migrate   (albo: sudo mariadb < database/migrations/001_update_schema.sql)
USE leaguehub;

-- Dotychczasowi użytkownicy dostają nazwę wyświetlaną równą nazwie użytkownika.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100) NOT NULL DEFAULT '' AFTER username;
UPDATE users SET display_name = username WHERE display_name = '';
ALTER TABLE users ALTER COLUMN display_name DROP DEFAULT;

ALTER TABLE games
    ADD COLUMN IF NOT EXISTS round_no        SMALLINT UNSIGNED NULL AFTER away_score,
    ADD COLUMN IF NOT EXISTS lineup_format   VARCHAR(20) NOT NULL DEFAULT 'football11',
    ADD COLUMN IF NOT EXISTS lineup_strategy VARCHAR(20) NOT NULL DEFAULT 'rotation';

CREATE TABLE IF NOT EXISTS game_lineups (
    game_id BIGINT           NOT NULL,
    team_id BIGINT           NOT NULL,
    user_id BIGINT           NOT NULL,
    role    ENUM ('starter', 'substitute') NOT NULL,
    slot    TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (game_id, user_id),
    KEY ix_lineups_team_user (team_id, user_id),
    CONSTRAINT fk_lineups_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
    CONSTRAINT fk_lineups_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_lineups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
