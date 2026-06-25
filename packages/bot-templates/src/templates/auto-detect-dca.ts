import { z } from "zod";
import { logger } from "@opentrader/logger";
import { BarSize } from "@opentrader/types";
import {
  useDca,
  cancelSmartTrade,
  IBotConfiguration,
  TBotContext,
  BotTemplate,
  type SmartTradeService,
} from "@opentrader/bot-processor";
import { detectPairs, analyzeProfitability, rankByProfitability } from "@opentrader/tools";
import type { CandleData, ProfitabilityResult } from "@opentrader/tools";

/**
 * Auto-Detect Profitable Pairs DCA Bot.
 *
 * Automatically scans the exchange for profitable DCA pairs using:
 * 1. Market data filtering (volume, spread, liquidity)
 * 2. Historical candle analysis to simulate DCA profitability
 * 3. Mean reversion scoring — picks pairs that bounce after dips
 *
 * The bot periodically re-scans and switches to the most profitable pair.
 */
export function* autoDetectDca(ctx: TBotContext<AutoDetectDCABotConfig>) {
  const { config, onStart, onStop, exchange, control, state } = ctx;
  const { settings } = config;

  if (onStop) {
    yield cancelSmartTrade();
    logger.info(`[AutoDetectDCA] Bot stopped`);
    return;
  }

  if (onStart) {
    logger.info(`[AutoDetectDCA] Bot started — scanning for profitable pairs...`);
    state.scanStatus = "scanning";
    state.lastScanAt = new Date().toISOString();
  }

  // Step 1: Fetch all tickers and markets from the exchange
  let tickers: Record<string, unknown>;
  let markets: Record<string, unknown>;
  try {
    tickers = (yield exchange.ccxt.fetchTickers()) as Record<string, unknown>;
    markets = (yield exchange.loadMarkets()) as Record<string, unknown>;
  } catch (err) {
    const errorMsg = `Failed to fetch market data: ${err}`;
    logger.error(`[AutoDetectDCA] ${errorMsg}`);
    state.scanStatus = "error";
    state.scanError = errorMsg;
    return;
  }

  const tickerCount = Object.keys(tickers).length;
  const marketCount = Object.keys(markets).length;
  logger.info(`[AutoDetectDCA] Fetched ${tickerCount} tickers and ${marketCount} markets`);

  // Step 2: Filter pairs by market metrics
  const candidates = detectPairs(
    tickers as Parameters<typeof detectPairs>[0],
    markets as Parameters<typeof detectPairs>[1],
    {
      quoteCurrency: settings.quoteCurrency,
      minVolume24h: settings.minVolume24h,
      maxSpreadPercent: settings.maxSpreadPercent,
      limit: settings.candidateLimit,
      sortBy: "score",
    },
  );

  if (candidates.length === 0) {
    logger.info(`[AutoDetectDCA] No suitable pairs found after filtering (quote=${settings.quoteCurrency}, minVol=${settings.minVolume24h}, maxSpread=${settings.maxSpreadPercent}%)`);
    state.scanStatus = "no_candidates";
    state.scanResult = `No pairs matched filters (${tickerCount} tickers checked)`;
    return;
  }

  logger.info(`[AutoDetectDCA] Found ${candidates.length} candidate pairs, analyzing top ${Math.min(candidates.length, settings.analyzePairCount)}...`);
  state.candidatesFound = candidates.length;
  state.topCandidates = candidates.slice(0, 5).map((c) => c.symbol);

  // Step 3: Analyze profitability of top candidates using historical candles
  const profitResults: ProfitabilityResult[] = [];

  for (const pair of candidates.slice(0, settings.analyzePairCount)) {
    try {
      const rawCandles = (yield exchange.getCandlesticks({
        symbol: pair.symbol,
        bar: settings.analysisTimeframe as BarSize,
        limit: settings.analysisCandles,
      })) as CandleData[];

      if (rawCandles.length < 10) {
        logger.info(`[AutoDetectDCA] ${pair.symbol}: skipped (only ${rawCandles.length} candles)`);
        continue;
      }

      const result = analyzeProfitability(pair.symbol, rawCandles, {
        dcaAmountPerEntry: settings.dcaAmount,
        tpPercent: settings.tpPercent,
        slPercent: settings.slPercent,
        feeRate: settings.feeRate,
        safetyOrderCount: settings.safetyOrders.length,
        safetyOrderDeviation: settings.safetyOrders[0]?.priceDeviation ?? 2,
        safetyOrderVolumeScale: 2,
        safetyOrderStepScale: 1.5,
      });

      profitResults.push(result);

      logger.info(
        `[AutoDetectDCA] ${pair.symbol}: score=${result.profitabilityScore} winRate=${(result.winRate * 100).toFixed(0)}% deals=${result.completedDeals} profit=${result.totalProfitPercent.toFixed(1)}%`,
      );
    } catch (err) {
      logger.warn(`[AutoDetectDCA] Failed to analyze ${pair.symbol}: ${err}`);
    }
  }

  if (profitResults.length === 0) {
    logger.info(`[AutoDetectDCA] No profitability data available, using best candidate by score`);
    // Fallback: use the best candidate by market score
    const fallbackPair = candidates[0];
    yield control.updateBotSymbol(fallbackPair.symbol);
    state.scanStatus = "fallback";
    state.detectedPair = fallbackPair.symbol;
    state.scanResult = `Used fallback pair ${fallbackPair.symbol} (no profitability data)`;
    state.lastScanAt = new Date().toISOString();
    logger.info(`[AutoDetectDCA] Fallback pair selected: ${fallbackPair.symbol}`);

    const entryQuantity = settings.dcaAmount / fallbackPair.lastPrice;
    const options = {
      symbol: fallbackPair.symbol,
      quantity: entryQuantity,
      tpPercent: settings.tpPercent / 100,
      slPercent: settings.slPercent ? settings.slPercent / 100 : undefined,
      safetyOrders: settings.safetyOrders.map((so) => ({
        relativePrice: -so.priceDeviation / 100,
        quantity: so.quantity,
      })),
    };

    const trade: SmartTradeService = yield useDca(options);
    if (trade.isCompleted()) {
      yield trade.replace();
    }
    return;
  }

  // Step 4: Rank by profitability and pick the best
  let ranked = rankByProfitability(profitResults, settings.minCompletedDeals, settings.minWinRate);

  // Fallback: relax filters if no pairs pass strict criteria
  if (ranked.length === 0) {
    logger.info(`[AutoDetectDCA] No pairs passed strict filters, relaxing to minDeals=1, minWinRate=0.2`);
    ranked = rankByProfitability(profitResults, 1, 0.2);
  }

  // Second fallback: just use the best scoring pair regardless of filters
  if (ranked.length === 0 && profitResults.length > 0) {
    logger.info(`[AutoDetectDCA] Still no qualifying pairs, using best available by profitability score`);
    ranked = [...profitResults].sort((a, b) => b.profitabilityScore - a.profitabilityScore);
  }

  if (ranked.length === 0) {
    logger.info(`[AutoDetectDCA] No profitable pairs found at all`);
    state.scanStatus = "no_profitable_pairs";
    state.scanResult = `Analyzed ${profitResults.length} pairs, none qualified`;
    return;
  }

  const bestPair = ranked[0];
  logger.info(
    `[AutoDetectDCA] Best pair: ${bestPair.symbol} | score: ${bestPair.profitabilityScore} | winRate: ${(bestPair.winRate * 100).toFixed(0)}% | profit: ${bestPair.totalProfitPercent.toFixed(1)}% | reversion: ${bestPair.meanReversionScore.toFixed(2)}`,
  );

  // Update the bot's symbol in the database so the dashboard shows the detected pair
  yield control.updateBotSymbol(bestPair.symbol);
  state.scanStatus = "detected";
  state.detectedPair = bestPair.symbol;
  state.scanResult = `${bestPair.symbol} | score=${bestPair.profitabilityScore} winRate=${(bestPair.winRate * 100).toFixed(0)}% profit=${bestPair.totalProfitPercent.toFixed(1)}%`;
  state.lastScanAt = new Date().toISOString();
  state.analyzedPairs = profitResults.length;
  logger.info(`[AutoDetectDCA] Bot symbol updated to ${bestPair.symbol}`);

  // Step 5: Execute DCA on the best pair
  const lastPrice = candidates.find((c) => c.symbol === bestPair.symbol)?.lastPrice ?? 1;
  const entryQuantity = settings.dcaAmount / lastPrice;

  const options = {
    symbol: bestPair.symbol,
    quantity: entryQuantity,
    tpPercent: settings.tpPercent / 100,
    slPercent: settings.slPercent ? settings.slPercent / 100 : undefined,
    safetyOrders: settings.safetyOrders.map((so) => ({
      relativePrice: -so.priceDeviation / 100,
      quantity: so.quantity,
    })),
  };

  const trade: SmartTradeService = yield useDca(options);
  if (trade.isCompleted()) {
    yield trade.replace();
    logger.info(`[AutoDetectDCA] Trade replaced on ${bestPair.symbol}`);
  }
}

autoDetectDca.displayName = "Auto-Detect Profitable DCA";
autoDetectDca.description =
  "Automatically scans the exchange for the most profitable pairs for DCA trading. " +
  "Uses real market data (volume, spread, volatility) combined with historical candle backtesting " +
  "to find pairs with the highest win rate and mean reversion score. " +
  "The bot re-scans periodically and trades the best pair automatically. " +
  "Profitability is measured by simulating DCA deals on historical data including fees and safety orders.";

autoDetectDca.schema = z.object({
  quoteCurrency: z.string().default("USDT").describe("Quote currency to filter pairs (e.g. USDT, BTC)"),
  minVolume24h: z.number().positive().default(100000).describe("Minimum 24h volume in quote currency"),
  maxSpreadPercent: z.number().positive().default(1).describe("Maximum spread in %"),
  candidateLimit: z.number().positive().default(50).describe("Max pairs to scan from market data"),
  analyzePairCount: z.number().positive().default(15).describe("How many top candidates to backtest"),
  analysisTimeframe: z.string().default("1h").describe("Candle timeframe for profitability analysis"),
  analysisCandles: z.number().positive().default(500).describe("Number of historical candles to analyze"),
  dcaAmount: z.number().positive().default(100).describe("DCA amount per entry in quote currency"),
  tpPercent: z.number().positive().default(3).describe("Take Profit in %"),
  slPercent: z.number().positive().optional().describe("Stop Loss in % (optional)"),
  feeRate: z.number().min(0).default(0.001).describe("Trading fee rate (e.g. 0.001 = 0.1%)"),
  minCompletedDeals: z.number().min(0).default(1).describe("Min completed deals to consider a pair profitable"),
  minWinRate: z.number().min(0).max(1).default(0.3).describe("Minimum win rate (0-1) to trade a pair"),
  safetyOrders: z.array(
    z.object({
      quantity: z.number().positive().describe("Safety order quantity"),
      priceDeviation: z.number().positive().describe("Price deviation from entry in %"),
    }),
  ).default([
    { quantity: 0.001, priceDeviation: 2 },
    { quantity: 0.002, priceDeviation: 4 },
    { quantity: 0.004, priceDeviation: 8 },
  ]).describe("Safety orders configuration"),
});

autoDetectDca.runPolicy = {
  onOrderFilled: true,
  onCandleClosed: true,
} satisfies Template["runPolicy"];

autoDetectDca.timeframe = BarSize.ONE_HOUR;

autoDetectDca.watchers = {
  watchCandles: ({ symbol, settings }: IBotConfiguration) => {
    if (symbol === "SCANNING") {
      const quote = (settings as { quoteCurrency?: string }).quoteCurrency || "USDT";
      return `BTC/${quote}`;
    }
    return symbol;
  },
};

type Template = BotTemplate<AutoDetectDCABotConfig>;

export type AutoDetectDCABotConfig = IBotConfiguration<z.infer<typeof autoDetectDca.schema>>;
