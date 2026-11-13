import * as React from 'react';

/**
 * One greeting for every KitStak app. Morning 05:00 to 11:59, afternoon 12:00 to 17:59, evening
 * otherwise. The hour is read in `timeZone` (an IANA zone) when given, else in the runtime's own
 * zone, so call it in the browser (see `useGreeting`) to greet people by their own clock.
 */
export type Greeting = 'Good morning' | 'Good afternoon' | 'Good evening';

export function hourIn(now: Date, timeZone?: string | null): number {
  if (!timeZone) return now.getHours();
  try {
    const part = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone })
      .formatToParts(now)
      .find((p) => p.type === 'hour');
    const hour = Number(part?.value);
    return Number.isFinite(hour) ? hour % 24 : now.getHours();
  } catch {
    return now.getHours();
  }
}

export function greetingFor(now: Date, timeZone?: string | null): Greeting {
  const hour = hourIn(now, timeZone);
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const subscribe = (onChange: () => void) => {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
};

/**
 * The greeting by the viewer's clock (or `timeZone`). Returns null during server rendering and
 * hydration, so a server in another zone never decides it; render the line hidden until then.
 */
export function useGreeting(timeZone?: string | null): Greeting | null {
  return React.useSyncExternalStore(
    subscribe,
    () => greetingFor(new Date(), timeZone),
    () => null,
  );
}
