/** Bazowa klasa widoku: dostaje stan aplikacji i przerysowuje swój fragment strony w render(). */
export class View {
  constructor(state) {
    this.state = state;
  }

  render() {
    throw new Error(`${this.constructor.name} musi zaimplementować render().`);
  }
}
