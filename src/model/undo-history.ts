export class UndoHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private pendingSnapshot: string | null = null;

  checkpoint(current: string) {
    this.commitPending(current);
    this.pendingSnapshot = current;
  }

  undo(current: string) {
    this.commitPending(current);
    this.pendingSnapshot = null;
    const previous = this.undoStack.pop();
    if (previous === undefined) return null;
    this.redoStack.push(current);
    return previous;
  }

  redo(current: string) {
    this.commitPending(current);
    this.pendingSnapshot = null;
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(current);
    return next;
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingSnapshot = null;
  }

  canUndo(current: string) {
    this.commitPending(current);
    return this.undoStack.length > 0;
  }

  canRedo(current: string) {
    this.commitPending(current);
    return this.redoStack.length > 0;
  }

  private commitPending(current: string) {
    if (this.pendingSnapshot === null) return;
    if (this.pendingSnapshot !== current) {
      this.undoStack.push(this.pendingSnapshot);
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
    }
    this.pendingSnapshot = null;
  }
}
