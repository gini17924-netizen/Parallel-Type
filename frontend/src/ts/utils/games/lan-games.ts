import { registerLanGame } from "./lan-registry";
import { lanBotDuel } from "../bot-duel/lan";

/**
 * The LAN games barrel (online wave, phase 1): importing this module
 * registers every online-capable game. `states/lan-match.ts` and the
 * lobby import it — KI-43's lesson: a registry is filled by module
 * loads, never by page mounts.
 */

registerLanGame(lanBotDuel);
