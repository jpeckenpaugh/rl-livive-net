/* Flight input: the held-key set shared by the game loops, and the on-screen
 * touch pad binding. */
export const pressed = new Set();

export function bindTouch(pad, set) {
  if (!pad) return;
  pad.querySelectorAll("[data-touch]").forEach((btn) => {
    const code = btn.dataset.touch;
    const down = (e) => { e.preventDefault(); set.add(code); btn.classList.add("pressed"); };
    const up = (e) => { e.preventDefault(); set.delete(code); btn.classList.remove("pressed"); };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
  });
}
export function setupTouchForMatch() { /* pads bound once in boot */ }
