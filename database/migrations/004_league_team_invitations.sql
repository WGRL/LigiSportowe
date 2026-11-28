-- Migracja: zaproszenia zawodników do drużyn w ligach (dodanie zawodnika wymaga jego akceptacji).
-- Bezpieczna do wielokrotnego uruchamiania (MariaDB 10.5+).
--
-- Uruchom: DB_PASSWORD=... ./run.sh --migrate   (albo: sudo mariadb < database/migrations/004_league_team_invitations.sql)
USE leaguehub;

-- Zaproszenie zawodnika do drużyny w lidze: wysyła kapitan albo organizator, zawodnik przyjmuje je albo odrzuca.
-- Dopiero po przyjęciu zawodnik trafia do team_members (wtedy też obowiązuje zasada „jedna drużyna na ligę”).
CREATE TABLE IF NOT EXISTS league_team_invitations (
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
