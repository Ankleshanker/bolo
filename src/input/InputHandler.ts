import Phaser from 'phaser';

export interface InputState {
  thrust:      boolean;
  brake:       boolean;
  turnLeft:    boolean;
  turnRight:   boolean;
  fire:        boolean;
}

export class InputHandler {
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private w: Phaser.Input.Keyboard.Key;
  private s: Phaser.Input.Keyboard.Key;
  private a: Phaser.Input.Keyboard.Key;
  private d: Phaser.Input.Keyboard.Key;
  private _fireHeld = false; // event-driven so startup key state doesn't bleed in

  constructor(scene: Phaser.Scene) {
    this.cursors = scene.input.keyboard!.createCursorKeys();
    const kb = scene.input.keyboard!;
    const K  = Phaser.Input.Keyboard.KeyCodes;
    this.w = kb.addKey(K.W);
    this.s = kb.addKey(K.S);
    this.a = kb.addKey(K.A);
    this.d = kb.addKey(K.D);

    kb.on('keydown-SPACE', () => { this._fireHeld = true;  });
    kb.on('keyup-SPACE',   () => { this._fireHeld = false; });
  }

  getState(): InputState {
    return {
      thrust:    this.cursors.up.isDown    || this.w.isDown,
      brake:     this.cursors.down.isDown  || this.s.isDown,
      turnLeft:  this.cursors.left.isDown  || this.a.isDown,
      turnRight: this.cursors.right.isDown || this.d.isDown,
      fire:      this._fireHeld,
    };
  }
}
