export interface PillInfo {
  x: number;
  y: number;
  owner: number;   // 0xFF = neutral
  armour: number;  // 0-15
  speed: number;   // fire rate in 20ms intervals
}

export interface BaseInfo {
  x: number;
  y: number;
  owner: number;
  armour: number;  // 0-90
  shells: number;  // 0-90
  mines: number;   // 0-90
}

export interface StartInfo {
  x: number;
  y: number;
  dir: number;     // 0-15, 16 compass directions
}

export interface MapData {
  pills: PillInfo[];
  bases: BaseInfo[];
  starts: StartInfo[];
  // 256×256 grid of display tile indices (DisplayTile enum values)
  terrain: number[][];
}
