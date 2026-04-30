import { C } from "./constants";

export { C };

// Deterministic color palette for agent chips — BUG-21/50 fix
const AGENT_PALETTE = [
  { t: C.orange, bg: C.orangeLight, br: C.orangeBdr },
  { t: C.teal,   bg: C.tealLight,   br: C.tealBdr },
  { t: C.blue,   bg: C.blueLight,   br: C.blueBdr },
  { t: C.green,  bg: C.greenLight,  br: C.greenBdr },
  { t: C.red,    bg: C.redLight,    br: C.redBdr },
];

export function eClr(colorIndex: number) {
  return AGENT_PALETTE[colorIndex % AGENT_PALETTE.length] ?? AGENT_PALETTE[0];
}

export function init(name: string): string {
  return (name || "?")
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function fmtS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtL(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
