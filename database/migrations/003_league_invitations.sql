-- Migracja: zaproszenia drużyn poza ligą do lig i powiadomienia. Bezpieczna do wielokrotnego uruchamiania (MariaDB 10.5+).
-- Wymaga migracji 002 (drużyny poza ligą).
--
-- Uruchom: DB_PASSWORD=... ./run.sh --migrate   (albo: sudo mariadb < database/migrations/003_league_invitations.sql)
USE leaguehub;

ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS independent_team_id BIGINT NULL AFTER name,
    ADD UNIQUE KEY IF NOT EXISTS uq_teams_league_independent (league_id, independent_team_id),
    ADD FOREIGN KEY IF NOT EXISTS fk_teams_independent (independent_team_id) REFERENCES independent_teams (id) ON DELETE SET NULL;

-- Zaproszenie drużyny poza ligą do ligi: wysyła organizator, przyjmuje albo odrzuca właściciel (kapitan) drużyny.
-- Po przyjęciu w lidze powstaje drużyna o tej samej nazwie i składzie, a właściciel zostaje jej kapitanem.
CREATE TABLE IF NOT EXISTS league_invitations (
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
CREATE TABLE IF NOT EXISTS notifications (
    id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id    BIGINT       NOT NULL,
    message    VARCHAR(300) NOT NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_notifications_user (user_id, created_at),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
