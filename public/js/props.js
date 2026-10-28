/**
 * Furniture, rugs, wall art, and work spots.
 * Format: [kind, tx, ty, tw, th, options?]
 */

const T = "#5eead4";
const P = "#fbbf24";
const C = "#818cf8";
const D = "#fb923c";
const K = "#fcd34d";
const S = "#38bdf8";
const L = "#f472b6";

export const FURNITURE = [
  // Research lab -------------------------------------------------------
  ["labBench", 4, 3, 8, 2, { accent: T }],
  ["scope", 12, 3, 1, 2, { accent: T }],
  ["specimen", 3, 7, 1, 2, { accent: T }],
  ["desk", 4, 8, 4, 2, { accent: T, monitors: 1 }],
  ["bookshelf", 11, 7, 2, 4, { accent: T }],
  ["cabinet", 13, 8, 1, 3, { accent: T }],
  ["plant", 13, 3, 1, 1, {}],
  ["plant", 3, 11, 1, 1, {}],

  // Planning room ------------------------------------------------------
  ["meetingTable", 20, 6, 6, 3, { accent: P }],
  ["bookshelf", 17, 3, 2, 4, { accent: P }],
  ["credenza", 17, 8, 1, 2, { accent: P }],
  ["cabinet", 17, 11, 2, 1, { accent: P }],
  ["plantTall", 27, 6, 1, 2, {}],
  ["plant", 27, 3, 1, 1, {}],
  ["plant", 27, 11, 1, 1, {}],

  // Coding room --------------------------------------------------------
  ["desk", 32, 4, 8, 2, { accent: C, monitors: 2 }],
  ["desk", 32, 8, 8, 2, { accent: C, monitors: 2 }],
  ["bookshelf", 40, 3, 2, 4, { accent: C }],
  ["plantTall", 41, 8, 1, 2, {}],
  ["cabinet", 40, 11, 2, 1, { accent: C }],
  ["plant", 31, 11, 1, 1, {}],

  // Deployment ---------------------------------------------------------
  ["serverRack", 46, 3, 2, 5, { accent: D }],
  ["serverRack", 54, 3, 2, 5, { accent: D }],
  ["console", 49, 8, 5, 2, { accent: D, monitors: 3 }],
  ["cabinet", 45, 3, 1, 2, { accent: D }],
  ["ups", 45, 7, 1, 2, { accent: D }],
  ["cableReel", 56, 7, 1, 1, { accent: D }],
  ["plant", 45, 11, 1, 1, {}],

  // Kitchen ------------------------------------------------------------
  ["counter", 3, 29, 9, 2, { accent: K }],
  ["fridge", 12, 21, 2, 4, { accent: K }],
  ["plantTall", 3, 21, 1, 2, {}],
  ["crate", 3, 24, 1, 1, { accent: K }],
  ["island", 5, 24, 5, 2, { accent: K }],
  ["cabinet", 12, 26, 2, 2, { accent: K }],
  ["plant", 3, 27, 1, 1, {}],

  // Testing ------------------------------------------------------------
  ["testBench", 18, 22, 8, 2, { accent: S, monitors: 2 }],
  ["serverRack", 26, 21, 2, 5, { accent: S }],
  ["cabinet", 17, 27, 3, 2, { accent: S }],
  ["toolCart", 18, 26, 1, 1, { accent: S }],
  ["cableReel", 25, 26, 1, 1, { accent: S }],
  ["cabinet", 26, 27, 2, 2, { accent: S }],
  ["plant", 17, 30, 1, 1, {}],
  ["plant", 27, 29, 1, 1, {}],

  // Chill zone ---------------------------------------------------------
  ["sofa", 33, 22, 7, 2, { accent: "#b15f83", cat: true }],
  ["sofa", 43, 22, 7, 2, { accent: "#b15f83" }],
  ["recordPlayer", 33, 25, 2, 1, { accent: L }],
  ["coffeeTable", 36, 26, 5, 2, { accent: L }],
  ["vending", 52, 27, 1, 2, { accent: L }],
  ["plantTall", 56, 26, 1, 2, {}],
  ["bookshelf", 53, 21, 3, 4, { accent: L }],
  ["arcade", 51, 22, 2, 3, { accent: L }],
  ["plant", 31, 21, 1, 1, {}],
  ["plant", 56, 29, 1, 1, {}],
  ["lamp", 32, 28, 1, 1, {}],
  ["lamp", 48, 28, 1, 1, {}],
  ["beanbag", 40, 28, 1, 1, { solid: false, accent: "#eab308" }],
  ["beanbag", 45, 28, 1, 1, { solid: false, accent: "#fb7185" }],

  // Corridor greenery --------------------------------------------------
  ["bench", 12, 19, 4, 1, {}],
  ["cooler", 31, 14, 1, 1, {}],
  ["plant", 3, 14, 1, 1, {}],
  ["plant", 57, 14, 1, 1, {}],
  ["plant", 3, 19, 1, 1, {}],
  ["plant", 57, 19, 1, 1, {}],
];

export const RUGS = [
  [3, 16, 54, 2, "runner", "#6d3b3b"],
  [4, 6, 6, 4, "tile", "#21434b"],
  [19, 5, 9, 5, "tile", "#513d2b"],
  [31, 6, 10, 2, "runner", "#303a5c"],
  [48, 9, 7, 3, "tile", "#363d4b"],
  [3, 25, 10, 4, "checker", "#a98f6b"],
  [17, 24, 10, 4, "tile", "#2c3c46"],
  [48, 11, 7, 1, "hazard", "#c28a2e"],
  [32, 22, 24, 8, "lounge", "#5b3e58"],
];

/** Wall-mounted art. [kind, tx, ty, tw] */
export const WALL_DECOR = [
  ["window", 3, 2, 2],
  ["window", 11, 2, 2],
  ["whiteboard", 3, 13, 3],
  ["window", 17, 2, 2],
  ["window", 26, 2, 2],
  ["whiteboard", 17, 13, 3],
  ["window", 31, 2, 2],
  ["window", 40, 2, 2],
  ["poster", 31, 13, 2],
  ["window", 45, 2, 2],
  ["screen", 47, 2, 2],
  ["window", 55, 2, 2],
  ["statusBoard", 45, 13, 3],
  ["menu", 3, 20, 2],
  ["clock", 11, 20, 1],
  ["window", 3, 31, 2],
  ["window", 11, 31, 2],
  ["window", 17, 31, 2],
  ["statusBoard", 24, 20, 3],
  ["window", 25, 31, 2],
  ["poster", 42, 20, 2],
  ["clock", 46, 20, 1],
  ["window", 33, 31, 2],
  ["window", 43, 31, 2],
  ["window", 52, 31, 2],
];

/** Work / rest spots. [tx, ty, facing] */
export const SPOTS = {
  research: [
    [6, 5, "up", true],
    [9, 5, "up", true],
    [5, 10, "up", true],
    [7, 10, "up", true],
    [10, 11, "up", false],
    [13, 5, "left", false],
  ],
  planning: [
    [20, 5, "down", true],
    [23, 5, "down", true],
    [26, 5, "down", true],
    [20, 9, "up", true],
    [23, 9, "up", true],
    [26, 9, "up", true],
    [19, 7, "right", true],
    [26, 7, "left", true],
    [21, 10, "up", true],
    [24, 10, "up", true],
  ],
  coding: [
    [33, 6, "up", true],
    [36, 6, "up", true],
    [39, 6, "up", true],
    [33, 10, "up", true],
    [36, 10, "up", true],
    [39, 10, "up", true],
    [31, 6, "right", false],
    [40, 7, "left", false],
    [31, 10, "right", false],
  ],
  deployment: [
    [48, 6, "down", false],
    [50, 6, "down", false],
    [48, 9, "right", false],
    [50, 10, "up", true],
    [52, 10, "up", true],
    [54, 10, "up", true],
    [56, 10, "up", true],
  ],
  kitchen: [
    [4, 23, "down", false],
    [9, 23, "down", false],
    [11, 23, "down", false],
    [4, 26, "right", true],
    [10, 26, "left", true],
    [7, 27, "up", true],
    [11, 27, "up", true],
    [4, 28, "down", true],
  ],
  testing: [
    [19, 24, "up", true],
    [22, 24, "up", true],
    [25, 24, "up", true],
    [21, 28, "up", false],
    [24, 28, "up", false],
    [17, 26, "right", false],
    [25, 29, "up", false],
  ],
  lounge: [
    [34, 24, "up", true],
    [37, 24, "up", true],
    [39, 24, "up", true],
    [44, 24, "up", true],
    [47, 24, "up", true],
    [49, 24, "up", true],
    [35, 26, "right", true],
    [41, 26, "left", true],
    [38, 28, "up", true],
    [40, 28, "up", true],
    [45, 28, "up", true],
    [33, 29, "right", false],
    [42, 29, "up", false],
    [46, 29, "up", false],
    [50, 26, "left", false],
    [52, 25, "up", false],
    [54, 26, "up", false],
  ],
};

/** Warm pools of light. [x, y, radius, rgb, alpha] */
export const LIGHTS = [
  [8 * 16, 16 * 16, 110, "255, 199, 128", 0.1],
  [22 * 16, 16 * 16, 110, "255, 199, 128", 0.1],
  [36 * 16, 16 * 16, 110, "255, 199, 128", 0.1],
  [50 * 16, 16 * 16, 110, "255, 199, 128", 0.1],
  [32 * 16, 28 * 16, 90, "255, 184, 112", 0.2],
  [48 * 16, 28 * 16, 90, "255, 184, 112", 0.2],
  [8 * 16, 6 * 16, 100, "126, 232, 214", 0.05],
  [51 * 16, 6 * 16, 100, "251, 146, 60", 0.06],
  [22 * 16, 25 * 16, 100, "56, 189, 248", 0.05],
  [8 * 16, 24 * 16, 100, "252, 211, 77", 0.06],
];
