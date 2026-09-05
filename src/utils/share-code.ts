import type { InsightIndex } from "../types/catalog";
import type { CharacterBuild, Profile } from "../types/profile";
import {
  emptyProfile,
  LEVEL_CAPS,
  normalizeTeamName,
  PSYCHUBE_IMPRINT_MAX,
  SLOTS_PER_TEAM,
  TEAM_COUNT,
} from "../types/profile";
import { getCharacter, getPsychube } from "./catalog";
import { sanitizeProfile } from "./profile-sanitize";

const LEGACY_SHARE_VERSION = 3;
const PREVIOUS_SHARE_VERSION = 4;
export const SHARE_VERSION = 5;
const VERSION_BITS = 4;
const COLLECTION_COUNT_BITS = 10;
const LEGACY_COLLECTION_COUNT_BITS = 8;
const OFFICIAL_ID_BITS = 14;
const MAX_OFFICIAL_ID = (1 << OFFICIAL_ID_BITS) - 1;
const MAX_COLLECTION_COUNT = (1 << COLLECTION_COUNT_BITS) - 1;
export const SHARE_PREFIX = "p=";

export interface DecodedShareToken {
  sourceVersion: number;
  profile: Profile;
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

class BitWriter {
  bits: number[] = [];

  put(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }

  putPositiveGamma(value: number): void {
    if (!Number.isInteger(value) || value <= 0 || value > MAX_OFFICIAL_ID)
      throw new RangeError(`Invalid positive delta: ${value}`);
    const width = Math.floor(Math.log2(value));
    this.put(0, width);
    this.put(value, width + 1);
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

  getPositiveGamma(): number | null {
    let leadingZeros = 0;
    while (true) {
      const bit = this.get(1);
      if (bit === null) return null;
      if (bit === 1) break;
      leadingZeros++;
      if (leadingZeros >= OFFICIAL_ID_BITS) return null;
    }
    const remainder = this.get(leadingZeros);
    if (remainder === null) return null;
    return (1 << leadingZeros) | remainder;
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
  return value > 0 && value <= MAX_OFFICIAL_ID ? value : null;
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

function referenceWidth(count: number): number {
  return count === 0 ? 0 : Math.ceil(Math.log2(count + 1));
}

function putOwnedId(
  writer: BitWriter,
  id: number,
  previousId: number | null,
): void {
  if (previousId === null) writer.put(id, OFFICIAL_ID_BITS);
  else writer.putPositiveGamma(id - previousId);
}

function getOwnedId(
  reader: BitReader,
  previousId: number | null,
): number | null {
  const id =
    previousId === null
      ? reader.get(OFFICIAL_ID_BITS)
      : (() => {
          const delta = reader.getPositiveGamma();
          return delta === null ? null : previousId + delta;
        })();
  if (id === null || id <= 0 || id > MAX_OFFICIAL_ID) return null;
  if (previousId !== null && id <= previousId) return null;
  return id;
}

function cleanBuildForWire(build: CharacterBuild): CharacterBuild {
  return {
    insight: clamp(build.insight, 0, 3) as InsightIndex,
    level: clamp(build.level, 1, 64),
    portray: clamp(build.portray, 0, 5),
    resonance: clamp(build.resonance, 0, 15),
    activeVariant: build.activeVariant,
  };
}

function putV5Build(writer: BitWriter, build: CharacterBuild): void {
  const clean = cleanBuildForWire(build);
  const isOwnedOnly =
    clean.insight === 0 &&
    clean.level === 1 &&
    clean.portray === 0 &&
    clean.resonance === 1;
  const isInsightThreeMax = clean.insight === 3 && clean.level === 60;
  if (isOwnedOnly) {
    writer.put(0, 1);
    return;
  }
  if (isInsightThreeMax) {
    writer.put(2, 2);
    writer.put(clean.portray === 0 ? 0 : 1, 1);
    if (clean.portray !== 0) writer.put(clean.portray, 3);
    writer.put(clean.resonance === 10 ? 0 : 1, 1);
    if (clean.resonance !== 10) writer.put(clean.resonance, 4);
    return;
  }
  writer.put(3, 2);
  writer.put(clean.insight, 2);
  writer.put(clean.level - 1, 6);
  writer.put(clean.portray, 3);
  writer.put(clean.resonance, 4);
}

function getV5Build(
  reader: BitReader,
): Omit<CharacterBuild, "activeVariant"> | null {
  const first = reader.get(1);
  if (first === null) return null;
  if (first === 0) return { insight: 0, level: 1, portray: 0, resonance: 1 };
  const second = reader.get(1);
  if (second === null) return null;
  if (second === 0) {
    const hasPortray = reader.get(1);
    if (hasPortray === null) return null;
    const portray = hasPortray ? reader.get(3) : 0;
    if (portray === null) return null;
    const hasResonance = reader.get(1);
    if (hasResonance === null) return null;
    const resonance = hasResonance ? reader.get(4) : 10;
    if (resonance === null) return null;
    return { insight: 3, level: 60, portray, resonance };
  }
  const insight = reader.get(2),
    level = reader.get(6),
    portray = reader.get(3),
    resonance = reader.get(4);
  if ([insight, level, portray, resonance].some((value) => value === null))
    return null;
  return {
    insight: insight as InsightIndex,
    level: level! + 1,
    portray: portray!,
    resonance: resonance!,
  };
}

function putV5Variant(
  writer: BitWriter,
  id: string,
  build: CharacterBuild,
): void {
  const def = getCharacter(id);
  const suffix = suffixFor(
    id,
    def && build.activeVariant && build.activeVariant !== def.defaultVariant
      ? build.activeVariant
      : null,
  );
  writer.put(suffix === null ? 0 : 1, 1);
  if (suffix !== null) writer.put(suffix, 7);
}

function getV5Variant(reader: BitReader): number | null | undefined {
  const hasVariant = reader.get(1);
  if (hasVariant === null) return undefined;
  if (!hasVariant) return null;
  const suffix = reader.get(7);
  return suffix === null || suffix === 0 ? undefined : suffix;
}

function putV5Imprint(writer: BitWriter, imprint: number): void {
  const clean = clamp(imprint, 1, PSYCHUBE_IMPRINT_MAX);
  writer.put(clean === 1 ? 0 : 1, 1);
  if (clean !== 1) writer.put(clean - 2, 2);
}

function getV5Imprint(reader: BitReader): number | null {
  const escaped = reader.get(1);
  if (escaped === null) return null;
  if (!escaped) return 1;
  const value = reader.get(2);
  return value === null ? null : value + 2;
}

export function encodeShareToken(profile: Profile): string {
  const writer = new BitWriter();
  writer.put(SHARE_VERSION, VERSION_BITS);

  const characters = Object.entries(profile.characters)
    .filter(([id]) => numericId(id) !== null && !!getCharacter(id))
    .sort(([a], [b]) => Number(a) - Number(b));
  if (characters.length > MAX_COLLECTION_COUNT)
    throw new RangeError(
      `Share profile has ${characters.length} characters; maximum is ${MAX_COLLECTION_COUNT}`,
    );
  writer.put(characters.length, COLLECTION_COUNT_BITS);
  let previousId: number | null = null;
  const characterReferences = new Map<string, number>();
  for (const [index, [id, build]] of characters.entries()) {
    const idNumber = Number(id);
    putOwnedId(writer, idNumber, previousId);
    previousId = idNumber;
    putV5Build(writer, build);
    putV5Variant(writer, id, build);
    characterReferences.set(id, index + 1);
  }

  const psychubes = Object.entries(profile.psychubes)
    .filter(([id]) => numericId(id) !== null && !!getPsychube(id))
    .sort(([a], [b]) => Number(a) - Number(b));
  if (psychubes.length > MAX_COLLECTION_COUNT)
    throw new RangeError(
      `Share profile has ${psychubes.length} psychubes; maximum is ${MAX_COLLECTION_COUNT}`,
    );
  writer.put(psychubes.length, COLLECTION_COUNT_BITS);
  previousId = null;
  const psychubeReferences = new Map<string, number>();
  for (const [index, [id, imprint]] of psychubes.entries()) {
    const idNumber = Number(id);
    putOwnedId(writer, idNumber, previousId);
    previousId = idNumber;
    putV5Imprint(writer, imprint);
    psychubeReferences.set(id, index + 1);
  }

  const characterReferenceWidth = referenceWidth(characters.length),
    psychubeReferenceWidth = referenceWidth(psychubes.length);
  for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
    putTeamName(writer, profile.teams[teamIndex]?.name ?? "");
    for (let slotIndex = 0; slotIndex < SLOTS_PER_TEAM; slotIndex++) {
      const slot = profile.teams[teamIndex]?.slots[slotIndex];
      writer.put(
        slot?.characterId
          ? (characterReferences.get(slot.characterId) ?? 0)
          : 0,
        characterReferenceWidth,
      );
      writer.put(
        slot?.psychubeId ? (psychubeReferences.get(slot.psychubeId) ?? 0) : 0,
        psychubeReferenceWidth,
      );
      writer.put(
        slot?.psychubeId2 ? (psychubeReferences.get(slot.psychubeId2) ?? 0) : 0,
        psychubeReferenceWidth,
      );
    }
  }
  return toBase64Url(writer.bytes());
}

function decodeV3V4Body(reader: BitReader, countBits: number): Profile | null {
  const profile = emptyProfile();
  const characterCount = reader.get(countBits);
  if (characterCount === null) return null;
  for (let index = 0; index < characterCount; index++) {
    const idNumber = reader.get(14),
      insight = reader.get(2),
      level = reader.get(6),
      portray = reader.get(3),
      resonance = reader.get(4),
      hasVariant = reader.get(1);
    if (
      [idNumber, insight, level, portray, resonance, hasVariant].some(
        (value) => value === null,
      )
    )
      return null;
    const suffix = hasVariant ? reader.get(7) : null;
    if (hasVariant && suffix === null) return null;
    const id = String(idNumber),
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

  const psychubeCount = reader.get(countBits);
  if (psychubeCount === null) return null;
  for (let index = 0; index < psychubeCount; index++) {
    const idNumber = reader.get(14),
      imprint = reader.get(3);
    if (idNumber === null || imprint === null) return null;
    const id = String(idNumber);
    if (getPsychube(id))
      profile.psychubes[id] = clamp(imprint, 1, PSYCHUBE_IMPRINT_MAX);
  }

  for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
    const name = getTeamName(reader);
    if (name === null) return null;
    profile.teams[teamIndex].name = name;
    for (let slotIndex = 0; slotIndex < SLOTS_PER_TEAM; slotIndex++) {
      const characterNumber = reader.get(14),
        psychubeNumber = reader.get(14),
        secondPsychubeNumber = reader.get(14);
      if (
        characterNumber === null ||
        psychubeNumber === null ||
        secondPsychubeNumber === null
      )
        return null;
      const characterId = characterNumber ? String(characterNumber) : null,
        psychubeId = psychubeNumber ? String(psychubeNumber) : null,
        psychubeId2 = secondPsychubeNumber
          ? String(secondPsychubeNumber)
          : null;
      profile.teams[teamIndex].slots[slotIndex] = {
        characterId:
          characterId && profile.characters[characterId] ? characterId : null,
        psychubeId:
          psychubeId && profile.psychubes[psychubeId] ? psychubeId : null,
        psychubeId2:
          psychubeId2 && profile.psychubes[psychubeId2] ? psychubeId2 : null,
      };
    }
  }
  return profile;
}

function resolveReference(
  reference: number,
  wireIds: Array<string | null>,
): string | null | undefined {
  if (reference > wireIds.length) return undefined;
  return reference === 0 ? null : wireIds[reference - 1];
}

function decodeV5Body(reader: BitReader): Profile | null {
  const profile = emptyProfile();
  const characterCount = reader.get(COLLECTION_COUNT_BITS);
  if (characterCount === null) return null;
  const wireCharacterIds: Array<string | null> = [];
  let previousId: number | null = null;
  for (let index = 0; index < characterCount; index++) {
    const idNumber = getOwnedId(reader, previousId);
    if (idNumber === null) return null;
    previousId = idNumber;
    const build = getV5Build(reader),
      suffix = getV5Variant(reader);
    if (!build || suffix === undefined) return null;
    const id = String(idNumber),
      def = getCharacter(id);
    wireCharacterIds.push(def ? id : null);
    if (!def) continue;
    const variant = suffix ? `${id}${String(suffix).padStart(2, "0")}` : null;
    const activeVariant =
      variant && def.skins.some((skin) => skin.id === variant) ? variant : null;
    const cleanInsight = Math.min(
      def.maxInsight,
      build.insight,
    ) as InsightIndex;
    profile.characters[id] = {
      insight: cleanInsight,
      level: clamp(build.level, 1, LEVEL_CAPS[cleanInsight]),
      portray: clamp(build.portray, 0, 5),
      resonance: clamp(build.resonance, 0, 15),
      activeVariant,
    };
  }

  const psychubeCount = reader.get(COLLECTION_COUNT_BITS);
  if (psychubeCount === null) return null;
  const wirePsychubeIds: Array<string | null> = [];
  previousId = null;
  for (let index = 0; index < psychubeCount; index++) {
    const idNumber = getOwnedId(reader, previousId);
    if (idNumber === null) return null;
    previousId = idNumber;
    const imprint = getV5Imprint(reader);
    if (imprint === null) return null;
    const id = String(idNumber),
      known = !!getPsychube(id);
    wirePsychubeIds.push(known ? id : null);
    if (known) profile.psychubes[id] = imprint;
  }

  const characterReferenceWidth = referenceWidth(characterCount),
    psychubeReferenceWidth = referenceWidth(psychubeCount);
  for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
    const name = getTeamName(reader);
    if (name === null) return null;
    profile.teams[teamIndex].name = name;
    for (let slotIndex = 0; slotIndex < SLOTS_PER_TEAM; slotIndex++) {
      const characterReference = reader.get(characterReferenceWidth),
        psychubeReference = reader.get(psychubeReferenceWidth),
        secondPsychubeReference = reader.get(psychubeReferenceWidth);
      if (
        characterReference === null ||
        psychubeReference === null ||
        secondPsychubeReference === null
      )
        return null;
      const characterId = resolveReference(
          characterReference,
          wireCharacterIds,
        ),
        psychubeId = resolveReference(psychubeReference, wirePsychubeIds),
        psychubeId2 = resolveReference(
          secondPsychubeReference,
          wirePsychubeIds,
        );
      if (
        characterId === undefined ||
        psychubeId === undefined ||
        psychubeId2 === undefined
      )
        return null;
      profile.teams[teamIndex].slots[slotIndex] = {
        characterId,
        psychubeId,
        psychubeId2,
      };
    }
  }
  return profile;
}

export function decodeShareToken(token: string): DecodedShareToken | null {
  const bytes = fromBase64Url(token);
  if (!bytes) return null;
  const reader = new BitReader(bytes);
  const version = reader.get(VERSION_BITS);
  if (version === null) return null;
  const profile =
    version === SHARE_VERSION
      ? decodeV5Body(reader)
      : version === PREVIOUS_SHARE_VERSION
        ? decodeV3V4Body(reader, COLLECTION_COUNT_BITS)
        : version === LEGACY_SHARE_VERSION
          ? decodeV3V4Body(reader, LEGACY_COLLECTION_COUNT_BITS)
          : null;
  if (!profile || !reader.paddingIsCanonical()) return null;
  return { sourceVersion: version, profile: sanitizeProfile(profile) };
}
