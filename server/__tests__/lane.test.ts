import { normalizeCity, normalizeState, laneKey } from '../utils/lane.js';

describe('lane utils', () => {
  test('normalizeCity trims and uppercases', () => {
    expect(normalizeCity('  Kansas City  ')).toBe('KANSAS CITY');
  });

  test('normalizeState uppercases', () => {
    expect(normalizeState('mo')).toBe('MO');
  });

  test('laneKey builds normalized key', () => {
    expect(laneKey(' Kansas City ', 'Mo', 'Omaha', 'ne')).toBe(
      'KANSAS CITY,MO-OMAHA,NE'
    );
  });
});
