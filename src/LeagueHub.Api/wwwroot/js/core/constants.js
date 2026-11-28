// Stałe domenowe frontendu.

export const STATUS = { preparation: "Przygotowanie", ongoing: "Trwający", finished: "Zakończony" };
export const NEXT_STATUS = { preparation: "Rozpocznij sezon", ongoing: "Zakończ sezon" };

// Domyślny format kadry zgadywany z dyscypliny ligi (organizator może go zmienić).
export const SPORT_FORMATS = [
  [/3\s*[x×]\s*3/i, "basketball3x3"], [/kosz|basket/i, "basketball"], [/siatk|volley/i, "volleyball"],
  [/futsal|hal/i, "futsal"], [/orlik|szóst|siódem|7/i, "football7"], [/ręczn|handball/i, "handball"],
  [/hokej|hockey/i, "hockey"]
];

/** Co ile ms sprawdzać nowe powiadomienia w tle. */
export const NOTIFICATIONS_POLL_MS = 30000;
