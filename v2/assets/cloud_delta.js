export async function fetchAllDeltaPages(fetchPage, { startRevision = 0, limit = 10, maxPages = 10_000 } = {}) {
  const transactions = [];
  let appliedRevision = Math.max(0, Number(startRevision || 0));
  let remoteRevision = appliedRevision;
  let completed = false;
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchPage(appliedRevision, limit);
    const pageTransactions = Array.isArray(payload?.transactions) ? payload.transactions : [];
    remoteRevision = Math.max(remoteRevision, Number(payload?.currentRevision || 0));
    if (!pageTransactions.length) {
      completed = true;
      break;
    }
    transactions.push(...pageTransactions);
    const pageRevision = Math.max(...pageTransactions.map((item) => Number(item.revision || 0)), appliedRevision);
    if (pageRevision <= appliedRevision) throw new Error("Cloud backup returned a non-advancing transaction page.");
    appliedRevision = pageRevision;
    if (appliedRevision >= remoteRevision) {
      completed = true;
      break;
    }
  }
  if (!completed) throw new Error("Cloud backup pagination exceeded its safety limit.");
  return { transactions, revision: appliedRevision, remoteRevision };
}

export function monotonicRevision(currentRevision, incomingRevision) {
  return Math.max(0, Number(currentRevision || 0), Number(incomingRevision || 0));
}

export function validateSparseCloudHistory(history) {
  const highWaterRevision = Number(history?.remoteRevision);
  if (!Number.isSafeInteger(highWaterRevision) || highWaterRevision < 0) {
    throw new Error("Cloud review history has an invalid high-water revision.");
  }
  let previousRevision = 0;
  for (const transaction of Array.isArray(history?.transactions) ? history.transactions : []) {
    const revision = Number(transaction?.revision);
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
