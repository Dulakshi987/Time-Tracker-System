// ─────────────────────────────────────────────────────────────────────────
// permissions.js
// Central role → route → button access map.
// ...(unchanged comments above)...
// ─────────────────────────────────────────────────────────────────────────

export const ROLES = {
  ADMIN: "Admin",
  SYSTEM_ADMIN: "System Administrator",
  DOCUMENT_ENTER: "Document Enter",
  PRINTER: "Printer",
  PRINT_WITH_DOCUMENT_ENTER: "Print with Document Enter",
  PICKER: "Picker",
  CHECKER: "Checker",
  DELIVER: "Deliver",
  FILED_ADDER: "Filed Adder",
  ALL: "All",
};

export const ROLE_ACCESS = {
  [ROLES.ADMIN]: {
    defaultRoute: "/admin",
    allowedRoutes: ["*"],
    buttons: ["*"],
    allDivisions: true,
    navKeys: "*",
  },
  [ROLES.SYSTEM_ADMIN]: {
    defaultRoute: "/admin",
    allowedRoutes: ["*"],
    buttons: ["*"],
    allDivisions: true,
    navKeys: "*",
  },
  [ROLES.DOCUMENT_ENTER]: {
    defaultRoute: "/documents",
    allowedRoutes: ["/documents"],
    buttons: ["start", "hold", "end"],
    navKeys: ["docentry"],
  },
  [ROLES.PRINTER]: {
    defaultRoute: "/print",
    allowedRoutes: ["/print"],
    buttons: ["start", "hold", "end"],
    navKeys: ["print"],
  },
  [ROLES.PRINT_WITH_DOCUMENT_ENTER]: {
    defaultRoute: "/admin",
    allowedRoutes: ["/admin", "/print", "/documents", "/confirm"],
    buttons: ["start", "hold", "end"],
    navKeys: ["docentry", "print", "document"],
    hiddenColumns: {
      docentry: ["actions"],
      print: ["actions"],
      document: ["actions"]
    },
  },
  [ROLES.PICKER]: {
    defaultRoute: "/pick",
    allowedRoutes: ["/pick"],
    buttons: ["handover", "start", "hold", "end", "emergency_done"],
    navKeys: ["pick"],
  },
  [ROLES.CHECKER]: {
    defaultRoute: "/check",
    allowedRoutes: ["/check"],
    buttons: ["start", "hold", "end"],
    navKeys: ["check"],
  },
  [ROLES.DELIVER]: {
    defaultRoute: "/delivery",
    allowedRoutes: ["/delivery"],
    buttons: ["deliver", "hold", "cancel"],
    navKeys: ["delivery"],
  },
  [ROLES.FILED_ADDER]: {
    defaultRoute: "/confirm",
    allowedRoutes: ["/confirm"],
    buttons: ["add_to_file"],
    navKeys: ["document"],
  },
  [ROLES.ALL]: {
    defaultRoute: "/admin",
    allowedRoutes: ["/admin", "/documents", "/print", "/pick", "/check", "/delivery", "/confirm"],
    buttons: [
      "start", "hold", "end", "handover", "emergency_done",
      "deliver", "cancel", "add_to_file",
    ],
    // Added "dashboard" so an "All" role account sees the Admin Dashboard
    // KPI/overview page in the sidebar too, alongside the existing portals.
    navKeys: ["dashboard", "docentry", "print", "pick", "check", "delivery", "document", "report"],
    hiddenColumns: {
      docentry: ["actions"],
      print: ["actions"],
      pick: ["actions"],
      check: ["actions"],
      document: ["actions"],
      delivery: ["actions", "manage", "handover"],
    },
  },
}

const STORAGE_KEY = "fentons_user";

export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function logoutUser() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function getRoleConfig(user) {
  if (!user || !user.staffName) return null;
  const wanted = String(user.staffName).trim().toLowerCase();
  const matchedKey = Object.keys(ROLE_ACCESS).find(
    (key) => key.trim().toLowerCase() === wanted
  );
  return matchedKey ? ROLE_ACCESS[matchedKey] : null;
}

export function getDefaultRoute(user) {
  const cfg = getRoleConfig(user);
  return cfg ? cfg.defaultRoute : "/";
}

export function canAccessRoute(user, path) {
  const cfg = getRoleConfig(user);
  if (!cfg) return false;
  if (cfg.allowedRoutes.includes("*")) return true;
  return cfg.allowedRoutes.includes(path);
}

export function canUseButton(user, action) {
  const cfg = getRoleConfig(user);
  if (!cfg) return false;
  if (cfg.buttons.includes("*")) return true;
  return cfg.buttons.includes(action);
}

export function getNavKeys(user) {
  const cfg = getRoleConfig(user);
  if (!cfg) return [];
  return cfg.navKeys || [];
}

export function canSeeNavKey(user, navKey) {
  const keys = getNavKeys(user);
  if (keys === "*") return true;
  return Array.isArray(keys) && keys.includes(navKey);
}

export function isColumnHidden(user, portalKey, columnName) {
  const cfg = getRoleConfig(user);
  if (!cfg || !cfg.hiddenColumns || !cfg.hiddenColumns[portalKey]) return false;
  const needle = String(columnName || "").toLowerCase();
  return cfg.hiddenColumns[portalKey].some((c) => c.toLowerCase() === needle);
}

export function hasAllDivisionAccess(user) {
  const cfg = getRoleConfig(user);
  return !!(cfg && cfg.allDivisions);
}

// FIX: previously this ONLY worked if the login response carried a
// `divisions` array — which nothing in the system actually populates.
// User Accounts (Master Setup) store a user's assigned division(s) as a
// comma-separated `divisionNo` string (e.g. "D1,D2"), the same field the
// login endpoint already returns on the user record. That string is now
// parsed as the fallback, so division restriction works immediately
// without needing a backend change to AuthController — as long as the
// user object returned at login includes `divisionNo` (it already needs
// to, since Master Setup saves it against the account).
export function getUserDivisions(user) {
  if (!user) return [];
  if (Array.isArray(user.divisions)) {
    return user.divisions.map(String);
  }
  if (user.divisionNo) {
    return String(user.divisionNo)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function canSeeDivision(user, divisionNo) {
  if (hasAllDivisionAccess(user)) return true;
  if (!divisionNo) return false;
  return getUserDivisions(user).includes(String(divisionNo));
}