import { minsUntil } from './utils.js';
import { state } from './state.js';

export async function requestPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function checkAndNotify() {
  if (!state.notifyMins || Notification.permission !== 'granted') return;
  for (const e of state.eta) {
    const key = e.EstimatedDeparture;
    if (state.notified.has(key)) continue;
    const mins = minsUntil(e.EstimatedDeparture);
    if (mins !== null && mins >= 0 && mins <= state.notifyMins) {
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
