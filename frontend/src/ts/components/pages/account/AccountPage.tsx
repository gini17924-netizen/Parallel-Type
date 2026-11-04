import { Mode } from "@monkeytype/schemas/shared";
import { Link } from "@tanstack/solid-router";
import { createMemo, createSignal, JSXElement, onMount, Show } from "solid-js";

import {
  createResultsQueryState,
  getResultsQueryOnce,
  useResultsLiveQuery,
} from "../../../collections/results";
import { SnapshotResult } from "../../../constants/default-snapshot";
import { importLocalBackup } from "../../../db";
import { isAuthenticated } from "../../../states/core";
import { hideLoaderBar, showLoaderBar } from "../../../states/loader-bar";
import {
  showErrorNotification,
  showSuccessNotification,
} from "../../../states/notifications";
import { filters, setFilters } from "../../../states/result-filters";
import {
  getDailyGoalMinutes,
  setDailyGoalMinutes,
  todayTypingSeconds,
} from "../../../utils/daily-goal";
import * as DesktopAutoBackup from "../../../utils/desktop-auto-backup";
import { qs } from "../../../utils/dom";
import {
  DESKTOP_OFFLINE,
  exportBackup,
  loadLocalResults,
} from "../../../utils/local-persistence";
import { computeStreakFromResults } from "../../../utils/local-streak";
import { downloadResultsCSV } from "../../../utils/misc";
import { Advertisement } from "../../common/Advertisement";
import AsyncContent from "../../common/AsyncContent";
import { Button } from "../../common/Button";
import { Charts } from "./Charts";
import { Filters } from "./Filters";
import { MyProfile } from "./MyProfile";
import { Table } from "./Table";
import { TestStats } from "./TestStats";
import { VerifyNotice } from "./VerifyNotice";

export function AccountPage(): JSXElement {
  const [limit, setLimit] = createSignal(10);

  const [sorting, setSorting] = createSignal<{
    field: keyof SnapshotResult<Mode>;
    direction: "asc" | "desc";
  }>({
    field: "timestamp",
    direction: "desc",
  });

  const queryState = createMemo(() => {
    if (!isAuthenticated() && !DESKTOP_OFFLINE) return undefined;

    return createResultsQueryState(filters);
  });

  const [selectedResultId, setSelectedResultId] = createSignal<null | string>(
    null,
  );
  const [isExporting, setIsExporting] = createSignal(false);
  const [isBackingUp, setIsBackingUp] = createSignal(false);
  const [isRestoring, setIsRestoring] = createSignal(false);
  const [restoreConfirming, setRestoreConfirming] = createSignal(false);
  // oxlint-disable-next-line eslint/no-unassigned-vars -- Solid ref binding assigns this in JSX
  let restoreInput: HTMLInputElement | undefined;

  const resultsQuery = useResultsLiveQuery({
    queryState,
    sorting,
    limit: () => limit() + 1,
  });

  const [localStreak, setLocalStreak] = createSignal(0);
  const [todaySeconds, setTodaySeconds] = createSignal(0);
  const [goalMinutes, setGoalMinutes] = createSignal(getDailyGoalMinutes());
  onMount(async () => {
    const results = await loadLocalResults();
    //same algorithm db.ts uses to maintain the snapshot streak — one source
    //of truth for the displayed and XP-relevant streak
    setLocalStreak(computeStreakFromResults(results));
    setTodaySeconds(todayTypingSeconds(results));
  });

  const updateGoal = (value: number): void => {
    setDailyGoalMinutes(value);
    setGoalMinutes(getDailyGoalMinutes());
  };

  const todayMinutes = () => Math.round(todaySeconds() / 60);
  const goalProgressPct = () =>
    Math.min(100, Math.round((todaySeconds() / (goalMinutes() * 60)) * 100));

  return (
    <div class="flex flex-col gap-8">
      <VerifyNotice />
      <MyProfile />

      <Advertisement id="ad-account-1" visible="sellout" />

      <Filters filters={filters} onChangeFilters={setFilters} />

      <Show
        when={resultsQuery()?.length > 0}
        fallback={
          <div class="grid h-150 place-items-center">
            <div>No data found. Check your filters.</div>
          </div>
        }
      >
        <>
          <Charts
            filters={filters}
            queryState={queryState}
            onHistoryChartClick={({ index, _id }) => {
              const newLimit = Math.ceil(index / 10) * 10;
              if (limit() < newLimit) {
                setLimit(newLimit);
              }
              setSelectedResultId(_id);

              requestAnimationFrame(() => {
                qs(
                  `#resultList tbody tr:nth-child(${index + 1})`,
                )?.scrollIntoView({
                  block: "center",
                });
              });
            }}
          />
          <TestStats queryState={queryState} />

          <div class="rounded bg-sub-alt p-4">
            <div class="text-sub">
              local streak (consecutive days with a result)
            </div>
            <div class="text-3xl text-main">
              {localStreak()} <span class="text-sm text-sub">days</span>
            </div>
          </div>

          <Link
            to="/wrapped"
            class="flex items-center justify-between rounded bg-sub-alt p-4 transition-colors duration-125 hover:bg-text"
          >
            <div>
              <div class="text-lg font-bold text-main">year wrapped</div>
              <div class="text-sub">
                your last 365 days of typing, as a recap
              </div>
            </div>
            <i class="fas fa-arrow-right text-main"></i>
          </Link>

          <div class="rounded bg-sub-alt p-4">
            <div class="flex items-baseline justify-between">
              <div class="text-sub">daily goal (today)</div>
              <label class="text-xs text-sub">
                goal:{" "}
                <input
                  type="number"
                  min="1"
                  max="240"
                  class="w-14 rounded bg-main px-1 text-main"
                  value={goalMinutes()}
                  onInput={(e) => updateGoal(Number(e.currentTarget.value))}
                />{" "}
                min
              </label>
            </div>
            <div class="text-3xl text-main">
              {todayMinutes()}{" "}
              <span class="text-sm text-sub">/ {goalMinutes()} min</span>
            </div>
            <div class="mt-2 h-2 w-full rounded bg-sub">
              <div
                class="h-2 rounded bg-main"
                style={{ width: `${goalProgressPct()}%` }}
              ></div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <Button
              text="Backup data"
              fa={{ icon: "fa-database" }}
              class="col-start-1 w-full"
              disabled={isBackingUp()}
              onClick={() => {
                setIsBackingUp(true);
                void exportBackup()
                  .then((backup) => {
                    const blob = new Blob([JSON.stringify(backup, null, 2)], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `monkeytype-backup-${new Date()
                      .toISOString()
                      .slice(0, 10)}.json`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10_000);
                    showSuccessNotification("Backup downloaded");
                  })
                  .catch((error: unknown) => {
                    console.error("Failed to export backup", error);
                    showErrorNotification("Failed to create backup", {
                      error,
                    });
                  })
                  .finally(() => setIsBackingUp(false));
              }}
            />
            <Button
              text={
                restoreConfirming()
                  ? "click again to confirm"
                  : "Restore backup"
              }
              fa={{ icon: "fa-file-import" }}
              class="col-start-2 w-full"
              disabled={isRestoring()}
              onClick={() => {
                if (restoreConfirming()) {
                  restoreInput?.click();
                } else {
                  setRestoreConfirming(true);
                  setTimeout(() => setRestoreConfirming(false), 4000);
                }
              }}
            />
            <Button
              text="Export CSV"
              fa={{ icon: "fa-file-csv" }}
              class="col-start-3 w-full"
              disabled={isExporting()}
              onClick={() => {
                setIsExporting(true);
                showLoaderBar();
                void getResultsQueryOnce({ queryState, sorting })
                  .then(
                    async (results) =>
                      results !== undefined &&
                      (await downloadResultsCSV(results)),
                  )
                  .finally(() => {
                    hideLoaderBar();
                    setIsExporting(false);
                  });
              }}
            />
            <input
              ref={restoreInput}
              type="file"
              accept="application/json,.json"
              class="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file === undefined) return;
                setIsRestoring(true);
                //importLocalBackup (not importBackup): the session's
                //in-memory snapshot must follow the restored storage even
                //before the reload below (audit Y1)
                void file
                  .text()
                  .then(async (text) =>
                    importLocalBackup(JSON.parse(text) as never),
                  )
                  .then(async (imported) => {
                    showSuccessNotification(
                      `Restored ${imported} results, reloading`,
                    );
                    //re-anchor the automatic backup before the reload wipes
                    //the pending timer
                    void DesktopAutoBackup.writeAutoBackup()
                      .catch(() => undefined)
                      .finally(() => {
                        setTimeout(() => window.location.reload(), 500);
                      });
                  })
                  .catch((error: unknown) => {
                    console.error("Failed to restore backup", error);
                    showErrorNotification("Failed to restore backup", {
                      error,
                    });
                    setIsRestoring(false);
                  });
              }}
            />
          </div>

          <Advertisement id="ad-account-2" visible="sellout" />

          <AsyncContent collections={{ resultsQuery }}>
            {({ resultsQueryData }) => (
              <>
                <Table
                  data={resultsQueryData().slice(0, limit())}
                  onSortingChange={(val) => setSorting(val)}
                  selectedRowId={selectedResultId}
                />
                <Button
                  text="load more"
                  disabled={
                    resultsQuery.isLoading ||
                    resultsQueryData().length <= limit()
                  }
                  onClick={() => setLimit((limit) => limit + 10)}
                  class="w-full text-center"
                />
              </>
            )}
          </AsyncContent>
        </>
      </Show>
    </div>
  );
}
