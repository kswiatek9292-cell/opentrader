import { z } from "zod";
import { logger } from "@opentrader/logger";
import { BarSize } from "@opentrader/types";
import {
  useDca,
  cancelSmartTrade,
  IBotConfiguration,
  TBotContext,
  BotTemplate,
  useIndicators,
  type SmartTradeService,
} from "@opentrader/bot-processor";

/**
 * Smart DCA strategy that adjusts position size based on RSI indicator.
 * Buys more aggressively when RSI indicates oversold conditions.
 * Reduces position size when RSI indicates overbought conditions.
 */
export function* smartDca(ctx: TBotContext<SmartDCABotConfig>) {
  const { config, onStart, onStop } = ctx;
  const { settings } = config;

  if (onStop) {
    yield cancelSmartTrade();
    logger.info(`[SmartDCA] Bot with ${config.symbol} pair stopped`);
    return;
  }

  if (onStart) {
    logger.info(`[SmartDCA] Bot strategy started on ${config.symbol} pair`);
    return;
  }

  // Get RSI value for smart sizing
  const indicators: { rsi: number[] } = yield useIndicators({
    rsi: { periods: settings.rsiPeriods },
  });

  const rsiValues = indicators.rsi;
  const currentRsi = rsiValues[rsiValues.length - 1];

  if (isNaN(currentRsi)) {
    logger.info(`[SmartDCA] RSI not yet available, waiting for more data`);
    return;
  }

  // Calculate dynamic quantity multiplier based on RSI
  const quantityMultiplier = calculateQuantityMultiplier(
    currentRsi,
    settings.rsiOversold,
    settings.rsiOverbought,
    settings.maxMultiplier,
  );

  // Skip entry if RSI is overbought and skipOverbought is enabled
  if (settings.skipOverbought && currentRsi > settings.rsiOverbought) {
    logger.info(`[SmartDCA] RSI ${currentRsi.toFixed(1)} > ${settings.rsiOverbought}, skipping entry (overbought)`);
    return;
  }

  const adjustedQuantity = settings.baseQuantity * quantityMultiplier;

  // Scale safety orders proportionally
  const adjustedSafetyOrders = settings.safetyOrders.map((so) => ({
    relativePrice: -so.priceDeviation / 100,
    quantity: so.quantity * quantityMultiplier,
  }));

  const options = {
    price: settings.entryPrice,
    quantity: adjustedQuantity,
    tpPercent: settings.tpPercent / 100,
    slPercent: settings.slPercent ? settings.slPercent / 100 : undefined,
    safetyOrders: adjustedSafetyOrders,
  };

  const trade: SmartTradeService = yield useDca(options);
  if (trade.isCompleted()) {
    yield trade.replace();
    logger.info(`[SmartDCA] Trade replaced`);
  }

  logger.info(
    `[SmartDCA] RSI: ${currentRsi.toFixed(1)} | Multiplier: ${quantityMultiplier.toFixed(2)}x | Quantity: ${adjustedQuantity.toFixed(6)} | TP: ${settings.tpPercent}%`,
  );
}

/**
 * Calculate quantity multiplier based on RSI:
 * - RSI <= oversold: maxMultiplier (buy aggressively)
 * - RSI >= overbought: 1.0 (minimum position)
 * - RSI between: linear interpolation
 */
function calculateQuantityMultiplier(
  rsi: number,
  oversold: number,
  overbought: number,
  maxMultiplier: number,
): number {
  if (rsi <= oversold) return maxMultiplier;
  if (rsi >= overbought) return 1.0;

  // Linear interpolation between oversold and overbought
  const range = overbought - oversold;
  const position = (rsi - oversold) / range;
  return maxMultiplier - position * (maxMultiplier - 1.0);
}

smartDca.displayName = "Smart DCA Bot";
smartDca.description =
  "Intelligent Dollar-Cost Averaging strategy that dynamically adjusts position sizes based on RSI indicator. " +
  "When the market is oversold (low RSI), the bot increases its buy quantity by a configurable multiplier. " +
  "When the market is overbought (high RSI), it uses the minimum position size or skips entry entirely. " +
  "This approach accumulates more tokens at lower prices, reducing overall cost basis compared to fixed DCA.";

smartDca.schema = z.object({
  baseQuantity: z.number().positive().describe("Base quantity in base currency per DCA entry"),
  entryPrice: z.number().optional().describe("Limit entry price (omit for market order)"),
  tpPercent: z.number().positive().default(3).describe("Take Profit from avg entry price in %"),
  slPercent: z.number().positive().optional().describe("Stop Loss drop from avg entry price in %"),
  rsiPeriods: z.number().positive().default(14).describe("RSI calculation period"),
  rsiOversold: z.number().min(0).max(100).default(30).describe("RSI oversold threshold — buy more below this"),
  rsiOverbought: z.number().min(0).max(100).default(70).describe("RSI overbought threshold — buy less above this"),
  maxMultiplier: z.number().min(1).max(10).default(3).describe("Max quantity multiplier when RSI is deeply oversold"),
  skipOverbought: z.boolean().default(false).describe("Skip entry entirely when RSI > overbought threshold"),
  safetyOrders: z.array(
    z.object({
      quantity: z.number().positive().describe("Base quantity for this safety order"),
      priceDeviation: z.number().positive().describe("Price deviation from entry in %"),
    }),
  ).default([]),
});

smartDca.runPolicy = {
  onOrderFilled: true,
  onCandleClosed: true,
} satisfies Template["runPolicy"];

smartDca.requiredHistory = 15;

smartDca.timeframe = BarSize.ONE_MINUTE;

smartDca.watchers = {
  watchCandles: ({ symbol }: IBotConfiguration) => symbol,
};

type Template = BotTemplate<SmartDCABotConfig>;

export type SmartDCABotConfig = IBotConfiguration<z.infer<typeof smartDca.schema>>;
