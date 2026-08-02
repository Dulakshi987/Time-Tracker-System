// src/utils/dateUtils.js

export function formatSriLankaTime(dateStr) {
  if (!dateStr) return "—";

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
    year: "numeric",     // ← මේ line එක add කරන්න (නැත්නම් Delivery Portal එකේ year එක නැති වෙනවා)
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}