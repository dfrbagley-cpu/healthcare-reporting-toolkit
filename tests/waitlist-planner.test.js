import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateCapacityPlan,
  simulateQueue
} from "../site/js/tools/waitlist-planner.js";

test("compares unchanged capacity with a delayed capacity increase", () => {
  const result = calculateCapacityPlan({
    initialBacklog: 240,
    weeklyArrivals: 42,
    weeklyCapacity: 38,
    changeWeek: 5,
    proposedCapacity: 50,
    horizonWeeks: 26,
    targetWaitWeeks: 4
  });

  assert.equal(result.current.finalBacklog, 344);
  assert.equal(result.planned.finalBacklog, 80);
  assert.equal(result.planned.finalWaitWeeks, 1.6);
  assert.equal(result.requiredWholeCapacity, 46);
  assert.equal(result.targetWeek, 11);
  assert.equal(result.onTrack, true);
});

test("never serves more people than are available", () => {
  const result = simulateQueue({
    initialBacklog: 0,
    weeklyArrivals: 5,
    weeklyCapacity: 20,
    horizonWeeks: 3
  });

  assert.deepEqual(
    result.weeks.slice(1).map((week) => week.served),
    [5, 5, 5]
  );
  assert.equal(result.finalBacklog, 0);
  assert.equal(result.totalServed, 15);
});

test("reports a non-finite wait proxy when capacity is zero", () => {
  const result = simulateQueue({
    initialBacklog: 10,
    weeklyArrivals: 2,
    weeklyCapacity: 0,
    horizonWeeks: 2
  });

  assert.equal(result.finalBacklog, 14);
  assert.equal(result.finalWaitWeeks, Number.POSITIVE_INFINITY);
});

test("identifies a plan that misses its wait target", () => {
  const result = calculateCapacityPlan({
    initialBacklog: 100,
    weeklyArrivals: 20,
    weeklyCapacity: 15,
    changeWeek: 3,
    proposedCapacity: 18,
    horizonWeeks: 12,
    targetWaitWeeks: 2
  });

  assert.equal(result.onTrack, false);
  assert.ok(result.requiredWholeCapacity > 18);
  assert.equal(result.targetWeek, null);
});

test("rejects invalid horizons and change weeks", () => {
  assert.throws(
    () =>
      calculateCapacityPlan({
        initialBacklog: 1,
        weeklyArrivals: 1,
        weeklyCapacity: 1,
        changeWeek: 6,
        proposedCapacity: 2,
        horizonWeeks: 5,
        targetWaitWeeks: 1
      }),
    /Capacity change week/
  );
  assert.throws(
    () =>
      calculateCapacityPlan({
        initialBacklog: -1,
        weeklyArrivals: 1,
        weeklyCapacity: 1,
        changeWeek: 1,
        proposedCapacity: 2,
        horizonWeeks: 5,
        targetWaitWeeks: 1
      }),
    /Current waitlist/
  );
});
