import { minsUntil, toEastern } from './utils.js';
import { state } from './state.js';

const MILESTONES = [0, 1, 3, 5, 10];

export async function requestPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function checkAndNotify() {
  if (!state.notifyMins || Notification.permission !== 'granted') return;
  for (const e of state.eta) {
    const mins = minsUntil(e.EstimatedDeparture);
    if (mins === null || mins < 0) continue;

    // Round to nearest minute so small timestamp drifts don't create duplicate keys
    const tripId = Math.round(toEastern(e.EstimatedDeparture).getTime() / 60_000);

    for (const milestone of MILESTONES) {
      if (milestone > state.notifyMins || mins > milestone) continue;
      const key = `${tripId}:${milestone}`;
      if (state.notified.has(key)) continue;
      state.notified.add(key);
      const dir = (e.RouteDirection || '').replace('_', ' ');
      const body = dir ? `${dir} bound at stop ${state.stop}` : `Arriving at stop ${state.stop}`;
      new Notification(mins === 0 ? 'Bus arriving now!' : `Bus in ${mins} min`, {
        body,
        icon: '/apple-touch-icon.png',
      });
    }
  }
}
