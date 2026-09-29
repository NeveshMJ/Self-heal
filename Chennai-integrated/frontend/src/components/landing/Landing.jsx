// src/components/landing/Landing.jsx
// Entry screen. The hero offers two options: Login (admin or analyst) and
// User (goes straight to the public complaint portal).

import {
  LogIn,
  UserRound,
  ShieldCheck,
  Gauge,
  Workflow,
} from "lucide-react";

function Landing({ onLogin, onUser }) {
  return (
    <div className="landing-page">

      {/* ============ TOP BAR ============ */}

      <header className="landing-header">

        <div className="landing-brand">
          <div className="logo-icon small">S</div>
          <span>Self-Healing Controller</span>
        </div>

      </header>


      {/* ============ HERO ============ */}

      <main className="landing-main">

        <div className="landing-hero">

          <span className="landing-tag">
            Intelligent IT Operations
          </span>

          <h1>Self-Healing Controller</h1>

          <p>
            Raise a complaint and the controller matches it against the
            knowledge base instantly, scores the confidence, and either heals
            it automatically or routes it to the right analyst.
          </p>

          <div className="landing-actions">

            <button
              type="button"
              className="landing-cta"
              onClick={onLogin}
            >
              <LogIn size={18} />
              Login
              <span>Admin / Analyst</span>
            </button>

            <button
              type="button"
              className="landing-cta outline"
              onClick={onUser}
            >
              <UserRound size={18} />
              User
              <span>Raise a complaint</span>
            </button>

          </div>

        </div>


        {/* ============ FEATURE STRIP ============ */}

        <div className="landing-features">

          <div className="landing-feature">
            <Gauge size={20} />
            <strong>Instant confidence score</strong>
            <span>
              Every complaint is matched and scored the moment it is submitted.
            </span>
          </div>

          <div className="landing-feature">
            <Workflow size={20} />
            <strong>Department-wise routing</strong>
            <span>
              Analysts open a department and work only the tickets that belong
              to it.
            </span>
          </div>

          <div className="landing-feature">
            <ShieldCheck size={20} />
            <strong>Full audit trail</strong>
            <span>
              Every match, override and self-heal is recorded and inspectable by
              an admin.
            </span>
          </div>

        </div>

      </main>

      <footer className="landing-footer">
        Self-Healing Controller · Chennai
      </footer>

    </div>
  );
}

export default Landing;
