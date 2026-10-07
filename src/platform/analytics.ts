/**
 * Analytics extension point (GDD D25): 1.0 ships with no provider. A future provider (e.g.
 * Firebase) implements `Analytics` and is installed with `setAnalytics()` — which also needs
 * the owner's account/config files and a Data safety update (docs/RELEASE.md).
 * Event names: snake_case; params: flat primitives, no personal data.
 */
export type AnalyticsParams = Record<string, string | number | boolean>;

export interface Analytics {
  event(name: string, params?: AnalyticsParams): void;
}

export class NoopAnalytics implements Analytics {
  event(_name: string, _params?: AnalyticsParams): void {}
}

let current: Analytics = new NoopAnalytics();

export function analytics(): Analytics {
  return current;
}

export function setAnalytics(provider: Analytics): void {
  current = provider;
}

/** Fire-and-forget helper; a broken provider never affects the game. */
export function track(name: string, params?: AnalyticsParams): void {
  try {
    current.event(name, params);
  } catch {
    // ignore
  }
}
