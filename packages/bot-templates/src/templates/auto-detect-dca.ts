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
  const { config, onStart, onStop, exchange, control } = ctx;
  const { settings } = config;

  if (onStop) {
    yield cancelSmartTrade();
    logger.info(`[AutoDetectDCA] Bot stopped`);
    return;
  }

  if (onStart) {
    logger.info(`[AutoDetectDCA] Bot started — scanning for profitable pairs...`);
    // Don't return — fall through to immediately scan on first start
  }

  // Step 1: Fetch all tickers and markets from the exchange
  // Use ccxt directly for fetchTickers (not on IExchange interface)
  let tickers: Record<string, unknown>;
  let markets: Record<string, unknown>;
  try {
    tickers = (yield exchange.ccxt.fetchTickers()) as Record<string, unknown>;
    markets = (yield exchange.loadMarkets()) as Record<string, unknown>;
  } catch (err) {
    logger.error(`[AutoDetectDCA] Failed to fetch market data: ${err}`);
    return;
  }

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
    logger.info(`[AutoDetectDCA] No suitable pairs found, waiting...`);
    return;
  }

  logger.info(`[AutoDetectDCA] Found ${candidates.length} candidate pairs, analyzing profitability...`);

  // Step 3: Analyze profitability of top candidates using historical candles
  const profitResults: ProfitabilityResult[] = [];

  for (const pair of candidates.slice(0, settings.analyzePairCount)) {
    try {
      const rawCandles = (yield exchange.getCandlesticks({
        symbol: pair.symbol,
        bar: settings.analysisTimeframe as BarSize,
        limit: settings.analysisCandles,
      })) as CandleData[];

      if (rawCandles.length < 50) continue;

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

  // Step 4: Rank by profitability and pick the best
  const ranked = rankByProfitability(profitResults, settings.minCompletedDeals, settings.minWinRate);

  if (ranked.length === 0) {
    logger.info(`[AutoDetectDCA] No profitable pairs found (min deals: ${settings.minCompletedDeals}, min win rate: ${settings.minWinRate})`);
    return;
  }

  const bestPair = ranked[0];
  logger.info(
    `[AutoDetectDCA] Best pair: ${bestPair.symbol} | score: ${bestPair.profitabilityScore} | winRate: ${(bestPair.winRate * 100).toFixed(0)}% | profit: ${bestPair.totalProfitPercent.toFixed(1)}% | reversion: ${bestPair.meanReversionScore.toFixed(2)}`,
  );

  // Update the bot's symbol in the database so the dashboard shows the detected pair
  yield control.updateBotSymbol(bestPair.symbol);
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
  minVolume24h: z.number().positive().default(500000).describe("Minimum 24h volume in quote currency"),
  maxSpreadPercent: z.number().positive().default(0.5).describe("Maximum spread in %"),
  candidateLimit: z.number().positive().default(50).describe("Max pairs to scan from market data"),
  analyzePairCount: z.number().positive().default(15).describe("How many top candidates to backtest"),
  analysisTimeframe: z.string().default("1h").describe("Candle timeframe for profitability analysis"),
  analysisCandles: z.number().positive().default(500).describe("Number of historical candles to analyze"),
  dcaAmount: z.number().positive().default(100).describe("DCA amount per entry in quote currency"),
  tpPercent: z.number().positive().default(3).describe("Take Profit in %"),
  slPercent: z.number().positive().optional().describe("Stop Loss in % (optional)"),
  feeRate: z.number().min(0).default(0.001).describe("Trading fee rate (e.g. 0.001 = 0.1%)"),
  minCompletedDeals: z.number().min(0).default(3).describe("Min completed deals to consider a pair profitable"),
  minWinRate: z.number().min(0).max(1).default(0.5).describe("Minimum win rate (0-1) to trade a pair"),
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
