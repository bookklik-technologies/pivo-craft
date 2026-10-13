// Original bounded snapshot history for PiVo Craft core.
// Snapshot strategy: bounded by estimated byte cost (default 128 MiB per spec 10.2).
// Each entry: {label, project snapshot}. Oldest complete transactions evicted; never half of one.
import type { Project } from './types.ts';
import { cloneProject, projectBytes, validateProject } from './document.ts';

export interface HistoryEntry {
  label: string;
  project: Project;
  bytes: number;
}

export class History {
  private origin: Project;
  private entries: HistoryEntry[] = []; // stack of undo states (states BEFORE the change they label? see below)
  private redoStack: HistoryEntry[] = [];
  private current: Project;
  private maxBytes: number;
  private totalBytes = 0;
  private branches: Map<string, HistoryEntry[]> = new Map();
  private activeBranch = 'main';

  constructor(p: Project, maxBytes = 134217728, private validate: (p: Project) => void = validateProject) {
    this.origin = cloneProject(p, {preserveImageIds:true}); // private snapshot: cancel() never aliases the caller's live object
    this.current = p;
    this.maxBytes = maxBytes;
  }

  get project(): Project {
    return this.current;
  }

  get canUndo(): boolean {
    return this.entries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Execute fn as one atomic, undoable command. The label names the entry.
   * fn mutates the live project in place. If fn throws, the live project is
   * rolled back to the pre-state and the transaction is discarded — a failed
   * command leaves neither state nor history entry behind (atomicity).
   */
  execute(label: string, fn: (p: Project) => void): void {
    const before = cloneProject(this.current, {preserveImageIds:true});
    try {
      fn(this.current);
      this.validate(this.current);
    } catch (err) {
      // Roll the live project back to the pre-state; no entry is pushed.
      this.current = before;
      throw err;
    }
    this.current.revision++;
    const bytes = projectBytes(this.current) + projectBytes(before);
    this.entries.push({ label, project: before, bytes });
    this.totalBytes -= this.redoStack.reduce((total, entry) => total + entry.bytes, 0);
    this.totalBytes += bytes;
    this.redoStack = []; // linear history: new edit clears redo
    this.evictIfNeeded();
    if (this.activeBranch !== 'main') {
      const b = this.branches.get(this.activeBranch);
      if (b) b.push({ label, project: cloneProject(this.current, {preserveImageIds:true}), bytes });
    }
  }

  /**
   * Cancel the pending un-committed change by restoring the last snapshot
   * (pointer-cancel path). With no entries, restores the constructor-time
   * origin. The restored state is a fresh deep copy: undo entries and live
   * state never share object identity after a cancel.
   */
  cancel(): void {
    if (this.entries.length > 0) {
      this.current = cloneProject(this.entries[this.entries.length - 1]!.project, {preserveImageIds:true});
    } else {
      this.current = cloneProject(this.origin, {preserveImageIds:true});
    }
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const entry = this.entries.pop()!;
    // capture current as redo state
    this.redoStack.push({ label: entry.label, project: cloneProject(this.current, {preserveImageIds:true}), bytes: entry.bytes });
    this.current = entry.project;
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const entry = this.redoStack.pop()!;
    this.entries.push({ label: entry.label, project: cloneProject(this.current, {preserveImageIds:true}), bytes: entry.bytes });
    this.current = entry.project;
    return true;
  }

  /**
   * Evict oldest entries beyond the byte budget. Guaranteed to make progress:
   * entries are only removed while the undo stack holds more than one entry,
   * so at least one undo step always survives.
   */
  private evictIfNeeded(): void {
    while (this.totalBytes > this.maxBytes && this.entries.length > 1) {
      const removed = this.entries.shift()!;
      this.totalBytes -= removed.bytes;
    }
  }

  get retainedBytes(): number { return this.totalBytes; }

  // -------------------------------------------------------------------------
  // Branching history (optional M7 surface)
  // -------------------------------------------------------------------------

  /** Fork the current state into a named branch; main stays untouched. */
  createBranch(name: string): void {
    this.branches.set(name, [{ label: 'branch point', project: cloneProject(this.current, {preserveImageIds:true}), bytes: 0 }]);
    this.activeBranch = name;
  }

  listBranches(): string[] {
    return ['main', ...this.branches.keys()];
  }

  /** Switch to a branch, restoring its tip state. */
  checkout(name: string): void {
    if (name === 'main') {
      this.activeBranch = 'main';
      if (this.entries.length > 0) this.current = this.entries[this.entries.length - 1]!.project;
      return;
    }
    const b = this.branches.get(name);
    if (!b || b.length === 0) throw new Error(`Unknown branch: ${name}`);
    this.activeBranch = name;
    this.current = b[b.length - 1]!.project;
  }
}
