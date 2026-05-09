export const STALE_MS = 30000;

export function isStale(turtle: { modified?: number }): boolean {
  return !!turtle.modified && (Date.now() - turtle.modified) > STALE_MS;
}
