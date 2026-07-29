import type { EditorCommand, HistoryOperationRecord } from '../types';

export interface ValuePatch {
  path: Array<string | number>;
  before?: unknown;
  after?: unknown;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function diffValues(before: unknown, after: unknown, path: Array<string | number>, output: ValuePatch[]) {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index += 1) diffValues(before[index], after[index], [...path, index], output);
    for (let index = before.length - 1; index >= after.length; index -= 1) output.push({ path: [...path, index], before: clone(before[index]) });
    for (let index = shared; index < after.length; index += 1) output.push({ path: [...path, index], after: clone(after[index]) });
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (!(key in after)) output.push({ path: [...path, key], before: clone(before[key]) });
      else if (!(key in before)) output.push({ path: [...path, key], after: clone(after[key]) });
      else diffValues(before[key], after[key], [...path, key], output);
    }
    return;
  }
  output.push({ path, before: clone(before), after: clone(after) });
}

function applyPatch(root: unknown, patch: ValuePatch, direction: 'forward' | 'backward') {
  const value = direction === 'forward' ? patch.after : patch.before;
  const hasValue = direction === 'forward' ? 'after' in patch : 'before' in patch;
  if (!patch.path.length) return hasValue ? clone(value) : undefined;
  const targetRoot = root as Record<string, unknown> | unknown[];
  let target = targetRoot;
  for (let index = 0; index < patch.path.length - 1; index += 1) {
    target = (target as Record<string | number, unknown>)[patch.path[index]] as Record<string, unknown> | unknown[];
  }
  const key = patch.path[patch.path.length - 1];
  if (Array.isArray(target) && typeof key === 'number') {
    if (!hasValue) target.splice(key, 1);
    else if (key >= target.length) target.splice(key, 0, clone(value));
    else target[key] = clone(value);
  } else if (!hasValue) {
    delete (target as Record<string | number, unknown>)[key];
  } else {
    (target as Record<string | number, unknown>)[key] = clone(value);
  }
  return root;
}

export class HistoryManager<T extends object> {
  private state: T | null = null;
  private entries: PatchCommand<T>[] = [];
  private index = -1;

  private limit: number;

  constructor(limit = 50) { this.limit = limit; }

  reset(next: T) {
    this.entries.forEach((entry) => entry.dispose());
    this.state = clone(next);
    this.entries = [];
    this.index = -1;
  }

  commit(next: T, label = '编辑操作') {
    if (!this.state) {
      this.reset(next);
      return false;
    }
    const forward: ValuePatch[] = [];
    diffValues(this.state, next, [], forward);
    if (!forward.length) return false;
    const backward = forward.map((patch) => ({ ...patch, path: [...patch.path] })).reverse();
    const discarded = this.entries.slice(this.index + 1);
    discarded.forEach((entry) => entry.dispose());
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(new PatchCommand<T>(label, forward, backward));
    if (this.entries.length > this.limit) this.entries.shift()?.dispose();
    this.index = this.entries.length - 1;
    this.state = clone(next);
    return true;
  }

  undo() {
    if (!this.state || this.index < 0) return null;
    this.state = this.entries[this.index].revert(this.state);
    this.index -= 1;
    return clone(this.state);
  }

  redo() {
    if (!this.state || this.index >= this.entries.length - 1) return null;
    const entry = this.entries[this.index + 1];
    this.state = entry.apply(this.state);
    this.index += 1;
    return clone(this.state);
  }

  canUndo() { return this.index >= 0; }
  canRedo() { return this.index < this.entries.length - 1; }
  records(): HistoryOperationRecord[] { return this.entries.map((entry) => entry.record()); }
}

class PatchCommand<T extends object> implements EditorCommand<T> {
  readonly id = crypto.randomUUID();
  readonly timestamp = Date.now();
  readonly label: string;
  private forward: ValuePatch[];
  private backward: ValuePatch[];

  constructor(label: string, forward: ValuePatch[], backward: ValuePatch[]) {
    this.label = label;
    this.forward = forward;
    this.backward = backward;
  }

  apply(state: T) {
    let next: unknown = clone(state);
    for (const patch of this.forward) next = applyPatch(next, patch, 'forward');
    return next as T;
  }

  revert(state: T) {
    let next: unknown = clone(state);
    for (const patch of this.backward) next = applyPatch(next, patch, 'backward');
    return next as T;
  }

  record(): HistoryOperationRecord {
    return { id: this.id, label: this.label, timestamp: this.timestamp, patches: clone(this.forward) };
  }

  dispose() {
    this.forward.length = 0;
    this.backward.length = 0;
  }
}
