import { describe, expect, it } from "vitest";
import { formatRulerTime, rulerStep, rulerTicks } from "../../src/timeline/ruler";

describe("régua da timeline", () => {
  it("formata mm:ss:ff e inclui horas só quando pedido", () => {
    expect(formatRulerTime(2, 10)).toBe("00:02:00");
    expect(formatRulerTime(62.5, 24)).toBe("01:02:12");
    expect(formatRulerTime(3725, 30, true)).toBe("01:02:05:00");
  });

  it("o passo cresce quando o zoom diminui e chega a frames quando o zoom é grande", () => {
    expect(rulerStep(30, 10)).toBe(10);
    expect(rulerStep(30, 90)).toBe(1);
    expect(rulerStep(30, 2000)).toBeCloseTo(1 / 30 * 2, 6);
    expect(rulerStep(24, 1e9)).toBeCloseTo(1 / 24, 6);
  });

  it("gera marcas espaçadas ao menos pelo mínimo de pixels", () => {
    const ticks = rulerTicks(60, 30, 1000);
    const pixelsPerSecond = 1000 / 60;
    const spacing = (ticks[1].time - ticks[0].time) * pixelsPerSecond;
    expect(spacing).toBeGreaterThanOrEqual(84);
    expect(ticks[0]).toEqual({ time: 0, label: "00:00:00" });
    expect(ticks.length).toBeLessThanOrEqual(1500);
  });
});
