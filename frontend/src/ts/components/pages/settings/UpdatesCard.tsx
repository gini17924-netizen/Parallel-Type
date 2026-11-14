import { onMount, JSXElement, createSignal, Show } from "solid-js";

import { cn } from "../../../utils/cn";
import {
  updatesCheckNow,
  updatesGetSettings,
  updatesSetAutoCheck,
  updatesSetChannel,
} from "../../../utils/updates";
import { Button } from "../../common/Button";

/**
 * The desktop updater's controls (phase 56): the auto-check toggle (the
 * boot check honors it — the flag persists in the app config dir), the
 * manual check button and the stable/beta channel switch (phase 90 —
 * beta reads the pre-release manifest only). Desktop-only: the browser
 * preview renders the desktop-only note instead.
 */
export function UpdatesCard(): JSXElement {
  const [autoCheck, setAutoCheck] = createSignal(true);
  const [channel, setChannel] = createSignal<"stable" | "beta">("stable");
  const [available, setAvailable] = createSignal<string | undefined>(undefined);
  const [checking, setChecking] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  onMount(() => {
    void (async () => {
      const settings = await updatesGetSettings();
      if (settings !== undefined) {
        setAutoCheck(settings.autoCheck);
        //defensive: a settings file from before phase 90 carries no
        //channel — anything but the exact beta string reads as stable
        //(the rust command validates too, this is just the UI belt)
        setChannel(settings.channel === "beta" ? "beta" : "stable");
      }
      setLoaded(true);
    })();
  });

  const flipAutoCheck = (enabled: boolean): void => {
    setAutoCheck(enabled); //optimistic; the persist is best-effort
    void updatesSetAutoCheck(enabled);
  };

  const flipChannel = (next: "stable" | "beta"): void => {
    setChannel(next); //optimistic; the persist is best-effort
    void updatesSetChannel(next);
  };

  const checkNow = async (): Promise<void> => {
    setChecking(true);
    const result = await updatesCheckNow();
    setChecking(false);
    if (result === undefined) return; //the app restarts mid-flight
    setAvailable(result.status === "updated" ? result.version : undefined);
  };

  return (
    <section
      class="grid gap-2 rounded bg-sub-alt p-4"
      aria-label="updates card"
      data-testid="uc-card"
    >
      <div class="text-sub">updates</div>
      <Show
        when={loaded()}
        fallback={<div class="text-xs text-sub">desktop only</div>}
      >
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="automatic updates: on"
            class={cn("w-full", autoCheck() && "bg-main text-bg")}
            onClick={() => flipAutoCheck(true)}
          />
          <Button
            text="automatic updates: off"
            class={cn("w-full", !autoCheck() && "bg-main text-bg")}
            onClick={() => flipAutoCheck(false)}
          />
        </div>
        <div class="grid grid-cols-2 gap-2" data-testid="uc-channel">
          <Button
            text="channel: stable"
            class={cn("w-full", channel() === "stable" && "bg-main text-bg")}
            onClick={() => flipChannel("stable")}
          />
          <Button
            text="channel: beta"
            class={cn("w-full", channel() === "beta" && "bg-main text-bg")}
            onClick={() => flipChannel("beta")}
          />
        </div>
        <Button
          text={checking() ? "checking…" : "check for updates"}
          fa={{ icon: "fa-sync-alt" }}
          class="w-full"
          disabled={checking()}
          onClick={() => void checkNow()}
        />
        <Show
          when={available() !== undefined}
          fallback={
            <div class="text-xs text-sub" data-testid="uc-current">
              you&apos;re on the latest version
            </div>
          }
        >
          <div class="text-xs font-bold text-main" data-testid="uc-available">
            downloading version {available()} — the app will restart when it
            lands
          </div>
        </Show>
        <div class="text-xs text-sub">
          automatic updates check at every app start. Turning them off keeps the
          manual button working. beta gets the pre-release builds — stable never
          does.
        </div>
      </Show>
    </section>
  );
}
