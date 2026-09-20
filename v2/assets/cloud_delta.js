export async function fetchAllDeltaPages(fetchPage, {
  startRevision = 0,
  limit = 10,
  maxPages = 10_000,
  retainTransactions = true,
  visitTransaction = null,
} = {}) {
  const transactions = [];
  const transactionRevisions = [];
  let appliedRevision = Math.max(0, Number(startRevision || 0));
  let remoteRevision = null;
  let transactionCount = 0;
  let completed = false;
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchPage(appliedRevision, limit);
    const advertisedRevision = Number(payload?.currentRevision);
    if (!Number.isSafeInteger(advertisedRevision) || advertisedRevision < appliedRevision) {
      throw new Error("Cloud backup returned an invalid high-water revision.");
    }
    // Freeze the remote head seen by the first page. A recovery must terminate
    // against one snapshot even if another device appends while it is running.
    if (remoteRevision === null) remoteRevision = advertisedRevision;
    const rawTransactions = Array.isArray(payload?.transactions) ? payload.transactions : [];
    let rawPageRevision = appliedRevision;
    for (const transaction of rawTransactions) {
      const revision = Number(transaction?.revision);
      if (!Number.isSafeInteger(revision) || revision <= rawPageRevision || revision > advertisedRevision) {
        throw new Error("Cloud backup returned a non-advancing transaction page.");
      }
      rawPageRevision = revision;
    }
    const pageTransactions = rawTransactions.filter((item) => Number(item?.revision) <= remoteRevision);
    if (!pageTransactions.length) {
      completed = true;
      break;
    }
    let pageRevision = appliedRevision;
    for (const transaction of pageTransactions) {
      const revision = Number(transaction?.revision);
      if (!Number.isSafeInteger(revision) || revision <= pageRevision || revision > remoteRevision) {
        throw new Error("Cloud backup returned a non-advancing transaction page.");
      }
      await visitTransaction?.(transaction, {
        page: page + 1,
        revision,
        remoteRevision,
        transactionCount: transactionCount + 1,
      });
      if (retainTransactions) transactions.push(transaction);
      transactionRevisions.push(revision);
      transactionCount += 1;
      pageRevision = revision;
    }
    appliedRevision = pageRevision;
    if (appliedRevision >= remoteRevision) {
      completed = true;
      break;
    }
  }
  if (!completed) throw new Error("Cloud backup pagination exceeded its safety limit.");
  return {
    transactions,
    transactionRevisions,
    transactionCount,
    revision: appliedRevision,
    remoteRevision: remoteRevision ?? appliedRevision,
  };
}

export function monotonicRevision(currentRevision, incomingRevision) {
  return Math.max(0, Number(currentRevision || 0), Number(incomingRevision || 0));
}

export function validateSparseCloudHistory(history, { startRevision = 0 } = {}) {
  const highWaterRevision = Number(history?.remoteRevision);
  if (!Number.isSafeInteger(highWaterRevision) || highWaterRevision < 0) {
    throw new Error("Cloud review history has an invalid high-water revision.");
  }
  let previousRevision = Math.max(0, Number(startRevision || 0));
  const revisions = Array.isArray(history?.transactionRevisions)
    ? history.transactionRevisions
    : (Array.isArray(history?.transactions) ? history.transactions : []).map((transaction) => transaction?.revision);
  for (const value of revisions) {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision <= 0 || revision <= previousRevision || revision > highWaterRevision) {
      throw new Error("Cloud review history is invalid; existing reviews were left unchanged.");
    }
    previousRevision = revision;
  }
  if (Number(history?.revision) !== previousRevision) {
    throw new Error("Cloud review history pagination is incomplete; existing reviews were left unchanged.");
  }
  return { highWaterRevision, lastTransactionRevision: previousRevision };
}

export function createCloudSyncGate() {
  let blocked = false;
  let chain = Promise.resolve();
  return {
    run(task, blockedResult = () => undefined) {
      if (blocked) return Promise.resolve(blockedResult());
      const operation = chain.then(() => (blocked ? blockedResult() : task()));
      chain = operation.catch(() => undefined);
      return operation;
    },
    async block() {
      blocked = true;
      await chain;
    },
    unblock() {
      blocked = false;
    },
  };
}

export async function requestJsonWithTimeout(fetchImpl, input, init = {}, {
  timeoutMs = 30_000,
  timeoutMessage = "Cloud request timed out. Check the connection and try again.",
} = {}) {
  const externalSignal = init.signal || null;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId = null;
  let removeAbortListener = () => {};
  const request = (async () => {
    const response = await fetchImpl(input, { ...init, signal: controller?.signal || externalSignal || undefined });
    let payload = null;
    try {
      payload = await response.json();
    } catch {}
    return { response, payload };
  })();
  const interrupted = new Promise((_, reject) => {
    const abort = () => {
      controller?.abort();
      const error = new Error("Cloud request cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    if (externalSignal?.aborted) {
      abort();
      return;
    }
    externalSignal?.addEventListener?.("abort", abort, { once: true });
    removeAbortListener = () => externalSignal?.removeEventListener?.("abort", abort);
    timeoutId = setTimeout(() => {
      controller?.abort();
      const error = new Error(timeoutMessage);
      error.name = "CloudRequestTimeoutError";
      reject(error);
    }, Math.max(1, Number(timeoutMs || 30_000)));
  });
  try {
    return await Promise.race([request, interrupted]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    removeAbortListener();
  }
}
