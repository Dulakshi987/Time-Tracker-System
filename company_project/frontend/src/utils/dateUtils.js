// src/utils/dateUtils.js

export function formatSriLankaTime(dateStr) {
  if (!dateStr) return "—";

  // Backend saves naive datetime in UTC (Railway server clock) with no
  // timezone marker, e.g. "2026-08-02 01:29:00". Force-parse it AS UTC
  // by converting to a proper ISO string with "Z", then render in
  // Sri Lanka time — otherwise the browser assumes it's already local
  // time and no conversion happens at all.
  let iso = String(dateStr).replace(" ", "T");
  if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso)) {
    iso += "Z";
  }

  const d = new Date(iso);
  if (isNaN(d.getTime())) return dateStr;

  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}