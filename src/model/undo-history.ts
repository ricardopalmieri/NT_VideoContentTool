interface Entry {
  state: string;
  label: string;
}

export class UndoHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private pending: Entry | null = null;

  /** Records the state before an edit; it becomes an undo step only if the state then changes. */
  checkpoint(current: string, label = "") {
    this.commitPending(current);
    this.pending = { state: current, label };
  }

  undo(current: string) {
    this.commitPending(current);
    this.pending = null;
    const previous = this.undoStack.pop();
    if (previous === undefined) return null;
    this.redoStack.push({ state: current, label: previous.label });
    return previous.state;
  }

  redo(current: string) {
    this.commitPending(current);
    this.pending = null;
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push({ state: current, label: next.label });
    return next.state;
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  }

  canUndo(current: string) {
    this.commitPending(current);
    return this.undoStack.length > 0;
  }

  canRedo(current: string) {
    this.commitPending(current);
    return this.redoStack.length > 0;
  }

  /** Name of the step the next undo reverts ("" when unnamed or empty). */
  undoLabel(current: string) {
    this.commitPending(current);
    return this.undoStack.at(-1)?.label ?? "";
  }

  redoLabel(current: string) {
    this.commitPending(current);
    return this.redoStack.at(-1)?.label ?? "";
  }

  private commitPending(current: string) {
    if (this.pending === null) return;
    if (this.pending.state !== current) {
      this.undoStack.push(this.pending);
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
    }
    this.pending = null;
  }
}
