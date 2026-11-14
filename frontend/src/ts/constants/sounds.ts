import {
  PlaySoundOnClick,
  PlaySoundOnError,
} from "@monkeytype/schemas/configs";

export const soundsConfig: SoundConfigType = {
  1: { numberOfSounds: 3 },
  2: { numberOfSounds: 3 },
  3: { numberOfSounds: 3 },
  4: { numberOfSounds: 6 },
  5: { numberOfSounds: 6 },
  6: { numberOfSounds: 3 },
  7: { numberOfSounds: 3 },
  8: { oscillatorType: "sine" },
  9: { oscillatorType: "sawtooth" },
  10: { oscillatorType: "square" },
  11: { oscillatorType: "triangle" },
  12: { validNotes: ["C", "D", "E", "G", "A"] },
  13: { validNotes: ["C", "D", "E", "Gb", "Ab", "Bb"] },
  14: { numberOfSounds: 8 },
  15: { numberOfSounds: 5 },
  16: { numberOfSounds: 8 },
  17: { numberOfSounds: 10 },
  18: { numberOfSounds: 10 },
  19: { numberOfSounds: 10 },
  20: { numberOfSounds: 10 },
  21: { numberOfSounds: 10 },
  22: { numberOfSounds: 10 },
  23: { numberOfSounds: 10 },
  24: { numberOfSounds: 10 },
  25: { numberOfSounds: 10 },
  26: { numberOfSounds: 10 },
};

export type ClickSoundConfig = {
  numberOfSounds: number;
};

export type SupportedOscillatorTypes = Exclude<OscillatorType, "custom">;
export type OscillatorSoundConfig = {
  oscillatorType: SupportedOscillatorTypes;
};

export type ScaleSoundConfig = {
  validNotes: ValidNotes[];
};

export type SoundConfigType = Record<
  Exclude<PlaySoundOnClick, "off">,
  ClickSoundConfig | OscillatorSoundConfig | ScaleSoundConfig
>;

export type ValidNotes =
  | "C"
  | "Db"
  | "D"
  | "Eb"
  | "E"
  | "F"
  | "Gb"
  | "G"
  | "Ab"
  | "A"
  | "Bb"
  | "B";

type ClickSoundConfigType = Partial<
  Record<Exclude<PlaySoundOnClick, "off">, string[]>
>;

export const clickSoundConfig: ClickSoundConfigType =
  extractClickSounds(soundsConfig);

function extractClickSounds(
  shortConfig: SoundConfigType,
): ClickSoundConfigType {
  return Object.fromEntries(
    Object.entries(shortConfig)
      .filter(([_, cfg]) => "numberOfSounds" in cfg)
      .map(([key, cfg]) => {
        const config = cfg as ClickSoundConfig;
        const fullConfig = new Array(config.numberOfSounds)
          .fill(0)
          .map((_, index) => `../sounds/click${key}/${index + 1}.wav`);
        return [key, fullConfig];
      }),
  );
}

// ---- phase 93: the sound packs — curated click+error pairs ----
// a pack couples a click scheme with an error sound of the same character,
// so the two sound settings can be set in one action. ids reference the
// EXISTING config enums (both keys persist in the config the way they
// always have); every pack must pass the pack identity spec.
export type SoundPack = {
  id: string;
  label: string;
  click: Exclude<PlaySoundOnClick, "off">;
  error: Exclude<PlaySoundOnError, "off">;
};

export const soundPacks: SoundPack[] = [
  { id: "classic", label: "classic", click: "4", error: "4" },
  { id: "soft", label: "soft", click: "1", error: "1" },
  { id: "sharp", label: "sharp", click: "2", error: "2" },
  { id: "deep", label: "deep", click: "3", error: "3" },
  { id: "piano", label: "piano scale", click: "12", error: "3" },
  { id: "blues", label: "blues scale", click: "13", error: "3" },
  { id: "sine", label: "sine tone", click: "8", error: "1" },
  { id: "saw", label: "saw tone", click: "9", error: "2" },
  { id: "square", label: "square tone", click: "10", error: "4" },
  { id: "triangle", label: "triangle tone", click: "11", error: "2" },
];
