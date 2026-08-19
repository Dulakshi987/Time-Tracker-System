import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./Login.css";
import { getDefaultRoute } from "../../config/permissions";

// ── Config ───────────────────────────────────────────────────────────────
// const AUTH_API = "http://localhost:8080/api/auth";
const AUTH_API = "https://time-tracker-system-production.up.railway.app/api/auth";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Shown when useIdleLogout() redirected here after 10 min of inactivity.
  const idleMessage =
    location.state?.reason === "idle-timeout"
      ? "You were logged out due to inactivity. Please sign in again."
      : null;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Please enter both username and password.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${AUTH_API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Invalid username or password.");
      }

      const user = await res.json();

      // Keep the logged-in user around for route guarding + division/button
      // permissions. `user.staffName` is treated as the role
      // (Admin / Printer / Picker / ...), `user.divisions` (if the backend
      // sends it) scopes which division's data this user can see.
      sessionStorage.setItem("fentons_user", JSON.stringify(user));

      const target = getDefaultRoute(user);
      if (target === "/") {
        // Role not recognised in permissions.js — don't let them in blind.
        setError("Your account role isn't set up for portal access yet. Contact an administrator.");
        sessionStorage.removeItem("fentons_user");
        setLoading(false);
        return;
      }

      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-title">Fentons Admin</div>
        <div className="login-subtitle">Sign in to continue to the dashboard</div>

        {idleMessage && <div className="login-error">⏱ {idleMessage}</div>}
        {error && <div className="login-error">⚠ {error}</div>}

        <form onSubmit={submit} className="login-form">
          <label className="login-label" htmlFor="login-username">Username</label>
          <input
            id="login-username"
            className="login-input"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your username"
          />

          <label className="login-label" htmlFor="login-password">Password</label>
          <div className="login-password-row">
            <input
              id="login-password"
              className="login-input"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
            <button
              type="button"
              className="login-toggle-btn"
              onClick={() => setShowPassword((s) => !s)}
              tabIndex={-1}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}