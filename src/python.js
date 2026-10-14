/* Python runtime bridge: the shared Pyodide instance, its bootstrap script, and
 * helpers that read JSON out of the running interpreter. */
import { state } from "./state.js";

export function readPythonJson(expression) { return JSON.parse(state.pyodide.runPython(expression)); }

export async function installWheel(url) {
  state.pyodide.globals.set("_wheel_url", url);
  try { await state.pyodide.runPythonAsync("import micropip\nawait micropip.install(_wheel_url, deps=False)"); }
  finally { state.pyodide.globals.delete("_wheel_url"); }
}

export async function loadPySetup() {
  const res = await fetch(new URL("./py/setup.py", import.meta.url));
  if (!res.ok) throw new Error(`Could not load Python setup (${res.status})`);
  return res.text();
}
