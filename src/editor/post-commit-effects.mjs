// Model acceptance must not be confused with failure to refresh a view or save
// recovery afterward. Run independent effects even if an earlier one fails.
export function runPostCommitEffects(effects) {
  const failures=[];
  for(const [name,run] of Object.entries(effects)) {
    try { run(); } catch(error) { failures.push({name,message:error instanceof Error?error.message:String(error)}); }
  }
  return failures;
}
