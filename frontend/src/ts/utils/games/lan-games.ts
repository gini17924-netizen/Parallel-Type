import { registerLanGame } from "./lan-registry";
import { lanBotDuel } from "../bot-duel/lan";
import { lanSprint } from "../sprint/lan";
import { lanGhostGp } from "../ghost-gp/lan";
import { lanSplitDuel } from "../split-duel/lan";
import { lanMaze } from "../maze-runner/lan";
import { lanClimber } from "../climber/lan";
import { lanRunner } from "../runner/lan";
import { lanWordBlast } from "../word-blast/lan";
import { lanStack } from "../stack-attack/lan";
import { lanNitro } from "../nitro-run/lan";

/**
 * The LAN games barrel (online wave, phase 1): importing this module
 * registers every online-capable game. `states/lan-match.ts` and the
 * lobby import it — KI-43's lesson: a registry is filled by module
 * loads, never by page mounts.
 */

registerLanGame(lanBotDuel);
registerLanGame(lanSprint);
registerLanGame(lanGhostGp);
registerLanGame(lanSplitDuel);
registerLanGame(lanMaze);
registerLanGame(lanClimber);
registerLanGame(lanRunner);
registerLanGame(lanWordBlast);
registerLanGame(lanStack);
registerLanGame(lanNitro);
