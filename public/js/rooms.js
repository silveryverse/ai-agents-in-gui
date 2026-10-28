/**
 * Room layout for the Agent HQ office.
 *
 * Coordinates are tile coordinates. Each room's outer rectangle includes a
 * one-tile wall; its interior is (x+1 .. x+w-2, y+1 .. y+h-2). The central
 * corridor runs from y=14 to y=19 and every room opens onto it.
 */

export const ROOMS = [
  {
    id: "research",
    label: "RESEARCH LAB",
    short: "Research",
    x: 2,
    y: 2,
    w: 13,
    h: 12,
    floor: "lab",
    wall: "#294248",
    trim: "#5eead4",
    tag: "EXPLORE",
  },
  {
    id: "planning",
    label: "PLANNING",
    short: "Planning",
    x: 16,
    y: 2,
    w: 13,
    h: 12,
    floor: "wood",
    wall: "#4a3a2d",
    trim: "#fbbf24",
    tag: "PLAN",
  },
  {
    id: "coding",
    label: "CODING ROOM",
    short: "Coding",
    x: 30,
    y: 2,
    w: 13,
    h: 12,
    floor: "carpet",
    wall: "#303a58",
    trim: "#818cf8",
    tag: "BUILD",
  },
  {
    id: "deployment",
    label: "DEPLOYMENT",
    short: "Deploy",
    x: 44,
    y: 2,
    w: 14,
    h: 12,
    floor: "server",
    wall: "#343a45",
    trim: "#fb923c",
    tag: "SHIP",
  },
  {
    id: "kitchen",
    label: "KITCHEN",
    short: "Kitchen",
    x: 2,
    y: 20,
    w: 13,
    h: 12,
    floor: "kitchen",
    wall: "#4a3c2d",
    trim: "#fcd34d",
    tag: "COFFEE",
  },
  {
    id: "testing",
    label: "TESTING LAB",
    short: "Testing",
    x: 16,
    y: 20,
    w: 13,
    h: 12,
    floor: "test",
    wall: "#31424c",
    trim: "#38bdf8",
    tag: "VERIFY",
  },
  {
    id: "lounge",
    label: "CHILL ZONE",
    short: "Chill",
    x: 30,
    y: 20,
    w: 28,
    h: 12,
    floor: "lounge",
    wall: "#45324b",
    trim: "#f472b6",
    tag: "BREATHE",
  },
];

export const ROOM_BY_ID = new Map(ROOMS.map((room) => [room.id, room]));

/** Door tile ranges. Each door is three tiles wide. */
export const DOORS = [
  { room: "research", x: 7, y: 13, w: 3 },
  { room: "planning", x: 21, y: 13, w: 3 },
  { room: "coding", x: 35, y: 13, w: 3 },
  { room: "deployment", x: 49, y: 13, w: 3 },
  { room: "kitchen", x: 7, y: 20, w: 3 },
  { room: "testing", x: 21, y: 20, w: 3 },
  { room: "lounge", x: 35, y: 20, w: 3 },
  { room: "lounge", x: 48, y: 20, w: 3 },
];

export const SPAWN = { x: 28, y: 16 };
