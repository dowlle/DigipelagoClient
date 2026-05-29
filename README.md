# DigipelagoClient

The web client for **Digipelago** — a Digimon guessing-game randomizer for Archipelago
(Digimon counterpart to PokepelagoClient). Non-commercial fan project. Forked in spirit
from `D:\pythonProjects\PokepelagoClient\`.

**Design & decisions live in the vault:** `F:\Vaults\stefappelhof\11-Dev\Digipelago\`.

## Status — foundation (Phase 1 client kickoff)

The **domain core is in place and unit-tested**; the React UI is a placeholder.

```
src/
  data/
    digimon_mvp.json   pinned reference dataset (bundled, version-gated)
    dataset.ts         loads it -> typed Dataset; DATASET_VERSION; isRoot/priorsOf
  game/
    types.ts           Digimon / Dataset / SlotData / GameState
    guess.ts           guessable() + capacity/tier/goalProgress (pure, mirrors the apworld)
    state.ts           reconstruct GameState from AP (item NAMES + caught set) + drift guard
    guess.test.ts      vitest: dataset integrity, guessable gates, goal progress, version guard
  App.tsx / main.tsx   placeholder shell
```

### Key design choices

- **Decode by item NAME, not ID offsets** — `archipelago.js` resolves received items to
  names, so `summarizeReceived` just counts `"Digivolution"` / `"DigiStorage Upgrade"` /
  `"<Attr> Key"`. Avoids Pokepelago's BUG-12 ID-offset drift class entirely.
- **`guessable()` is strictly stronger than the apworld's `can_catch_n`** (it adds
  digivolution-line ordering via `priors.some(caught)`), so the client can never exceed AP
  logic.
- **State is server-reconstructable** (ADR-0002): items → capacity/tier/attributes,
  checked slots → caughtCount, AP DataStorage → caught identity. localStorage will hold
  only connection details + prefs.
- **`dataset_version` guard** — `assertDatasetMatches` refuses to run a seed whose
  `slot_data.dataset_version` doesn't match the bundled dataset.

## Install & test

Dependencies are pinned (no `^`/`~`). Audit, then:

```
npm install
npm run test:run     # vitest — domain logic
npm run dev          # placeholder UI
```

## Next

Connection manager (archipelago.js), `onConnected`/`onItemsReceived` wiring + DataStorage
caught-set, the DexGrid + guess input (free-text and multiple-choice w/ regenerating
wrong-pick meter), clue feedback (level/attribute/type/field/year/X-Antibody), sprites.
