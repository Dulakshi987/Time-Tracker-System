// ─────────────────────────────────────────────────────────────────────────
// permissions.js
// Central role → route → button access map.
// The "role" for each user is their `staffName` value from Master Setup →
// User Accounts (the same value AuthController already returns on login,
// e.g. "Admin", "Printer", "Picker" ...). If you rename any role in
// Master Setup, update the matching key below too — they must match
// EXACTLY (case-sensitive).
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
};

// allowedRoutes: "*" = every route. buttons: "*" = every button.
// allDivisions: true = ignore division filtering, see everything.
// Button names used across portals: "handover", "start", "hold", "end",
// "edit", "delete", "emergency_done", "deliver", "cancel", "add_to_file".
// Only Admin / System Administrator (buttons: "*") can Edit or Delete a
// completed card — Picker, Printer, and Print with Document Enter only get
// the workflow-action buttons, never Edit/Delete.
export const ROLE_ACCESS = {
  [ROLES.ADMIN]: {
    defaultRoute: "/admin",
    allowedRoutes: ["*"],
    buttons: ["*"],
    allDivisions: true,
  },
  [ROLES.SYSTEM_ADMIN]: {
    defaultRoute: "/admin",
    allowedRoutes: ["*"],
    buttons: ["*"],
    allDivisions: true,
  },
  [ROLES.DOCUMENT_ENTER]: {
    defaultRoute: "/documents",
    allowedRoutes: ["/documents"],
    buttons: ["start", "hold", "end"],
  },
  [ROLES.PRINTER]: {
    defaultRoute: "/print",
    allowedRoutes: ["/print"],
    buttons: ["start", "hold", "end"],
  },
  [ROLES.PRINT_WITH_DOCUMENT_ENTER]: {
    defaultRoute: "/print",
    allowedRoutes: ["/print", "/documents"],
    buttons: ["start", "hold", "end"],
  },
  [ROLES.PICKER]: {
    defaultRoute: "/pick",
    allowedRoutes: ["/pick"],
    // Pickers get the full pick-workflow action set, but never edit/delete.
    buttons: ["handover", "start", "hold", "end", "emergency_done"],
  },
  [ROLES.CHECKER]: {
    defaultRoute: "/check",
    allowedRoutes: ["/check"],
    buttons: ["start", "hold", "end"],
  },
  [ROLES.DELIVER]: {
    defaultRoute: "/delivery",
    allowedRoutes: ["/delivery"],
    buttons: ["deliver", "hold", "cancel"],
  },
  [ROLES.FILED_ADDER]: {
    defaultRoute: "/confirm",
    allowedRoutes: ["/confirm"],
    buttons: ["add_to_file"],
  },
};

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
  return ROLE_ACCESS[user.staffName] || null;
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

export function hasAllDivisionAccess(user) {
  const cfg = getRoleConfig(user);
  return !!(cfg && cfg.allDivisions);
}

// Expects the login response to include a `divisions` array of division
// numbers, e.g. ["4017", "4032", "4026"]. See the note in AuthController.java
// about wiring this up from SystemUser.
export function getUserDivisions(user) {
  if (!user || !Array.isArray(user.divisions)) return [];
  return user.divisions.map(String);
}

// Convenience: can this user see documents/rows belonging to divisionNo?
export function canSeeDivision(user, divisionNo) {
  if (hasAllDivisionAccess(user)) return true;
  if (!divisionNo) return false;
  return getUserDivisions(user).includes(String(divisionNo));
}