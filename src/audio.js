/* Audio: chiptune sound effects and music, the announcer voice pack, the clip
 * composer, and the commentary director. */
import { data } from "./data.js";

export const Sound = (() => {
  let ctx = null;
  let musicOn = true;
  let sfxOn = true;
  let unlocked = false;
  let musicTimer = null;
  let musicStep = 0;
  let trackId = null;
  let track = null;
  let musicGain = null;
  // Temporarily hold music while the screen router swaps tracks (a warm-boot
  // RESET must not blip a note); resumeMusic() restarts the current track.
  let musicSuspended = false;
  // 1990s-arcade announcer voice pack (8-bit / 8 kHz callouts). Cosmetic only:
  // every path here fails soft so a missing clip or locked audio never breaks play.
  // assets/voice/manifest.json is authoritative for which clips exist. The
  // fallback list below is preloaded immediately so the original callouts never
  // regress when the manifest fetch is slow or unavailable; new dynamic clips
  // (player_1..player_4, event/modifier/easter-egg ids) are picked up from the
  // manifest as the voice pack grows.
  const voiceClips = new Map();
  let voiceManifest = null;
  let voiceIds = new Set();
  let voicesOn = true;
  let voicesLoaded = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type = "square", vol = 0.05, delay = 0, slideTo = null, dest = null) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(dest || ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function chord(freqs, dur, type, vol, delay) {
    freqs.forEach((f, i) => tone(f, dur, type, vol, (delay || 0) + i * 0.02));
  }
  function sfx(name) {
    if (!ctx || !sfxOn) return;
    switch (name) {
      case "menu": tone(440, 0.05, "square", 0.04); break;
      case "select": chord([660, 990], 0.09, "square", 0.05); break;
      case "coin": chord([988, 1319], 0.12, "square", 0.06); tone(1760, 0.18, "square", 0.05, 0.1); break;
      case "countdown": tone(name === "go" ? 1046 : 523, 0.12, "triangle", 0.06); break;
      case "go": chord([523, 784, 1046], 0.22, "triangle", 0.06); break;
      case "thrust": tone(90 + 40, 0.05, "sawtooth", 0.015); break;
      case "land": chord([523, 659, 784], 0.3, "triangle", 0.07); break;
      case "crash": tone(220, 0.5, "sawtooth", 0.07, 0, 55); break;
      case "fanfare": {
        const notes = [523, 659, 784, 1046, 784, 1046, 1318];
        notes.forEach((f, i) => tone(f, 0.16, "square", 0.06, i * 0.12));
        break;
      }
      case "lose": tone(392, 0.32, "triangle", 0.06); tone(294, 0.42, "triangle", 0.06, 0.16); break;
      default: break;
    }
  }
  // ------------------------------------------------------------------ tracks
  // One named song per screen. Each record owns its note tables, waves,
  // volumes and tempo, so a screen change also changes the sound. `once` marks
  // a short sting that plays through one time instead of looping. All tracks
  // sit in A minor and its relative modes, so changes feel like one game.
  // Music runs through its own gain so a switch can fade instead of clicking.
  function musicBus() {
    if (!ctx) return null;
    if (!musicGain) {
      musicGain = ctx.createGain();
      musicGain.gain.value = 1;
      musicGain.connect(ctx.destination);
    }
    return musicGain;
  }
  function trackLength(t) { return Math.max((t.bass || []).length, (t.lead || []).length, 1); }
  function musicTick() {
    if (!musicOn || !ctx || !track) return;
    const bus = musicBus();
    const bass = track.bass || [];
    const lead = track.lead || [];
    if (bass.length) {
      const b = bass[musicStep % bass.length];
      if (b) tone(b, 0.22, track.bassWave || "triangle", track.bassVol != null ? track.bassVol : 0.03, 0, null, bus);
    }
    if (lead.length) {
      const l = lead[musicStep % lead.length];
      if (l) tone(l, 0.14, track.leadWave || "square", track.leadVol != null ? track.leadVol : 0.018, 0.02, null, bus);
    }
    musicStep++;
    if (track.once && musicStep >= trackLength(track)) stopMusic();
  }
  function startMusic() {
    if (!ctx || !musicOn || !track || musicTimer || musicSuspended) return;
    if (track.once && musicStep >= trackLength(track)) musicStep = 0;
    musicTimer = setInterval(musicTick, track.stepMs || 300);
    musicTick();
  }
  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }
  function fadeMusic(done) {
    const bus = musicBus();
    if (!bus || !ctx) { done(); return; }
    const now = ctx.currentTime;
    try {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0.0001, now + 0.06);
    } catch (err) { done(); return; }
    setTimeout(() => {
      try { bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setValueAtTime(1, ctx.currentTime); } catch (err) { /* fail soft */ }
      done();
    }, 70);
  }
  // Switch songs. Idempotent: a no-op when the same track is already playing,
  // so menu sub-screens and round ticks never restart the song. Unknown tracks
  // fall back to the menu theme.
  function setTrack(id) {
    const next = data.tracks[id] ? id : "menu";
    if (next === trackId) return;
    trackId = next;
    track = data.tracks[next];
    musicStep = 0;
    const wasPlaying = !!musicTimer;
    stopMusic();
    if (ctx && musicOn) { if (wasPlaying) fadeMusic(startMusic); else startMusic(); }
  }
  function unlock() {
    if (unlocked) return;
    const c = ensure();
    if (!c) return;
    unlocked = true;
    if (musicOn) startMusic();
    loadVoices();
  }
  function toggleMusic() {
    musicOn = !musicOn;
    if (musicOn) { ensure(); startMusic(); } else stopMusic();
    return musicOn;
  }
  // File name for a clip id. New catalog entries may name their WAV explicitly
  // in the manifest; legacy clips fall back to `<id>.wav`.
  function clipFile(id) {
    const rec = voiceManifest && voiceManifest[id];
    return rec && rec.file ? rec.file : `${id}.wav`;
  }
  function preloadClip(id) {
    try {
      const clip = new Audio();
      clip.preload = "auto";
      clip.addEventListener("error", () => voiceClips.delete(id));
      clip.src = new URL(`assets/voice/${clipFile(id)}`, document.baseURI).href;
      clip.load();
      voiceClips.set(id, clip);
    } catch (err) { voiceClips.delete(id); }
  }
  // Read the manifest so the game follows the voice pack instead of a hardcoded
  // list. Returns the clip ids, or null when the manifest cannot be read.
  async function loadVoiceManifest() {
    try {
      const res = await fetch(new URL("assets/voice/manifest.json", document.baseURI).href, { cache: "force-cache" });
      if (!res || !res.ok) return null;
      const json = await res.json();
      const lines = json && json.lines;
      if (!lines || typeof lines !== "object") return null;
      voiceManifest = lines;
      return Object.keys(lines);
    } catch (err) { return null; }
  }
  // Preload the announcer clips after the first user gesture so the browser
  // autoplay policy is already satisfied when voice() calls play().
  function loadVoices() {
    if (voicesLoaded || typeof Audio === "undefined") return;
    voicesLoaded = true;
    voiceIds = new Set(data.voiceFallback);
    for (const id of data.voiceFallback) preloadClip(id);
    loadVoiceManifest().then((ids) => {
      if (!ids || !ids.length) return;
      voiceIds = new Set(ids);
      for (const id of ids) if (!voiceClips.has(id)) preloadClip(id);
    });
  }
  // Play a named callout. No-ops when the voice layer is off, audio is still
  // locked, or the clip is missing/undecodable.
  function voice(name) {
    if (!unlocked || !voicesOn) return;
    const clip = voiceClips.get(name);
    if (!clip) return;
    try {
      clip.currentTime = 0;
      const played = clip.play();
      if (played && typeof played.catch === "function") played.catch(() => {});
    } catch (err) { /* fail soft */ }
  }
  function stopVoices() {
    for (const clip of voiceClips.values()) {
      try { clip.pause(); clip.currentTime = 0; } catch (err) { /* fail soft */ }
    }
  }
  function toggleVoices() {
    voicesOn = !voicesOn;
    if (!voicesOn) stopVoices();
    return voicesOn;
  }
  function toggleSfx() {
    sfxOn = !sfxOn;
    return sfxOn;
  }
  return {
    unlock, sfx, toggleMusic, ensure, startMusic, stopMusic, setTrack,
    loadVoices, voice, toggleVoices, toggleSfx, stopVoices,
    isOn: () => musicOn,
    isSfxOn: () => sfxOn,
    isUnlocked: () => unlocked,
    isVoicesOn: () => voicesOn,
    currentTrack: () => trackId,
    voiceNames: () => [...voiceIds],
    clipFile: (id) => clipFile(id),
    manifest: () => voiceManifest,
    // Persisted-pref setters (AIA-46 R3): seed each layer before any sound plays.
    setEnabled(on) { musicOn = !!on; if (musicOn) startMusic(); else stopMusic(); return musicOn; },
    setSfxEnabled(on) { sfxOn = !!on; return sfxOn; },
    setVoicesEnabled(on) { voicesOn = !!on; if (!voicesOn) stopVoices(); return voicesOn; },
    suspendMusic() { musicSuspended = true; stopMusic(); },
    resumeMusic() { musicSuspended = false; if (musicOn) startMusic(); },
  };
})();

/* ============================================================================
 * VOICE COMPOSER — joins pre-baked clips into one callout
 * ==========================================================================*/
/*
 * Decode each clip in a line once, then schedule the buffers back-to-back with a
 * short gap so "Player 1" + "wins" reads as a single phrase. Fails soft: a
 * missing or undecodable clip is dropped, and if Web Audio/decoding is
 * unavailable the line simply does not play. This never throws.
 */
/* commentary-composer:start */
export function createVoiceComposer(deps) {
  const gap = typeof deps.gap === "number" ? deps.gap : 0.06; // ~60 ms between clips
  const buffers = new Map(); // clip id -> Promise<AudioBuffer|null>
  let token = 0;
  let active = null; // { sources: AudioBufferSourceNode[], endAt: number }

  function loadBuffer(id) {
    if (buffers.has(id)) return buffers.get(id);
    const pending = (async () => {
      try {
        const ctx = deps.getContext();
        if (!ctx || typeof ctx.decodeAudioData !== "function") return null;
        const bytes = await deps.fetchBytes(deps.clipUrl(id));
        if (!bytes || !bytes.byteLength) return null;
        return await new Promise((resolve) => {
          try { ctx.decodeAudioData(bytes.slice(0), resolve, () => resolve(null)); }
          catch (err) { resolve(null); }
        });
      } catch (err) { return null; }
    })();
    buffers.set(id, pending);
    return pending;
  }

  function stop() {
    token += 1;
    if (!active) return;
    for (const src of active.sources) { try { src.stop(0); } catch (err) { /* fail soft */ } }
    active = null;
  }

  // Play the clip ids in order. Resolves to { count, durationMs } once the
  // sequence is scheduled (or { count: 0 } when nothing could be played).
  async function play(ids) {
    stop();
    const ctx = deps.getContext();
    if (!ctx || !Array.isArray(ids) || !ids.length) return { count: 0, durationMs: 0 };
    const mine = token;
    const decoded = await Promise.all(ids.map(loadBuffer));
    if (mine !== token) return { count: 0, durationMs: 0 }; // interrupted while decoding
    const bufs = decoded.filter(Boolean);
    if (!bufs.length) return { count: 0, durationMs: 0 };
    const sources = [];
    let at = ctx.currentTime + 0.02;
    let durationMs = 20;
    for (const buffer of bufs) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      try { src.start(at); } catch (err) { continue; }
      sources.push(src);
      at += buffer.duration + gap;
      durationMs += buffer.duration * 1000 + gap * 1000;
    }
    if (!sources.length) return { count: 0, durationMs: 0 };
    active = { sources, endAt: ctx.currentTime + durationMs / 1000 };
    return { count: sources.length, durationMs };
  }

  return { play, stop, isPlaying: () => !!active };
}
/* commentary-composer:end */

/* ============================================================================
 * COMMENTARY DIRECTOR — reads match state, emits line intents, queues them
 * ==========================================================================*/
/*
 * The director turns match context into line intents (event + priority +
 * candidate clip ids) and plays them through a single queue: one line at a time
 * (no talk-over), a per-event cool-down, consecutive de-dupe, and an interrupt
 * that lets a big moment cut in front of a low-priority line. Every clip is
 * resolved against the manifest, so a missing clip simply falls back or drops.
 */
/* commentary-director:start */
export function createCommentary(deps) {
  // Internal queue ordering. "big" moments (round/match results) can interrupt
  // the low-priority callouts (coin/select); easter eggs sit just below them.
  const PRIORITY = { low: 1, color: 2, normal: 5, high: 8, easter: 9, big: 10 };
  const DEFAULT_COOLDOWN = 4500;
  const EASTER_COOLDOWN = 15000;
  const MAX_QUEUE = 4;
  const CLOSE_MARGIN = 3; // "by a hair"  (catalog: roundMargin <= 3)
  const BIG_MARGIN = 40;  // "in a blowout" (catalog: roundMargin >= 40)

  const queue = [];
  const lastPlayedAt = new Map(); // event -> ms
  const variantCursor = new Map(); // base id -> next variant index
  let current = null; // { key, priority, event }
  let running = false;
  let wake = null;
  let token = 0;

  function now() { return deps.now ? deps.now() : Date.now(); }
  // Expand a canonical id into its base/_2/_3 variants that actually exist, and
  // rotate them so the same phrase does not repeat back to back.
  function variantOf(id, have) {
    const candidates = [id, `${id}_2`, `${id}_3`].filter((v) => have.has(v));
    if (!candidates.length) return null;
    const cursor = variantCursor.get(id) || 0;
    variantCursor.set(id, cursor + 1);
    return candidates[cursor % candidates.length];
  }
  function pick(ids) {
    const have = deps.available();
    const out = [];
    for (const id of ids || []) {
      if (!id) continue;
      const chosen = variantOf(id, have);
      if (chosen) out.push(chosen);
    }
    return out;
  }
  function resolve(intent) {
    const have = deps.available();
    const required = (intent.require || []).filter(Boolean);
    if (required.length && !required.every((id) => have.has(id))) return pick(intent.fallback);
    let ids = intent.clips && intent.clips.length ? pick(intent.clips) : [];
    if (!ids.length) ids = intent.fallback && intent.fallback.length ? pick(intent.fallback) : [];
    return ids;
  }
  function subject(slot) { return (slot != null && slot >= 0 && slot < 4) ? `player_${slot + 1}` : null; }

  function sleep(ms) {
    return new Promise((resolve) => {
      const timer = deps.setTimer(() => { wake = null; resolve(); }, ms);
      wake = () => { deps.clearTimer(timer); wake = null; resolve(); };
    });
  }
  function interrupt() {
    token += 1;
    if (deps.stopPlayback) deps.stopPlayback();
    if (wake) wake();
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const intent = queue.shift();
        const ids = resolve(intent);
        if (!ids.length) continue;
        current = { key: intent.key || intent.event, priority: intent.priority || PRIORITY.normal, event: intent.event || intent.key };
        const mine = ++token;
        const result = await deps.play(ids);
        lastPlayedAt.set(current.event, now());
        if (result && result.durationMs && mine === token) await sleep(result.durationMs);
        current = null;
      }
    } catch (err) { /* fail soft: commentary must never break the game */ }
    finally { running = false; current = null; }
  }

  function say(intent) {
    if (!intent || !deps.isEnabled()) return false;
    const event = intent.event || intent.key || "line";
    const key = intent.key || event;
    if (current && current.key === key) return false; // already talking
    if (queue.length && queue[queue.length - 1].key === key) return false; // de-dupe tail
    const coolDown = intent.coolDown != null ? intent.coolDown : DEFAULT_COOLDOWN;
    const last = lastPlayedAt.get(event);
    if (coolDown > 0 && last != null && now() - last < coolDown) return false;
    const priority = intent.priority || PRIORITY.normal;
    if (current) {
      if (priority > current.priority) {
        queue.length = 0; // drop the low-priority backlog for a big moment
        queue.push({ ...intent, priority, event, key });
        interrupt();
        return true;
      }
      queue.push({ ...intent, priority, event, key });
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      return true;
    }
    queue.push({ ...intent, priority, event, key });
    pump();
    return true;
  }

  function stop() {
    queue.length = 0;
    interrupt();
  }

  // --- intent builders: read the gathered match context ----------------------
  function roundStart(round, totalRounds) {
    // "Final round" only on the actual last round (cup round 10, best-of-3 round 3).
    // Middle rounds stay silent (there is no generic round clip).
    const isFinal = totalRounds ? round >= totalRounds : round >= 3;
    const clip = round === 1 ? "round_one" : round === 2 ? "round_two" : isFinal ? "round_three" : null;
    return { event: "round_start", key: `round_start:${round}`, priority: PRIORITY.high, clips: clip ? [clip] : [], fallback: [], coolDown: 0 };
  }
  function go() {
    return { event: "go", key: "go", priority: PRIORITY.high, clips: ["fight"], fallback: ["fight"], coolDown: 0 };
  }
  function line(id, opts) {
    return Object.assign({ event: id, key: id, priority: PRIORITY.normal, clips: [id], fallback: [id] }, opts || {});
  }
  // ctx: { round, winnerSlot, winnerLanded, margin, humanSlot, humanWon,
  //        humanLanded, anyLanded, landedCount, crashedCount, slotCount }
  function roundResult(ctx) {
    const crashed = ctx.crashedCount || 0;
    const winner = ctx.teamMode ? null : subject(ctx.winnerSlot);
    const event = ctx.teamMode ? "team_takes_the_round" : (ctx.winnerLanded ? "sticks_the_landing" : "takes_the_round");
    const clips = winner ? [winner, event] : [event];
    if (ctx.landedCount >= 2 && ctx.margin > 0 && ctx.margin <= CLOSE_MARGIN) clips.push("by_a_hair");
    else if (ctx.margin != null && ctx.margin >= BIG_MARGIN) clips.push("in_a_blowout");
    else if (ctx.winnerLanded && crashed === 0 && ctx.slotCount > 1) clips.push("flawless");
    const fallback = ctx.humanLanded && ctx.humanWon ? ["flawless"] : ctx.anyLanded ? ["perfect"] : ["ko"];
    const require = winner ? [winner, event] : [event];
    return { event: "round_result", key: `round_result:${ctx.round}`, priority: PRIORITY.big, clips, fallback, require, coolDown: 0 };
  }
  // Context-gated easter eggs; each stands alone (never composed with a subject).
  function easterEgg(ctx) {
    if ((ctx.crashedCount || 0) >= 2) return "houston";                       // 2+ crashes in a round
    if (ctx.slotCount === 4 && ctx.landedCount === 4) return "all_four_land";  // everyone walked away
    if (ctx.anyLanded && ctx.margin > 0 && ctx.margin <= CLOSE_MARGIN) return "photo_finish";
    return null;
  }
  function easterLine(id) {
    return { event: `easter_egg:${id}`, key: `easter_egg:${id}`, priority: PRIORITY.easter, clips: [id], fallback: [], require: [id], coolDown: EASTER_COOLDOWN };
  }
  function takesTheLead(ctx) {
    const s = subject(ctx.leadSlot);
    return { event: "takes_the_lead", key: "takes_the_lead", priority: PRIORITY.normal, clips: [s, "takes_the_lead"], fallback: [], require: [s, "takes_the_lead"], coolDown: 8000 };
  }
  function matchWin(slot) {
    const s = subject(slot);
    return { event: "match_win", key: "match_win", priority: PRIORITY.big, clips: [s, "wins"], fallback: ["you_win"], require: [s, "wins"], coolDown: 0 };
  }
  function matchLose() {
    return { event: "match_lose", key: "match_lose", priority: PRIORITY.big, clips: ["you_lose"], fallback: ["you_lose"], coolDown: 0 };
  }

  return {
    say, stop,
    roundStart: (round, totalRounds) => say(roundStart(round, totalRounds)),
    go: () => say(go()),
    line: (id, opts) => say(line(id, opts)),
    // The round result plays as a composed line, then any easter egg stands alone.
    roundResult: (ctx) => {
      const ok = say(roundResult(ctx));
      const egg = easterEgg(ctx);
      if (egg) say(easterLine(egg));
      return ok;
    },
    takesTheLead: (ctx) => say(takesTheLead(ctx)),
    matchWin: (slot) => say(matchWin(slot)),
    matchLose: () => say(matchLose()),
    // exposed for tests / debugging
    _build: { roundStart, go, line, roundResult, takesTheLead, matchWin, matchLose, easterEgg, easterLine },
    _resolve: resolve,
    _queueLength: () => queue.length,
    _isBusy: () => !!(current || running),
  };
}
/* commentary-director:end */

/*
 * Wire the director to the live cabinet: the composer decodes through the
 * shared AudioContext, and clip availability comes from Sound's manifest.
 */
export const Composer = createVoiceComposer({
  gap: 0.06,
  getContext: () => Sound.ensure(),
  clipUrl: (id) => new URL(`assets/voice/${Sound.clipFile(id)}`, document.baseURI).href,
  fetchBytes: (url) => fetch(url, { cache: "force-cache" })
    .then((res) => (res && res.ok ? res.arrayBuffer() : null))
    .catch(() => null),
});

export const Commentary = createCommentary({
  play: (ids) => Composer.play(ids),
  stopPlayback: () => Composer.stop(),
  available: () => new Set(Sound.voiceNames()),
  isEnabled: () => Sound.isVoicesOn() && Sound.isUnlocked(),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer),
});
