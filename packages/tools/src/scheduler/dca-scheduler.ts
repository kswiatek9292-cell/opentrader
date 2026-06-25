export type ScheduleInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "12h" | "1d" | "1w";

export interface DCAScheduleConfig {
  /** Unique identifier for this schedule */
  id: string;
  /** Trading pair */
  symbol: string;
  /** DCA interval */
  interval: ScheduleInterval;
  /** Amount to invest per DCA in quote currency */
  amountPerDCA: number;
  /** Whether the schedule is active */
  active: boolean;
  /** Start time (ISO string), or null for immediate start */
  startTime?: string;
  /** End time (ISO string), or null for no end */
  endTime?: string;
  /** Maximum number of DCA rounds, or null for unlimited */
  maxRounds?: number;
}

export interface DCAScheduleState {
  config: DCAScheduleConfig;
  roundsCompleted: number;
  totalInvested: number;
  totalQuantityBought: number;
  avgPrice: number;
  lastExecutionTime?: string;
  nextExecutionTime: string;
}

const INTERVAL_MS: Record<ScheduleInterval, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

/**
 * Calculate the next execution time from the current time and interval.
 */
export function calculateNextExecution(interval: ScheduleInterval, from?: Date): Date {
  const now = from ?? new Date();
  return new Date(now.getTime() + INTERVAL_MS[interval]);
}

/**
 * Check if a schedule should execute now.
 */
export function shouldExecuteNow(state: DCAScheduleState): boolean {
  if (!state.config.active) return false;

  const now = new Date();

  // Check start time
  if (state.config.startTime && now < new Date(state.config.startTime)) return false;

  // Check end time
  if (state.config.endTime && now > new Date(state.config.endTime)) return false;

  // Check max rounds
  if (state.config.maxRounds && state.roundsCompleted >= state.config.maxRounds) return false;

  // Check next execution time
  return now >= new Date(state.nextExecutionTime);
}

/**
 * Update schedule state after a DCA execution.
 */
export function updateScheduleState(
  state: DCAScheduleState,
  executedPrice: number,
  executedQuantity: number,
): DCAScheduleState {
  const newRoundsCompleted = state.roundsCompleted + 1;
  const newTotalInvested = state.totalInvested + executedPrice * executedQuantity;
  const newTotalQuantity = state.totalQuantityBought + executedQuantity;

  return {
    ...state,
    roundsCompleted: newRoundsCompleted,
    totalInvested: newTotalInvested,
    totalQuantityBought: newTotalQuantity,
    avgPrice: newTotalQuantity > 0 ? newTotalInvested / newTotalQuantity : 0,
    lastExecutionTime: new Date().toISOString(),
    nextExecutionTime: calculateNextExecution(state.config.interval).toISOString(),
  };
}

/**
 * Create initial state for a new DCA schedule.
 */
export function createScheduleState(config: DCAScheduleConfig): DCAScheduleState {
  const startTime = config.startTime ? new Date(config.startTime) : new Date();
  return {
    config,
    roundsCompleted: 0,
    totalInvested: 0,
    totalQuantityBought: 0,
    avgPrice: 0,
    nextExecutionTime: startTime.toISOString(),
  };
}

/**
 * Get interval in milliseconds.
 */
export function getIntervalMs(interval: ScheduleInterval): number {
  return INTERVAL_MS[interval];
}

/**
 * Format schedule state as a summary string.
 */
export function formatScheduleSummary(state: DCAScheduleState): string {
  const { config } = state;
  const lines = [
    `Schedule: ${config.id}`,
    `Pair: ${config.symbol}`,
    `Interval: ${config.interval}`,
    `Amount: ${config.amountPerDCA} per DCA`,
    `Rounds: ${state.roundsCompleted}${config.maxRounds ? `/${config.maxRounds}` : ""}`,
    `Total Invested: ${state.totalInvested.toFixed(2)}`,
    `Avg Price: ${state.avgPrice.toFixed(2)}`,
    `Total Bought: ${state.totalQuantityBought.toFixed(6)}`,
    `Active: ${config.active}`,
    `Next: ${state.nextExecutionTime}`,
  ];
  return lines.join("\n");
}
