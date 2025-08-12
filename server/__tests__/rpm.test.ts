import { avgRpm, Load } from '../utils/rpm.js';

describe('avgRpm', () => {
  test('calculates average revenue per mile', () => {
    const loads: Load[] = [
      { miles: 100, revenue: 200 },
      { miles: 0, revenue: 100 },
      { miles: 300, revenue: 600 },
    ];
    expect(avgRpm(loads)).toBeCloseTo(2);
  });

  test('returns 0 when total miles is 0', () => {
    const loads: Load[] = [
      { miles: 0, revenue: 100 },
      { miles: 0, revenue: 200 },
    ];
    expect(avgRpm(loads)).toBe(0);
  });
});
