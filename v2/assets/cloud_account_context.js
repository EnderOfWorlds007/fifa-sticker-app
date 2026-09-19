export function accountContextMatches(active, captured) {
  return Boolean(
    captured
      && captured.generation === active.generation
      && captured.profileId === active.profileId
      && captured.userSecretId === active.userSecretId,
  );
}

export function accountRevisionMatches(activeRevision, captured) {
  return Number(captured?.startRevision) === Number(activeRevision);
}

export async function resolveAccountBound(promise, captured, activeContext) {
  const value = await promise;
  return accountContextMatches(activeContext(), captured)
    ? { stale: false, value }
    : { stale: true, value: null };
}

export function canActivateCloudAccount({ checkpointApplied = false, hasCachedProjection = false } = {}) {
  return Boolean(checkpointApplied || hasCachedProjection);
}
