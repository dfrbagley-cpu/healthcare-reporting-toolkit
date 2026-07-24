export function calculateCapacityPlan(input) {
  const initialBacklog = numberAtLeast(input.initialBacklog, 0, "Current waitlist");
  const weeklyArrivals = numberAtLeast(input.weeklyArrivals, 0, "Weekly referrals");
  const weeklyCapacity = numberAtLeast(input.weeklyCapacity, 0, "Current capacity");
  const proposedCapacity = numberAtLeast(
    input.proposedCapacity,
    0,
    "Proposed capacity"
  );
  const targetWaitWeeks = numberAtLeast(
    input.targetWaitWeeks,
    0,
    "Target wait"
  );
  const horizonWeeks = wholeNumberBetween(
    input.horizonWeeks,
    1,
    104,
    "Planning horizon"
  );
  const changeWeek = wholeNumberBetween(
    input.changeWeek,
    1,
    horizonWeeks,
    "Capacity change week"
  );

  const current = simulateQueue({
    initialBacklog,
    weeklyArrivals,
    weeklyCapacity,
    horizonWeeks
  });
  const planned = simulateQueue({
    initialBacklog,
    weeklyArrivals,
    weeklyCapacity,
    horizonWeeks,
    changeWeek,
    postChangeCapacity: proposedCapacity
  });

  const weeksBeforeChange = changeWeek - 1;
  const weeksAfterChange = horizonWeeks - weeksBeforeChange;
  const demandBeforeAndDuringHorizon =
    initialBacklog + weeklyArrivals * horizonWeeks;
  const capacityBeforeChange = weeklyCapacity * weeksBeforeChange;
  const requiredPostChangeCapacity =
    (demandBeforeAndDuringHorizon - capacityBeforeChange) /
    (weeksAfterChange + targetWaitWeeks);
  const requiredCapacity = Math.max(0, requiredPostChangeCapacity);
  const targetFinalBacklog = targetWaitWeeks * proposedCapacity;
  const finalPlanned = planned.weeks.at(-1);
  const targetWeek = findSustainedTargetWeek(
    planned.weeks,
    targetWaitWeeks,
    changeWeek
  );

  return {
    inputs: {
      initialBacklog,
      weeklyArrivals,
      weeklyCapacity,
      proposedCapacity,
      targetWaitWeeks,
      horizonWeeks,
      changeWeek
    },
    current,
    planned,
    requiredPostChangeCapacity: requiredCapacity,
    requiredWholeCapacity: Math.ceil(requiredCapacity),
    targetFinalBacklog,
    targetWeek,
    onTrack:
      waitProxy(finalPlanned.backlog, finalPlanned.capacity) <= targetWaitWeeks
  };
}

function findSustainedTargetWeek(weeks, targetWaitWeeks, firstEligibleWeek) {
  for (let index = firstEligibleWeek; index < weeks.length; index += 1) {
    const remainsWithinTarget = weeks
      .slice(index)
      .every(
        (week) => waitProxy(week.backlog, week.capacity) <= targetWaitWeeks
      );
    if (remainsWithinTarget) {
      return weeks[index].week;
    }
  }
  return null;
}

export function simulateQueue({
  initialBacklog,
  weeklyArrivals,
  weeklyCapacity,
  horizonWeeks,
  changeWeek = null,
  postChangeCapacity = null
}) {
  const weeks = [
    {
      week: 0,
      arrivals: 0,
      capacity: weeklyCapacity,
      served: 0,
      backlog: initialBacklog,
      waitWeeks: waitProxy(initialBacklog, weeklyCapacity)
    }
  ];
  let backlog = initialBacklog;
  let totalServed = 0;

  for (let week = 1; week <= horizonWeeks; week += 1) {
    const capacity =
      changeWeek !== null && week >= changeWeek
        ? postChangeCapacity
        : weeklyCapacity;
    const availableToServe = backlog + weeklyArrivals;
    const served = Math.min(availableToServe, capacity);
    backlog = Math.max(0, availableToServe - served);
    totalServed += served;
    weeks.push({
      week,
      arrivals: weeklyArrivals,
      capacity,
      served,
      backlog,
      waitWeeks: waitProxy(backlog, capacity)
    });
  }

  return {
    weeks,
    totalArrivals: weeklyArrivals * horizonWeeks,
    totalServed,
    finalBacklog: weeks.at(-1).backlog,
    finalWaitWeeks: weeks.at(-1).waitWeeks,
    peakBacklog: Math.max(...weeks.map((week) => week.backlog))
  };
}

function waitProxy(backlog, capacity) {
  if (backlog === 0) {
    return 0;
  }
  return capacity > 0 ? backlog / capacity : Number.POSITIVE_INFINITY;
}

function numberAtLeast(value, minimum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    throw new Error(`${label} must be ${minimum} or greater.`);
  }
  return number;
}

function wholeNumberBetween(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(
      `${label} must be a whole number from ${minimum} to ${maximum}.`
    );
  }
  return number;
}
