import { describe, expect, it } from "vitest";
import { UndoHistory } from "../../src/model/undo-history";

describe("undo history", () => {
  it("does not create an undo step when a gesture changes nothing", () => {
    const history = new UndoHistory();
    history.checkpoint("unchanged");

    expect(history.undo("unchanged")).toBeNull();
    expect(history.canUndo("unchanged")).toBe(false);
  });

  it("commits real edits and supports undo and redo", () => {
    const history = new UndoHistory();
    history.checkpoint("before");

    expect(history.undo("after")).toBe("before");
    expect(history.redo("before")).toBe("after");
  });

  it("keeps redo after a no-op checkpoint", () => {
    const history = new UndoHistory();
    history.checkpoint("A");
    expect(history.undo("B")).toBe("A");

    history.checkpoint("A");
    expect(history.undo("A")).toBeNull();
    expect(history.redo("A")).toBe("B");
  });

  it("limits undo history to sixty committed edits", () => {
    const history = new UndoHistory();
    let current = "0";
    for (let index = 0; index < 61; index++) {
      history.checkpoint(current);
      current = String(index + 1);
      expect(history.canUndo(current)).toBe(true);
    }

    let undoCount = 0;
    while (history.undo(current) !== null) {
      undoCount++;
      current = String(61 - undoCount);
    }
    expect(undoCount).toBe(60);
  });
});

describe("undo step names", () => {
  it("keeps the label of each step across undo and redo", () => {
    const history = new UndoHistory();
    history.checkpoint("A", "Mover clipe");
    expect(history.undoLabel("B")).toBe("Mover clipe");
    expect(history.undo("B")).toBe("A");
    expect(history.redoLabel("A")).toBe("Mover clipe");
    expect(history.redo("A")).toBe("B");
    expect(history.undoLabel("B")).toBe("Mover clipe");
  });
});
