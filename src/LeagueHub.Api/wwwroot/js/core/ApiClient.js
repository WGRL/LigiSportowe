/**
 * Jedyny punkt komunikacji z serwerem: wysyła JSON, rozpakowuje odpowiedź
 * i zamienia błędy HTTP na wyjątki z komunikatem dla użytkownika.
 */
export class ApiClient {
  async request(url, method = "GET", body) {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    if (!res.ok) {
      const fallback = { 401: "Zaloguj się, aby to zrobić.", 429: "Zbyt wiele prób — spróbuj za minutę." }[res.status];
      throw Object.assign(new Error(data?.message || fallback || "Nie udało się wykonać operacji."), { status: res.status });
    }
    return data;
  }
}
