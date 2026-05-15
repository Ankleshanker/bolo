// Raw terrain nibble values stored in .bmap file (4-bit, 0-7 used in practice)
export const RawTerrain = {
  Sea:    0,  // open/deep sea
  River:  1,  // shallow coastal water / river
  Swamp:  2,
  Crater: 3,
  Road:   4,
  Forest: 5,
  Rubble: 6,
  Grass:  7,
  // 8 = pillbox marker in terrain stream (uncommon)
  // 9 = base marker in terrain stream (uncommon)
} as const;

// Display tile index in our spritesheet (left-to-right strip)
export const DisplayTile = {
  Sea:         0,
  Shallow:     1,
  Swamp:       2,
  Crater:      3,
  Road:        4,
  Forest:      5,
  Rubble:      6,
  Grass:       7,
  Wall:        8,
  DamagedWall: 9,
  Mountain:   10,  // impassable, indestructible — bullets die on contact, no damage chain
} as const;

export const ROAD_VARIANT_BASE   = 11; // shifted from 10 to make room for Mountain
export const NUM_DISPLAY_TILES   = 27; // 11 base tiles + 16 road variants (indices 11–26)

// Raw nibble → display tile index
export const TERRAIN_TO_DISPLAY: Readonly<Record<number, number>> = {
  0: DisplayTile.Sea,
  1: DisplayTile.Shallow,  // river / coastal water
  2: DisplayTile.Swamp,
  3: DisplayTile.Crater,
  4: DisplayTile.Road,
  5: DisplayTile.Forest,
  6: DisplayTile.Rubble,
  7: DisplayTile.Grass,
  8: DisplayTile.Grass,    // pillbox terrain marker → grass underneath
  9: DisplayTile.Road,     // base terrain marker → road underneath
};

// Speed multiplier for each display tile (1.0 = normal grass speed)
export const TERRAIN_SPEED: Readonly<Record<number, number>> = {
  0:  0.0,   // Sea          — sink animation, not physics-blocked
  1:  0.25,  // Shallow Sea  — very slow wading
  2:  0.35,  // Swamp        — sluggish
  3:  0.65,  // Crater       — uneven ground
  4:  1.30,  // Road         — faster than grass
  5:  0.55,  // Forest       — slow + harvestable
  6:  0.85,  // Rubble       — slightly slow
  7:  1.00,  // Grass        — baseline
  8:  0.0,   // Wall         — collision-blocked
  9:  0.75,  // Damaged Wall — passable but rough
  10: 0.0,   // Mountain     — collision-blocked (impassable, indestructible)
};

// Tiles the physics system treats as solid walls
export const COLLISION_TILES = [8, 10]; // Wall + Mountain (Sea handled programmatically)

export const MAP_SIZE = 256;
export const TILE_SIZE = 32;
export const TILESET_KEY = 'tileset';
