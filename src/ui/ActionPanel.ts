import Phaser from 'phaser';

export type BuildAction = 'collectTrees' | 'buildRoad' | 'buildWall' | 'buildPillbox' | 'placeMine';

export const PANEL_WIDTH = 100;

const ACTIONS: {
  key:       BuildAction;
  label:     string;
  cost:      string;
  hotkey:    string;
  icon:      string;
  iconScale: number;
}[] = [
  { key: 'collectTrees', label: 'Collect\nTrees',  cost: '',         hotkey: '1', icon: 'icon_trees',  iconScale: 0.75 },
  { key: 'buildRoad',    label: 'Build\nRoad',     cost: '2 wood',   hotkey: '2', icon: 'icon_road',   iconScale: 0.75 },
  { key: 'buildWall',    label: 'Build\nWall',     cost: '4 wood',   hotkey: '3', icon: 'icon_wall',   iconScale: 0.75 },
  { key: 'buildPillbox', label: 'Place\nPillbox',  cost: '10W+pill', hotkey: '4', icon: 'pill_neutral', iconScale: 0.75 },
  { key: 'placeMine',    label: 'Place\nMine',     cost: '1 mine',   hotkey: '5', icon: 'mine',         iconScale: 1.5  },
];

const BTN_H   = 90;
const BTN_W   = 88;
const BTN_PAD = 6;

export class ActionPanel {
  private selected: BuildAction = 'collectTrees';
  private bgs: Map<BuildAction, Phaser.GameObjects.Rectangle> = new Map();
  private costTexts: Map<BuildAction, Phaser.GameObjects.Text> = new Map();
  private availability: Map<BuildAction, boolean> = new Map();
  readonly gameObjects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene) {
    const push = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.gameObjects.push(obj);
      return obj;
    };

    // Background — large enough to cover any screen height; owned by uiCam via gameObjects[]
    push(scene.add.rectangle(PANEL_WIDTH / 2, 1000, PANEL_WIDTH, 2000, 0x111820).setDepth(20));

    push(scene.add.text(PANEL_WIDTH / 2, 8, 'Builder', {
      fontSize: '10px', color: '#aaaaaa',
    }).setDepth(21).setOrigin(0.5, 0));

    const labelStyle  = { fontSize: '11px', color: '#ffffff', align: 'center' as const };
    const costStyle   = { fontSize: '9px',  color: '#aaaacc', align: 'center' as const };
    const hotkeyStyle = { fontSize: '9px',  color: '#555577', align: 'center' as const };

    ACTIONS.forEach(({ key, label, cost, hotkey, icon, iconScale }, i) => {
      const cy = 26 + i * (BTN_H + BTN_PAD) + BTN_H / 2;

      const bg = push(scene.add.rectangle(PANEL_WIDTH / 2, cy, BTN_W, BTN_H, 0x1e2e44)
        .setDepth(21)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.select(key))
        .on('pointerover', () => { if (this.selected !== key) bg.setFillStyle(0x2a3e58); })
        .on('pointerout',  () => this.refreshColor(key)));

      this.bgs.set(key, bg);

      push(scene.add.image(PANEL_WIDTH / 2, cy - 20, icon)
        .setDepth(22)
        .setScale(iconScale));

      push(scene.add.text(PANEL_WIDTH / 2, cy + 10, label, {
        ...labelStyle, wordWrap: { width: BTN_W - 4 },
      }).setDepth(22).setOrigin(0.5, 0.5));

      if (cost) {
        const costText = push(scene.add.text(PANEL_WIDTH / 2, cy + 28, cost, costStyle)
          .setDepth(22).setOrigin(0.5, 0.5));
        this.costTexts.set(key, costText as Phaser.GameObjects.Text);
      }

      push(scene.add.text(PANEL_WIDTH / 2, cy + 38, `[${hotkey}]`, hotkeyStyle)
        .setDepth(22).setOrigin(0.5, 0.5));
    });

    // Hotkeys 1–5
    const kb = scene.input.keyboard!;
    ACTIONS.forEach(({ key, hotkey }) => {
      kb.on(`keydown-${hotkey}`, () => this.select(key));
    });

    this.refreshColor(this.selected);
    this.select('collectTrees');
  }

  get selectedAction(): BuildAction { return this.selected; }

  private select(key: BuildAction) {
    this.selected = key;
    for (const [k] of this.bgs) this.refreshColor(k);
  }

  /** Call each frame with current resource counts to keep button states fresh. */
  update(trees: number, pillsCarried: number, mines: number) {
    const checks: [BuildAction, boolean][] = [
      ['buildRoad',    trees >= 2],
      ['buildWall',    trees >= 4],
      ['buildPillbox', trees >= 10 && pillsCarried >= 1],
      ['placeMine',    mines >= 1],
    ];
    for (const [action, ok] of checks) {
      if (this.availability.get(action) !== ok) {
        this.availability.set(action, ok);
        this.costTexts.get(action)?.setColor(ok ? '#aaaacc' : '#cc4444');
        this.refreshColor(action);
      }
    }
  }

  private refreshColor(key: BuildAction) {
    const available = this.availability.get(key) ?? true;
    const isSelected = key === this.selected;
    if (isSelected) {
      this.bgs.get(key)?.setFillStyle(0x2a5c1a).setAlpha(1);
    } else {
      this.bgs.get(key)?.setFillStyle(0x1e2e44).setAlpha(available ? 1 : 0.55);
    }
  }
}
