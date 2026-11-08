import { describe, expect, it } from 'vitest';
import { tableCapacityIssue } from './table-capacity.js';

describe('fixed ten-person tables', () => {
  it('allows partially occupied tables and extra tables within the hall layout', () => {
    expect(tableCapacityIssue(95, 10, 12, 200)).toBeNull();
    expect(tableCapacityIssue(95, 12, 12, 200)).toBeNull();
  });
  it('rejects one extra person and reducing aggregate menu tables below the minimum', () => {
    expect(tableCapacityIssue(101, 10, 12, 200)).toBe('BOOKING_TABLES_INSUFFICIENT');
    expect(tableCapacityIssue(95, 9, 12, 200)).toBe('BOOKING_TABLES_INSUFFICIENT');
  });
  it('rejects twenty tables where the largest published layout has twelve', () => {
    expect(tableCapacityIssue(100, 20, 12, 200)).toBe('BOOKING_LAYOUT_TABLE_LIMIT');
  });
  it('requires an available layout and preserves the hall headcount bound', () => {
    expect(tableCapacityIssue(10, 1, 0, 200)).toBe('BOOKING_LAYOUT_UNAVAILABLE');
    expect(tableCapacityIssue(121, 13, 20, 120)).toBe('BOOKING_HALL_CAPACITY_EXCEEDED');
  });
});
