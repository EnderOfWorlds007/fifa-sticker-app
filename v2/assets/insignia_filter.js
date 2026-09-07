import { normalizeInsigniaFilter } from "./trade_state.js?v=build-6fbb7fadf697";

export function mountInsigniaFilter(target, options = {}) {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) return null;
  const label = options.label || "Card back";
  const help = `${options.help || "Filter by the insignia colour on the back."} Prefer keeps every available match and uses that colour first.`;
  let value = normalizeInsigniaFilter(options.value);
  root.classList.add("insigniaFilter");
  root.innerHTML = `
    <span class="insigniaFilterLabel">${label}</span>
    <div class="insigniaFilterButtons" role="group" aria-label="${label}">
      <div class="collectionSegmented insigniaExactButtons">
        <button type="button" data-insignia-value="both">Both</button>
        <button type="button" data-insignia-value="green">Green</button>
        <button type="button" data-insignia-value="blue">Blue</button>
      </div>
      <div class="collectionSegmented insigniaPreferenceButtons">
        <button type="button" data-insignia-value="prefer-green">Prefer green</button>
        <button type="button" data-insignia-value="prefer-blue">Prefer blue</button>
      </div>
    </div>
    <span class="insigniaFilterHelp">${help}</span>
  `;
  const buttons = [...root.querySelectorAll("[data-insignia-value]")];
  const render = () => buttons.forEach((button) => {
    const active = button.dataset.insigniaValue === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const nextValue = normalizeInsigniaFilter(button.dataset.insigniaValue);
      if (nextValue === value) return;
      value = nextValue;
      render();
      options.onChange?.(value);
    });
  }
  render();
  return {
    get value() { return value; },
    setValue(nextValue) {
      value = normalizeInsigniaFilter(nextValue);
      render();
    },
  };
}
