import type { MapData, PillInfo, BaseInfo, StartInfo } from './MapData';
import { TERRAIN_TO_DISPLAY, DisplayTile, MAP_SIZE } from './TileTypes';

const MAGIC = 'BMAPBOLO';

export class BoloMapParser {
  static parse(buffer: ArrayBuffer): MapData {
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    // --- Header ---
    const magic = String.fromCharCode(...bytes.slice(0, 8));
    if (magic !== MAGIC) throw new Error(`Invalid .bmap magic: "${magic}"`);
    offset = 8;

    const version = bytes[offset++];
    if (version !== 0) console.warn(`Unknown .bmap version: ${version}`);

    const npills  = bytes[offset++];
    const nbases  = bytes[offset++];
    const nstarts = bytes[offset++];

    // --- Pill records (5 bytes each) ---
    const pills: PillInfo[] = [];
    for (let i = 0; i < npills; i++) {
      pills.push({
        x:      bytes[offset++],
        y:      bytes[offset++],
        owner:  bytes[offset++],
        armour: bytes[offset++],
        speed:  bytes[offset++],
      });
    }

    // --- Base records (6 bytes each) ---
    const bases: BaseInfo[] = [];
    for (let i = 0; i < nbases; i++) {
      bases.push({
        x:      bytes[offset++],
        y:      bytes[offset++],
        owner:  bytes[offset++],
        armour: bytes[offset++],
        shells: bytes[offset++],
        mines:  bytes[offset++],
      });
    }

    // --- Start position records (3 bytes each) ---
    const starts: StartInfo[] = [];
    for (let i = 0; i < nstarts; i++) {
      starts.push({
        x:   bytes[offset++],
        y:   bytes[offset++],
        dir: bytes[offset++],
      });
    }

    // --- Terrain grid ---
    // Initialize with defaults:
    //   Entire grid: Deep Sea (display 0)
    //   Inner 10-236 × 10-236: also Deep Sea (mined sea looks same for now)
    const terrain: number[][] = Array.from({ length: MAP_SIZE }, () =>
      new Array(MAP_SIZE).fill(DisplayTile.Sea)
    );

    // Decode RLE nibble-encoded row segments
    // Each segment: y (1 byte), startX (1 byte), endX (1 byte), then nibble stream
    // Nibble stream decoding:
    //   nibble < 8  → (nibble + 1) literal tile nibbles follow
    //   nibble >= 8 → run of (nibble - 6) copies of next nibble tile type
    // Segments end when y == 0xFF
    while (offset < bytes.length) {
      const y = bytes[offset++];
      if (y === 0xFF) break;
      if (offset >= bytes.length) break;

      const startX = bytes[offset++];
      const endX   = bytes[offset++];
      const count  = endX - startX; // number of tiles in this segment
      if (count <= 0) continue;

      // Nibble reader state
      let nibbleByte = 0;
      let nibbleHigh = true; // alternate high/low nibble within each byte

      const readNibble = (): number => {
        if (nibbleHigh) {
          nibbleByte = bytes[offset++];
          nibbleHigh = false;
          return (nibbleByte >> 4) & 0x0F;
        } else {
          nibbleHigh = true;
          return nibbleByte & 0x0F;
        }
      };

      let col = startX;
      let remaining = count;

      while (remaining > 0 && offset <= bytes.length) {
        const n = readNibble();

        if (n >= 8) {
          // Run of identical tiles
          const runLen = n - 6;
          const tileType = readNibble();
          const display = TERRAIN_TO_DISPLAY[tileType] ?? DisplayTile.Sea;
          for (let k = 0; k < runLen && remaining > 0; k++, col++, remaining--) {
            terrain[y][col] = display;
          }
        } else {
          // Literal tiles
          const litCount = n + 1;
          for (let k = 0; k < litCount && remaining > 0; k++, col++, remaining--) {
            const tileType = readNibble();
            terrain[y][col] = TERRAIN_TO_DISPLAY[tileType] ?? DisplayTile.Sea;
          }
        }
      }
    }

    // Overlay pill and base tile positions as grass underneath
    // (the actual pillbox/base objects will be drawn on top in Phase 4)
    for (const pill of pills) {
      if (pill.x < MAP_SIZE && pill.y < MAP_SIZE) {
        terrain[pill.y][pill.x] = DisplayTile.Grass;
      }
    }
    for (const base of bases) {
      if (base.x < MAP_SIZE && base.y < MAP_SIZE) {
        terrain[base.y][base.x] = DisplayTile.Road;
      }
    }

    return { pills, bases, starts, terrain };
  }
}
