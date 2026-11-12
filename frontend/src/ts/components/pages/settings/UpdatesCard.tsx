import { onMount, JSXElement, createSignal, Show } from "solid-js";

import { cn } from "../../../utils/cn";
import {
  updatesCheckNow,
  updatesGetSettings,
  updatesSetAutoCheck,
} from "../../../utils/updates";
import { Button } from "../../common/Button";

/**
 * The desktop updater's controls (phase 56): the auto-check toggle (the
 * boot check honors it — the flag persists in the app config dir) and
 * the manual check button. Desktop-only: the browser preview renders
 * the desktop-only note instead.
 */
export function UpdatesCard(): JSXElement {
  const [autoCheck, setAutoCheck] = createSignal(true);
  const [available, setAvailable] = createSignal<string | undefined>(undefined);
  const [checking, setChecking] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  onMount(() => {
    void (async () => {
      const settings = await updatesGetSettings();
      if (settings !== undefined) setAutoCheck(settings.autoCheck);
      setLoaded(true);
    })();
  });

  const flipAutoCheck = (enabled: boolean): void => {
    setAutoCheck(enabled); //optimistic; the persist is best-effort
    void updatesSetAutoCheck(enabled);
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
          manual button working.
        </div>
      </Show>
    </section>
  );
}
