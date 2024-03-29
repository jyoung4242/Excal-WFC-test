import { Sprite, SpriteSheet, Loadable } from "excalibur";

/**
 * Wave Function Collapse
 *
 * summary: be able to create seeded levels that can be generated to interface
 * with Excalibur tilemaps
 *
 * the plugin manages the different levels.
 * a level consists of the WFC algorithm, the spritesheet, the rules, default tile settings
 * and the tile weighting
 *
 */

//#region types
interface WFCPluginOptions {
  spritesheet: SpriteSheet;
  tiledims: { width: number; height: number };
  leveldims: { width: number; height: number };
  seed?: number;
}

interface WFCoptions {
  levelsize: { width: number; height: number };
  seed?: number;
}

type levelData = {
  WFC: WFC;
  image: SpriteSheet;
  levelDims: { width: number; height: number };
  tileDims: { width: number; height: number };
  tileCoords: Record<string, any>;
};

type TileData = {
  index?: number;
  type?: string;
  entropy?: number;
  availableTiles?: Array<string>;
};

export type Rule = {
  up: Array<string>;
  down: Array<string>;
  left: Array<string>;
  right: Array<string>;
};

type WeightData = number;

enum BufferState {
  collapsed = "collapsed",
  ready = "ready",
  collapsing = "collapsing",
  unknown = "unknown",
  default = "defaults",
}
//#endregion

//exported plug in manages the tileset, and is the interface between Excalibur Tilemap and the actual WFC algorithm
export class ExcaliburWfcPlugin implements Loadable<{}> {
  levels: levelData[] = [];
  constructor() {}

  isLoaded(): boolean {
    return true;
  }

  data: {} = {};
  load() {
    return new Promise<{}>(resolve => {});
  }

  loadRules(levelIndex: number, rules: Record<string, Rule>) {
    if (this.levels[levelIndex] == undefined) throw new Error("invalid level index");
    this.levels[levelIndex].WFC.setRules(rules);
  }

  loadWeights(levelIndex: number, weights: Array<{ type: string; weight: number }>) {
    if (this.levels[levelIndex] == undefined) throw new Error("invalid level index");
    this.levels[levelIndex].WFC.setWeights(weights);
  }

  loadDefaults(levelIndex: number, defaults: Array<{ index: number; tile: TileData }>) {
    if (this.levels[levelIndex] == undefined) throw new Error("invalid level index");
    this.levels[levelIndex].WFC.setTiles(defaults);
  }

  async generatelevel(levelIndex: number, seed?: number): Promise<void> {
    if (this.levels[levelIndex] == undefined) throw new Error("invalid level index");
    await this.levels[levelIndex].WFC.generateLevel();
  }

  createNewLevel(options: WFCPluginOptions): void {
    let lvlOptions: WFCoptions;
    if (options.seed) {
      lvlOptions = {
        levelsize: { width: options.leveldims.width, height: options.leveldims.height },
        seed: options.seed,
      };
    } else {
      lvlOptions = {
        levelsize: { width: options.leveldims.width, height: options.leveldims.height },
      };
    }

    this.levels.push({
      image: options.spritesheet,
      WFC: new WFC(lvlOptions),
      levelDims: options.leveldims,
      tileDims: options.tiledims,
      tileCoords: {},
    });
  }

  loadTileCoords(levelIndex: number, coords: Record<string, any>) {
    if (this.levels[levelIndex] == undefined) throw new Error("invalid level index");
    this.levels[levelIndex].tileCoords = { ...coords };
  }

  getTile(levelIndex: number, index: number): Sprite {
    if (this.levels[levelIndex] == undefined) throw new Error("invalid level index");
    let tileType = this.levels[levelIndex].WFC.tiles[index].type;
    //console.log("tiletype: ", tileType);

    let { x, y } = this.levels[levelIndex].tileCoords[tileType as string];
    //console.log("tile coords, ", x, y);

    return this.levels[levelIndex].image.getSprite(x, y) as Sprite;
  }
}

//internal WFC algorithm class that generates a level based on tiledata, rules, and weighting
class WFC {
  width: number;
  rnd: Random;
  height: number;
  tiles: Array<TileData>;
  rules: Record<string, Rule>;
  numTiles: number;
  bufferstate: BufferState;
  weighting: Record<string, WeightData>;
  startWithRandom: boolean = true;

  constructor(options: WFCoptions) {
    this.width = options.levelsize.width;
    this.height = options.levelsize.height;
    this.numTiles = this.width * this.height;
    this.bufferstate = BufferState.unknown;
    options.seed ? (this.rnd = new Random(options.seed)) : (this.rnd = new Random(Date.now()));
    this.tiles = [];
    //create tiles entries
    for (let index = 0; index < this.numTiles; index++) {
      this.tiles.push({
        index,
        entropy: Infinity,
        availableTiles: [],
        type: "",
      });
    }
    this.rules = {};
    this.weighting = {};
  }

  async generateLevel() {
    //gaurd conditions
    this.bufferstate = this._isDataReady();
    if (this.bufferstate != BufferState.ready)
      throw new Error(
        `WFC ERROR: tile data is invalid currently in this state: ${this.bufferstate}, reinitialize buffer, set rules, weighting, tiledata, and defaults, and regenerate the level prior to calling this method`
      );

    //if randomStartFlag, choose and collaps one random tile
    if (this.startWithRandom) {
      const firstTile = this.rnd.pickOne(this.tiles);
      if (firstTile == undefined) throw new Error(`WFC ERROR: Error choosing initial starting tile, possible issue with tiles loaded`);
      firstTile.type = this.rnd.pickOne(Object.keys(this.rules));
      if (firstTile == undefined) throw new Error(`WFC ERROR: Error choosing initial starting tile, possible issue with rules`);
      firstTile.entropy = 0;
    }

    this._prepareTileDataForCollapsing();

    const wfcGenerator = this._collapseNext();
    let done: Boolean | undefined = false;
    this.bufferstate = BufferState.collapsing;

    while (!done) {
      try {
        ({ done } = await wfcGenerator.next());
      } catch (error) {
        //@ts-ignore
        console.error(error, error.payload);
        done = true;
      }
    }
    this.bufferstate = BufferState.collapsed;
  }

  getTileData(index: number) {
    if (this.bufferstate != BufferState.collapsed)
      throw new Error(
        `WFC ERROR: tile data is invalid currently in this state: ${this.bufferstate}, reinitialize buffer, set rules, weighting, tiledata, and defaults, and regenerate the level prior to calling this method`
      );

    const tileData = Array.from(this.tiles).find((tile: TileData) => tile.index == index);
    if (tileData == undefined) throw new Error(`WFC ERROR: Error choosing tile, possible issue with tiles loaded`);
    return tileData;
  }

  resetLevel() {
    this.tiles = [];
    this.rules = {};
    this.weighting = {};
    this.bufferstate = BufferState.unknown;
    //create tiles entries
    for (let index = 0; index < this.numTiles; index++) {
      this.tiles.push({
        index,
        entropy: Infinity,
        availableTiles: [],
        type: "",
      });
    }
  }

  setTileData(tile: TileData, index: number, setRandomStart: boolean = true) {
    try {
      this.tiles[index] = { index, type: tile.type, entropy: Infinity, availableTiles: [] };
    } catch (error) {
      throw new Error("WFC ERROR: issue setting tile data, possible issue with tiles loaded, tiles maybe be uninitialized");
    }

    this.startWithRandom = setRandomStart;
  }

  setTiles(tiles: Array<{ index: number; tile: TileData }>, setRandomStart: boolean = true) {
    tiles.forEach((inputTileData: TileData) => {
      //add new
      if (inputTileData.index)
        this.tiles[inputTileData.index] = {
          index: inputTileData.index,
          type: inputTileData.type,
          entropy: Infinity,
          availableTiles: [],
        };
    });
    this.startWithRandom = setRandomStart;
  }

  resetTileData() {
    this.tiles = [];
    for (let index = 0; index < this.numTiles; index++) {
      this.tiles.push({
        index,
        entropy: Infinity,
        availableTiles: [],
        type: "",
      });
    }
    this.startWithRandom = true;
  }

  setRule(type: string, rule: Rule) {
    this.rules[type] = rule;
  }

  setRules(rules: Array<{ type: string; rule: Rule }> | Record<string, Rule>) {
    if (Array.isArray(rules)) {
      rules.forEach(rule => {
        this.rules[rule.type] = rule.rule;
      });
    } else if (typeof rules == "object") {
      this.rules = JSON.parse(JSON.stringify(rules));
    }
  }

  resetRules() {
    this.rules = {};
  }

  setWeight(type: string, weight: number) {
    this.weighting[type] = weight;
  }

  setWeights(weights: Array<{ type: string; weight: number }>) {
    weights.forEach(weight => (this.weighting[weight.type] = weight.weight));
  }

  resetWeights() {
    this.weighting = {};
  }

  private async *_collapseNext() {
    while (true) {
      const nextGroupOfTiles: TileData[] = this._getListofTilesWithLowestEntropy();
      if (nextGroupOfTiles.length == 0) throw new Error("WFC ERROR: no valid tiles remaining");
      const currentTileObject: TileData = this.rnd.pickOne(nextGroupOfTiles);
      //console.log(currentTileObject);

      if (currentTileObject == undefined)
        throw new Error("WFC ERROR: unable to select next tile, invalid list of available tiles to choose");

      if (currentTileObject.availableTiles?.length == 0) {
        let err = new Error("WFC ERROR: there are no valid tiles remaining");
        Object.assign(err, { payload: this });
        throw err;
      }
      let retries = currentTileObject.availableTiles?.length;
      if (retries == undefined) throw new Error("WFC ERROR: no valid tiles remaining");

      let passedEntropyTest = false;
      let choices: Array<string> = [];
      while (!passedEntropyTest) {
        try {
          if (retries <= 0) break;
          let availableChoices = currentTileObject.availableTiles?.filter((item: string) => {
            const rslt = choices.find((chc: string) => chc == item);
            return !rslt;
          });

          currentTileObject.type = this.rnd.pickOneWeighted(availableChoices!, this.weighting);
          //console.log("275, current tile: ", currentTileObject.type);

          currentTileObject.entropy = 0;
          this._setEntropyOfSurroundingTiles(currentTileObject.index!);
          passedEntropyTest = true;
        } catch (error) {
          console.log("WFC ERROR -> ", error, currentTileObject);
          retries--;
        }

        if (!passedEntropyTest) throw new Error("WFC ERROR: failed to collapse tile");
        if (this._getNumberOfRemainingTilesToCollapse() == 0) return;
        //test for undefines
        if (this.tiles.some(tile => tile.type == undefined))
          throw new Error("WFC ERROR: corrupt tile data, invalid undefined type found");
        yield;
      }
    }
  }

  private _isDataReady(): BufferState {
    if (this.tiles.length == 0) return BufferState.unknown;
    if (Object.keys(this.rules).length == 0) return BufferState.unknown;
    return BufferState.ready;
  }

  private _getListofTilesWithLowestEntropy(): TileData[] {
    const filteredArrayNoZeroes = this.tiles.filter(t => t.entropy != 0 && t.entropy != undefined);
    //@ts-ignore
    const minEntropy = Math.min(...filteredArrayNoZeroes.map(element => element.entropy));
    const lowestEntropyObjects = this.tiles.filter(element => element.entropy === minEntropy);
    return lowestEntropyObjects;
  }

  private _setEntropyOfSurroundingTiles(index: number) {
    //get neighbors and validate legitimacy
    let upTileIndex, rightTileIndex, leftTileIndex, downTileIndex;
    index - this.width < 0 ? (upTileIndex = -1) : (upTileIndex = index - this.width);
    index + this.width > this.tiles.length - 1 ? (downTileIndex = -1) : (downTileIndex = index + this.width);
    index % this.width == this.width - 1 ? (rightTileIndex = -1) : (rightTileIndex = index + 1);
    index % this.width == 0 ? (leftTileIndex = -1) : (leftTileIndex = index - 1);

    //console.log("CHECKING SURROUNDINGS OF TILE: ", index);

    //console.log(upTileIndex, rightTileIndex, leftTileIndex, downTileIndex);

    //get the entropies of the neighbors
    let leftTileEntropy: number | undefined = undefined,
      upTileEntropy: number | undefined = undefined,
      rightTileEntropy: number | undefined = undefined,
      downTileEntropy: number | undefined = undefined;

    if (upTileIndex != -1) {
      try {
        upTileEntropy = this._getEntropy(upTileIndex);
      } catch (error) {
        throw new Error("broken level, can't get entropy of up tile");
      }
    }
    if (downTileIndex != -1) {
      try {
        downTileEntropy = this._getEntropy(downTileIndex);
      } catch (error) {
        throw new Error("broken level, can't get entropy of down tile");
      }
    }

    if (leftTileIndex != -1) {
      try {
        leftTileEntropy = this._getEntropy(leftTileIndex);
      } catch (error) {
        throw new Error("broken level, can't get entropy of left tile");
      }
    }

    if (rightTileIndex != -1) {
      try {
        rightTileEntropy = this._getEntropy(rightTileIndex);
      } catch (error) {
        throw new Error("broken level, can't get entropy of right tile");
      }
    }

    //update the entropies
    if (leftTileIndex != -1 && leftTileEntropy && this.tiles[leftTileIndex].entropy != 0) {
      this.tiles[leftTileIndex].entropy = leftTileEntropy;
    }
    if (rightTileIndex != -1 && rightTileEntropy) {
      this.tiles[rightTileIndex].entropy = rightTileEntropy;
    }
    if (upTileIndex != -1 && upTileEntropy) {
      this.tiles[upTileIndex].entropy = upTileEntropy;
    }
    if (downTileIndex != -1 && downTileEntropy) {
      this.tiles[downTileIndex].entropy = downTileEntropy;
    }
  }

  private _getNumberOfRemainingTilesToCollapse(): number {
    return this.tiles.reduce((count, element) => {
      if (element.entropy != 0) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  private _prepareTileDataForCollapsing() {
    // cycle through indices
    this.tiles.forEach((tile: any, index: number) => {
      // if its zero, skip it
      //this.log("inside Entropy Scan, tile: ", tile);

      if (tile.entropy == 0) return;

      try {
        this.tiles[index].entropy = this._getEntropy(index);
      } catch (error) {
        //@ts-ignore
        throw new Error(error);
      }
    });
  }

  private _getEntropy(index: number): number {
    if (this.tiles[index].entropy == 0) return 0;

    //finding neighbors
    let upTileIndex, rightTileIndex, leftTileIndex, downTileIndex;
    index - this.width < 0 ? (upTileIndex = -1) : (upTileIndex = index - this.width);
    index + this.width > this.tiles.length - 1 ? (downTileIndex = -1) : (downTileIndex = index + this.width);
    index % this.width == this.width - 1 ? (rightTileIndex = -1) : (rightTileIndex = index + 1);
    index % this.width == 0 ? (leftTileIndex = -1) : (leftTileIndex = index - 1);

    //grab neighbor tiles allowed
    let upTileAvailableTiles: any[] = [];
    let downTileAvailableTiles: any[] = [];
    let leftTileAvailableTiles: any[] = [];
    let rightTileAvailableTiles: any[] = [];

    //console.log(`get entropy, index: ${index}  `, upTileIndex, downTileIndex, leftTileIndex, rightTileIndex);

    if (upTileIndex != -1 && this.tiles[upTileIndex].entropy == 0) {
      let uptiletype = this.tiles[upTileIndex].type;
      //  console.log("uptile check: ", upTileIndex, uptiletype);

      if (uptiletype == undefined) throw new Error("invalid tile type found");
      upTileAvailableTiles = [...this.rules[uptiletype].down];
      //console.log("uptile check: ", upTileIndex, uptiletype, upTileAvailableTiles);
    }
    if (downTileIndex != -1 && this.tiles[downTileIndex].entropy == 0) {
      let downTileType = this.tiles[downTileIndex].type;
      //console.log("downtile check: ", downTileIndex, downTileType);
      if (downTileType == undefined) throw new Error("invalid tile type found");
      downTileAvailableTiles = [...this.rules[downTileType].up];
      //console.log("downtile check: ", downTileIndex, downTileType, downTileAvailableTiles);
    }
    if (leftTileIndex != -1 && this.tiles[leftTileIndex].entropy == 0) {
      let leftTileType = this.tiles[leftTileIndex].type;
      //console.log("leftile check: ", leftTileIndex, leftTileType);
      if (leftTileType == undefined) throw new Error("invalid tile type found");
      leftTileAvailableTiles = [...this.rules[leftTileType].right];
    }
    if (rightTileIndex != -1 && this.tiles[rightTileIndex].entropy == 0) {
      let rightTileType = this.tiles[rightTileIndex].type;
      //console.log("right check: ", rightTileIndex, rightTileType);
      if (rightTileType == undefined) throw new Error("invalid tile type found");
      rightTileAvailableTiles = [...this.rules[rightTileType].left];
    }

    //consolodate into one array
    let testArray = [];

    if (upTileAvailableTiles.length) testArray.push(upTileAvailableTiles);
    if (downTileAvailableTiles.length) testArray.push(downTileAvailableTiles);
    if (leftTileAvailableTiles.length) testArray.push(leftTileAvailableTiles);
    if (rightTileAvailableTiles.length) testArray.push(rightTileAvailableTiles);
    /*  if (this.tiles[upTileIndex]) console.log("current up tile type: ", this.tiles[upTileIndex].type);
    if (this.tiles[downTileIndex]) console.log("current down tile type: ", this.tiles[downTileIndex].type);
    if (this.tiles[leftTileIndex]) console.log("current left tile type: ", this.tiles[leftTileIndex].type);
    if (this.tiles[rightTileIndex]) console.log("current right type: ", this.tiles[rightTileIndex].type); */

    //    console.log(this.tiles);

    //  console.log("testarray", testArray);

    if (testArray.length == 0) {
      return Infinity;
    }
    const consolodatedArray = testArray.reduce((sum, arr) => sum.filter((x: any) => arr.includes(x)), testArray[0]);

    if (consolodatedArray.length == 0) throw new Error("Broken Plot, no availble neighbor tiles");

    this.tiles[index].availableTiles = [...consolodatedArray];
    if (this.tiles[index].availableTiles == undefined) throw new Error("Broken Plot, no availble neighbor tiles");
    //@ts-ignore
    return this.tiles[index].availableTiles.length;
  }
}

class Random {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  // Linear Congruential Generator
  getRandom(): number {
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    this.seed = (a * this.seed + c) % m;
    return this.seed / m;
  }

  getRandomFloat(min: number, max: number): number {
    return this.getRandom() * max + min;
  }

  getRandomInteger(min: number, max: number): number {
    return Math.floor(this.getRandom() * max + min);
  }

  pickOne(set: Array<any>): any {
    let rnd = this.getRandom();
    let choice = Math.floor(rnd * set.length);
    return set[choice];
  }

  pickOneWeighted(set: Array<any>, wieghting: Record<string, number>): any {
    let newSet: any[] = [];
    set.forEach((item, ind) => {
      if (wieghting.length == 0 || wieghting[item] == undefined) {
        newSet.push(item);
      } else {
        for (let i = 0; i < wieghting[item]; i++) {
          newSet.push(item);
        }
      }
    });
    let rnd = this.getRandom();
    let choice = Math.floor(rnd * newSet.length);
    return newSet[choice];
  }
}
