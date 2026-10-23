import { R, S } from './state.js';
import { pickHour, weatherText } from './weathercore.js';

/* The weather at the start of the activity, from Open-Meteo (free, no key). Only runs when the Weather chip is on. */
/* what the card and HUD draw, or '' */
export const weatherLine = () => (S.weather && R.weather && R.weather.for === R.fullTrack ? weatherText(R.weather.data, S.temp, S.units) : '');

async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error('weather ' + r.status); return r.json(); }

export async function loadWeather() {
  const t = R.fullTrack; if (!(S.weather || S.wxfx) || !t || !t.meta.hasTime || t.meta.startTime == null) return;
  if (R.weather && R.weather.for === t) return;
  const [lng, lat] = t.line.coords[0], start = t.meta.startTime;
  const day = new Date(start).toISOString().slice(0, 10), next = new Date(start + 864e5).toISOString().slice(0, 10);
  const q = '?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) + '&start_date=' + day + '&end_date=' + next + '&hourly=temperature_2m,weather_code&timezone=auto';
  const recent = Date.now() - start < 80 * 864e5;
  const urls = ['https://api.open-meteo.com/v1/forecast', 'https://archive-api.open-meteo.com/v1/archive'].map((u) => u + q);
  if (!recent) urls.reverse();
  let data = null;
  for (const url of urls) { try { data = pickHour(await getJson(url), start); if (data) break; } catch (e) { /* try the other service */ } }
  if (R.fullTrack === t) R.weather = { for: t, data };
  return data;
}
