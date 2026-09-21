// Where a tank's saved population lives, chosen per host.
//
// The browser preview keeps a site's population in localStorage, which is keyed per
// *origin*, not per page or per tab. Every same-origin tab (including the preview opened a
// second time, or another scene sharing the origin) reads and writes the same key, so they
// share one preview tank and the last writer wins. The Mac wallpaper runs a whole copy of
// the aquarium per display, each in its own WebKit view whose data store is deliberately
// non-persistent (see Wallpaper.swift), so its population has nowhere to go but a real
// file. The Swift host therefore pre-injects a
// per-display tank identity and the file's current contents, and the page hands saves
// back to the host through a WebKit message channel. Because a Mac app bundle is rebuilt
// from scratch on every install, that file must live outside the bundle (in
// ~/Library/Application Support) or a reinstall or update would wipe every fish.
//
// Every operation here is defensive: a storage failure must never stop the aquarium. The
// scene reads `state or null` and goes on living either way.
import { parse, serialize } from "./tank-state.js";

const NAMESPACE = "desktop-habitats/tank";

function browserKey() {
  return `${NAMESPACE}:v1`;
}

/**
 * Create a storage adapter. `globalThis.habitatTankId` is injected only by the wallpaper
 * host (Wallpaper.swift). When it is present the adapter talks to the host; otherwise it
 * falls back to localStorage, which is what an ordinary browser or preview offer.
 *
 * - `initial()`   resolves the current saved state, or null when there is none or it is
 *                 unreadable. Call it once at startup; never call it again on a running
 *                 tank (it must not clobber live age).
 * - `save(state)` writes the population, returning true on success, false otherwise.
 */
export function createTankStorage({
  id: providedId = null,
  initial: providedInitial = null,
} = {}) {
  const id = providedId ?? globalThis.habitatTankId ?? null;
  const host = typeof id === "string" && id.length > 0;

  function initial() {
    if (providedInitial != null) return parse(providedInitial) ?? null;
    if (host) {
      // The host already parsed the file and injected the string at document start.
      const text = globalThis.habitatTankInitial;
      if (typeof text !== "string") return null;
      return parse(text) ?? null;
    }
    try {
      return parse(window.localStorage.getItem(browserKey())) ?? null;
    } catch (error) {
      console.warn("Riverscape: could not read the saved tank", error);
      return null;
    }
  }

  function save(state) {
    let text;
    try {
      text = serialize(state);
    } catch (error) {
      console.warn("Riverscape: could not build the tank save", error);
      return false;
    }
    if (host) {
      // A WebKit message is async on the Swift side; it is our responsibility to succeed
      // since the page cannot wait on it here. Periodic saving overlaps lifecycle saving
      // exactly so that one dropped message never costs a whole tank.
      try {
        if (typeof globalThis.habitatTankSave === "function") {
          globalThis.habitatTankSave(text);
        } else if (
          globalThis.webkit?.messageHandlers?.tankSave &&
          typeof globalThis.webkit.messageHandlers.tankSave.postMessage === "function"
        ) {
          globalThis.webkit.messageHandlers.tankSave.postMessage(text);
        } else {
          return false;
        }
        return true;
      } catch (error) {
        console.warn("Riverscape: could not hand the tank save to the host", error);
        return false;
      }
    }
    try {
      window.localStorage.setItem(browserKey(), text);
      return true;
    } catch (error) {
      console.warn("Riverscape: could not store the tank", error);
      return false;
    }
  }

  return { id, host, initial, save };
}
