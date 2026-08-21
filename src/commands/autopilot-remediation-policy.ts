export const AUTOPILOT_FULL_CYCLE_FLOOR_MINUTES = 60;

export interface AutopilotRemediationPlanShape {
  score: number;
  planLength: number;
  estimatedSeconds: number;
  minutesSinceLastFull: number;
}

/**
 * Keep recommendation keys stable for doctor/remediate checkpoints while
 * giving Autopilot a fresh single-flight slot on every dispatch interval.
 */
export function autopilotRemediationIdempotencyKey(
  recommendationKey: string,
  dispatchSlot: string,
): string {
  return `${recommendationKey}:autopilot:${dispatchSlot}`;
}

/**
 * A full cycle is a freshness invariant, independent of the current score or
 * targeted plan. Slow plans stay in the dependency-aware remediation lane;
 * estimated duration must not route them into a cycle that cannot consume
 * targeted handlers (for example extract-timeline-from-meetings).
 */
export function shouldRunAutopilotFullCycle({
  score,
  planLength,
  estimatedSeconds: _estimatedSeconds,
  minutesSinceLastFull,
}: AutopilotRemediationPlanShape): boolean {
  return minutesSinceLastFull >= AUTOPILOT_FULL_CYCLE_FLOOR_MINUTES
    || planLength > 3
    || score < 70;
}

export function shouldSleepHealthyAutopilot(
  score: number,
  planLength: number,
  minutesSinceLastFull: number,
): boolean {
  return score >= 95
    && planLength === 0
    && minutesSinceLastFull < AUTOPILOT_FULL_CYCLE_FLOOR_MINUTES;
}
