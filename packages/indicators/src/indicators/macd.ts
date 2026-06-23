import type { ICandlestick } from "@opentrader/types";
import { MACD } from "technicalindicators";
import { IndicatorError } from "../utils/indicator.error.js";

type MacdParams = {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
};

export type MacdResult = {
  macd: number[];
  signal: number[];
  histogram: number[];
};

/**
 * Calculate the Moving Average Convergence Divergence (MACD).
 *
 * @param params - MACD parameters
 * @param candles - The candles to calculate the MACD for
 * @returns The MACD, signal, and histogram values.
 */
export async function macd(
  params: MacdParams,
  candles: ICandlestick[],
): Promise<MacdResult> {
  const prices = candles.map((candle) => candle.close);

  if (params.fastPeriod < 2 || params.slowPeriod < 2 || params.signalPeriod < 2) {
    throw new IndicatorError("MACD requires at least 2 periods for all parameters", "MACD");
  }

  if (params.fastPeriod >= params.slowPeriod) {
    throw new IndicatorError("MACD fast period must be less than slow period", "MACD");
  }

  if (candles.length < 1) {
    throw new IndicatorError("No candles provided for MACD", "MACD");
  }

  const result = MACD.calculate({
    fastPeriod: params.fastPeriod,
    slowPeriod: params.slowPeriod,
    signalPeriod: params.signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
    values: prices,
  });

  const padLength = candles.length - result.length;
  const pad = new Array<number>(padLength).fill(NaN);

  return {
    macd: [...pad, ...result.map((r) => r.MACD ?? NaN)],
    signal: [...pad, ...result.map((r) => r.signal ?? NaN)],
    histogram: [...pad, ...result.map((r) => r.histogram ?? NaN)],
  };
}
