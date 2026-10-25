import { Configuration } from "@monkeytype/schemas/configuration";
import { promiseWithResolvers } from "../utils/misc";
import { queryClient } from "../queries";
import { getServerConfigurationQueryOptions } from "../queries/server-configuration";
import { DESKTOP_OFFLINE } from "../utils/local-persistence";

const {
  promise: configurationPromise,
  resolve,
  reject,
} = promiseWithResolvers<boolean>();

export { configurationPromise };

export function get(): Configuration | undefined {
  return queryClient.getQueryData(
    getServerConfigurationQueryOptions().queryKey,
  );
}

export async function sync(): Promise<void> {
  try {
    await queryClient.fetchQuery(getServerConfigurationQueryOptions());
    resolve(true);
  } catch (e) {
    if (DESKTOP_OFFLINE) {
      //desktop offline build: no backend to sync with
      resolve(true);
      return;
    }
    reject(e);
  }
}
