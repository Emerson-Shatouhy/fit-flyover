/* Pure helpers for the Open-Meteo weather lookup (no app state, so they can be tested). */
const CODES = [[0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Overcast'], [48, 'Fog'], [57, 'Drizzle'], [67, 'Rain'], [77, 'Snow'], [82, 'Showers'], [86, 'Snow showers'], [99, 'Thunderstorms']];

export function codeText(code) {
  const hit = CODES.find(([max]) => code <= max);
  return hit ? hit[1] : '';
}

/* the hourly reading nearest the start; the response hours are local to the place, offset by utc_offset_seconds */
export function pickHour(json, startMs) {
  const h = json && json.hourly; if (!h || !h.time || !h.time.length) return null;
  const local = new Date(startMs + (json.utc_offset_seconds || 0) * 1000);
  if (local.getUTCMinutes() >= 30) local.setUTCHours(local.getUTCHours() + 1);
  const key = local.toISOString().slice(0, 13) + ':00';
  const i = h.time.indexOf(key); if (i < 0) return null;
  const tempC = h.temperature_2m[i], code = h.weather_code[i];
  return tempC == null || code == null ? null : { tempC, code };
}

export function weatherText(w, units) {
  if (!w) return '';
  const t = units === 'mi' ? Math.round(w.tempC * 9 / 5 + 32) + '°F' : Math.round(w.tempC) + '°C';
  return (t + ' · ' + codeText(w.code)).toUpperCase();
}
