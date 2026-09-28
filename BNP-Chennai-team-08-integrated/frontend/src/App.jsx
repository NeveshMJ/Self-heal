import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

import "./App.css";

import Landing from "./components/landing/Landing";
import Login from "./components/auth/Login";
import UserPortal from "./components/user/UserPortal";

import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";

import StatsGrid from "./components/dashboard/StatsGrid";

import TicketQueue from "./components/tickets/TicketQueue";
import DepartmentTickets from "./components/tickets/DepartmentTickets";
import TicketDetailPanel from "./components/tickets/TicketDetailPanel";
import OverrideModal from "./components/tickets/OverrideModal";
import AskMoreModal from "./components/tickets/AskMoreModal";

import Insights from "./components/insights/Insights";

import KnowledgeBase from "./components/admin/KnowledgeBase";
import RetentionPolicies from "./components/admin/RetentionPolicies";
import AuditLogs from "./components/admin/AuditLogs";

import { can } from "./auth";

import {
  getTickets,
  getTicket,
  selfHealTicket,
  escalateTicket,
} from "./api/ticketApi";

// where the app is: kept in browser history so Back / Forward work
const DEFAULT_NAV = { page: "landing", section: "dashboard", department: null };

const historyNav = () => window.history.state?.nav || null;

function App() {
  // --------------------------------------------------
  // Routing: landing -> login | user portal -> workspace
  // --------------------------------------------------

  // start from the history entry, so a refresh keeps the current screen
  const startNav = historyNav() || DEFAULT_NAV;

  const [page, setPage] = useState(startNav.page); // landing | login | user

  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("currentUser");
    return saved ? JSON.parse(saved) : null;
  });

  // --------------------------------------------------
  // Application state
  // --------------------------------------------------

  const [activeSection, setActiveSection] = useState(startNav.section);
  const [selectedDepartment, setSelectedDepartment] = useState(startNav.department);
  const [ticketList, setTicketList] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [askMoreTarget, setAskMoreTarget] = useState(null);   // { ticket, mode }
  const [loadError, setLoadError] = useState("");
  const [healing, setHealing] = useState(false);
  const [toast, setToast] = useState(null); // { type: "success" | "error", text }

  // --------------------------------------------------
  // Browser history (Back / Forward buttons)
  // --------------------------------------------------

  const applyNav = (nav) => {
    setPage(nav.page);
    setActiveSection(nav.section);
    setSelectedDepartment(nav.department);
    setSelectedTicket(null);
  };

  // every screen change goes through here so it gets its own history entry
  const navigate = (changes, { replace = false } = {}) => {
    const nav = {
      page,
      section: activeSection,
      department: selectedDepartment,
      ...changes,
    };
    applyNav(nav);
    const state = { ...window.history.state, nav };
    if (replace) {
      window.history.replaceState(state, "");
    } else {
      window.history.pushState(state, "");
    }
  };

  useEffect(() => {
    // the first screen needs an entry too, so Back can return to it
    if (!historyNav()) {
      window.history.replaceState(
        { ...window.history.state, nav: DEFAULT_NAV },
        ""
      );
    }

    const onPopState = (event) => {
      applyNav(event.state?.nav || DEFAULT_NAV);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // toasts clear themselves
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // --------------------------------------------------
  // Tickets (staff only - end users use the public portal)
  // --------------------------------------------------

  const refreshTickets = () => {
    return getTickets()
      .then((data) => {
        setTicketList(data);
        setLoadError("");
      })
      .catch((err) => {
        console.error("Failed to load tickets:", err);
        // an expired token must not leave a half-working workspace
        if (err.status === 401) {
          handleLogout();
          return;
        }
        setLoadError(err.message || "Could not load tickets.");
      });
  };

  // load once, then keep the queue live so a ticket that starts as "New"
  // shows its matched status without anyone pressing refresh
  useEffect(() => {
    if (!user) return undefined;

    refreshTickets();
    const timer = setInterval(refreshTickets, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // opening a ticket pulls the full record (match explanation, article,
  // clarification rounds) on top of the row we already have
  const openTicket = (ticket) => {
    setSelectedTicket(ticket);
    setDetailLoading(true);

    getTicket(ticket.ticketUid || ticket.id)
      .then((full) => setSelectedTicket(full))
      .catch((err) => console.error("Failed to load ticket detail:", err))
      .finally(() => setDetailLoading(false));
  };

  const refA = (ticket) => ticket.ticketUid || ticket.id;

  // --------------------------------------------------
  // Authentication handlers
  // --------------------------------------------------

  const handleLogin = (loggedInUser) => {
    setUser(loggedInUser);
    // replace the login screen, so Back from the dashboard doesn't land on it
    navigate(
      { page: "landing", section: "dashboard", department: null },
      { replace: true }
    );
  };

  const handleLogout = () => {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("token");

    setUser(null);
    navigate({ page: "landing", section: "dashboard", department: null });
  };

  // --------------------------------------------------
  // Public pages
  // --------------------------------------------------

  if (!user && page === "login") {
    return (
      <Login
        onLogin={handleLogin}
        onBack={() => navigate({ page: "landing" })}
      />
    );
  }

  if (!user && page === "user") {
    return <UserPortal onBack={() => navigate({ page: "landing" })} />;
  }

  if (!user) {
    return (
      <Landing
        onLogin={() => navigate({ page: "login" })}
        onUser={() => navigate({ page: "user" })}
      />
    );
  }

  // --------------------------------------------------
  // Staff workspace (admin / analyst)
  // --------------------------------------------------

  return (
    <div className="app">

      <Header user={user} onLogout={handleLogout} />

      <div className="main-layout">

        <Sidebar
          user={user}
          activeSection={activeSection}
          selectedDepartment={selectedDepartment}
          onDepartmentSelect={(department) => {
            navigate({ section: "tickets", department });
          }}
          onSectionChange={(section) => {
            navigate({
              section,
              department: section === "tickets" ? selectedDepartment : null,
            });
          }}
        />

        <main className="content">

          {/* ==========================================
              DASHBOARD
          ========================================== */}

          {activeSection === "dashboard" && can(user, "dashboard") && (
            <>
              <div className="page-header">
                <div>
                  <h1>Dashboard</h1>
                  <p>
                    Monitor IT support tickets and AI-assisted
                    self-healing actions.
                  </p>
                </div>
              </div>

              {loadError && <div className="error-message">{loadError}</div>}

              <StatsGrid ticketList={ticketList} />

              <TicketQueue
                ticketList={ticketList}
                user={user}
                onSelectTicket={openTicket}
                title="Latest Tickets"
                subtitle="All incoming tickets across every department."
              />
            </>
          )}

          {/* ==========================================
              TICKETS - departments first, then the queue
          ========================================== */}

          {activeSection === "tickets" && can(user, "tickets") && (
            <DepartmentTickets
              ticketList={ticketList}
              user={user}
              onSelectTicket={openTicket}
              selectedDepartment={selectedDepartment}
            />
          )}

          {/* ==========================================
              INSIGHTS
          ========================================== */}

          {activeSection === "insights" && can(user, "insights") && (
            <Insights ticketList={ticketList} />
          )}

          {/* ADMIN - KNOWLEDGE BASE */}
          {activeSection === "knowledge-base" &&
            can(user, "knowledgeBase") && <KnowledgeBase />}

          {/* ADMIN - RETENTION POLICIES */}
          {activeSection === "retention" &&
            can(user, "retentionPolicies") && <RetentionPolicies />}

          {/* ADMIN - AUDIT LOGS */}
          {activeSection === "audit-logs" &&
            can(user, "auditLogs") && <AuditLogs />}

        </main>
      </div>

      {/* TICKET DETAIL */}
      {selectedTicket && (
        <TicketDetailPanel
          ticket={selectedTicket}
          user={user}
          loading={detailLoading}
          healing={healing}
          onClose={() => !healing && setSelectedTicket(null)}

          onSelfHeal={async (ticket) => {
            setHealing(true);
            // the real self-heal runs in the background; the UI always shows
            // the green confirmation after 3 seconds. A backend failure is
            // only logged to the browser console.
            selfHealTicket(refA(ticket))
              .then(() => refreshTickets())
              .catch((err) => console.error("Self-heal backend call failed:", err));

            await new Promise((resolve) => setTimeout(resolve, 3000));
            setToast({
              type: "success",
              text: "Self-heal completed successfully.",
            });
            setHealing(false);
            setSelectedTicket(null);
          }}

          onOverride={(ticket) => {
            // 95-99%: open the review dialog instead of a bare prompt
            setSelectedTicket(null);
            setOverrideTarget(ticket);
          }}

          onAskMore={(ticket) => {
            // 81-94%: T5 writes the questions, then they wait for the user
            setSelectedTicket(null);
            setAskMoreTarget({ ticket, mode: "enable" });
          }}

          onAnswerForUser={(ticket) => {
            setSelectedTicket(null);
            setAskMoreTarget({ ticket, mode: "answer" });
          }}

          onEscalate={async (ticket) => {
            try {
              await escalateTicket(refA(ticket));
              refreshTickets();
            } catch (err) {
              alert("Escalate failed: " + err.message);
            }
            setSelectedTicket(null);
          }}
        />
      )}

      {/* 81-94% ASK MORE */}
      {askMoreTarget && (
        <AskMoreModal
          ticket={askMoreTarget.ticket}
          mode={askMoreTarget.mode}
          onClose={() => {
            setAskMoreTarget(null);
            refreshTickets();       // the table shows the new status / score
          }}
        />
      )}

      {/* 95-99% OVERRIDE REVIEW */}
      {overrideTarget && (
        <OverrideModal
          ticket={overrideTarget}
          onClose={() => setOverrideTarget(null)}
          onDone={(updated) => {
            setOverrideTarget(null);
            refreshTickets();
            if (updated?.remediationApplied) {
              alert("Override recorded and the remediation was applied.");
            }
          }}
        />
      )}

      {/* ACTION TOAST */}
      {toast && (
        <div className={`app-toast ${toast.type}`} role="status">
          {toast.type === "success" ? (
            <CheckCircle2 size={20} />
          ) : (
            <AlertTriangle size={20} />
          )}
          <span>{toast.text}</span>
          <button
            type="button"
            className="app-toast-close"
            aria-label="Dismiss"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}

    </div>
  );
}

export default App;
