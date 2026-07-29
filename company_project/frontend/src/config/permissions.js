// ─────────────────────────────────────────────────────────────────────────
// permissions.js
// Central role → route → button access map.
// The "role" for each user is their `staffName` value from Master Setup →
// User Accounts (the same value AuthController already returns on login,
// e.g. "Admin", "Printer", "Picker" ...). If you rename any role in
// Master Setup, update the matching key below too — they must match
// EXACTLY (case-sensitive).
//
// FIX (this version): getRoleConfig() now matches staffName against the
// ROLE_ACCESS keys ignoring case and leading/trailing whitespace. This
// was causing "All" and "Print with Document Enter" accounts to fail to
// resolve a role (falling back to "/" and being bounced back to the
// login screen) whenever the staffName stored in Master Setup had a
// slightly different casing or stray spaces from the exact key string.
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
  // Sees Document Enter + all 4 workflow portals inside the shared admin
  // dashboard shell, but never gets Edit/Delete (matches the "All" staff
  // name / Chameera4017 account from Master Setup → User Accounts).
  ALL: "All",
};

// navKeys below refer to AdminDashboard.jsx's NAV_ITEMS "key" values
// (e.g. "docentry", "print", "pick", "check", "delivery", "document",
// "dashboard", "fullreport", "mastersetup", "notify", "report").
// "*" = every sidebar item. "Logout" is always shown regardless of navKeys.
//
// hiddenColumns below lists column/section names that a role's UI should
// hide inside a given portal (e.g. the Actions/Edit-Delete column, or the
// Delivery portal's "manage" / "handover" columns). The portal components
// themselves (IssuePrintForm, IssuePickForm, IssueCheckForm,
// IssueDeliveryForm, DocumentForm) need to read this via
// isColumnHidden(user, portalKey, columnName) — see helpers below.

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
    // Uses the shared admin dashboard shell so the sidebar can be
    // restricted, rather than the standalone /print page.
    defaultRoute: "/admin",
    allowedRoutes: ["/admin", "/print", "/documents"],
    buttons: ["start", "hold", "end"],
    // Sidebar shows ONLY Document Form + Print Portal (+ Logout, always shown).
    navKeys: ["docentry", "print"],
    // Edit/Delete are already hidden automatically since "edit"/"delete"
    // aren't in the buttons whitelist above — but listed here explicitly
    // too so the portal UI can hide the whole Actions column, not just
    // disable the buttons inside it.
    hiddenColumns: {
      docentry: ["actions"],
      print: ["actions"],
    },
  },
  [ROLES.PICKER]: {
    defaultRoute: "/pick",
    allowedRoutes: ["/pick"],
    // Pickers get the full pick-workflow action set, but never edit/delete.
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
    // Shared admin dashboard shell, restricted sidebar: Document Form +
    // all 4 workflow portals (+ Logout, always shown) — nothing else
    // (no Dashboard, Document Portal, Full Report, Master Setup,
    // Notification, or Report tabs).
    defaultRoute: "/admin",
    allowedRoutes: ["/admin", "/documents", "/print", "/pick", "/check", "/delivery"],
    // Every normal workflow button EXCEPT "edit" and "delete" — this role
    // must never see Edit/Delete on a completed card in any portal.
    buttons: [
      "start", "hold", "end", "handover", "emergency_done",
      "deliver", "cancel", "add_to_file",
    ],
    navKeys: ["docentry", "print", "pick", "check", "delivery"],
    // Actions/Edit-Delete column hidden entirely in these 4 portals, plus
    // Delivery's "Manage" and "Handover" columns hidden specifically.
    hiddenColumns: {
      docentry: ["actions"],
      print: ["actions"],
      pick: ["actions"],
      check: ["actions"],
      delivery: ["actions", "manage", "handover"],
    },
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

// FIXED: matches user.staffName against ROLE_ACCESS keys ignoring case
// and leading/trailing whitespace, instead of requiring an exact
// byte-for-byte match. This is what was breaking "All" and
// "Print with Document Enter" logins whenever the staffName stored in
// Master Setup had different casing/spacing than the literal key string.
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

// Which AdminDashboard sidebar keys (NAV_ITEMS "key") this user may see.
// Returns "*" (meaning "all") or an array of allowed keys.
export function getNavKeys(user) {
  const cfg = getRoleConfig(user);
  if (!cfg) return [];
  return cfg.navKeys || [];
}

// Should this NAV_ITEMS entry ("dashboard", "docentry", "print", "pick",
// "check", "delivery", "document", "fullreport", "mastersetup", "notify",
// "report") show in the sidebar for this user? Logout is NOT part of
// NAV_ITEMS in AdminDashboard.jsx (it's rendered separately) so it is
// always shown regardless of this check.
export function canSeeNavKey(user, navKey) {
  const keys = getNavKeys(user);
  if (keys === "*") return true;
  return Array.isArray(keys) && keys.includes(navKey);
}

// Should a given column/section (e.g. "actions", "manage", "handover") be
// hidden for this user inside a given portal ("docentry", "print", "pick",
// "check", "delivery")? Column names are case-insensitive.
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