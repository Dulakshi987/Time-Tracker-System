import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";

// ── Config ───────────────────────────────────────────────────────────────
// const AUTH_API = "http://localhost:8080/api/auth";
const AUTH_API = "https://time-tracker-system-production.up.railway.app/api/auth";

// Change this to whatever route renders <AdminDashboard /> in your router.
const ADMIN_DASHBOARD_ROUTE = "/admin";

export default function Login() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

      // Keep the logged-in user around for the dashboard / route guard.
      sessionStorage.setItem("fentons_user", JSON.stringify(user));

      navigate(ADMIN_DASHBOARD_ROUTE, { replace: true });
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
