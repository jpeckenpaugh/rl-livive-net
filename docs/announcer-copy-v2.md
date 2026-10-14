# Announcer Copy v2 — Contextual Commentator Catalog

Catalog id: `AIA-23` · Version 2 · 71 clips · Game: **LUNAR LANDER — TOURNAMENT EDITION** (`rl-livive-net`)

This is the copy source of truth for the contextual announcer. It replaces the
one-line-per-moment v1 callouts with a small grammar of reusable clips the
commentary director composes at run time. The machine-readable companion is
`tools/voice_lines_v2.json` — the same rows, loadable directly by
`tools/gen_voice_lines.py`.

## Design intent

The v1 pack sounds like a cabinet: it says a fixed line at a fixed moment. The
board asked for commentary that reacts to **the actual situation**. The fix is
not more one-off lines — it is a composition grammar.

- **Mental model (Jakob's Law / Mental Models):** a sports broadcast. The
  director is the play-by-play caller; clips are words, not sentences.
- **Cognitive Load / Chunking:** subjects, events and modifiers are separate
  clips, so a handful of small assets cover hundreds of specific moments.
- **Serial Position / Peak-End Rule:** the round result and the match result
  carry the richest copy, because those are the moments players remember.
- **Von Restorff:** easter eggs stand out precisely because they are rare and
  context-gated.
- **Doherty Threshold:** every clip is short (1–6 words, < 1.5 s) so a call
  never lags the action it describes.
- **Arcade fiction:** 1990s cabinet announcer, present tense, active voice.

## Voice rules

1. **Pilots are only ever "Player one".."Player four".** No usernames, no model
   names, no "1st party / policy / ONNX" — that is research talk, not cabinet talk.
2. **Present tense, active voice.** "Sticks the landing!", never "has stuck".
3. **Short.** 1–6 words. A subject clip and an event clip are each a single beat.
4. **Two or three variants for common events** so repeated moments do not repeat
   audio. Variants share a base id plus a `_2` / `_3` suffix; the director rotates
   them and avoids playing the same id twice in a row.
5. **Easter eggs are context-gated and rare.** A clear trigger, a cool-down, and
   (usually) once per match. They must never fire on the normal path.

## Composition model

```
composed call  =  [ subject ]  +  event  +  [ modifier ]
```

- **Subject** (`player_1`..`player_4`) is voiced alone as its own clip and only
  in solo/cup rounds where one pilot owns the event.
- **Event** is the verb of the call: `wins`, `takes_the_round`,
  `sticks_the_landing`, `goes_down`, `crashes`, `takes_the_lead`, ...
- **Modifier** attaches after the event: `by_a_hair`, `in_a_blowout`,
  `flawless`, `clean_sweep`.

Worked examples (each string is one played clip in the chain):

| Moment | Composed call |
|---|---|
| Player 2 wins a tight round | `player_2` + `wins` + `by_a_hair` → “Player two. Wins! By a hair!” |
| Player 3 crashes | `player_3` + `crashes` → “Player three. Crashes!” |
| Player 4 takes first place | `player_4` + `takes_the_lead` → “Player four. Takes the lead!” |
| Player 1 is the champion | `player_1` + `wins_the_match` + `clean_sweep` → “Player one. Wins the match! Clean sweep!” |
| Cup champion | `champion` (standalone) → “Champion!” |
| Standing easter egg | `houston` (standalone) → “Houston, we have some problems!” |

## Priority bands

The director interrupts a lower-priority call for a higher one on a big moment
(Peak-End Rule). Higher number = more important.

| Priority | Band | Meaning |
|---:|---|---|
| 0 | component | subject / modifier; never queued on its own |
| 20 | color | commentator color / interjection |
| 40 | pilot | per-pilot round event (clean landing / crash) |
| 60 | round | round start, round result, lead change, first landing |
| 80 | match | match point, match win/lose, challenger, timer |
| 90 | easter_egg | rare, context-gated moment |
| 100 | system | coin, pilot select, game over |

## Clip catalog

Composition grammar, priority bands and trigger glossary are the contract; the
tables below are the copy. `existing: true` rows already ship in v1 and must be
kept. `changed: true` rows change an existing clip (see **Changes to existing
clips**).

### Subject clips

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `player_1` | Player one. | subject | subject | Composed as the subject of any Player 1 callout. | 0 | always |
| `player_2` | Player two. | subject | subject | Composed as the subject of any Player 2 callout. | 0 | always |
| `player_3` | Player three. | subject | subject | Composed as the subject of any Player 3 callout. | 0 | always |
| `player_4` | Player four. | subject | subject | Composed as the subject of any Player 4 callout. | 0 | always |

### Round start

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `take_off` | Take off! | round_start | event | GO countdown ends / round start (existing). | 60 | always |
| `fight` | Fight! | round_start | event | GO countdown ends / round start (existing). | 60 | always |
| `here_we_go` | Here we go! | round_start | event | GO countdown ends; variant of take_off. | 60 | always |
| `and_theyre_away` | And they're away! | round_start | event | GO countdown ends; variant of take_off. | 60 | always |
| `off_the_pad` | Off the pad! | round_start | event | GO countdown ends; variant of take_off. | 60 | always |

### Clean landings

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `sticks_the_landing` | Sticks the landing! | landing | event | Slot outcome LANDED and it is the round's cleanest or only landing. | 40 | always |
| `sticks_the_landing_2` | Sticks it! | landing | event | Variant of sticks_the_landing. | 40 | always |
| `sticks_the_landing_3` | Nails the landing! | landing | event | Variant of sticks_the_landing. | 40 | always |
| `clean_landing` | Clean landing! | landing | event | Slot outcome LANDED with low descent speed / centered pad contact. | 40 | always |
| `touchdown` | Touchdown! | landing | event | Slot outcome LANDED; variant used to avoid repeats. | 40 | always |

### Crashes

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `goes_down` | Goes down! | crash | event | Slot outcome is a crash. | 40 | always |
| `goes_down_2` | Goes down hard! | crash | event | Slot outcome is a high-speed crash. | 40 | always |
| `crashes` | Crashes! | crash | event | Slot outcome is a crash; base id for the director. | 40 | always |
| `crashes_2` | Wrecks it! | crash | event | Variant of crashes. | 40 | always |
| `crashes_3` | Down in flames! | crash | event | Variant of crashes; echoes the existing lose tagline. | 40 | always |
| `ko` | K. O.! | crash | event | Every active pilot crashes in a round (existing). | 60 | always |

### Round result

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `takes_the_round` | Takes the round! | round_result | event | Single-pilot round winner; composed with subject. | 60 | always |
| `takes_the_round_2` | Takes it! | round_result | event | Variant of takes_the_round. | 60 | always |
| `wins` | Wins! | round_result | event | Round winner; base id expected by the director. | 60 | always |
| `wins_2` | Takes the win! | round_result | event | Variant of wins. | 60 | always |
| `wins_3` | Seals it! | round_result | event | Variant of wins; good on a decisive final approach. | 60 | always |
| `team_takes_the_round` | The team takes the round! | round_result | event | 2v2 team mode round win; used without a subject clip. | 60 | always |
| `perfect` | Perfect! | round_result | event | Every active pilot lands but no single clean winner (existing round-end variety). | 60 | always |

### Lead changes

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `takes_the_lead` | Takes the lead! | lead_change | event | A slot becomes the cumulative points leader; composed with subject. | 60 | always |
| `takes_the_lead_2` | Into the lead! | lead_change | event | Variant of takes_the_lead. | 60 | always |
| `takes_the_lead_3` | New leader! | lead_change | event | Variant of takes_the_lead; used when there is no single subject, e.g. a tie flips. | 60 | always |

### Match (win / lose / cup / timer)

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `match_point` | Match point! | match | event | A pilot or team is one round win from the match/cup. | 80 | always |
| `last_round` | Last round! | match | event | Final round of the match begins. | 80 | always |
| `takes_the_match` | Takes the match! | match | event | Match winner; composed with subject in solo mode. | 80 | always |
| `wins_the_match` | Wins the match! | match | event | Match winner; composed with subject in solo mode. | 80 | always |
| `wins_the_cup` | Wins the cup! | match | event | Cup-mode champion; composed with subject when one pilot owns the cup. | 80 | always |
| `champion` | Champion! | match | event | Crown/champion reveal; used without a subject. | 80 | always |
| `new_challenger` | New challenger! | match | event | Cup mode: a fresh pilot enters the next cup (existing). | 80 | always |
| `you_win` | You win! | match | event | Human pilot wins the match (existing). | 80 | always |
| `you_lose` | You lose. | match | event | Human pilot loses the match (existing). | 80 | always |
| `game_over` | Game over. | match | event | Match over splash (existing). | 100 | always |
| `time_up` | Time up! | match | event | Solo timer expires (existing). | 80 | always |

### Modifiers

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `by_a_hair` | By a hair! | modifier | modifier | Attaches to a round result when roundMargin <= 3 pts or the round needed a tiebreak. | 0 | common |
| `in_a_blowout` | In a blowout! | modifier | modifier | Attaches to a round result when roundMargin >= 40 pts or winner >= 2x runner-up. | 0 | common |
| `flawless` | Flawless! | modifier | modifier | Attaches to a round result when the winner landed clean and no pilot crashed. NOTE: replaces the existing standalone 'Flawless victory!' clip. | 0 | common |
| `clean_sweep` | Clean sweep! | modifier | modifier | Attaches to a match result when one pilot or team wins every round played. | 0 | rare |

### Commentator color (interjections)

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `neck_and_neck` | Neck and neck! | color | interjection | Mid-round, top two cumulative totals within 5 pts and both still flying. | 20 | common |
| `neck_and_neck_2` | Wheel to wheel! | color | interjection | Variant of neck_and_neck. | 20 | common |
| `all_tied` | All tied up! | color | interjection | Mid-round, the top two cumulative totals are exactly equal. | 20 | common |
| `all_tied_2` | Nothing between them! | color | interjection | Variant of all_tied. | 20 | common |
| `closing_in` | Closing in! | color | interjection | Mid-round, the runner-up has cut the gap to within 5 pts this round. | 20 | common |
| `closing_in_2` | Closing the gap! | color | interjection | Variant of closing_in. | 20 | common |
| `down_to_the_wire` | Down to the wire! | color | interjection | Final approach with the top two within 5 pts. | 20 | common |
| `down_to_the_wire_2` | Down to the wire now! | color | interjection | Variant of down_to_the_wire. | 20 | common |
| `hold_your_breath` | Hold your breath! | color | interjection | Two or more pilots on final approach in the same step window. | 20 | common |
| `no_room_for_error` | No room for error! | color | interjection | Final round with the match lead within 5 pts. | 20 | common |
| `what_a_round` | What a round! | color | interjection | A round that had at least three lead changes or a photo finish. | 20 | common |
| `what_a_round_2` | What a finish! | color | interjection | Variant of what_a_round. | 20 | common |
| `unbelievable` | Unbelievable! | color | interjection | A come-from-behind round win or a big points swing. | 20 | common |

### Easter eggs

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `houston` | Houston, we have some problems! | easter_egg | easter_egg | Two or more pilots crash in the same round. | 90 | uncommon |
| `photo_finish` | Photo finish! | easter_egg | easter_egg | roundMargin <= 3 pts or the round is decided on a placement tiebreak. Not spoken if houston fired this round. | 90 | rare |
| `all_four_land` | All four land! | easter_egg | easter_egg | Every one of the four pilots lands clean in the same round (4-pilot modes only). | 90 | rare |
| `big_comeback` | What a comeback! | easter_egg | easter_egg | The round or match winner was in last place (or a full round behind) earlier in the match. | 90 | rare |
| `the_eagle_has_landed` | The Eagle has landed! | easter_egg | easter_egg | The match champion landed clean in every round with no crash (flawless match). | 90 | very_rare |
| `one_small_step` | One small step! | easter_egg | easter_egg | The first clean landing of the entire match. | 90 | once_per_match |
| `over_the_moon` | Over the moon! | easter_egg | easter_egg | One pilot or team sweeps every round of the match. | 90 | very_rare |
| `the_pad_remembers` | The pad remembers. | easter_egg | easter_egg | The match is won on a round with at least one hazard level active; callback to the tagline. | 90 | rare |

### System / meta (existing)

| Clip id | Spoken text | Category | Type | Context trigger / condition | Priority | Rarity |
|---|---|---|---|---|---|---|
| `coin` | Insert coin. | system | system | Boot / attract -> menu (existing). | 100 | always |
| `select` | Choose your pilot. | system | system | Pilot select screen (existing). | 100 | always |
| `round_one` | Round one. | system | system | Round 1 intro (existing). | 60 | always |
| `round_two` | Round two. | system | system | Round 2 intro (existing). | 60 | always |
| `round_three` | Final round. | system | system | Round 3+ / final round intro (existing). | 60 | always |


## Changes to existing clips

| Clip id | v1 | v2 | Reason |
|---|---|---|---|
| `flawless` | “Flawless victory!” (standalone round-end call) | “Flawless!” (modifier) | The director now composes “Player N. Wins! Flawless!”; a short modifier is the reusable unit. The old standalone call is retired by the AIA-22 director. |

No other existing clip is removed. `coin`, `select`, `round_one/two/three`,
`fight`, `take_off`, `perfect`, `ko`, `you_win`, `you_lose`, `game_over`,
`new_challenger` and `time_up` stay as they are.

## Trigger glossary (signals the director already has)

- **`LANDED`** — per-slot round outcome is a clean pad contact.
- **`crash`** — per-slot round outcome is a crash / out-of-bounds.
- **`roundMargin`** — winner total minus runner-up total for the round.
- **`cumulativeLead`** — the slot owning the highest `match.stats[slot].total`.
- **`matchPoint`** — a pilot/team is one round win from the match/cup.
- **`firstLanding`** — the first `LANDED` outcome seen anywhere in the match.
- **`sweep`** — one pilot/team wins every round played.
- **`flawlessMatch`** — match champion landed clean every round, no crash.
- **`photoFinish`** — `roundMargin <= 3` or the round needed a placement tiebreak.
- **`blowout`** — `roundMargin >= 40` or winner scored ≥ 2× runner-up.

Easter-egg gating (do not weaken): `houston` is capped at one trigger per round
with a 2-round cool-down; every other easter egg is once per match, and no two
easter eggs play within two rounds of each other.

## Acceptance / handoff

- Copy in this document and in `tools/voice_lines_v2.json` match exactly.
- Chunked disposition is unchanged: director-driven commentary (AIA-22) and
  playback concerns live with the engineer. This task owns **copy only**.
- The director must degrade gracefully when any clip is absent from
  `manifest.json` (fail soft) and must keep the VOICE ON/OFF toggle honest.
- Easter eggs, once spoken, must be marked so a reloaded round does not repeat
  a once-per-match line.
