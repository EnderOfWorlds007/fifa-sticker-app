export async function fetchAllDeltaPages(fetchPage, { startRevision = 0, limit = 10, maxPages = 10_000 } = {}) {
  const transactions = [];
  let appliedRevision = Math.max(0, Number(startRevision || 0));
  let remoteRevision = appliedRevision;
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchPage(appliedRevision, limit);
    const pageTransactions = Array.isArray(payload?.transactions) ? payload.transactions : [];
    remoteRevision = Math.max(remoteRevision, Number(payload?.currentRevision || 0));
    if (!pageTransactions.length) break;
    transactions.push(...pageTransactions);
    const pageRevision = Math.max(...pageTransactions.map((item) => Number(item.revision || 0)), appliedRevision);
    if (pageRevision <= appliedRevision) throw new Error("Cloud backup returned a non-advancing transaction page.");
    appliedRevision = pageRevision;
    if (appliedRevision >= remoteRevision) break;
  }
  return { transactions, revision: appliedRevision, remoteRevision };
}

export function monotonicRevision(currentRevision, incomingRevision) {
  return Math.max(0, Number(currentRevision || 0), Number(incomingRevision || 0));
}
