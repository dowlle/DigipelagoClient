// Food catalog (silhouette-mode Stamina refills). Food items are received from the
// multiworld (AP item stream) and eaten on the client to refill the Stamina bar.
// Client-side only: eating never gates AP (Stamina self-heals). Names match the
// apworld's Items.py exactly, keyed for received-count + refill lookups.
//
// refill = how many Stamina points one item restores; Infinity = refill to full.

export interface FoodDef {
  /** AP item name (must match worlds/digipelago/Items.py). */
  item: string;
  /** Short display label. */
  label: string;
  /** Stamina points restored when eaten (Infinity = full). */
  refill: number;
}

export const FOODS: FoodDef[] = [
  { item: 'Processed Meat', label: 'Processed Meat', refill: 1 },
  { item: 'Digimeat', label: 'Digimeat', refill: 3 },
  { item: 'DigiProtein', label: 'DigiProtein', refill: Number.POSITIVE_INFINITY },
];

/** All food item names, for the DataStorage "eaten" watch. */
export const FOOD_ITEMS: string[] = FOODS.map((f) => f.item);

/** item name -> Stamina restored. */
export const FOOD_REFILL: Record<string, number> = Object.fromEntries(
  FOODS.map((f) => [f.item, f.refill]),
);
