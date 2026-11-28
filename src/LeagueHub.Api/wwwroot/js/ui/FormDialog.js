import { $ } from "../core/dom.js";

/**
 * Uniwersalny formularz w oknie dialogowym, budowany z opisu pól:
 * { name, label, type?, options?, value?, hint?, text?, required?, min?, max?, maxLength?, readOnly? }.
 * Po udanym zapisie wywołuje onSaved (przeładowanie danych) i zamyka okno — chyba że zapis otworzył
 * kolejny formularz (formularz wieloetapowy).
 */
export class FormDialog {
  #submit = null;
  #generation = 0;

  constructor(onSaved) {
    this.onSaved = onSaved;
    $("#edit-form").addEventListener("submit", (event) => this.#handleSubmit(event));
  }

  open(title, fields, submit) {
    this.#generation++;
    $("#form-title").textContent = title;
    $("#form-message").textContent = "";
    $("#form-fields").replaceChildren(...fields.map((f) => FormDialog.#field(f)));
    this.#submit = async (data) => { await submit(data); await this.onSaved(); };
    $("#form-dialog").showModal();
  }

  static #field(f) {
    const label = document.createElement("label");
    const input = document.createElement(f.options ? "select" : "input");
    label.append(f.label, input);
    if (f.hint) label.append(Object.assign(document.createElement("small"), { className: "hint", textContent: f.hint }));
    input.name = f.name;
    if (f.options) input.append(...f.options.map(([value, text]) => new Option(text, value)));
    else input.type = f.type ?? "text";
    if (f.text) input.dataset.text = "1";
    for (const key of ["required", "min", "max", "maxLength", "readOnly"]) if (f[key] !== undefined) input[key] = f[key];
    if (input.type === "checkbox") {
      input.checked = !!f.value;
      label.classList.add("checkbox");
      label.prepend(input);
    } else input.value = f.value ?? "";
    return label;
  }

  // Pola liczbowe i listy wyboru (bez data-text) zamieniane są na liczby, puste pola na null.
  static #read(form) {
    const data = {};
    for (const el of form.elements) {
      if (!el.name || el.readOnly) continue;
      if (el.type === "checkbox") { data[el.name] = el.checked; continue; }
      const numeric = el.type === "number" || (el.tagName === "SELECT" && !el.dataset.text);
      data[el.name] = el.value === "" ? null : numeric ? Number(el.value) : el.value;
    }
    return data;
  }

  async #handleSubmit(event) {
    event.preventDefault();
    const data = FormDialog.#read(event.currentTarget);
    const generation = this.#generation;
    try {
      await this.#submit(data);
      if (generation === this.#generation) $("#form-dialog").close();
    } catch (error) {
      $("#form-message").textContent = error.message;
    }
  }
}
