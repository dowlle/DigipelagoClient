# Digipelago — client

The web client for **Digipelago**, a Digimon guessing game for the Archipelago
Multiworld Randomizer (the Digimon counterpart to Pokepelago). Unofficial,
non-commercial fan project.

The multiworld feeds you items that widen what you can guess; you catch Digimon by
naming them (free-text, hard-mode clues, or a "name the silhouette" multiple-choice
mode), and each correct catch checks an Archipelago location. Logged-out play works
entirely from `localStorage`; an optional Discord login (shared across the ap-pie
family) syncs unlocked palette themes and saved connections.

The matching Archipelago world (the APWorld) lives in a separate repository.

## Tech

React 19 + TypeScript + Vite + Tailwind v4 on the front end; a small Flask + Postgres
backend (`backend/`) provides Discord SSO, theme/connection sync, and anonymous gameplay
telemetry. The same image serves the built SPA and the API.

```
npm install        # dependencies are pinned (no ^/~); audit before installing
npm run test:run   # vitest — domain + game logic
npm run dev        # local dev server
npm run build      # type-check + dash guard + production build
```

## License

This project's own source code is licensed under the **GNU Affero General Public
License v3.0 or later (AGPL-3.0-or-later)** — see `LICENSE`. Because the AGPL covers
network use, any modified version run as a hosted service must offer its source to its
users; the live deployment links back to this repository for that reason.

Copyright (C) 2026 Dowlle.

## Fan project disclaimer

Digipelago is an unofficial, non-commercial fan project. Digimon and all related names,
characters, and media are trademarks and copyright of Bandai, Toei Animation, and their
respective owners. This project is not affiliated with, endorsed by, or sponsored by any
of them.

Digimon data is sourced from [Digi-API](https://digi-api.com/) (which draws on Wikimon).
**No copyrighted Digimon artwork is hosted or distributed by this project** — sprites are
fetched on the player's own device, only with explicit consent, and cached locally. The
AGPL license covers this repository's own code only, not any Digimon names, data, or
media, which remain the property of their respective owners.
