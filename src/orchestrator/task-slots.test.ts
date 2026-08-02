import { describe, expect, it } from 'vitest';
import { availableTaskSlots } from './task-slots.js';

describe('availableTaskSlots (grant ↔ busy coupling with reserved agents)', () => {
  it('a live judge consumes the slot its demand added to the grant', () => {
    // Demand = 1 pending + 1 reserved → grant 2. Without the reserved term the
    // pool would see 2 free slots and spawn a task agent ON TOP of the judge.
    expect(availableTaskSlots(2, 0, 0, 1)).toBe(1);
    expect(availableTaskSlots(2, 1, 0, 1)).toBe(0);
  });

  it('matches the legacy arithmetic when nothing is reserved', () => {
    expect(availableTaskSlots(5, 2, 1, 0)).toBe(2);
    expect(availableTaskSlots(0, 0, 0, 0)).toBe(0);
  });

  it('never goes negative when the grant shrank under the busy set', () => {
    expect(availableTaskSlots(1, 2, 1, 1)).toBe(0);
  });
});
