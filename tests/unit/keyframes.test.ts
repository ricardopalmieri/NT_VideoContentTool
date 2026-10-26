import { describe, expect, it } from "vitest";
import { keyframeAt, toggleKeyframe, upsertKeyframe } from "../../src/model/keyframes";
import type { Keyframe } from "../../src/model/types";

const initial: Keyframe[] = [
  { time: 0, value: 10, easing: "linear" },
  { time: 1, value: 20, easing: "hold" },
];

describe("keyframe domain operations", () => {
  it("finds a keyframe within the supplied frame tolerance", () => {
    expect(keyframeAt(initial, 1.04, .05)).toBe(initial[1]);
    expect(keyframeAt(initial, 1.06, .05)).toBeUndefined();
  });

  it("updates a nearby key without changing its time or easing", () => {
    const result = upsertKeyframe(initial, 1.02, 30, .05, "easeInOut");

    expect(result.created).toBe(false);
    expect(result.keyframes).toEqual([
      initial[0],
      { time: 1, value: 30, easing: "hold" },
    ]);
    expect(initial[1].value).toBe(20);
  });

  it("inserts new keys in chronological order", () => {
    const result = upsertKeyframe(initial, .5, 15, .01, "easeInOut");

    expect(result.created).toBe(true);
    expect(result.keyframes.map(({ time }) => time)).toEqual([0, .5, 1]);
    expect(initial).toHaveLength(2);
  });

  it("toggles a nearby key off and reports an added key", () => {
    const removed = toggleKeyframe(initial, 1.02, 0, .05, "easeInOut");
    const added = toggleKeyframe(initial, .5, 15, .01, "linear");

    expect(removed.action).toBe("removed");
    expect(removed.keyframes).toEqual([initial[0]]);
    expect(added.action).toBe("added");
    expect(added.keyframe).toEqual({ time: .5, value: 15, easing: "linear" });
    expect(initial).toHaveLength(2);
  });
});
