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

/**
 * Multi-pair DCA strategy that manages DCA entries across multiple pairs
 * from a single bot configuration. Each pair has its own quantity and
 * safety order settings.
 */
export function* multiPairDca(ctx: TBotContext<MultiPairDCABotConfig>) {
  const { config, onStart, onStop } = ctx;
  const { settings } = config;

  if (onStop) {
    for (let i = 0; i < settings.pairs.length; i++) {
      yield cancelSmartTrade(`pair-${i}`);
    }
    logger.info(`[MultiPairDCA] Bot stopped, all ${settings.pairs.length} pairs cancelled`);
    return;
  }

  if (onStart) {
    logger.info(
      `[MultiPairDCA] Bot started with ${settings.pairs.length} pairs: ${settings.pairs.map((p) => p.symbol).join(", ")}`,
    );
    return;
  }

  for (const [index, pairConfig] of settings.pairs.entries()) {
    const options = {
      symbol: pairConfig.symbol,
      quantity: pairConfig.quantity,
      tpPercent: pairConfig.tpPercent / 100,
      slPercent: pairConfig.slPercent ? pairConfig.slPercent / 100 : undefined,
      safetyOrders: (pairConfig.safetyOrders ?? settings.defaultSafetyOrders).map((so) => ({
        relativePrice: -so.priceDeviation / 100,
        quantity: so.quantity,
      })),
    };

    const trade: SmartTradeService = yield useDca(options, `pair-${index}`);
    if (trade.isCompleted()) {
      yield trade.replace();
      logger.info(`[MultiPairDCA] Trade replaced for ${pairConfig.symbol}`);
    }

    logger.info(`[MultiPairDCA] Entry for ${pairConfig.symbol}: qty=${pairConfig.quantity} tp=${pairConfig.tpPercent}%`);
  }
}

const SafetyOrderSchema = z.object({
  quantity: z.number().positive().describe("Quantity for this safety order"),
  priceDeviation: z.number().positive().describe("Price deviation from entry in %"),
});

multiPairDca.displayName = "Multi-Pair DCA Bot";
multiPairDca.description =
  "Manage DCA strategies across multiple trading pairs from a single bot. " +
  "Each pair can have its own quantity, take profit, and stop loss settings, " +
  "while sharing default safety order configurations. Perfect for portfolio-wide DCA accumulation.";

multiPairDca.schema = z.object({
  pairs: z.array(
    z.object({
      symbol: z.string().describe("Trading pair, e.g. BTC/USDT"),
      quantity: z.number().positive().describe("Entry quantity in base currency"),
      tpPercent: z.number().positive().default(3).describe("Take Profit in %"),
      slPercent: z.number().positive().optional().describe("Stop Loss in %"),
      safetyOrders: z.array(SafetyOrderSchema).optional().describe("Per-pair safety orders (overrides defaults)"),
    }),
  ).min(1).describe("List of pairs to DCA"),
  defaultSafetyOrders: z.array(SafetyOrderSchema).default([
    { quantity: 0.001, priceDeviation: 2 },
    { quantity: 0.002, priceDeviation: 4 },
    { quantity: 0.004, priceDeviation: 8 },
  ]).describe("Default safety orders used when pair has no custom ones"),
});

multiPairDca.runPolicy = {
  onOrderFilled: true,
  onCandleClosed: true,
} satisfies Template["runPolicy"];

multiPairDca.timeframe = BarSize.ONE_MINUTE;

multiPairDca.watchers = {
  watchCandles: ({ symbol }: IBotConfiguration) => symbol,
};

type Template = BotTemplate<MultiPairDCABotConfig>;

export type MultiPairDCABotConfig = IBotConfiguration<z.infer<typeof multiPairDca.schema>>;
