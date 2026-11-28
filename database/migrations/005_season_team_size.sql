-- Migracja: rozmiar kadry meczowej ustawiany w sezonie (opcjonalnie) zamiast formatu dyscypliny w każdym meczu.
-- Bezpieczna do wielokrotnego uruchamiania (MariaDB 10.5+).
--
-- Istniejące sezony dostają „bez podziału” (team_size = NULL), bo rozmiaru nikt w nich nie wybierał.
-- Zaplanowane mecze takich sezonów: cała drużyna trafia do kadry. Rozegrane mecze zostają w historii bez zmian.
--
-- Uruchom: DB_PASSWORD=... ./run.sh --migrate   (albo: sudo mariadb < database/migrations/005_season_team_size.sql)
USE leaguehub;

ALTER TABLE seasons
    ADD COLUMN IF NOT EXISTS team_size  TINYINT UNSIGNED NULL AFTER status,
    ADD COLUMN IF NOT EXISTS bench_size TINYINT UNSIGNED NULL AFTER team_size,
    ADD CONSTRAINT IF NOT EXISTS chk_seasons_squad CHECK ((team_size IS NULL OR team_size BETWEEN 1 AND 50)
                                                          AND (bench_size IS NULL OR (team_size IS NOT NULL AND bench_size <= 50)));

-- Jednorazowo (dopóki istnieje stara kolumna games.lineup_format): przebudowa kadr zaplanowanych meczów i usunięcie kolumny.
DELIMITER //
BEGIN NOT ATOMIC
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'games' AND column_name = 'lineup_format') THEN
        UPDATE game_lineups gl JOIN games g ON g.id = gl.game_id JOIN seasons s ON s.id = g.season_id
        SET gl.role = 'starter'
        WHERE g.home_score IS NULL AND s.team_size IS NULL;

        INSERT IGNORE INTO game_lineups (game_id, team_id, user_id, role, slot)
        SELECT g.id, m.team_id, m.user_id, 'starter', 200
        FROM games g JOIN seasons s ON s.id = g.season_id
        JOIN team_members m ON m.team_id IN (g.home_team_id, g.away_team_id)
        WHERE g.home_score IS NULL AND s.team_size IS NULL;

        ALTER TABLE games DROP COLUMN lineup_format;
    END IF;
END //
DELIMITER ;
