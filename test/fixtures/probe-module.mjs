// A rule module that reports what its views contain, so tests can see the
// revisions, SHA and files a module is given. Silent unless repo.probe.
export function createRules({ config }) {
  if (!config.probe) return {};
  return {
    body: (view) => [{ rule: "probe-body", message: JSON.stringify({ base: view.base ?? null, head: view.head ?? null, files: view.files }) }],
    commit: (view) => [{ rule: "probe-commit", message: JSON.stringify({ sha: view.sha ?? null, files: view.files ?? null }) }],
  };
}
