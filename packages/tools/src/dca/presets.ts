/**
 * Pre-configured DCA strategy presets for common use cases.
 * Each preset provides sensible defaults that can be customized.
 */

export interface DCAPreset {
  name: string;
  description: string;
  settings: {
    quantity: number;
    tpPercent: number;
    slPercent?: number;
    safetyOrders: Array<{
      quantity: number;
      priceDeviation: number;
    }>;
  };
}

/**
 * Conservative DCA: Small positions, wide safety orders, tight TP.
 * Best for: Low-risk accumulation of blue-chip assets (BTC, ETH).
 */
export const CONSERVATIVE_DCA: DCAPreset = {
  name: "Conservative DCA",
  description: "Low-risk accumulation with small positions and wide safety orders. Best for BTC/ETH.",
  settings: {
    quantity: 0.001,
    tpPercent: 1.5,
    safetyOrders: [
      { quantity: 0.001, priceDeviation: 2 },
      { quantity: 0.002, priceDeviation: 5 },
      { quantity: 0.003, priceDeviation: 10 },
    ],
  },
};

/**
 * Aggressive DCA: Larger positions, tighter safety orders, wider TP.
 * Best for: Higher volatility assets in trending markets.
 */
export const AGGRESSIVE_DCA: DCAPreset = {
  name: "Aggressive DCA",
  description: "Larger positions with tight safety orders for high-volatility assets. Higher risk/reward.",
  settings: {
    quantity: 0.005,
    tpPercent: 5,
    slPercent: 15,
    safetyOrders: [
      { quantity: 0.005, priceDeviation: 1 },
      { quantity: 0.01, priceDeviation: 2.5 },
      { quantity: 0.02, priceDeviation: 5 },
      { quantity: 0.04, priceDeviation: 8 },
      { quantity: 0.08, priceDeviation: 12 },
    ],
  },
};

/**
 * Weekly BTC Accumulation: Simple DCA without safety orders.
 * Best for: Long-term BTC holders who want to accumulate over time.
 */
export const WEEKLY_BTC_ACCUMULATION: DCAPreset = {
  name: "Weekly BTC Accumulation",
  description: "Simple recurring buy without safety orders. Set it and forget it for long-term holding.",
  settings: {
    quantity: 0.0005,
    tpPercent: 10,
    safetyOrders: [],
  },
};

/**
 * Dip Buyer: Large safety orders with aggressive scaling.
 * Best for: Catching major dips with Martingale-style scaling.
 */
export const DIP_BUYER: DCAPreset = {
  name: "Dip Buyer",
  description: "Catches major dips with scaling safety orders. Martingale-style position building.",
  settings: {
    quantity: 0.002,
    tpPercent: 3,
    slPercent: 25,
    safetyOrders: [
      { quantity: 0.002, priceDeviation: 3 },
      { quantity: 0.004, priceDeviation: 6 },
      { quantity: 0.008, priceDeviation: 10 },
      { quantity: 0.016, priceDeviation: 15 },
      { quantity: 0.032, priceDeviation: 20 },
    ],
  },
};

/**
 * Scalper DCA: Quick in-and-out with tight parameters.
 * Best for: High-frequency DCA on liquid pairs.
 */
export const SCALPER_DCA: DCAPreset = {
  name: "Scalper DCA",
  description: "Quick scalping DCA with tight TP and close safety orders. For liquid pairs only.",
  settings: {
    quantity: 0.01,
    tpPercent: 0.8,
    slPercent: 5,
    safetyOrders: [
      { quantity: 0.01, priceDeviation: 0.5 },
      { quantity: 0.02, priceDeviation: 1 },
      { quantity: 0.04, priceDeviation: 2 },
    ],
  },
};

/**
 * All available presets.
 */
export const DCA_PRESETS: Record<string, DCAPreset> = {
  conservative: CONSERVATIVE_DCA,
  aggressive: AGGRESSIVE_DCA,
  weekly_btc: WEEKLY_BTC_ACCUMULATION,
  dip_buyer: DIP_BUYER,
  scalper: SCALPER_DCA,
};

/**
 * Get a preset by name.
 */
export function getDCAPreset(name: string): DCAPreset | undefined {
  return DCA_PRESETS[name];
}

/**
 * List all available preset names.
 */
export function listDCAPresets(): string[] {
  return Object.keys(DCA_PRESETS);
}
