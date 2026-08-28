import {
  COLLECTION_KEY,
  INVENTORY_CACHE_META_KEY,
  INVENTORY_SNAPSHOT_KEY,
  LEDGER_KEY,
} from "./backup_restore.js?v=build-1275c9cccb86";
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
} from "./public_share.js?v=build-1275c9cccb86";
import { loadCollectionCatalog } from "./catalog_source.js?v=build-1275c9cccb86";
import { buildInventoryProjection } from "./inventory_projection.js?v=build-1275c9cccb86";

export const USER_SECRET_ID_KEY = "panini.cloudSync.userSecretId.v1";
export const USER_ACCOUNTS_KEY = "panini.cloudSync.accounts.v1";
export const DEVICE_ID_KEY = "panini.cloudSync.deviceId.v1";
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{12,80}$/;
const LAST_REVISION_PREFIX = "panini.cloudSync.lastRevision.v1:";
const ACCOUNT_STATE_PREFIX = "panini.cloudSync.accountState.v1:";
const LAST_SYNC_STATUS_KEY = "panini.cloudSync.lastStatus.v1";
const ID_RANDOM_BYTES = 24;
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
  let pendingTimer = null;
  let lastTriggerKind = "manual";
  const refreshShareControls = () => controls.setShareSettings(loadPublicShareSettings(storage));

  const syncDeltas = async ({ apply = true } = {}) => {
    try {
      const previousSecretId = client.userSecretId;
      await client.ensureIdentity();
      if (client.userSecretId !== previousSecretId) controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
      const result = await client.fetchDeltas();
      if (apply && result.transactions.length) {
        applyingRemote = true;
        try {
          for (const transaction of result.transactions) {
            const payload = await client.decryptTransaction(transaction);
            applyCloudCheckpoint(payload, storage);
          }
          saveAccountProjection(storage, client.profileId);
          client.setLastRevision(result.revision);
          refreshShareControls();
        } finally {
          applyingRemote = false;
        }
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: result.revision });
      }
      controls.setStatus(
        result.transactions.length
          ? `Cloud backup updated from ${result.transactions.length} change${result.transactions.length === 1 ? "" : "s"}.`
          : `Cloud backup ready. Revision ${result.revision}.`,
        "ok",
      );
      return result;
    } catch (error) {
      controls.setStatus(error?.message || "Cloud sync could not connect.", "warning");
      return { transactions: [], revision: client.lastRevision };
    }
  };

  const queueAutosave = (kind = "local") => {
    if (!initialized || applyingRemote) return;
    if (client.profileId) saveAccountProjection(storage, client.profileId);
    lastTriggerKind = kind || "local";
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      autosave(lastTriggerKind);
    }, 900);
  };

  const switchToAccount = async (restoreCode, { confirmMessage, emptyMessage }) => {
    const normalized = normalizeUserSecretId(restoreCode);
    if (!normalized) {
      controls.setStatus("Enter a valid restore code.", "warning");
      return false;
    }
    if (!confirmAccountSwitch(windowRef, confirmMessage)) {
      controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
      return false;
    }
    const wasKnown = loadUserAccounts(storage).accounts.some((account) => account.userSecretId === normalized);
    clearTimeout(pendingTimer);
    pendingTimer = null;
    const previousCode = client.userSecretId;
    const previousProfileId = client.profileId;
    if (previousProfileId) saveAccountProjection(storage, previousProfileId);
    const targetProfileId = await deriveProfileId(normalized, cryptoImpl);
    const cachedProjection = loadAccountProjection(storage, targetProfileId);
    try {
      await client.useRestoreCode(normalized);
      controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
      const result = await client.fetchDeltas();
      if (result.transactions.length) {
        applyingRemote = true;
        try {
          for (const transaction of result.transactions) {
            const payload = await client.decryptTransaction(transaction);
            applyCloudCheckpoint(payload, storage);
          }
          saveAccountProjection(storage, client.profileId);
          client.setLastRevision(result.revision);
          refreshShareControls();
        } finally {
          applyingRemote = false;
        }
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: result.revision });
        controls.setStatus(`Cloud account switched. Revision ${result.revision}.`, "ok");
        return true;
      }
      if (cachedProjection) {
        applyAccountProjection(storage, cachedProjection);
        refreshShareControls();
        controls.setStatus("Cloud account switched using this browser's saved copy.", "ok");
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: client.lastRevision });
        return true;
      }
    } catch (error) {
      if (cachedProjection) {
        applyAccountProjection(storage, cachedProjection);
        refreshShareControls();
        controls.setStatus("Cloud account switched using this browser's saved copy.", "warning");
        dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: client.lastRevision });
        return true;
      }
      controls.setStatus(error?.message || "Cloud account switch failed.", "warning");
    }
    if (previousCode) {
      await client.useRestoreCode(previousCode);
      const previousProjection = previousProfileId ? loadAccountProjection(storage, previousProfileId) : null;
      if (previousProjection) applyAccountProjection(storage, previousProjection);
      if (!wasKnown) removeUserAccount(storage, normalized);
      controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
    }
    controls.setStatus(emptyMessage, "warning");
    return false;
  };

  const autosave = async (kind = "local") => {
    try {
      await syncDeltas({ apply: true });
      const checkpoint = createStorageCheckpoint({ storage, triggerKind: kind, deviceId: client.deviceId });
      const publicShare = await publicShareForCheckpoint(checkpoint, { fetchImpl, cryptoImpl });
      const result = await client.appendTransaction(checkpoint, { publicShare });
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
      if (error?.status === 409 || error?.status === 412) {
        controls.setStatus("Cloud backup changed elsewhere. Loading newest changes first.", "warning");
        await syncDeltas({ apply: true });
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

  windowRef.addEventListener?.("panini:local-state-saved", (event) => {
    queueAutosave(event?.detail?.kind || "local");
  });
  windowRef.addEventListener?.("focus", () => syncDeltas({ apply: true }));
  globalThis.document?.addEventListener?.("visibilitychange", () => {
    if (globalThis.document.visibilityState === "visible") syncDeltas({ apply: true });
  });
  controls.onCopyCode = () => copyText(client.userSecretId, controls);
  controls.onRestoreCode = async (restoreCode) => {
    if (!restoreCode) return;
    await switchToAccount(restoreCode, {
      confirmMessage: "Add this cloud account and make it active? Current local collection and activity will be replaced by that account.",
      emptyMessage: "No cloud backup was found for that account, so this browser kept the current account active.",
    });
  };
  controls.onSelectAccount = async (restoreCode) => {
    if (!restoreCode || normalizeUserSecretId(restoreCode) === client.userSecretId) return;
    await switchToAccount(restoreCode, {
      confirmMessage: "Switch active cloud account? Current local collection and activity will be replaced by that account.",
      emptyMessage: "No saved state was found for that account, so this browser kept the current account active.",
    });
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
    dispatchWindowEvent(windowRef, APPLIED_EVENT, { revision: client.lastRevision });
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

  syncDeltas({ apply: true }).finally(() => {
    initialized = true;
    controls.setAccounts(loadUserAccounts(storage), client.userSecretId);
    refreshShareControls();
    if (publicShareNeedsRepublish(loadPublicShareSettings(storage))) {
      queueAutosave("public-projection-upgrade");
    }
  });
  return { client, syncDeltas, autosave };
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
  }

  async ensureIdentity({ restoreCode = "" } = {}) {
    migrateLegacyUserSecret(this.storage);
    const activeAccount = activeUserSecretId(this.storage);
    const code = normalizeUserSecretId(restoreCode || activeAccount || "");
    return this.useRestoreCode(code || generateUserSecretId(this.crypto));
  }

  async useRestoreCode(code) {
    this.userSecretId = normalizeUserSecretId(code);
    if (!this.userSecretId) throw new Error("Enter a valid restore code.");
    this.profileId = await deriveProfileId(this.userSecretId, this.crypto);
    this.deviceId = ensureDeviceId(this.storage, this.crypto);
    upsertUserAccount(this.storage, this.userSecretId);
    setActiveUserSecretId(this.storage, this.userSecretId);
    this.lastRevision = Number(this.storage.getItem(LAST_REVISION_PREFIX + this.profileId) || 0);
    return this.userSecretId;
  }

  async fetchDeltas({ limit = 500 } = {}) {
    if (!this.profileId) await this.ensureIdentity();
    const url = new URL(`${this.baseUrl}/v1/profiles/${this.profileId}/transactions`);
    url.searchParams.set("after", String(this.lastRevision));
    url.searchParams.set("limit", String(limit));
    const response = await this.fetchImpl(url, { cache: "no-store" });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw requestError(response, payload?.error || "Cloud backup could not be loaded.");
    const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
    const revision = Number(payload.currentRevision || this.lastRevision);
    const remoteRevision = Math.max(revision, ...transactions.map((item) => Number(item.revision || 0)), this.lastRevision);
    if (!transactions.length) this.setLastRevision(remoteRevision);
    return { transactions, revision: remoteRevision };
  }

  async appendTransaction(payload, { publicShare } = {}) {
    if (!this.profileId) await this.ensureIdentity();
    const encryptedPayload = await encryptPayload(payload, this.userSecretId, this.crypto);
    const response = await this.fetchImpl(`${this.baseUrl}/v1/profiles/${this.profileId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txId: randomId("tx", this.crypto),
        deviceId: this.deviceId,
        clientCreatedAt: new Date().toISOString(),
        baseRevision: this.lastRevision,
        encryptedPayload,
        ...(publicShare ? { publicShare } : {}),
      }),
    });
    const result = await readJsonResponse(response);
    if (!response.ok) throw requestError(response, result?.error || "Cloud backup could not be saved.");
    this.setLastRevision(Number(result.revision || this.lastRevision));
    return { revision: this.lastRevision };
  }

  async decryptTransaction(transaction) {
    return decryptPayload(transaction.encryptedPayload, this.userSecretId, this.crypto);
  }

  setLastRevision(revision) {
    this.lastRevision = Math.max(0, Number(revision || 0));
    if (this.profileId) this.storage.setItem(LAST_REVISION_PREFIX + this.profileId, String(this.lastRevision));
    this.storage.setItem(LAST_SYNC_STATUS_KEY, JSON.stringify({
      profileId: this.profileId,
      revision: this.lastRevision,
      syncedAt: new Date().toISOString(),
    }));
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

export async function publicShareForCheckpoint(checkpoint, { fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
  const settings = normalizeCheckpointShareSettings(checkpoint?.storage?.publicShareSettings);
  if (!settings.enabled) return { enabled: false };
  const catalog = await loadCollectionCatalog({ fetch: fetchImpl });
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
  const controls = {
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

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
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
