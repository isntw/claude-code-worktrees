export const REPAIR_HINT =
  'Repair relinks from the root checkout — anything running is stopped and started again, and anything a worktree installed itself is replaced.'

export const repairTitle = (name: string) =>
  `${name} does not match what the recipe declares — repair relinks it from the root checkout, stopping and restarting anything running around it`
