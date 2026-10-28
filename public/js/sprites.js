/**
 * Original procedural pixel-art characters.
 *
 * Every sprite is drawn from a 16x24 pixel grid at 2x scale, so the whole game
 * stays crisp and no external art assets are required. The agent's server-side
 * color drives the shirt, headset, and nameplate accent.
 */

const SCALE = 2;
const HAIR = ["#2b1f1a", "#3a2a20", "#1f2530", "#4a2c26", "#55402c"];
const SKIN = ["#f3c9a2", "#e3ae82", "#cb8d64", "#9c6748"];
const PANTS = ["#2f3a52", "#3a3450", "#2a3d44"];
const SHOES = "#1a1e28";

const spriteCache = new Map();

export function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mix a hex color toward white (positive) or black (negative). */
export function shade(hex, amount) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const value = Number.parseInt(hex.slice(1), 16);
  const target = amount >= 0 ? 255 : 0;
  const mix = Math.min(1, Math.abs(amount));
  const channels = [16, 8, 0].map((shift) => {
    const channel = (value >> shift) & 255;
    return Math.round(channel + (target - channel) * mix);
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Build (and cache) one sprite frame.
 * direction: "down" | "up" | "side"
 * state: "idle" | "walk" | "work" | "sit" | "turn" | "cheer"
 * variant: "type" | "read" | "think" | "use" | "error" | "wait"
 */
export function makeCharacterSprite(color, direction, state, frame, variant = "type") {
  const key = `${color}|${direction}|${state}|${frame}|${variant}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = 16 * SCALE;
  canvas.height = 24 * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const seed = hashString(`${color}${direction}`);
  const skin = SKIN[seed % SKIN.length];
  const skinShade = shade(skin, -0.22);
  const hair = HAIR[(seed >> 3) % HAIR.length];
  const pants = PANTS[(seed >> 5) % PANTS.length];
  const shirt = color;
  const shirtLight = shade(color, 0.2);
  const shirtDark = shade(color, -0.28);
  const shirtDeep = shade(color, -0.45);

  const rect = (x, y, w, h, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(
      Math.round(x) * SCALE,
      Math.round(y) * SCALE,
      Math.round(w) * SCALE,
      Math.round(h) * SCALE,
    );
  };

  const walking = state === "walk";
  const seated = state === "sit";
  const working = state === "work" || seated;
  const cheering = state === "cheer";
  const turning = state === "turn";
  const reading = working && variant === "read";
  const thinking = working && variant === "think";
  const usingTool = working && variant === "use";
  const relaxing = working && variant === "relax";
  const alarmed = working && variant === "error";
  const blink = (state === "idle" || cheering || relaxing) && frame % 6 === 5;
  const swing = walking ? [1, 0, -1, 0][frame % 4] : 0;
  const lift = walking && frame % 4 === 1 ? 1 : 0;
  const bob = walking ? (frame % 4 === 1 ? -1 : 0) : 0;
  const glance = state === "idle" || relaxing ? [0, 0, -1, 0, 1, 0][frame % 6] : 0;
  const typingLeft = working ? [0, 1, 0, 1][frame % 4] : 0;
  const typingRight = working ? [1, 0, 1, 0][frame % 4] : 0;

  // Shadow-free body so the office can draw its own contact shadow.
  const bodyY = 11 + bob + (seated ? 1 : 0);

  // Legs and shoes -----------------------------------------------------
  if (turning) {
    // A small pivoting stance that sells a direction change without adding a
    // long animation state.
    rect(4, 18, 3, 4, pants);
    rect(9, 18, 2, 4, pants);
    rect(3, 21, 4, 1, SHOES);
    rect(9, 21, 3, 1, SHOES);
  } else if (seated) {
    // Tucked legs: the chair and desk do most of the work, while the knees
    // still read as a seated silhouette.
    rect(4, 18, 3, 3, pants);
    rect(9, 18, 3, 3, pants);
    rect(3, 20, 4, 1, SHOES);
    rect(9, 20, 4, 1, SHOES);
  } else if (!working) {
    rect(5 - swing, 18, 2, 4 - lift, pants);
    rect(9 + swing, 18, 3, 4, pants);
    rect(5 - swing, 21 - lift, 3, 1, SHOES);
    rect(9 + swing, 21, 3, 1, SHOES);
  } else {
    rect(5, 19, 2, 3, pants);
    rect(9, 19, 2, 3, pants);
    rect(5, 21, 3, 1, SHOES);
    rect(9, 21, 3, 1, SHOES);
  }

  // Torso --------------------------------------------------------------
  rect(4, bodyY, 8, 7, shirt);
  rect(4, bodyY, 2, 7, shirtLight);
  rect(10, bodyY, 2, 7, shirtDark);
  rect(7, bodyY, 2, 1, shirtDeep);
  rect(7, bodyY + 2, 2, 4, shirtDeep); // zipper / badge stripe
  rect(6, bodyY + 6, 4, 1, shirtDeep); // belt

  // Arms ---------------------------------------------------------------
  if (cheering) {
    // Both hands up. The office adds a few sparkles around the head while an
    // execution success cue is still fresh.
    rect(2, bodyY - 2, 2, 5, shirtDark);
    rect(12, bodyY - 2, 2, 5, shirtDark);
    rect(2, bodyY - 4, 2, 2, skin);
    rect(12, bodyY - 4, 2, 2, skin);
  } else if (reading) {
    // A small page held in both hands, with a slow one-pixel page bob.
    const pageY = bodyY + 4 - (frame % 4 === 1 ? 1 : 0);
    rect(4, pageY, 8, 5, "#e9e2d2");
    rect(5, pageY + 1, 6, 1, "#8d9aa7");
    rect(5, pageY + 3, 4, 1, "#8d9aa7");
    rect(3, bodyY + 2, 2, 4, shirtDark);
    rect(11, bodyY + 2, 2, 4, shirtDark);
    rect(4, pageY + 1, 1, 2, skin);
    rect(11, pageY + 1, 1, 2, skin);
  } else if (thinking) {
    rect(2, bodyY + 2, 2, 4, shirtDark);
    rect(2, bodyY + 6, 2, 1, skin);
    rect(11, bodyY + 1, 2, 3, shirtDark);
    rect(10, bodyY - 1, 2, 2, skin);
    rect(9, bodyY + 1, 1, 1, skinShade);
  } else if (usingTool) {
    rect(3, bodyY + 2, 2, 4, shirtDark);
    rect(11, bodyY + 2, 2, 4, shirtDark);
    rect(4, bodyY + 6, 2, 2, skin);
    rect(10, bodyY + 6, 2, 2, skin);
    // A tiny tool head in the active hand.
    rect(12, bodyY + 7, 2, 1, "#d6d1c4");
    rect(13, bodyY + 6, 1, 1, "#fbbf24");
  } else if (relaxing) {
    // At ease on a sofa or counter stool: hands resting in the lap.
    rect(3, bodyY + 3, 2, 4, shirtDark);
    rect(11, bodyY + 3, 2, 4, shirtDark);
    rect(4, bodyY + 6, 2, 1, skin);
    rect(10, bodyY + 6, 2, 1, skin);
  } else if (working) {
    // Alternating hands on the keyboard, with a tiny feedback bob.
    rect(3, bodyY + 3 - typingLeft, 2, 4, shirtDark);
    rect(11, bodyY + 3 - typingRight, 2, 4, shirtDark);
    rect(3, bodyY + 6 - typingLeft, 2, 2, skin);
    rect(11, bodyY + 6 - typingRight, 2, 2, skin);
  } else if (turning) {
    rect(2, bodyY + 2, 2, 4, shirtDark);
    rect(12, bodyY + 1, 2, 5, shirtDark);
    rect(2, bodyY + 6, 2, 1, skin);
    rect(12, bodyY + 6, 2, 1, skin);
  } else {
    const armSwing = walking ? swing : 0;
    rect(2, bodyY + 1 - armSwing, 2, 5, shirtDark);
    rect(12, bodyY + 1 + armSwing, 2, 5, shirtDark);
    rect(2, bodyY + 6 - armSwing, 2, 1, skin);
    rect(12, bodyY + 6 + armSwing, 2, 1, skin);
  }

  // Head ---------------------------------------------------------------
  const headY =
    3 + (working ? 1 : 0) + (working && frame % 4 === 2 ? 1 : 0) + (reading ? 1 : 0);
  if (direction === "side") {
    rect(4, headY, 9, 8, skin);
    rect(4, headY + 7, 8, 1, skinShade);
    rect(2, headY + 5, 1, 3, skin); // ear
    rect(13, headY + 6, 1, 2, skinShade); // nose

    // Hair swept toward the back.
    rect(3, headY - 1, 11, 3, hair);
    rect(3, headY + 1, 4, 5, hair);
    rect(7, headY + 1, 2, 1, hair);

    // Eye, mouth, and cheek.
    rect(10, headY + 4, 1, blink ? 1 : 2, "#241a18");
    if (!blink) rect(10, headY + 4, 1, 1, "#fff6e6");
    rect(11, headY + 6, 1, 1, shade(skin, -0.4));
    rect(8, headY + 5, 2, 1, "#e88f86");
  } else {
    rect(3, headY, 10, 8, skin);
    rect(3, headY + 7, 10, 1, skinShade);
    rect(2, headY + 5, 1, 2, skin);
    rect(13, headY + 5, 1, 2, skin);

    // Hair cap and fringe.
    rect(2, headY - 1, 12, 3, hair);
    if (direction === "down") {
      rect(3, headY + 2, 10, 1, hair);
      rect(2, headY + 3, 1, 3, hair);
      rect(13, headY + 3, 1, 3, hair);
      rect(4, headY + 2, 2, 2, hair);
      rect(9, headY + 2, 3, 1, hair);
    } else {
      rect(2, headY + 2, 12, 6, hair);
      rect(4, headY + 5, 8, 1, shade(hair, 0.12));
    }

    if (direction === "down") {
      // Eyes (or a blink line), nose, and mouth. Idle frames glance left and
      // right so waiting characters still feel alive.
      const eyeX = glance;
      if (blink) {
        rect(5 + eyeX, headY + 5, 2, 1, "#241a18");
        rect(9 + eyeX, headY + 5, 2, 1, "#241a18");
      } else {
        rect(5 + eyeX, headY + 4, 2, 2, "#241a18");
        rect(9 + eyeX, headY + 4, 2, 2, "#241a18");
        rect(5 + eyeX, headY + 4, 1, 1, "#fff6e6");
        rect(9 + eyeX, headY + 4, 1, 1, "#fff6e6");
      }
      rect(7, headY + 5, 2, 1, skinShade);
      rect(6, headY + 7, 4, 1, "#b56b65");
      rect(4, headY + 6, 1, 1, "#e88f86");
      rect(11, headY + 6, 1, 1, "#e88f86");
    }
  }

  // Headset: a small band + earpiece in the agent's identity color.
  rect(2, headY - 2, 11, 1, shirtDeep);
  rect(1, headY + 3, 1, 3, shirtDeep);
  rect(2, headY + 6, 1, 1, shirtLight);
  rect(12, headY + 3, 1, 3, shirtDeep);

  if (direction === "down" && alarmed) {
    // Worried brows, a small sweat pixel, and a flat mouth.
    rect(4, headY + 3, 2, 1, "#241a18");
    rect(10, headY + 3, 2, 1, "#241a18");
    rect(7, headY + 7, 2, 1, "#7a2f35");
    rect(12, headY + 2, 1, 2, "#7dd3fc");
  }
  if (direction === "down" && cheering) {
    rect(6, headY + 7, 4, 2, "#b56b65");
    rect(7, headY + 7, 2, 1, "#f4a3a0");
    rect(4, headY + 6, 1, 1, "#e88f86");
    rect(11, headY + 6, 1, 1, "#e88f86");
  }

  // Tiny status thread at the shoulder for a little personality.
  if (working) {
    rect(12, bodyY + 1, 1, 1, "#fef3c7");
    rect(13, bodyY + 1, 1, 1, "#fbbf24");
  }

  spriteCache.set(key, canvas);
  return canvas;
}

/** Draw a small character portrait into a roster/inspector canvas. */
export function drawAvatar(canvas, color) {
  if (!canvas) return;
  const sprite = makeCharacterSprite(color, "down", "idle", 0);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sprite, 0, 0);
}
