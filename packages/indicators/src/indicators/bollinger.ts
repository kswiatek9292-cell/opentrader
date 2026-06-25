import type { ICandlestick } from "@opentrader/types";
import { BollingerBands } from "technicalindicators";
import { IndicatorError } from "../utils/indicator.error.js";

type BollingerParams = {
  periods: number;
  stdDev: number;
};

export type BollingerResult = {
  upper: number[];
  middle: number[];
  lower: number[];
};

/**
 * Calculate Bollinger Bands for a given set of candles.
 *
 * @param params - Bollinger Bands parameters
 * @param candles - The candles to calculate the Bollinger Bands for
 * @returns The upper, middle, and lower band values.
 */
export async function bollinger(
  params: BollingerParams,
  candles: ICandlestick[],
): Promise<BollingerResult> {
  const prices = candles.map((candle) => candle.close);

  if (params.periods < 2) {
    throw new IndicatorError("Bollinger Bands requires at least 2 periods", "BollingerBands");
  }

  if (params.stdDev <= 0) {
    throw new IndicatorError("Bollinger Bands stdDev must be positive", "BollingerBands");
  }

  if (candles.length < 1) {
    throw new IndicatorError("No candles provided for Bollinger Bands", "BollingerBands");
  }

  const result = BollingerBands.calculate({
    period: params.periods,
    stdDev: params.stdDev,
    values: prices,
  });

  const padLength = candles.length - result.length;
  const pad = new Array<number>(padLength).fill(NaN);

  return {
    upper: [...pad, ...result.map((r) => r.upper)],
    middle: [...pad, ...result.map((r) => r.middle)],
    lower: [...pad, ...result.map((r) => r.lower)],
  };
}
