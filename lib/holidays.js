// Holiday decorations: a small mark by the logo on every national holiday (plus a few fun ones),
// and a full color change for the big ones. Turned on/off in Settings > Look.
const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// nth weekday (0=Sun) of a month; n = -1 for the last one
function nth(y, m, wd, n) {
  if (n > 0) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return iso(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7); }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(), lw = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return iso(y, m, lastDay - ((lw - wd + 7) % 7));
}
function easter(y) {                                   // anonymous Gregorian computus
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, mo, da);
}
const shift = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// big: the whole app changes color. Ranges are inclusive.
export function holidayFor(date) {
  const y = +date.slice(0, 4), md = date.slice(5);
  const thx = nth(y, 11, 4, 4);
  const list = [
    { key: "newyear", name: "Happy New Year", big: true, from: iso(y, 1, 1), to: iso(y, 1, 1) },
    { key: "newyear", name: "Happy New Year's Eve", big: true, from: iso(y, 12, 31), to: iso(y, 12, 31) },
    { key: "mlk", name: "Martin Luther King Jr. Day", from: nth(y, 1, 1, 3) },
    { key: "valentine", name: "Happy Valentine's Day", from: iso(y, 2, 14) },
    { key: "presidents", name: "Presidents' Day", from: nth(y, 2, 1, 3) },
    { key: "stpat", name: "Happy St. Patrick's Day", from: iso(y, 3, 17) },
    { key: "easter", name: "Happy Easter", from: shift(easter(y), -2), to: easter(y) },
    { key: "mother", name: "Happy Mother's Day", from: shift(nth(y, 5, 0, 2), -1), to: nth(y, 5, 0, 2) },
    { key: "memorial", name: "Memorial Day", from: nth(y, 5, 1, -1) },
    { key: "father", name: "Happy Father's Day", from: shift(nth(y, 6, 0, 3), -1), to: nth(y, 6, 0, 3) },
    { key: "juneteenth", name: "Juneteenth", from: iso(y, 6, 19) },
    { key: "july4", name: "Happy Independence Day", big: true, from: iso(y, 7, 1), to: iso(y, 7, 4) },
    { key: "pioneer", name: "Happy Pioneer Day", from: iso(y, 7, 24) },
    { key: "labor", name: "Labor Day", from: nth(y, 9, 1, 1) },
    { key: "columbus", name: "Columbus / Indigenous Peoples' Day", from: nth(y, 10, 1, 2) },
    { key: "halloween", name: "Happy Halloween", big: true, from: iso(y, 10, 25), to: iso(y, 10, 31) },
    { key: "veterans", name: "Veterans Day", from: iso(y, 11, 11) },
    { key: "thanks", name: "Happy Thanksgiving", big: true, from: shift(thx, -3), to: shift(thx, 1) },
    { key: "christmas", name: "Merry Christmas", big: true, from: iso(y, 12, 1), to: iso(y, 12, 26) },
  ];
  return list.find(h => date >= h.from && date <= (h.to || h.from)) || null;
}
export const PREVIEW = { christmas: "Christmas", halloween: "Halloween", thanks: "Thanksgiving", july4: "Independence Day", newyear: "New Year", valentine: "Valentine's Day",
  stpat: "St. Patrick's Day", easter: "Easter", veterans: "Veterans Day", pioneer: "Pioneer Day" };
export const byKey = key => ({ key, name: PREVIEW[key] || key, big: ["christmas", "halloween", "thanks", "july4", "newyear"].includes(key) });

// little line icons (24x24), drawn for this app
const S = (body, fill = "none") => `<svg viewBox="0 0 24 24" width="20" height="20" fill="${fill}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const MARK = {
  christmas: S('<path d="M12 3l5 7h-3l4 5h-3l3 4H6l3-4H6l4-5H7z"/><path d="M12 19v2"/><circle cx="12" cy="3" r=".6" fill="currentColor"/>'),
  halloween: S('<path d="M12 6c-5 0-8 3-8 7s3 7 8 7 8-3 8-7-3-7-8-7z"/><path d="M12 6c-1.5 1.5-1.5 12 0 14M12 6c1.5 1.5 1.5 12 0 14M12 6V3.5c1 0 2 .5 2 1.5"/><path d="M8.5 11.5l1.5 1 1.5-1M12.5 11.5l1.5 1 1.5-1M9 16h6"/>'),
  thanks: S('<path d="M12 21v-6"/><path d="M12 15c-4 0-7-3-7-7 3 0 5 1 7 4 2-3 4-4 7-4 0 4-3 7-7 7z"/><path d="M12 12c0-3 1-6 3-8M12 12c0-3-1-6-3-8"/>'),
  july4: S('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="2.5"/>'),
  newyear: S('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  valentine: S('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  stpat: S('<circle cx="9" cy="9" r="3.2"/><circle cx="15" cy="9" r="3.2"/><circle cx="12" cy="14" r="3.2"/><path d="M12 15c0 3 1 5 3 6"/>'),
  easter: S('<path d="M12 3c-4 0-6.5 6-6.5 10a6.5 6.5 0 0 0 13 0C18.5 9 16 3 12 3z"/><path d="M6 12l3 1.5 3-1.5 3 1.5 3-1.5"/>'),
  flag: S('<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>'),
  star: S('<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>'),
  heart: S('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  wagon: S('<path d="M4 13h13l2-4H6zM6 9c0-3 2.5-5 6.5-5S19 6 19 9"/><circle cx="7" cy="17" r="2.5"/><circle cx="16" cy="17" r="2.5"/>'),
};
export const markFor = h => MARK[h.key] || ({ mlk: MARK.star, presidents: MARK.flag, memorial: MARK.flag, juneteenth: MARK.star, labor: MARK.star, columbus: MARK.flag,
  veterans: MARK.star, mother: MARK.heart, father: MARK.heart, pioneer: MARK.wagon })[h.key] || MARK.star;
