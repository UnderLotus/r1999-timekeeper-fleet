import type { Profile } from "../types/profile";
import {
  LEVEL_CAPS,
  normalizeTeamName,
  PSYCHUBE_IMPRINT_MAX,
} from "../types/profile";
import { sanitizeProfile } from "./profile-sanitize";
import { emptyProfile, SLOTS_PER_TEAM, TEAM_COUNT } from "../types/profile";
import type { InsightIndex } from "../types/catalog";
import { getCharacter, getPsychube } from "./catalog";

const LEGACY_SHARE_VERSION = 3;
export const SHARE_VERSION = 4;
const COLLECTION_COUNT_BITS = 10;
const LEGACY_COLLECTION_COUNT_BITS = 8;
const MAX_COLLECTION_COUNT = (1 << COLLECTION_COUNT_BITS) - 1;
export const SHARE_PREFIX = "p=";
export interface SharePayload {
  version: number;
  profile: Profile;
}
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

class BitWriter {
  bits: number[] = [];
  put(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, index) => {
      if (bit) out[index >> 3] |= 1 << (7 - (index & 7));
    });
    return out;
  }
}
class BitReader {
  position = 0;
  constructor(private bytes: Uint8Array) {}
  get(width: number): number | null {
    if (this.position + width > this.bytes.length * 8) return null;
    let value = 0;
    for (let i = 0; i < width; i++) {
      const p = this.position++;
      value = (value << 1) | ((this.bytes[p >> 3] >> (7 - (p & 7))) & 1);
    }
    return value;
  }
  paddingIsCanonical(): boolean {
    const remaining = this.bytes.length * 8 - this.position;
    if (remaining > 7) return false;
    while (this.position < this.bytes.length * 8)
      if (this.get(1) !== 0) return false;
    return true;
  }
}
function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = i + 1 < bytes.length ? bytes[i + 1] : 0,
      c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += ALPHABET[c & 63];
  }
  return out;
}
function fromBase64Url(token: string): Uint8Array | null {
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const index = new Map([...ALPHABET].map((char, i) => [char, i]));
  const bytes: number[] = [];
  let acc = 0,
    bits = 0;
  for (const char of token) {
    const value = index.get(char);
    if (value === undefined) return null;
    acc = (acc << 6) | value;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && acc !== 0) return null;
  const result = Uint8Array.from(bytes);
  return toBase64Url(result) === token ? result : null;
}
function numericId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const value = Number(id);
  return value > 0 && value < 16384 ? value : null;
}
function suffixFor(baseId: string, variant: string | null): number | null {
  if (!variant || !variant.startsWith(baseId)) return null;
  const suffix = Number(variant.slice(baseId.length));
  return Number.isInteger(suffix) && suffix > 0 && suffix < 128 ? suffix : null;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
function putTeamName(writer: BitWriter, value: string): void {
  const bytes = new TextEncoder().encode(normalizeTeamName(value));
  writer.put(bytes.length, 6);
  for (const byte of bytes) writer.put(byte, 8);
}
function getTeamName(reader: BitReader): string | null {
  const length = reader.get(6);
  if (length === null || length > 48) return null;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    const byte = reader.get(8);
    if (byte === null) return null;
    bytes[index] = byte;
  }
  try {
    return normalizeTeamName(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return null;
  }
}

export function profileToPayload(profile: Profile): SharePayload {
  return { version: SHARE_VERSION, profile };
}
export function payloadToProfile(payload: SharePayload): Profile {
  return payload.profile;
}
export function encodeShareToken(payload: SharePayload): string {
  const profile = payload.profile,
    w = new BitWriter();
  w.put(SHARE_VERSION, 4);
  const characters = Object.entries(profile.characters)
    .filter(([id]) => numericId(id) !== null && !!getCharacter(id))
    .sort(([a], [b]) => Number(a) - Number(b));
  if (characters.length > MAX_COLLECTION_COUNT)
    throw new RangeError(
      `Share profile has ${characters.length} characters; maximum is ${MAX_COLLECTION_COUNT}`,
    );
  w.put(characters.length, COLLECTION_COUNT_BITS);
  for (const [id, build] of characters) {
    const def = getCharacter(id);
    if (!def) continue;
    const suffix = suffixFor(
      id,
      build.activeVariant && build.activeVariant !== def.defaultVariant
        ? build.activeVariant
        : null,
    );
    w.put(Number(id), 14);
    w.put(clamp(build.insight, 0, 3), 2);
    w.put(clamp(build.level - 1, 0, 63), 6);
    w.put(clamp(build.portray, 0, 5), 3);
    w.put(clamp(build.resonance, 0, 15), 4);
    w.put(suffix === null ? 0 : 1, 1);
    if (suffix !== null) w.put(suffix, 7);
  }
  const psychubes = Object.entries(profile.psychubes)
    .filter(([id]) => numericId(id) !== null && !!getPsychube(id))
    .sort(([a], [b]) => Number(a) - Number(b));
  if (psychubes.length > MAX_COLLECTION_COUNT)
    throw new RangeError(
      `Share profile has ${psychubes.length} psychubes; maximum is ${MAX_COLLECTION_COUNT}`,
    );
  w.put(psychubes.length, COLLECTION_COUNT_BITS);
  for (const [id, imprint] of psychubes) {
    w.put(Number(id), 14);
    w.put(clamp(imprint, 1, PSYCHUBE_IMPRINT_MAX), 3);
  }
  for (let ti = 0; ti < TEAM_COUNT; ti++) {
    putTeamName(w, profile.teams[ti]?.name ?? "");
    for (let si = 0; si < SLOTS_PER_TEAM; si++) {
      const slot = profile.teams[ti]?.slots[si];
      w.put(slot?.characterId ? (numericId(slot.characterId) ?? 0) : 0, 14);
      w.put(slot?.psychubeId ? (numericId(slot.psychubeId) ?? 0) : 0, 14);
      w.put(slot?.psychubeId2 ? (numericId(slot.psychubeId2) ?? 0) : 0, 14);
    }
  }
  return toBase64Url(w.bytes());
}
export function decodeSharePayload(token: string): SharePayload | null {
  const bytes = fromBase64Url(token);
  if (!bytes) return null;
  const r = new BitReader(bytes);
  const version = r.get(4);
  if (version === null) return null;
  const countBits =
    version === SHARE_VERSION
      ? COLLECTION_COUNT_BITS
      : version === LEGACY_SHARE_VERSION
        ? LEGACY_COLLECTION_COUNT_BITS
        : null;
  if (countBits === null) return null;
  const profile = emptyProfile();
  const charCount = r.get(countBits);
  if (charCount === null) return null;
  for (let i = 0; i < charCount; i++) {
    const idNum = r.get(14),
      insight = r.get(2),
      level = r.get(6),
      portray = r.get(3),
      resonance = r.get(4),
      hasVariant = r.get(1);
    if (
      [idNum, insight, level, portray, resonance, hasVariant].some(
        (v) => v === null,
      )
    )
      return null;
    const suffix = hasVariant ? r.get(7) : null;
    if (hasVariant && suffix === null) return null;
    const id = String(idNum),
      def = getCharacter(id);
    if (!def) continue;
    const variant = suffix ? `${id}${String(suffix).padStart(2, "0")}` : null;
    const activeVariant =
      variant && def.skins.some((skin) => skin.id === variant) ? variant : null;
    const cleanInsight = Math.min(def.maxInsight, insight!) as InsightIndex;
    profile.characters[id] = {
      insight: cleanInsight,
      level: clamp(level! + 1, 1, LEVEL_CAPS[cleanInsight]),
      portray: clamp(portray!, 0, 5),
      resonance: clamp(resonance!, 0, 15),
      activeVariant,
    };
  }
  const psyCount = r.get(countBits);
  if (psyCount === null) return null;
  for (let i = 0; i < psyCount; i++) {
    const idNum = r.get(14),
      imprint = r.get(3);
    if (idNum === null || imprint === null) return null;
    const id = String(idNum);
    if (getPsychube(id))
      profile.psychubes[id] = clamp(imprint, 1, PSYCHUBE_IMPRINT_MAX);
  }
  for (let ti = 0; ti < TEAM_COUNT; ti++) {
    const name = getTeamName(r);
    if (name === null) return null;
    profile.teams[ti].name = name;
    for (let si = 0; si < SLOTS_PER_TEAM; si++) {
      const charNum = r.get(14),
        psyNum = r.get(14),
        psyNum2 = r.get(14);
      if (charNum === null || psyNum === null || psyNum2 === null) return null;
      const characterId = charNum ? String(charNum) : null,
        psychubeId = psyNum ? String(psyNum) : null,
        psychubeId2 = psyNum2 ? String(psyNum2) : null;
      profile.teams[ti].slots[si] = {
        characterId:
          characterId && profile.characters[characterId] ? characterId : null,
        psychubeId:
          psychubeId && profile.psychubes[psychubeId] ? psychubeId : null,
        psychubeId2:
          psychubeId2 && profile.psychubes[psychubeId2] ? psychubeId2 : null,
      };
    }
  }
  if (!r.paddingIsCanonical()) return null;
  return { version, profile: sanitizeProfile(profile) };
}
