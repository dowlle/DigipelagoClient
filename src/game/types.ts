// Core Digipelago domain types. Kept dependency-free so the game logic is
// trivially unit-testable in isolation.

export interface Digimon {
  id: number;
  name: string;
  level: string;           // "Rookie" | "Champion" | "Ultimate" | "Mega"
  tier: number;            // LEVEL_TIER[level]
  attributes: string[];    // may be multi-valued
  attribute: string;       // primary (gating) attribute
  types: string[];
  fields: string[];
  year: string | null;
  sprite: string | null;
  xAntibody: boolean;      // clue dimension (boolean match)
}

// The pinned reference dataset (bundled with the client, version-gated).
export interface Dataset {
  version: string;                       // sha256[:12] of the source JSON
  levelTier: Record<string, number>;     // {"Rookie":2,...}
  attributes: string[];
  meta: Record<string, Digimon>;         // id -> Digimon
  lines: Record<string, number[]>;       // id -> curated prior ids (non-roots only)
  roots: Set<number>;                    // ids guessable with no prior
}

// Authoritative per-seed config from Archipelago slot_data (server-sent, lean).
export interface SlotData {
  dataset_version: string;
  starting_capacity: number;
  capacity_per_upgrade: number;
  goal: 'total' | 'level';
  goal_level: string | null;
  goal_count: number;
  starting_attribute: string;
  // Client input-mode lock (client-side only, never gates AP). Older seeds omit
  // these, so all three are optional and the client falls back to free choice.
  starting_mode?: 'free_text' | 'free_text_hard' | 'silhouette';
  allow_mode_switch?: boolean;
  starting_stamina?: number;        // base silhouette Stamina-bar max
  stamina_regen_seconds?: number;   // seconds to regen one Stamina point (0 = free guesses)
  level_tier: Record<string, number>;
  attributes: string[];
  cell_counts: Record<string, number>;   // "Level|Attribute" -> count
  pool_size: number;
}

// Live game state, fully reconstructable from the AP server (see ADR-0002):
// items received -> capacity/tier/heldAttributes; DataStorage -> caught.
export interface GameState {
  capacity: number;        // current cap = starting + upgrades*per
  tierReached: number;     // 1 + count("Digivolution")
  heldAttributes: Set<string>;
  caught: Set<number>;     // identity of caught Digimon (from DataStorage)
  caughtCount: number;     // = number of checked catch-slot locations
  staminaUps: number;      // count of received "Stamina Up" items (raises Stamina max)
  foodReceived: Record<string, number>; // received food item name -> count (eat to refill)
}
