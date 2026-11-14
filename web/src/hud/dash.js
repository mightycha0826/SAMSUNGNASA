// The readings as tiles that move (layout.js says where to, and how).
//
// Each reading has a tile of its own: a small panel fixed to the view, like the other HUD
// cards. The tiles stand in two columns beside what the wearer looks at; when the list of
// readings changes, or one becomes critical, they spring to their new places, a new one fades
// in where it belongs and a dropped one fades out where it stood.
//
// A tile is drawn again only when what it shows has changed (the caller says so with `sig`).

import { HUD } from './config.js';
import { drawReading } from './draw.js';
import { arrange, spring, stretch } from './layout.js';

/**
 * @param tools { makePanel, parent (the group the HUD cards hang in), unitM (metres per degree at the HUD's distance) }
 */
export function createDash({ makePanel, parent, unitM }) {
  const K = HUD.dash;
  const tiles = new Map(); // id -> tile
  let wanted = new Map(); // id -> where layout.js puts it (only the readings on show)

  function make(r) {
    const panel = makePanel(K.tileWDeg, r.hDeg);
    panel.mesh.visible = false;
    panel.mat.opacity = 0;
    parent.add(panel.mesh);
    return { panel, hDeg: r.hDeg, x: null, y: null, scale: null, sig: null, shown: false };
  }

  return {
    /** The readings to show, most important first (index.js statusVM): each { id, hDeg, state, sig, ...what drawReading needs }. */
    set(readings) {
      wanted = arrange(readings, K);
      for (const r of readings) {
        let tile = tiles.get(r.id);
        if (!tile) tiles.set(r.id, (tile = make(r)));
        if (tile.sig !== r.sig) {
          tile.sig = r.sig;
          drawReading(tile.panel.g, HUD.pxPerDeg, r);
          tile.panel.tex.needsUpdate = true;
        }
      }
    },

    /** Every frame: move the tiles toward their places, fade the ones that come and go. */
    tick(dt) {
      for (const [id, tile] of tiles) {
        const to = wanted.get(id);
        const { mesh, mat } = tile.panel;
        if (to) {
          const yMid = to.y + (tile.hDeg * to.scale) / 2; // layout gives the top edge; the mesh is placed by its middle
          if (!tile.shown) {
            // It appears where it belongs, a little small, and grows into place.
            tile.x = { x: to.x, v: 0 };
            tile.y = { x: yMid, v: 0 };
            tile.scale = { x: to.scale * K.appearScale, v: 0 };
            tile.shown = true;
          }
          spring(tile.x, to.x, dt, K.spring);
          spring(tile.y, yMid, dt, K.spring);
          spring(tile.scale, to.scale, dt, K.spring);
          mat.opacity += (1 - mat.opacity) * (1 - Math.exp(-K.fadeRate * dt));
        } else if (tile.shown) {
          // Dropped: it fades out where it stands, shrinking a little.
          spring(tile.scale, K.appearScale, dt, K.spring);
          mat.opacity += (0 - mat.opacity) * (1 - Math.exp(-K.fadeRate * dt));
          if (mat.opacity < 0.02) {
            tile.shown = false;
            mat.opacity = 0;
          }
        }
        mesh.visible = tile.shown && mat.opacity > 0.01;
        if (!mesh.visible) continue;
        const [sx, sy] = stretch(tile.x.v, tile.y.v, K.stretch, K.stretchFullDegS);
        mesh.position.set(tile.x.x * unitM, (HUD.stage.hDeg / 2 - tile.y.x) * unitM, -HUD.distanceM);
        mesh.scale.set(tile.scale.x * sx, tile.scale.x * sy, 1);
      }
    },

    /** Where every tile is now and where it is going (tests, console). */
    state: () =>
      [...tiles].filter(([, t]) => t.shown).map(([id, t]) => ({ id, side: wanted.get(id)?.side ?? 'leaving', x: +t.x.x.toFixed(2), y: +t.y.x.toFixed(2), scale: +t.scale.x.toFixed(2), opacity: +t.panel.mat.opacity.toFixed(2) })),
  };
}
