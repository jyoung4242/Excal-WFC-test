import "./style.css";
import { UI } from "@peasy-lib/peasy-ui";
import { Engine, DisplayMode, TileMap, ImageSource, SpriteSheet, Camera, Vector } from "excalibur";
import { ExcaliburWfcPlugin } from "./exWFC";
import { rules } from "./rules";
import { tileCoords } from "./tilemapping";
import { weightArray } from "./weights";

//@ts-ignore
import roguelikess from "./assets/roguelike.png";
import { WaveFunctionCollapsePlugIn, WFCoptions } from "./ExcaliburWFCPlugin";
const kennyRougeLikePack = new ImageSource(roguelikess);
await kennyRougeLikePack.load();
const rlSS = SpriteSheet.fromImageSource({
  image: kennyRougeLikePack,
  grid: { columns: 57, rows: 31, spriteHeight: 16, spriteWidth: 16 },
  spacing: { margin: { x: 1, y: 1 } },
});

const model = {};

const template = `
<style>
    canvas{
        position: fixed;
        top:50%;
        left:50%;
        transform: translate(-50%,-50%);
    }
</style>
<div>
    <canvas id='cnv'></canvas>
</div>`;
await UI.create(document.body, model, template).attached;

const game = new Engine({
  width: 800, // the width of the canvas
  height: 600, // the height of the canvas
  canvasElementId: "cnv", // the DOM canvas element ID, if you are providing your own
  displayMode: DisplayMode.Fixed, // the display mode
});

const wfcOptions: WFCoptions = {
  levelsize: { width: 20, height: 20 },
  spritesheet: rlSS,
};

const wfcPlugin = new WaveFunctionCollapsePlugIn(wfcOptions);
wfcPlugin.setRules(rules);
wfcPlugin.loadTileCoords(tileCoords);
wfcPlugin.setWeights(weightArray);
await wfcPlugin.generateLevel();

// Create a tilemap
const tilemap = new TileMap({
  rows: 20,
  columns: 20,
  tileWidth: 16,
  tileHeight: 16,
});

// loop through tilemap cells
let tileIndex = 0;

for (let tile of tilemap.tiles) {
  const sprite = wfcPlugin.getTile(tileIndex); ///rlSS.getSprite(0, 0);
  if (sprite) {
    tile.addGraphic(sprite);
  }
  tileIndex++;
}

await game.start();
game.add(tilemap);
game.currentScene.camera.pos = new Vector(160, 160);

setTimeout;
console.log(wfcPlugin.getJSONTiles);
console.log(wfcPlugin.tiles);
