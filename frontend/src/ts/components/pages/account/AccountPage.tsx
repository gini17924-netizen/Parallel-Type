import { Mode } from "@monkeytype/schemas/shared";
import { createMemo, createSignal, JSXElement, onMount, Show } from "solid-js";

import {
  createResultsQueryState,
  getResultsQueryOnce,
  useResultsLiveQuery,
} from "../../../collections/results";
import { SnapshotResult } from "../../../constants/default-snapshot";
import { isAuthenticated } from "../../../states/core";
import { hideLoaderBar, showLoaderBar } from "../../../states/loader-bar";
import {
  showErrorNotification,
  showSuccessNotification,
} from "../../../states/notifications";
import { filters, setFilters } from "../../../states/result-filters";
import * as DesktopAutoBackup from "../../../utils/desktop-auto-backup";
import { qs } from "../../../utils/dom";
import {
  DESKTOP_OFFLINE,
  exportBackup,
  importBackup,
  loadLocalResults,
} from "../../../utils/local-persistence";
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
  onMount(async () => {
    const daySet = new Set(
      (await loadLocalResults()).map((r) =>
        new Date(r.timestamp).toDateString(),
      ),
    );
    let streak = 0;
    const cursor = new Date();
    //a streak counts today (or yesterday, if today has no result yet) backwards
    if (!daySet.has(cursor.toDateString())) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (daySet.has(cursor.toDateString())) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    setLocalStreak(streak);
  });

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
                void file
                  .text()
                  .then(async (text) => importBackup(JSON.parse(text) as never))
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
