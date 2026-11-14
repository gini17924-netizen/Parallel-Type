import { JSXElement } from "solid-js";

import { setStreamerModeEnabled } from "../../../utils/streamer-mode";
import { Button } from "../../common/Button";
import { SearchableSetting } from "./SearchableSetting";

/**
 * phase 99: the streamer mode switch — the same two-button toggle shape as
 * the updates card. ON hides the app chrome and scales the typing words up
 * (the body class drives the styles), so an OBS window capture of the test
 * page shows ONLY the typing.
 */
export function StreamerModeCard(): JSXElement {
  return (
    <SearchableSetting
      key="streamerMode"
      title="streamer mode"
      description="hide the app chrome and scale the typing words up — made for an OBS window capture of the test page"
      fa={{ icon: "fa-video" }}
      inputs={<StreamerToggle />}
    />
  );
}

function StreamerToggle(): JSXElement {
  return (
    <div class="grid w-full grid-cols-2 gap-2" data-testid="streamer-toggle">
      <Button
        text="streamer mode: on"
        class="w-full"
        onClick={() => setStreamerModeEnabled(true)}
      />
      <Button
        text="streamer mode: off"
        class="w-full"
        onClick={() => setStreamerModeEnabled(false)}
      />
    </div>
  );
}
