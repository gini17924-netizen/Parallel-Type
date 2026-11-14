import { For, JSXElement } from "solid-js";

import { configMetadata } from "../../../../config/metadata";
import { setConfig } from "../../../../config/setters";
import { soundPacks } from "../../../../constants/sounds";
import {
  previewClick,
  previewError,
} from "../../../../controllers/sound-controller";
import { Button } from "../../../common/Button";
import { SearchableSetting } from "../SearchableSetting";

/**
 * The sound packs (phase 93): curated click+error pairs — one action sets
 * BOTH sound settings (they persist in the config exactly as before), and
 * the preview plays the pair from OUTSIDE typing (the click on the button
 * is the gesture that unlocks the audio context, the same way the
 * per-option previews in the sound section always worked).
 */
export function SoundPack(): JSXElement {
  const previewPack = (click: string, error: string): void => {
    void (async () => {
      await previewClick(click as never);
      await previewError(error as never);
    })();
  };

  const usePack = (click: string, error: string): void => {
    setConfig("playSoundOnClick", click as never);
    setConfig("playSoundOnError", error as never);
  };

  return (
    <SearchableSetting
      key="soundPack"
      title="sound packs"
      description={configMetadata.soundVolume.description}
      fa={configMetadata.soundVolume.fa}
      fullWidthInputs={
        <div class="grid gap-2" data-testid="sound-pack">
          <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <For each={soundPacks}>
              {(pack) => (
                <div class="flex items-center justify-between gap-2 rounded bg-bg p-2">
                  <div>
                    <div class="font-bold text-main">{pack.label}</div>
                    <div class="text-xs text-sub">
                      click {pack.click} + error {pack.error}
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-1">
                    <Button
                      text="preview"
                      fa={{ icon: "fa-volume-up" }}
                      onClick={() => {
                        previewPack(pack.click, pack.error);
                      }}
                    />
                    <Button
                      text="use"
                      fa={{ icon: "fa-check" }}
                      onClick={() => {
                        usePack(pack.click, pack.error);
                      }}
                    />
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      }
    />
  );
}
