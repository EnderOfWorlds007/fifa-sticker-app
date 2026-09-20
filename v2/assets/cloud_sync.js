import {
  COLLECTION_KEY,
  INVENTORY_CACHE_META_KEY,
  INVENTORY_SNAPSHOT_KEY,
  LEDGER_KEY,
} from "./backup_restore.js?v=build-90cdc644aa5c";
import {
  generatePublicShareToken,
  loadPublicShareSettings,
  publicShareControlState,
  publicShareNeedsRepublish,
  publicShareUrl,
  PUBLIC_SHARE_SETTINGS_KEY,
  publicShareTokenHash,
  savePublicShareSettings,
  serializePublicTradeProjection,
  withCurrentPublicProjectionModel,
} from "./public_share.js?v=build-90cdc644aa5c";
import { loadCollectionCatalog } from "./catalog_source.js?v=build-90cdc644aa5c";
import { buildInventoryProjection } from "./inventory_projection.js?v=build-90cdc644aa5c";
import { publicShareRefreshNeededOnPage } from "./public_share_refresh.js?v=build-90cdc644aa5c";
import { importCloudReviewPayload } from "./cloud_review_import.js?v=build-90cdc644aa5c";
import {
  createCloudSyncGate,
  fetchAllDeltaPages,
  monotonicRevision,
  requestJsonWithTimeout,
  validateSparseCloudHistory,
} from "./cloud_delta.js?v=build-90cdc644aa5c";
import {
  activateCloudPhotoReviewBatch,
  cloudPhotoReviewBatchId,
  migrateLegacyPhotoReviewProfile,
} from "./photo_review_store_v2.js?v=build-90cdc644aa5c";
import { accountContextMatches, accountRevisionMatches, canActivateCloudAccount, resolveAccountBound } from "./cloud_account_context.js?v=build-90cdc644aa5c";

export const USER_SECRET_ID_KEY = "panini.cloudSync.userSecretId.v1";
export const USER_ACCOUNTS_KEY = "panini.cloudSync.accounts.v1";
export const DEVICE_ID_KEY = "panini.cloudSync.deviceId.v1";
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{12,80}$/;
const LAST_REVISION_PREFIX = "panini.cloudSync.lastRevision.v1:";
const ACCOUNT_STATE_PREFIX = "panini.cloudSync.accountState.v1:";
const LAST_SYNC_STATUS_KEY = "panini.cloudSync.lastStatus.v1";
const ACTIVE_CLOUD_PROFILE_ID_KEY = "panini.cloudSync.activeProfileId.v1";
const ID_RANDOM_BYTES = 24;
const CLOUD_REQUEST_TIMEOUT_MS = 30_000;
const SYNC_EVENT = "panini:cloud-sync-status";
const APPLIED_EVENT = "panini:cloud-sync-applied";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function mountCollectionCloudSync({
  config = globalThis.PANINI_CONFIG || {},
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  cryptoImpl = globalThis.crypto,
  location = globalThis.location,
  windowRef = globalThis,
} = {}) {
  const baseUrl = normalizeBaseUrl(config.collectionSyncBaseUrl);
  const controls = bindCloudControls({ storage, location, windowRef });
  if (!baseUrl || !fetchImpl || !cryptoImpl?.subtle) {
    controls.setStatus("Cloud sync is not configured on this app.", "muted");
    return null;
  }

  const client = new CloudSyncClient({ baseUrl, storage, fetchImpl, cryptoImpl });
  let initialized = false;
  let applyingRemote = false;
  const syncGate = createCloudSyncGate();
  let pendingTimer = null;
  let lastTriggerKind = "manual";
  let pendingInitializationSave = "";
  let pendingRecoverySave = "";
  let activeBackgroundController = null;
  let activeAutosaveController = null;
  let activeRecoveryController = null;
  let reviewRecoveryGeneration = 0;
  const refreshShareControls = () => controls.setShareSettings(loadPublicShareSettings(storage));
  const applyTransactions = async (transactions, context) => {
    let reviewsChanged = false;
    let checkpointApplied = false;
    for (const transaction of transactions) {
      client.assertAccountContext(context);
      const payload = await client.decryptTransaction(transaction, context);
      client.assertAccountContext(context);
      if (applyCloudCheckpoint(payload, storage)) {
        checkpointApplied = true;
        continue;
      }
      if (await importCloudReviewPayload(payload, context.profileId) === "committed") reviewsChanged = true;
    }
    return { reviewsChanged, checkpointApplied };
  };

  const performSyncDeltas = async ({ apply = true, quiet = false, signal = null } = {}) => {
    try {
      const previousSecretId = client.userSecretId;
      await client.ensureIdentity();
      if (client.userSecretId !== previousSecretId) controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
      const context = client.captureAccountContext();
      let result;
      if (apply && controls.reviewRecoveryMode) {
        applyingRemote = true;
        try {
          const recovery = await streamCloudHistory(context, {
            startRevision: context.startRevision,
            signal,
            onProgress: quiet ? null : ({ transactionCount, remoteRevision, revision, photoPackages }) => {
              controls.setStatus(
                `Loading encrypted reviews · checked ${transactionCount} record${transactionCount === 1 ? "" : "s"}`
                  + ` through revision ${revision} of ${remoteRevision}`
                  + ` · loaded ${photoPackages} photo package${photoPackages === 1 ? "" : "s"}.`,
                "muted",
              );
            },
          });
          client.assertAccountContext(context);
          if (applyCloudCheckpoint(recovery.latestCheckpoint, storage)) saveAccountProjection(storage, context.profileId);
          if (recovery.recoveredBatchId) {
            await activateCloudPhotoReviewBatch(context.profileId, recovery.recoveredBatchId, { signal });
          }
          client.setLastRevision(recovery.revision);
          refreshShareControls();
          result = {
            transactions: [],
            transactionCount: recovery.transactionCount,
            revision: recovery.revision,
          };
        } finally {
          applyingRemote = false;
        }
      } else {
        result = await client.fetchDeltas({ context, signal });
        client.assertAccountContext(context);
        if (apply && result.transactions.length) {
          applyingRemote = true;
          try {
            const applied = await applyTransactions(result.transactions, context);
            client.assertAccountContext(context);
            if (applied.checkpointApplied) saveAccountProjection(storage, context.profileId);
            client.setLastRevision(result.revision);
            refreshShareControls();
          } finally {
            applyingRemote = false;
          }
        }
      }
      if (apply) dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: result.revision, profileId: client.profileId });
      if (!quiet) {
        const changeCount = Number(result.transactionCount ?? result.transactions.length);
        controls.setStatus(
          changeCount
            ? `Cloud backup updated from ${changeCount} change${changeCount === 1 ? "" : "s"}.`
            : `Cloud backup ready. Revision ${result.revision}.`,
          "ok",
        );
      }
      return result;
    } catch (error) {
      if (error instanceof StaleCloudAccountError) return { transactions: [], revision: client.lastRevision, stale: true };
      if (signal?.aborted) return { transactions: [], revision: client.lastRevision, aborted: true };
      if (!quiet) controls.setStatus(error?.message || "Cloud sync could not connect.", "warning");
      return { transactions: [], revision: client.lastRevision };
    }
  };

  const syncDeltas = (options = {}) => syncGate.run(
    () => performSyncDeltas(options),
    () => ({ transactions: [], revision: client.lastRevision, recovering: true }),
  );

  const startBackgroundSync = (options = {}) => {
    activeBackgroundController?.abort();
    const controller = new AbortController();
    activeBackgroundController = controller;
    return syncDeltas({ ...options, signal: controller.signal }).finally(() => {
      if (activeBackgroundController === controller) activeBackgroundController = null;
    });
  };

  const queueAutosave = (kind = "local") => {
    if (!initialized) {
      pendingInitializationSave = kind || "local";
      return;
    }
    if (applyingRemote) return;
    if (client.profileId) saveAccountProjection(storage, client.profileId);
    lastTriggerKind = kind || "local";
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      autosave(lastTriggerKind);
    }, 900);
  };

  const streamCloudHistory = async (context, {
    startRevision = 0,
    signal = null,
    onProgress = null,
    assertCurrent = () => {},
  } = {}) => {
    let hasReviewCommit = false;
    let recoveredBatchId = "";
    let reviewCount = 0;
    let latestCheckpoint = null;
    let photoPackages = 0;
    let lastProgressAt = 0;
    let recoveryStage = "requesting cloud history";
    let history;
    try {
      history = await client.fetchDeltas({
        context,
        startRevision,
        limit: 1,
        retainTransactions: false,
        signal,
        visitTransaction: async (transaction, progress) => {
          assertCurrent();
          client.assertAccountContext(context);
          recoveryStage = `decrypting cloud revision ${progress.revision}`;
          const payload = await client.decryptTransaction(transaction, context);
          assertCurrent();
          client.assertAccountContext(context);
          if (payload?.kind === "storage-checkpoint" && payload.storage) {
            latestCheckpoint = payload;
          } else {
            recoveryStage = `saving cloud revision ${progress.revision}`;
            const result = await importCloudReviewPayload(payload, context.profileId, { activate: false, signal });
            assertCurrent();
            client.assertAccountContext(context);
            if (result === "staged") photoPackages += 1;
            if (payload?.kind === "photo-review-import-commit-v1") {
              hasReviewCommit = true;
              recoveredBatchId = cloudPhotoReviewBatchId(context.profileId, payload.importId, payload.batch?.id);
              reviewCount = Number(payload.expectedReviewItemCount || payload.batch?.reviewItems?.length || 0);
            }
          }
          const now = Date.now();
          if (onProgress && (photoPackages || progress.transactionCount === 1 || now - lastProgressAt >= 250)) {
            onProgress({ ...progress, photoPackages });
            lastProgressAt = now;
          }
          // Give mobile Safari a paint/GC opportunity after each large record.
          if (photoPackages || progress.transactionCount % 10 === 0) await nextBrowserTurn();
        },
      });
    } catch (error) {
      if (!signal?.aborted) {
        console.error("Encrypted review recovery failed.", {
          stage: recoveryStage,
          photoPackages,
          name: String(error?.name || "Error"),
          message: String(error?.message || error || "Unknown error"),
        });
      }
      throw error;
    }
    const validatedHistory = validateSparseCloudHistory(history, { startRevision });
    return {
      hasReviewCommit,
      latestCheckpoint,
      recoveredBatchId,
      reviewCount,
      photoPackages,
      transactionCount: history.transactionCount,
      revision: validatedHistory.highWaterRevision,
    };
  };

  const recoverCloudReviewHistory = (context, options = {}) => streamCloudHistory(context, {
    ...options,
    startRevision: 0,
  });

  const switchToAccount = async (restoreCode, {
    confirmMessage,
    emptyMessage,
    recoverReviews = false,
    signal = null,
    assertCurrent = () => {},
  }) => {
    const normalized = normalizeUserSecretId(restoreCode);
    if (!normalized) {
      controls.setStatus("Enter a valid restore code.", "warning");
      return false;
    }
    if (!confirmAccountSwitch(windowRef, confirmMessage)) {
      controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
      controls.setStatus(
        recoverReviews
          ? "Review loading cancelled. Existing reviews were left unchanged."
          : "Cloud account switch cancelled.",
        "muted",
      );
      return false;
    }
    const wasKnown = loadUserAccounts(storage).accounts.some((account) => account.userSecretId === normalized);
    clearTimeout(pendingTimer);
    pendingTimer = null;
    const previousCode = client.userSecretId;
    const previousProfileId = client.profileId;
    if (previousProfileId) saveAccountProjection(storage, previousProfileId);
    const previousProjection = storageProjection(storage);
    const targetProfileId = await deriveProfileId(normalized, cryptoImpl);
    const cachedProjection = loadAccountProjection(storage, targetProfileId);
    let failureMessage = emptyMessage;
    try {
      await client.useRestoreCode(normalized);
      const context = client.captureAccountContext();
      controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
      if (recoverReviews) {
        const recovery = await recoverCloudReviewHistory(context, {
          signal,
          assertCurrent,
          onProgress: ({ transactionCount, remoteRevision, revision, photoPackages }) => {
            assertCurrent();
            controls.setStatus(
              `Loading encrypted reviews · checked ${transactionCount} record${transactionCount === 1 ? "" : "s"}`
                + ` through revision ${revision} of ${remoteRevision}`
                + ` · loaded ${photoPackages} photo package${photoPackages === 1 ? "" : "s"}.`,
              "muted",
            );
          },
        });
        assertCurrent();
        const checkpointApplied = applyCloudCheckpoint(recovery.latestCheckpoint, storage);
        if (!checkpointApplied) {
          if (previousProjection) {
            applyAccountProjection(storage, previousProjection);
            saveAccountProjection(storage, context.profileId);
          }
        } else {
          saveAccountProjection(storage, context.profileId);
        }
        if (recovery.recoveredBatchId) {
          assertCurrent();
          await activateCloudPhotoReviewBatch(context.profileId, recovery.recoveredBatchId, { signal });
        }
        client.setLastRevision(recovery.revision);
        refreshShareControls();
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: recovery.revision, profileId: context.profileId });
        controls.setStatus(
          recovery.hasReviewCommit
            ? `Cloud reviews loaded${recovery.reviewCount ? ` · ${recovery.reviewCount} decisions waiting` : ""}.`
            : "Cloud account loaded, but it has no saved reviews.",
          recovery.hasReviewCommit ? "ok" : "warning",
        );
        return true;
      }
      let checkpointApplied = false;
      const result = await client.fetchDeltas({ context });
      client.assertAccountContext(context);
      if (result.transactions.length) {
        applyingRemote = true;
        let applied;
        try {
          applied = await applyTransactions(result.transactions, context);
        } finally {
          applyingRemote = false;
        }
        client.assertAccountContext(context);
        checkpointApplied = checkpointApplied || applied.checkpointApplied;
        if (!canActivateCloudAccount({ checkpointApplied, hasCachedProjection: Boolean(cachedProjection) })) {
          throw new Error("That account has review data but no collection backup yet.");
        }
        if (checkpointApplied) {
          saveAccountProjection(storage, context.profileId);
        } else {
          applyAccountProjection(storage, cachedProjection);
        }
        client.setLastRevision(result.revision);
        refreshShareControls();
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: result.revision, profileId: context.profileId });
        controls.setStatus(`Cloud account switched. Revision ${result.revision}.`, "ok");
        return true;
      }
      if (checkpointApplied) {
        saveAccountProjection(storage, context.profileId);
        client.setLastRevision(Math.max(client.lastRevision, result.revision));
        refreshShareControls();
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: client.lastRevision, profileId: context.profileId });
        controls.setStatus(`Cloud account switched. Revision ${client.lastRevision}.`, "ok");
        return true;
      }
      if (cachedProjection && !recoverReviews) {
        applyAccountProjection(storage, cachedProjection);
        refreshShareControls();
        controls.setStatus("Cloud account switched using this browser's saved copy.", "ok");
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: client.lastRevision, profileId: client.profileId });
        return true;
      }
    } catch (error) {
      if (cachedProjection && !recoverReviews) {
        applyAccountProjection(storage, cachedProjection);
        refreshShareControls();
        controls.setStatus("Cloud account switched using this browser's saved copy.", "warning");
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: client.lastRevision, profileId: client.profileId });
        return true;
      }
      failureMessage = error?.message || "Cloud account switch failed.";
      if (recoverReviews && !/left unchanged/i.test(failureMessage)) {
        failureMessage += " Existing reviews were left unchanged.";
      }
    }
    if (previousCode) {
      await client.useRestoreCode(previousCode);
      if (previousProjection) applyAccountProjection(storage, previousProjection);
      if (!wasKnown) removeUserAccount(storage, normalized);
      controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
      dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: client.lastRevision, profileId: client.profileId });
    }
    controls.setStatus(failureMessage, "warning");
    return false;
  };

  const performAutosave = async (kind = "local", { signal = null } = {}) => {
    try {
      const synced = await performSyncDeltas({ apply: true, signal });
      if (synced.stale || synced.aborted || signal?.aborted) return false;
      const context = client.captureAccountContext();
      const checkpoint = createStorageCheckpoint({ storage, triggerKind: kind, deviceId: client.deviceId });
      const publicShare = await publicShareForCheckpoint(checkpoint, { fetchImpl, cryptoImpl, signal });
      if (signal?.aborted) return false;
      client.assertAccountContext(context);
      const result = await client.appendTransaction(checkpoint, { publicShare, context, signal });
      const publishedSettings = normalizeCheckpointShareSettings(checkpoint.storage.publicShareSettings);
      const currentSettings = loadPublicShareSettings(storage);
      if (publishedSettings.enabled && currentSettings.token === publishedSettings.token) {
        savePublicShareSettings(storage, publishedSettings);
        saveAccountProjection(storage, client.profileId);
        refreshShareControls();
      }
      controls.setStatus(`Cloud backup saved. Revision ${result.revision}.`, "ok");
      controls.setShareStatus(
        publicShare.enabled
          ? `Trade link updated with cloud backup revision ${result.revision}.`
          : "Public trade sharing is off.",
        "ok",
      );
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      if (error?.status === 409 || error?.status === 412) {
        controls.setStatus("Cloud backup changed elsewhere. Loading newest changes first.", "warning");
        await performSyncDeltas({ apply: true, signal });
        queueAutosave(kind);
        return false;
      }
      controls.setStatus(error?.message || "Cloud backup save failed.", "warning");
      if (loadPublicShareSettings(storage).enabled) {
        controls.setShareStatus("Trade link was not updated because the cloud backup failed.", "warning");
      }
      return false;
    }
  };

  const autosave = (kind = "local") => syncGate.run(
    () => {
      const controller = new AbortController();
      activeAutosaveController = controller;
      return performAutosave(kind, { signal: controller.signal }).finally(() => {
        if (activeAutosaveController === controller) activeAutosaveController = null;
      });
    },
    () => {
      pendingRecoverySave = kind || "local";
      return false;
    },
  );

  windowRef.addEventListener?.("panini:local-state-saved", (event) => {
    queueAutosave(event?.detail?.kind || "local");
  });
  windowRef.addEventListener?.("focus", () => startBackgroundSync({ apply: true }));
  globalThis.document?.addEventListener?.("visibilitychange", () => {
    if (globalThis.document.visibilityState === "visible") startBackgroundSync({ apply: true });
  });
  windowRef.addEventListener?.("pagehide", () => {
    reviewRecoveryGeneration += 1;
    activeRecoveryController?.abort();
    activeBackgroundController?.abort();
    activeAutosaveController?.abort();
  });
  controls.onCopyCode = () => copyText(client.userSecretId, controls);
  controls.onRestoreCode = async (restoreCode) => {
    const recoverReviews = controls.reviewRecoveryMode;
    const selectedRestoreCode = restoreCode || (recoverReviews ? controls.selectedAccountCode() : "");
    if (!selectedRestoreCode) return;
    controls.setAccountBusy(true);
    controls.setStatus(recoverReviews ? "Loading encrypted cloud reviews…" : "Switching cloud account…", "muted");
    let loaded = false;
    const recoveryGeneration = ++reviewRecoveryGeneration;
    const recoveryController = new AbortController();
    activeRecoveryController?.abort();
    activeRecoveryController = recoveryController;
    const assertCurrent = () => {
      if (recoveryGeneration !== reviewRecoveryGeneration || recoveryController.signal.aborted) {
        throw new StaleCloudAccountError();
      }
    };
    if (recoverReviews) {
      activeBackgroundController?.abort();
      activeAutosaveController?.abort();
      await syncGate.block();
      controls.setStatus("Loading encrypted reviews · connecting to cloud…", "muted");
    }
    try {
      loaded = await switchToAccount(selectedRestoreCode, {
        confirmMessage: recoverReviews
          ? "Load encrypted reviews from this cloud account? If it also contains a collection backup, that account's collection and activity will become active."
          : "Add this cloud account and make it active? Current local collection and activity will be replaced by that account.",
        emptyMessage: "No cloud backup was found for that account, so this browser kept the current account active.",
        recoverReviews,
        signal: recoveryController.signal,
        assertCurrent,
      });
      if (loaded) controls.prefillRestoreCode("");
    } finally {
      if (recoverReviews) syncGate.unblock();
      if (activeRecoveryController === recoveryController) activeRecoveryController = null;
      controls.setAccountBusy(false);
    }
    if (loaded && recoverReviews) await syncDeltas({ apply: true, quiet: true });
    if (recoverReviews && pendingRecoverySave) {
      const pendingKind = pendingRecoverySave;
      pendingRecoverySave = "";
      queueAutosave(pendingKind);
    }
  };
  controls.onSelectAccount = async (restoreCode) => {
    if (!restoreCode) return;
    if (controls.reviewRecoveryMode) {
      controls.prefillRestoreCode(restoreCode);
      controls.setStatus("Saved account selected. Press Load reviews to recover its encrypted queue.", "muted");
      return;
    }
    if (normalizeUserSecretId(restoreCode) === client.userSecretId) return;
    controls.setAccountBusy(true);
    controls.setStatus("Loading encrypted cloud reviews…", "muted");
    try {
      await switchToAccount(restoreCode, {
        confirmMessage: "Switch active cloud account? Current local collection and activity will be replaced by that account.",
        emptyMessage: "No saved state was found for that account, so this browser kept the current account active.",
      });
    } finally {
      controls.setAccountBusy(false);
    }
  };
  controls.onNewAccount = async () => {
    if (!confirmAccountSwitch(windowRef, "Create a new empty cloud account and make it active? Current local collection and activity will be saved on the previous account.")) return;
    const importedCollectionSnapshotVersion = currentCollectionImportVersion(storage);
    if (client.profileId) saveAccountProjection(storage, client.profileId);
    await client.useRestoreCode(generateUserSecretId(cryptoImpl));
    applyAccountProjection(storage, emptyAccountProjection({ importedCollectionSnapshotVersion }));
    refreshShareControls();
    saveAccountProjection(storage, client.profileId);
    controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
    await autosave("new-account");
    dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: client.lastRevision, profileId: client.profileId });
  };
  controls.onCreateShare = async () => {
    const settings = savePublicShareSettings(storage, { enabled: true, token: generatePublicShareToken(cryptoImpl) });
    refreshShareControls();
    saveAccountProjection(storage, client.profileId);
    controls.setShareStatus("Creating the link and saving the matching cloud revision…", "muted");
    await autosave("share-create");
    return settings;
  };
  controls.onCopyShare = async () => {
    const url = publicShareUrl(loadPublicShareSettings(storage).token, location);
    try {
      await navigator.clipboard?.writeText(url);
      controls.setShareStatus("Trade link copied. Anyone with it can see the shared lists.", "ok");
    } catch {
      controls.setShareStatus(url || "No active trade link.", "warning");
    }
  };
  controls.onRotateShare = async () => {
    if (!confirmAccountSwitch(windowRef, "Replace the current trade link? The old link will stop working after this cloud save.")) return;
    savePublicShareSettings(storage, { enabled: true, token: generatePublicShareToken(cryptoImpl) });
    refreshShareControls();
    saveAccountProjection(storage, client.profileId);
    controls.setShareStatus("Rotating the link and saving the matching cloud revision…", "muted");
    await autosave("share-rotate");
  };
  controls.onStopShare = async () => {
    if (!confirmAccountSwitch(windowRef, "Stop public trade sharing? The current link will stop working after this cloud save.")) return;
    savePublicShareSettings(storage, { enabled: false, token: "" });
    refreshShareControls();
    saveAccountProjection(storage, client.profileId);
    controls.setShareStatus("Revoking the link with the next cloud revision…", "muted");
    await autosave("share-revoke");
  };

  const pendingRestoreCode = restoreCodeFromLocation(location);
  if (pendingRestoreCode) {
    controls.prefillRestoreCode(pendingRestoreCode);
    controls.setStatus("Restore link detected. Add it when you are ready to switch accounts.", "warning");
    scrubRestoreFragment(location);
  }

  const ready = startBackgroundSync({ apply: true }).finally(() => {
    initialized = true;
    controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
    refreshShareControls();
    const shareSettings = loadPublicShareSettings(storage);
    const upgradeNeeded = publicShareNeedsRepublish(shareSettings);
    const pageRefreshNeeded = publicShareRefreshNeededOnPage(shareSettings, location);
    const pendingKind = pendingInitializationSave;
    pendingInitializationSave = "";
    if (upgradeNeeded || pageRefreshNeeded || pendingKind) {
      queueAutosave(upgradeNeeded
        ? "public-projection-upgrade"
        : pageRefreshNeeded
          ? "public-projection-page-refresh"
          : pendingKind);
    }
  });
  return { client, syncDeltas, autosave, ready };
}

export class CloudSyncClient {
  constructor({ baseUrl, storage, fetchImpl, cryptoImpl }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.crypto = cryptoImpl;
    this.userSecretId = "";
    this.deviceId = "";
    this.profileId = "";
    this.lastRevision = 0;
    this.accountGeneration = 0;
  }

  async ensureIdentity({ restoreCode = "" } = {}) {
    migrateLegacyUserSecret(this.storage);
    const activeAccount = activeUserSecretId(this.storage);
    const code = normalizeUserSecretId(restoreCode || activeAccount || "");
    return this.useRestoreCode(code || generateUserSecretId(this.crypto));
  }

  async useRestoreCode(code) {
    const nextSecretId = normalizeUserSecretId(code);
    if (!nextSecretId) throw new Error("Enter a valid restore code.");
    const nextProfileId = await deriveProfileId(nextSecretId, this.crypto);
    const previousCloudProfileId = String(this.storage.getItem(ACTIVE_CLOUD_PROFILE_ID_KEY) || "");
    if (!previousCloudProfileId) {
      const localProfileId = String(this.storage.getItem("panini.v2.activeProfileId") || "");
      await migrateLegacyPhotoReviewProfile(localProfileId, nextProfileId);
    }
    if (nextSecretId !== this.userSecretId || nextProfileId !== this.profileId) this.accountGeneration += 1;
    this.userSecretId = nextSecretId;
    this.profileId = nextProfileId;
    this.storage.setItem(ACTIVE_CLOUD_PROFILE_ID_KEY, this.profileId);
    this.deviceId = ensureDeviceId(this.storage, this.crypto);
    upsertUserAccount(this.storage, this.userSecretId);
    setActiveUserSecretId(this.storage, this.userSecretId);
    this.lastRevision = Number(this.storage.getItem(LAST_REVISION_PREFIX + this.profileId) || 0);
    return this.userSecretId;
  }

  captureAccountContext() {
    return {
      generation: this.accountGeneration,
      profileId: this.profileId,
      userSecretId: this.userSecretId,
      startRevision: this.lastRevision,
    };
  }

  assertAccountContext(context) {
    if (!accountContextMatches({
      generation: this.accountGeneration,
      profileId: this.profileId,
      userSecretId: this.userSecretId,
    }, context)) {
      throw new StaleCloudAccountError();
    }
  }

  assertAccountRevision(context) {
    if (!accountRevisionMatches(this.lastRevision, context)) throw new StaleCloudRevisionError();
  }

  async fetchDeltas({
    limit = 10,
    context = null,
    startRevision = null,
    retainTransactions = true,
    visitTransaction = null,
    signal = null,
    requestTimeoutMs = CLOUD_REQUEST_TIMEOUT_MS,
  } = {}) {
    if (!this.profileId) await this.ensureIdentity();
    const accountContext = context || this.captureAccountContext();
    this.assertAccountContext(accountContext);
    return fetchAllDeltaPages(async (after, pageLimit) => {
      const url = new URL(`${this.baseUrl}/v1/profiles/${accountContext.profileId}/transactions`);
      url.searchParams.set("after", String(after));
      url.searchParams.set("limit", String(pageLimit));
      const { response, payload } = await requestJsonWithTimeout(this.fetchImpl, url, {
        cache: "no-store",
        signal,
      }, {
        timeoutMs: requestTimeoutMs,
        timeoutMessage: "Cloud review download timed out. Check the connection and try Load reviews again.",
      });
      if (!response.ok) throw requestError(response, payload?.error || "Cloud backup could not be loaded.");
      return payload;
    }, {
      startRevision: startRevision === null ? accountContext.startRevision : Math.max(0, Number(startRevision || 0)),
      limit,
      retainTransactions,
      visitTransaction,
    });
  }

  async appendTransaction(payload, { publicShare, txId = "", context = null, signal = null } = {}) {
    if (!this.profileId) await this.ensureIdentity();
    const accountContext = context || this.captureAccountContext();
    this.assertAccountContext(accountContext);
    this.assertAccountRevision(accountContext);
    const encryptedPayload = await encryptPayload(payload, accountContext.userSecretId, this.crypto);
    this.assertAccountContext(accountContext);
    this.assertAccountRevision(accountContext);
    const { response, payload: result } = await requestJsonWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}/v1/profiles/${accountContext.profileId}/transactions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          txId: txId || randomId("tx", this.crypto),
          deviceId: this.deviceId,
          clientCreatedAt: new Date().toISOString(),
          baseRevision: accountContext.startRevision,
          encryptedPayload,
          ...(publicShare ? { publicShare } : {}),
        }),
      },
      {
        timeoutMs: CLOUD_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Cloud backup save timed out. Check the connection and try again.",
      },
    );
    this.assertAccountContext(accountContext);
    if (!response.ok) throw requestError(response, result?.error || "Cloud backup could not be saved.");
    this.setLastRevision(Number(result.revision || this.lastRevision));
    return { revision: this.lastRevision };
  }

  async decryptTransaction(transaction, context = this.captureAccountContext()) {
    this.assertAccountContext(context);
    const result = await resolveAccountBound(
      decryptPayload(transaction.encryptedPayload, context.userSecretId, this.crypto),
      context,
      () => ({
        generation: this.accountGeneration,
        profileId: this.profileId,
        userSecretId: this.userSecretId,
      }),
    );
    if (result.stale) throw new StaleCloudAccountError();
    return result.value;
  }

  setLastRevision(revision) {
    this.lastRevision = monotonicRevision(this.lastRevision, revision);
    if (this.profileId) this.storage.setItem(LAST_REVISION_PREFIX + this.profileId, String(this.lastRevision));
    this.storage.setItem(LAST_SYNC_STATUS_KEY, JSON.stringify({
      profileId: this.profileId,
      revision: this.lastRevision,
      syncedAt: new Date().toISOString(),
    }));
  }
}

class StaleCloudAccountError extends Error {
  constructor() {
    super("Cloud account changed while synchronization was in progress.");
    this.name = "StaleCloudAccountError";
  }
}

class StaleCloudRevisionError extends Error {
  constructor() {
    super("Cloud backup advanced while this save was being prepared.");
    this.name = "StaleCloudRevisionError";
    this.status = 409;
  }
}

export function createStorageCheckpoint({ storage = globalThis.localStorage, triggerKind = "local", deviceId = "" } = {}) {
  const projectedStorage = storageProjection(storage);
  if (projectedStorage.publicShareSettings?.enabled) {
    projectedStorage.publicShareSettings = withCurrentPublicProjectionModel(projectedStorage.publicShareSettings);
  }
  return {
    schemaVersion: 1,
    kind: "storage-checkpoint",
    triggerKind,
    deviceId,
    createdAt: new Date().toISOString(),
    storage: projectedStorage,
  };
}

export async function publicShareForCheckpoint(checkpoint, {
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  signal = null,
} = {}) {
  const settings = normalizeCheckpointShareSettings(checkpoint?.storage?.publicShareSettings);
  if (!settings.enabled) return { enabled: false };
  const controller = new AbortController();
  const catalog = await settleWithin(
    loadCollectionCatalog({
      fetch: (input, init = {}) => fetchImpl(input, { ...init, signal: controller.signal }),
    }),
    {
      signal,
      timeoutMs: CLOUD_REQUEST_TIMEOUT_MS,
      timeoutMessage: "Loading the sharing catalogue timed out.",
      onInterrupt: () => controller.abort(),
    },
  );
  const inventoryProjection = buildInventoryProjection({
    catalog,
    collectionState: checkpoint.storage.collectionState,
    ledger: checkpoint.storage.ledger,
    inventoryPayload: checkpoint.storage.inventorySnapshot,
  });
  return {
    enabled: true,
    tokenHash: await publicShareTokenHash(settings.token, cryptoImpl),
    projection: serializePublicTradeProjection({ catalog, inventoryProjection }),
  };
}

export function storageProjection(storage = globalThis.localStorage) {
  return {
    collectionState: parseStoredJson(storage.getItem(COLLECTION_KEY), {}),
    ledger: parseStoredJson(storage.getItem(LEDGER_KEY), { schemaVersion: 1, transactions: [] }),
    inventorySnapshot: parseStoredJson(storage.getItem(INVENTORY_SNAPSHOT_KEY), {}),
    inventoryCacheMeta: parseStoredJson(storage.getItem(INVENTORY_CACHE_META_KEY), {}),
    publicShareSettings: parseStoredJson(storage.getItem(PUBLIC_SHARE_SETTINGS_KEY), { schemaVersion: 1, enabled: false, token: "" }),
  };
}

export function emptyAccountProjection({ importedCollectionSnapshotVersion = 1 } = {}) {
  return {
    collectionState: {
      filter: "missing",
      sortOrder: "album",
      collected: [],
      albumStatusOverrides: {},
      hasLocalState: true,
      importedCollectionSnapshotVersion: Math.max(1, Number(importedCollectionSnapshotVersion || 0)),
    },
    ledger: { schemaVersion: 1, transactions: [] },
    inventorySnapshot: { schema_version: 1, updated_at: new Date(0).toISOString(), cards: {}, stats: { empty_account: true } },
    inventoryCacheMeta: { sourceLabel: "empty cloud account", emptyAccount: true },
    publicShareSettings: { schemaVersion: 1, enabled: false, token: "" },
  };
}

export function applyCloudCheckpoint(payload, storage = globalThis.localStorage) {
  if (payload?.kind !== "storage-checkpoint" || !payload.storage) return false;
  return applyAccountProjection(storage, payload.storage);
}

export function generateUserSecretId(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(ID_RANDOM_BYTES);
  cryptoImpl.getRandomValues(bytes);
  const encoded = base32Encode(bytes);
  const body = encoded.match(/.{1,4}/g).join("-");
  return `PN1-${body}`;
}

export function normalizeUserSecretId(value) {
  const text = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!text) return "";
  const withPrefix = text.startsWith("PN1") ? text : `PN1${text}`;
  if (!/^PN1[0-9A-HJKMNP-TV-Z]{30,}$/.test(withPrefix)) return "";
  return `PN1-${withPrefix.slice(3).match(/.{1,4}/g).join("-")}`;
}

export function loadUserAccounts(storage = globalThis.localStorage) {
  migrateLegacyUserSecret(storage);
  const parsed = parseStoredJson(storage.getItem(USER_ACCOUNTS_KEY), { schemaVersion: 1, accounts: [] });
  const seen = new Set();
  const accounts = (Array.isArray(parsed?.accounts) ? parsed.accounts : [])
    .map((account) => ({
      userSecretId: normalizeUserSecretId(account?.userSecretId || account),
      label: String(account?.label || "").trim(),
      addedAt: validDateOrNow(account?.addedAt),
      lastUsedAt: validDateOrNow(account?.lastUsedAt),
    }))
    .filter((account) => {
      if (!account.userSecretId || seen.has(account.userSecretId)) return false;
      seen.add(account.userSecretId);
      return true;
    });
  return { schemaVersion: 1, accounts };
}

export function activeUserSecretId(storage = globalThis.localStorage) {
  const active = normalizeUserSecretId(storage.getItem(USER_SECRET_ID_KEY) || "");
  if (active) return active;
  const [first] = loadUserAccounts(storage).accounts;
  if (first?.userSecretId) setActiveUserSecretId(storage, first.userSecretId);
  return first?.userSecretId || "";
}

export function upsertUserAccount(storage, userSecretId, now = new Date().toISOString()) {
  const normalized = normalizeUserSecretId(userSecretId);
  if (!normalized) throw new Error("Enter a valid restore code.");
  const registry = loadUserAccounts(storage);
  const existing = registry.accounts.find((account) => account.userSecretId === normalized);
  if (existing) {
    existing.lastUsedAt = now;
  } else {
    registry.accounts.push({ userSecretId: normalized, label: accountLabel(normalized), addedAt: now, lastUsedAt: now });
  }
  storage.setItem(USER_ACCOUNTS_KEY, JSON.stringify({
    schemaVersion: 1,
    accounts: registry.accounts.sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt))),
  }));
  return normalized;
}

export function setActiveUserSecretId(storage, userSecretId) {
  const normalized = normalizeUserSecretId(userSecretId);
  if (!normalized) throw new Error("Enter a valid restore code.");
  storage.setItem(USER_SECRET_ID_KEY, normalized);
  upsertUserAccount(storage, normalized);
  return normalized;
}

export function removeUserAccount(storage, userSecretId) {
  const normalized = normalizeUserSecretId(userSecretId);
  if (!normalized) return;
  const registry = loadUserAccounts(storage);
  storage.setItem(USER_ACCOUNTS_KEY, JSON.stringify({
    schemaVersion: 1,
    accounts: registry.accounts.filter((account) => account.userSecretId !== normalized),
  }));
}

export async function deriveProfileId(userSecretId, cryptoImpl = globalThis.crypto) {
  const normalized = normalizeUserSecretId(userSecretId);
  if (!normalized) throw new Error("Invalid restore code.");
  const digest = await cryptoImpl.subtle.digest("SHA-256", textBytes(`panini-profile-lookup-v1:${normalized}`));
  return hex(new Uint8Array(digest));
}

export async function encryptPayload(payload, userSecretId, cryptoImpl = globalThis.crypto) {
  const iv = new Uint8Array(12);
  cryptoImpl.getRandomValues(iv);
  const key = await encryptionKey(userSecretId, cryptoImpl);
  const ciphertext = await cryptoImpl.subtle.encrypt({ name: "AES-GCM", iv }, key, textBytes(JSON.stringify(payload)));
  return {
    envelopeVersion: 1,
    algorithm: "AES-GCM",
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

export async function decryptPayload(envelope, userSecretId, cryptoImpl = globalThis.crypto) {
  if (!envelope || envelope.envelopeVersion !== 1 || envelope.algorithm !== "AES-GCM") {
    throw new Error("Unsupported cloud backup envelope.");
  }
  const key = await encryptionKey(userSecretId, cryptoImpl);
  const plaintext = await cryptoImpl.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(envelope.iv) },
    key,
    base64UrlDecode(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function bindCloudControls({ storage, location, windowRef }) {
  const documentRef = globalThis.document;
  const status = documentRef?.querySelector?.("#cloudSyncStatus");
  const copyButton = documentRef?.querySelector?.("#copyCloudIdButton");
  const restoreButton = documentRef?.querySelector?.("#restoreCloudIdButton");
  const newAccountButton = documentRef?.querySelector?.("#newCloudAccountButton");
  const restoreInput = documentRef?.querySelector?.("#cloudRestoreIdInput");
  const codeOutput = documentRef?.querySelector?.("#cloudUserId");
  const accountSelect = documentRef?.querySelector?.("#cloudAccountSelect");
  const shareStatus = documentRef?.querySelector?.("#publicShareStatus");
  const createShareButton = documentRef?.querySelector?.("#createPublicShareButton");
  const copyShareButton = documentRef?.querySelector?.("#copyPublicShareButton");
  const rotateShareButton = documentRef?.querySelector?.("#rotatePublicShareButton");
  const stopShareButton = documentRef?.querySelector?.("#stopPublicShareButton");
  const restoreButtonLabel = restoreButton?.textContent || "Load reviews";
  const controls = {
    reviewRecoveryMode: documentRef?.body?.dataset?.photoReviewMode === "reviews",
    onCopyCode: null,
    onRestoreCode: null,
    onSelectAccount: null,
    onNewAccount: null,
    onCreateShare: null,
    onCopyShare: null,
    onRotateShare: null,
    onStopShare: null,
    prefillRestoreCode(code) {
      if (restoreInput) restoreInput.value = code || "";
    },
    selectedAccountCode() {
      return accountSelect?.value || "";
    },
    setAccountBusy(busy) {
      if (restoreButton) {
        restoreButton.disabled = busy;
        restoreButton.textContent = busy ? "Loading…" : restoreButtonLabel;
      }
      if (restoreInput) restoreInput.disabled = busy;
      if (accountSelect) accountSelect.disabled = busy;
    },
    setCode(code) {
      if (codeOutput) codeOutput.textContent = code || "Not assigned yet";
    },
    setAccounts(registry, activeCode) {
      controls.setCode(activeCode);
      if (!accountSelect) return;
      accountSelect.textContent = "";
      const accounts = Array.isArray(registry?.accounts) ? registry.accounts : [];
      for (const account of accounts) {
        const option = documentRef.createElement("option");
        option.value = account.userSecretId;
        option.textContent = account.label || accountLabel(account.userSecretId);
        option.selected = account.userSecretId === activeCode;
        accountSelect.append(option);
      }
      accountSelect.hidden = accounts.length <= 1;
      const field = accountSelect.closest?.(".cloudSyncField");
      if (field) field.hidden = accounts.length <= 1;
    },
    setStatus(message, severity = "muted") {
      if (status) {
        status.dataset.severity = severity;
        status.querySelector("strong").textContent = severity === "ok" ? "Cloud backup" : "Cloud backup status";
        status.querySelector("span").textContent = message;
      }
      try {
        storage.setItem(LAST_SYNC_STATUS_KEY, JSON.stringify({ message, severity, updatedAt: new Date().toISOString() }));
      } catch {}
      dispatchWindowEvent(windowRef, SYNC_EVENT, { message, severity });
    },
    setShareSettings(settings) {
      const state = publicShareControlState(settings);
      if (createShareButton) createShareButton.hidden = state.enabled;
      for (const button of [copyShareButton, rotateShareButton, stopShareButton]) {
        if (button) button.hidden = !state.enabled;
      }
      if (shareStatus) controls.setShareStatus(state.message, state.severity);
    },
    setShareStatus(message, severity = "muted") {
      if (!shareStatus) return;
      shareStatus.dataset.severity = severity;
      shareStatus.querySelector("strong").textContent = "Trade link";
      shareStatus.querySelector("span").textContent = message;
    },
  };
  copyButton?.addEventListener?.("click", () => controls.onCopyCode?.());
  restoreButton?.addEventListener?.("click", () => controls.onRestoreCode?.(restoreInput?.value || ""));
  newAccountButton?.addEventListener?.("click", () => controls.onNewAccount?.());
  accountSelect?.addEventListener?.("change", () => controls.onSelectAccount?.(accountSelect.value));
  createShareButton?.addEventListener?.("click", () => controls.onCreateShare?.());
  copyShareButton?.addEventListener?.("click", () => controls.onCopyShare?.());
  rotateShareButton?.addEventListener?.("click", () => controls.onRotateShare?.());
  stopShareButton?.addEventListener?.("click", () => controls.onStopShare?.());
  return controls;
}

function migrateLegacyUserSecret(storage) {
  const legacy = normalizeUserSecretId(storage.getItem(USER_SECRET_ID_KEY) || "");
  if (!legacy) return;
  const registry = parseStoredJson(storage.getItem(USER_ACCOUNTS_KEY), null);
  if (Array.isArray(registry?.accounts) && registry.accounts.some((account) => normalizeUserSecretId(account?.userSecretId || account) === legacy)) return;
  const now = new Date().toISOString();
  const accounts = Array.isArray(registry?.accounts) ? registry.accounts : [];
  accounts.push({ userSecretId: legacy, label: accountLabel(legacy), addedAt: now, lastUsedAt: now });
  storage.setItem(USER_ACCOUNTS_KEY, JSON.stringify({ schemaVersion: 1, accounts }));
}

function saveAccountProjection(storage, profileId) {
  if (!/^[a-f0-9]{64}$/.test(profileId || "")) return;
  storage.setItem(ACCOUNT_STATE_PREFIX + profileId, JSON.stringify(storageProjection(storage)));
}

function loadAccountProjection(storage, profileId) {
  if (!/^[a-f0-9]{64}$/.test(profileId || "")) return null;
  return parseStoredJson(storage.getItem(ACCOUNT_STATE_PREFIX + profileId), null);
}

function applyAccountProjection(storage, projection) {
  if (!projection || typeof projection !== "object") return false;
  storage.setItem(COLLECTION_KEY, JSON.stringify(projection.collectionState || {}));
  storage.setItem(LEDGER_KEY, JSON.stringify(projection.ledger || { schemaVersion: 1, transactions: [] }));
  storage.setItem(INVENTORY_SNAPSHOT_KEY, JSON.stringify(projection.inventorySnapshot || {}));
  storage.setItem(INVENTORY_CACHE_META_KEY, JSON.stringify(projection.inventoryCacheMeta || {}));
  storage.setItem(PUBLIC_SHARE_SETTINGS_KEY, JSON.stringify(projection.publicShareSettings || { schemaVersion: 1, enabled: false, token: "" }));
  return true;
}

function currentCollectionImportVersion(storage) {
  const current = parseStoredJson(storage.getItem(COLLECTION_KEY), {});
  return Math.max(1, Number(current?.importedCollectionSnapshotVersion || 0));
}

function confirmAccountSwitch(windowRef, message) {
  return typeof windowRef.confirm === "function" ? windowRef.confirm(message) : true;
}

function accountLabel(userSecretId) {
  const normalized = normalizeUserSecretId(userSecretId);
  return normalized ? `Account ${normalized.slice(-9)}` : "Account";
}

function validDateOrNow(value) {
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}

function restoreCodeFromLocation(location) {
  const hash = String(location?.hash || "");
  const params = new URLSearchParams(hash.replace(/^#/, "?"));
  return normalizeUserSecretId(params.get("restore") || "");
}

function scrubRestoreFragment(location) {
  if (!location?.hash || typeof globalThis.history?.replaceState !== "function") return;
  const url = new URL(location.href);
  url.hash = "";
  globalThis.history.replaceState(null, "", url);
}

async function copyText(text, controls) {
  try {
    await navigator.clipboard?.writeText(text);
    controls.setStatus("Restore code copied. Keep it private.", "ok");
  } catch {
    controls.setStatus(text || "No restore code assigned yet.", "warning");
  }
}

async function encryptionKey(userSecretId, cryptoImpl) {
  const digest = await cryptoImpl.subtle.digest("SHA-256", textBytes(`panini-profile-encryption-v1:${normalizeUserSecretId(userSecretId)}`));
  return cryptoImpl.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function ensureDeviceId(storage, cryptoImpl) {
  const existing = String(storage.getItem(DEVICE_ID_KEY) || "");
  if (DEVICE_ID_PATTERN.test(existing)) return existing;
  const deviceId = randomId("dev", cryptoImpl);
  storage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

function randomId(prefix, cryptoImpl) {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return `${prefix}_${base64UrlEncode(bytes)}`;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function parseStoredJson(text, fallback) {
  try {
    return JSON.parse(text || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeCheckpointShareSettings(value) {
  const storage = {
    getItem(key) {
      return key === PUBLIC_SHARE_SETTINGS_KEY ? JSON.stringify(value || null) : null;
    },
  };
  return loadPublicShareSettings(storage);
}

function nextBrowserTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function settleWithin(promise, {
  signal = null,
  timeoutMs = CLOUD_REQUEST_TIMEOUT_MS,
  timeoutMessage = "Cloud operation timed out.",
  onInterrupt = () => {},
} = {}) {
  let timeoutId = null;
  let removeAbortListener = () => {};
  const interrupted = new Promise((_, reject) => {
    const abort = () => {
      onInterrupt();
      const error = new Error("Cloud operation cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener?.("abort", abort, { once: true });
    removeAbortListener = () => signal?.removeEventListener?.("abort", abort);
    timeoutId = setTimeout(() => {
      onInterrupt();
      const error = new Error(timeoutMessage);
      error.name = "CloudRequestTimeoutError";
      reject(error);
    }, Math.max(1, Number(timeoutMs || CLOUD_REQUEST_TIMEOUT_MS)));
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    removeAbortListener();
  }
}

function requestError(response, message) {
  const error = new Error(message);
  error.status = response.status;
  return error;
}

function dispatchWindowEvent(windowRef, name, detail) {
  try {
    windowRef.dispatchEvent?.(new CustomEvent(name, { detail }));
  } catch {}
}

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base64UrlEncode(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const padded = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, String.fromCharCode(47))
    .padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
