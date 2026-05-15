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

    // Decode RLE nibble-encoded row segments.
    // Each segment: dataLen (1 byte, total segment size including header),
    //               y (1 byte), startX (1 byte), endX (1 byte),
    //               then (dataLen - 4) bytes of nibble data.
    // Sentinel: dataLen=4, y=0xFF.
    //
    // Nibble RLE:
    //   seqLen < 8  → next (seqLen + 1) nibbles are individual tile types
    //   seqLen >= 8 → next nibble tile type repeats (seqLen - 6) times
    while (offset < bytes.length) {
      const dataLen = bytes[offset++];
      if (offset >= bytes.length) break;

      const y      = bytes[offset++];
      if (y === 0xFF) break;

      const startX = bytes[offset++];
      const endX   = bytes[offset++];
      const count  = endX - startX;

      const nibbleData  = bytes.slice(offset, offset + dataLen - 4);
      offset += dataLen - 4;

      if (count <= 0) continue;

      let nibblePos = 0;
      const readNibble = (): number => {
        const idx = Math.floor(nibblePos);
        const n = (nibblePos === idx)
          ? (nibbleData[idx] >> 4) & 0x0F
          : nibbleData[idx] & 0x0F;
        nibblePos += 0.5;
        return n;
      };

      let col = startX;
      while (col < endX) {
        const seqLen = readNibble();
        if (seqLen < 8) {
          for (let k = 0; k < seqLen + 1 && col < endX; k++, col++) {
            terrain[y][col] = TERRAIN_TO_DISPLAY[readNibble()] ?? DisplayTile.Sea;
          }
        } else {
          const display = TERRAIN_TO_DISPLAY[readNibble()] ?? DisplayTile.Sea;
          for (let k = 0; k < seqLen - 6 && col < endX; k++, col++) {
            terrain[y][col] = display;
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
