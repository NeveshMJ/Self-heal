// src/components/auth/Login.jsx
// Staff login only. There is no signup: the controller ships with two fixed
// accounts, admin and analyst.

import { useState } from "react";
import { ArrowLeft, ShieldCheck, Headset } from "lucide-react";
import { login } from "../../api/authApi";

const ACCOUNTS = [
  {
    key: "admin",
    label: "Admin",
    icon: ShieldCheck,
    username: "admin",
    password: "admin@123",
    blurb: "Full access: tickets, insights, datasets, retention, audit logs.",
  },
  {
    key: "analyst",
    label: "Analyst",
    icon: Headset,
    username: "analyst",
    password: "analyst@123",
    blurb: "Works the ticket queue department-wise and acts on AI matches.",
  },
];

function Login({ onLogin, onBack }) {
  const [role, setRole] = useState("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // picking a role pre-fills the matching account
  const chooseRole = (account) => {
    setRole(account.key);
    setUsername(account.username);
    setPassword("");
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError("Please enter your ID and password.");
      return;
    }

    setLoading(true);
    try {
      const data = await login({ username: cleanUsername, password });

      if (data.user.role !== "admin" && data.user.role !== "analyst") {
        setError(
          "This login is for admin and analyst accounts only. " +
            "Use the User option on the home page to raise a complaint."
        );
        localStorage.removeItem("token");
        localStorage.removeItem("currentUser");
        return;
      }

      onLogin(data.user);
    } catch (err) {
      console.error("Login error:", err);
      setError(err.message || "Invalid ID or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card wide">

        {onBack && (
          <button type="button" className="back-link" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to home
          </button>
        )}

        {/* Logo */}
        <div className="auth-logo">
          <div className="logo-icon">S</div>

          <div>
            <h1>Self-Healing Controller</h1>
            <p>Intelligent IT Operations</p>
          </div>
        </div>

        {/* Heading */}
        <div className="auth-heading">
          <h2>Staff Login</h2>
          <p>Sign in as an admin or an analyst.</p>
        </div>

        {/* Role picker */}
        <div className="role-picker">
          {ACCOUNTS.map((account) => {
            const Icon = account.icon;
            return (
              <button
                key={account.key}
                type="button"
                className={`role-option ${role === account.key ? "active" : ""}`}
                onClick={() => chooseRole(account)}
                disabled={loading}
              >
                <Icon size={19} />
                <strong>{account.label}</strong>
                <span>{account.blurb}</span>
              </button>
            );
          })}
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit}>

          <div className="form-group">
            <label htmlFor="login-username">ID</label>
            <input
              id="login-username"
              type="text"
              value={username}
              placeholder="admin or analyst"
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              placeholder="Enter your password"
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>

        </form>

        <div className="auth-note">
          <strong>Accounts</strong>
          <span>admin / admin@123</span>
          <span>analyst / analyst@123</span>
        </div>

      </div>
    </div>
  );
}

export default Login;
