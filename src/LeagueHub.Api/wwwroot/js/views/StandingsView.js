import { $, esc } from "../core/dom.js";
import { empty } from "./components.js";
import { View } from "./View.js";

/** Tabela sezonu. */
export class StandingsView extends View {
  render() {
    const { state } = this, rows = state.standings;
    $("#standings-table").innerHTML = rows.length
      ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>#</th><th class="left">Drużyna</th><th title="Mecze">M</th><th title="Zwycięstwa">Z</th>
            <th title="Remisy">R</th><th title="Porażki">P</th><th>Bramki</th><th title="Różnica bramek">+/−</th><th>Pkt</th></tr></thead>
          <tbody>${rows.map((r, i) => `<tr>
            <td>${i + 1}</td><td class="left">${esc(r.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td>
            <td>${r.lost}</td><td>${r.goalsFor}:${r.goalsAgainst}</td><td>${r.goalsFor - r.goalsAgainst}</td><td><strong>${r.points}</strong></td>
          </tr>`).join("")}</tbody></table></div>`
      : empty("▤", state.season ? "Tabela pojawi się po dodaniu meczów do terminarza." : "Brak sezonu.");
  }
}
