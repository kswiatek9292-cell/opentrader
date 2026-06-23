/**
 * Profitability analyzer for auto-detected pairs.
 * Uses historical OHLCV candle data to simulate DCA and estimate potential profit.
 */

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProfitabilityConfig {
  /** DCA investment amount per entry (in quote currency) */
  dcaAmountPerEntry: number;
  /** Take profit target in % */
  tpPercent: number;
  /** Stop loss in % (optional) */
  slPercent?: number;
  /** Simulated maker fee rate */
  feeRate: number;
  /** Number of safety orders */
  safetyOrderCount: number;
  /** Price deviation for first safety order (%) */
  safetyOrderDeviation: number;
  /** Safety order volume scale (multiplier for each subsequent SO) */
  safetyOrderVolumeScale: number;
  /** Safety order step scale (multiplier for deviation between SOs) */
  safetyOrderStepScale: number;
}

export interface ProfitabilityResult {
  symbol: string;
  /** Number of completed DCA deals in the period */
  completedDeals: number;
  /** Number of deals that hit stop loss */
  stoppedDeals: number;
  /** Total profit in quote currency */
  totalProfit: number;
  /** Total profit as percentage of total invested */
  totalProfitPercent: number;
  /** Average profit per completed deal */
  avgProfitPerDeal: number;
  /** Average deal duration in candles */
  avgDealDuration: number;
  /** Maximum drawdown during the period (%) */
  maxDrawdownPercent: number;
  /** Win rate (completed deals / total deals) */
  winRate: number;
  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;
  /** Composite profitability score (0-1) */
  profitabilityScore: number;
  /** Average number of safety orders triggered per deal */
  avgSafetyOrdersTriggered: number;
  /** Total amount invested across all deals */
  totalInvested: number;
  /** Price volatility (std dev of returns) */
  volatility: number;
  /** Mean reversion score — how well price reverts after dips */
  meanReversionScore: number;
}

const DEFAULT_PROFITABILITY_CONFIG: ProfitabilityConfig = {
  dcaAmountPerEntry: 100,
  tpPercent: 3,
  feeRate: 0.001,
  safetyOrderCount: 3,
  safetyOrderDeviation: 2,
  safetyOrderVolumeScale: 2,
  safetyOrderStepScale: 1.5,
};

interface DCADeal {
  entryPrice: number;
  avgPrice: number;
  totalQuantity: number;
  totalInvested: number;
  safetyOrdersTriggered: number;
  startIndex: number;
  endIndex: number;
  profit: number;
  profitPercent: number;
  result: "tp" | "sl" | "open";
}

/**
 * Analyze profitability of a trading pair for DCA strategy
 * by simulating deals on historical candle data.
 */
export function analyzeProfitability(
  symbol: string,
  candles: CandleData[],
  config: Partial<ProfitabilityConfig> = {},
): ProfitabilityResult {
  const cfg = { ...DEFAULT_PROFITABILITY_CONFIG, ...config };

  if (candles.length < 10) {
    return emptyResult(symbol);
  }

  // Calculate safety order levels
  const safetyOrders = buildSafetyOrders(cfg);
  const deals: DCADeal[] = [];
  let i = 0;

  while (i < candles.length - 1) {
    const deal = simulateDeal(candles, i, cfg, safetyOrders);
    if (!deal) break;
    deals.push(deal);
    i = deal.endIndex + 1;
  }

  if (deals.length === 0) {
    return emptyResult(symbol);
  }

  const completedDeals = deals.filter((d) => d.result === "tp");
  const stoppedDeals = deals.filter((d) => d.result === "sl");
  const totalProfit = deals.reduce((sum, d) => sum + d.profit, 0);
  const totalInvested = deals.reduce((sum, d) => sum + d.totalInvested, 0);
  const grossProfit = deals.filter((d) => d.profit > 0).reduce((sum, d) => sum + d.profit, 0);
  const grossLoss = Math.abs(deals.filter((d) => d.profit < 0).reduce((sum, d) => sum + d.profit, 0));

  const avgDealDuration = deals.reduce((sum, d) => sum + (d.endIndex - d.startIndex), 0) / deals.length;
  const avgSafetyOrdersTriggered = deals.reduce((sum, d) => sum + d.safetyOrdersTriggered, 0) / deals.length;

  const volatility = calculateVolatility(candles);
  const meanReversionScore = calculateMeanReversionScore(candles);
  const maxDrawdownPercent = calculateMaxDrawdown(candles);

  const winRate = deals.length > 0 ? completedDeals.length / deals.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

  // Composite profitability score
  const winRateScore = Math.min(winRate, 1);
  const profitScore = Math.min(Math.max(totalProfitPercent / 10, 0), 1);
  const dealFreqScore = Math.min(deals.length / 20, 1);
  const reversionBonus = Math.min(meanReversionScore, 1);
  const drawdownPenalty = Math.max(1 - maxDrawdownPercent / 50, 0);

  const profitabilityScore = Math.round(
    (winRateScore * 0.25 + profitScore * 0.3 + dealFreqScore * 0.15 + reversionBonus * 0.15 + drawdownPenalty * 0.15) * 1000,
  ) / 1000;

  return {
    symbol,
    completedDeals: completedDeals.length,
    stoppedDeals: stoppedDeals.length,
    totalProfit: round(totalProfit),
    totalProfitPercent: round(totalProfitPercent),
    avgProfitPerDeal: round(deals.length > 0 ? totalProfit / deals.length : 0),
    avgDealDuration: Math.round(avgDealDuration),
    maxDrawdownPercent: round(maxDrawdownPercent),
    winRate: round(winRate),
    profitFactor: round(Math.min(profitFactor, 999)),
    profitabilityScore,
    avgSafetyOrdersTriggered: round(avgSafetyOrdersTriggered),
    totalInvested: round(totalInvested),
    volatility: round(volatility),
    meanReversionScore: round(meanReversionScore),
  };
}

interface SafetyOrderLevel {
  deviationPercent: number;
  volumeMultiplier: number;
}

function buildSafetyOrders(cfg: ProfitabilityConfig): SafetyOrderLevel[] {
  const orders: SafetyOrderLevel[] = [];
  let deviation = cfg.safetyOrderDeviation;
  let volume = 1;

  for (let i = 0; i < cfg.safetyOrderCount; i++) {
    orders.push({ deviationPercent: deviation, volumeMultiplier: volume });
    deviation += cfg.safetyOrderDeviation * Math.pow(cfg.safetyOrderStepScale, i);
    volume *= cfg.safetyOrderVolumeScale;
  }

  return orders;
}

function simulateDeal(
  candles: CandleData[],
  startIdx: number,
  cfg: ProfitabilityConfig,
  safetyOrders: SafetyOrderLevel[],
): DCADeal | null {
  if (startIdx >= candles.length) return null;

  const entryPrice = candles[startIdx].close;
  const entryQty = cfg.dcaAmountPerEntry / entryPrice;
  const entryFee = cfg.dcaAmountPerEntry * cfg.feeRate;

  let totalQty = entryQty;
  let totalCost = cfg.dcaAmountPerEntry + entryFee;
  let soTriggered = 0;
  const soFilled = new Set<number>();

  const tpPrice = entryPrice * (1 + cfg.tpPercent / 100);
  const slPrice = cfg.slPercent ? entryPrice * (1 - cfg.slPercent / 100) : 0;

  for (let i = startIdx + 1; i < candles.length; i++) {
    const candle = candles[i];

    // Check safety orders
    for (let s = 0; s < safetyOrders.length; s++) {
      if (soFilled.has(s)) continue;
      const soPrice = entryPrice * (1 - safetyOrders[s].deviationPercent / 100);
      if (candle.low <= soPrice) {
        const soAmount = cfg.dcaAmountPerEntry * safetyOrders[s].volumeMultiplier;
        const soQty = soAmount / soPrice;
        const soFee = soAmount * cfg.feeRate;
        totalQty += soQty;
        totalCost += soAmount + soFee;
        soTriggered++;
        soFilled.add(s);
      }
    }

    const avgPrice = totalCost / totalQty;
    const currentTpPrice = avgPrice * (1 + cfg.tpPercent / 100);

    // Take profit hit
    if (candle.high >= currentTpPrice) {
      const sellValue = totalQty * currentTpPrice;
      const sellFee = sellValue * cfg.feeRate;
      const profit = sellValue - sellFee - totalCost;
      return {
        entryPrice,
        avgPrice,
        totalQuantity: totalQty,
        totalInvested: totalCost,
        safetyOrdersTriggered: soTriggered,
        startIndex: startIdx,
        endIndex: i,
        profit,
        profitPercent: (profit / totalCost) * 100,
        result: "tp",
      };
    }

    // Stop loss hit
    if (slPrice > 0 && candle.low <= slPrice) {
      const sellValue = totalQty * slPrice;
      const sellFee = sellValue * cfg.feeRate;
      const profit = sellValue - sellFee - totalCost;
      return {
        entryPrice,
        avgPrice,
        totalQuantity: totalQty,
        totalInvested: totalCost,
        safetyOrdersTriggered: soTriggered,
        startIndex: startIdx,
        endIndex: i,
        profit,
        profitPercent: (profit / totalCost) * 100,
        result: "sl",
      };
    }

    // Limit deal duration to avoid endless open deals (max 500 candles)
    if (i - startIdx > 500) {
      const sellValue = totalQty * candle.close;
      const sellFee = sellValue * cfg.feeRate;
      const profit = sellValue - sellFee - totalCost;
      return {
        entryPrice,
        avgPrice,
        totalQuantity: totalQty,
        totalInvested: totalCost,
        safetyOrdersTriggered: soTriggered,
        startIndex: startIdx,
        endIndex: i,
        profit,
        profitPercent: (profit / totalCost) * 100,
        result: "open",
      };
    }
  }

  // Deal still open at end of data
  const lastCandle = candles[candles.length - 1];
  const sellValue = totalQty * lastCandle.close;
  const sellFee = sellValue * cfg.feeRate;
  const profit = sellValue - sellFee - totalCost;
  return {
    entryPrice,
    avgPrice,
    totalQuantity: totalQty,
    totalInvested: totalCost,
    safetyOrdersTriggered: soTriggered,
    startIndex: startIdx,
    endIndex: candles.length - 1,
    profit,
    profitPercent: (profit / totalCost) * 100,
    result: "open",
  };
}

/**
 * Calculate price volatility as standard deviation of log returns.
 */
function calculateVolatility(candles: CandleData[]): number {
  if (candles.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) {
      returns.push(Math.log(candles[i].close / candles[i - 1].close));
    }
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

/**
 * Mean reversion score: how well price reverts to mean after dipping.
 * Higher score = better for DCA (price tends to bounce back).
 */
function calculateMeanReversionScore(candles: CandleData[]): number {
  if (candles.length < 20) return 0.5;

  const closes = candles.map((c) => c.close);
  let reversionCount = 0;
  let dipCount = 0;

  // Use 20-period SMA as the mean
  for (let i = 20; i < closes.length - 5; i++) {
    const sma = closes.slice(i - 20, i).reduce((s, v) => s + v, 0) / 20;
    const deviation = (closes[i] - sma) / sma;

    // Price is below SMA by at least 2%
    if (deviation < -0.02) {
      dipCount++;
      // Check if price reverts within next 5 candles
      for (let j = 1; j <= 5 && i + j < closes.length; j++) {
        if (closes[i + j] > sma * 0.99) {
          reversionCount++;
          break;
        }
      }
    }
  }

  return dipCount > 0 ? reversionCount / dipCount : 0.5;
}

/**
 * Calculate maximum drawdown from peak.
 */
function calculateMaxDrawdown(candles: CandleData[]): number {
  if (candles.length < 2) return 0;
  let peak = candles[0].close;
  let maxDrawdown = 0;

  for (const candle of candles) {
    if (candle.close > peak) peak = candle.close;
    const drawdown = ((peak - candle.close) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

function emptyResult(symbol: string): ProfitabilityResult {
  return {
    symbol,
    completedDeals: 0,
    stoppedDeals: 0,
    totalProfit: 0,
    totalProfitPercent: 0,
    avgProfitPerDeal: 0,
    avgDealDuration: 0,
    maxDrawdownPercent: 0,
    winRate: 0,
    profitFactor: 0,
    profitabilityScore: 0,
    avgSafetyOrdersTriggered: 0,
    totalInvested: 0,
    volatility: 0,
    meanReversionScore: 0,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Rank multiple pairs by their profitability scores.
 * Pass results from analyzeProfitability for each pair.
 */
export function rankByProfitability(
  results: ProfitabilityResult[],
  minCompletedDeals: number = 3,
  minWinRate: number = 0.5,
): ProfitabilityResult[] {
  return results
    .filter((r) => r.completedDeals >= minCompletedDeals && r.winRate >= minWinRate)
    .sort((a, b) => b.profitabilityScore - a.profitabilityScore);
}
