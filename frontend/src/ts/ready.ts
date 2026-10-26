import * as MonkeyPower from "./elements/monkey-power";
import * as MerchBanner from "./elements/merch-banner";
import * as ServerConfiguration from "./ape/server-configuration";
import { configLoadPromise } from "./config/lifecycle";
import { authPromise } from "./firebase";
import { onDOMReady, qs } from "./utils/dom";
import { isAuthenticated, setAppReady } from "./states/core";
import {
  DESKTOP_OFFLINE,
  ensureResultsMigrated,
} from "./utils/local-persistence";
import * as DB from "./db";

onDOMReady(async () => {
  await configLoadPromise;
  await authPromise;

  //desktop offline build: signed-out users get a local snapshot
  //(personal bests, typing stats) restored from localStorage
  if (!isAuthenticated()) {
    DB.initLocalSnapshot();
  }

  //desktop offline build: move any 0.1.x results from localStorage to
  //IndexedDB early (the results collection awaits this too, but booting it
  //here keeps the storage consistent from the start)
  if (DESKTOP_OFFLINE) {
    void ensureResultsMigrated();
  }

  //this line goes back to pretty much the beginning of the project and im pretty sure its here
  //to make sure the initial theme application doesnt animate the background color
  qs("body")?.setStyle({
    transition: "background .25s, transform .05s",
  });
  //desktop offline build: no merch banner
  if (!DESKTOP_OFFLINE) {
    MerchBanner.showIfNotClosedBefore();
  }

  setAppReady(true);

  void ServerConfiguration.sync();

  MonkeyPower.init();
});
