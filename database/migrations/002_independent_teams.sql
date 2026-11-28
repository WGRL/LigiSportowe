-- Migracja: drużyny poza ligą i zaproszenia do nich. Bezpieczna do wielokrotnego uruchamiania (MariaDB 10.5+).
--
-- Uruchom: DB_PASSWORD=... ./run.sh --migrate   (albo: sudo mariadb < database/migrations/002_independent_teams.sql)
USE leaguehub;
-- Drużyny poza ligą: zakłada je dowolny zalogowany użytkownik (właściciel) i zaprasza do nich innych po nazwie użytkownika.
-- Właściciel jest zawsze członkiem swojej drużyny. Zaproszenie czeka, aż zaproszony je przyjmie albo odrzuci.
CREATE TABLE IF NOT EXISTS independent_teams (
    id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_id   BIGINT      NOT NULL,
    name       VARCHAR(60) NOT NULL,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_independent_teams_owner_name (owner_id, name),
    CONSTRAINT fk_independent_teams_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS independent_team_members (
    team_id   BIGINT   NOT NULL,
    user_id   BIGINT   NOT NULL,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id),
    KEY ix_independent_members_user (user_id),
    CONSTRAINT fk_independent_members_team FOREIGN KEY (team_id) REFERENCES independent_teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_independent_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS team_invitations (
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
