// src/components/user/UserPortal.jsx
//
// The "User" option on the home page lands here directly - this IS the
// complaint registration page.
//
// The form carries the ticket-table fields the complainant must supply
// (department_id, description) plus their credentials, which are mandatory:
// nothing is logged until the id + password are verified against the backend.
// Everything else on the ticket row is generated: the SHA-256 ticket id, the
// status, the match score, the matched article and the timestamp.
//
// The ticket is created with status "New" and the AI match runs behind it, so
// the status updates itself on this page while the complainant watches.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Send,
  CheckCircle2,
  RefreshCcw,
  Inbox,
  Loader2,
  ShieldCheck,
  BellRing,
  X,
  LogIn,
  MessageCircle,
} from "lucide-react";

import { verifyEndUser } from "../../api/authApi";
import {
  createTicket,
  getMyTickets,
  getPublicDepartments,
  submitAnswers,
} from "../../api/ticketApi";
import ClarificationAnswers from "../tickets/ClarificationAnswers";
import {
  bandDescription,
  departmentLabel,
  formatDateTime,
  scoreClass,
  statusClass,
  ticketRef,
} from "../../utils/format";

const POLL_INTERVAL = 2000;   // how often we re-check the status
const POLL_LIMIT = 20;        // give up after ~40s
const MINE_POLL_INTERVAL = 5000;   // keep "My Requests" live (new questions appear)

// what the user is told once their answers have been re-scored
function answerOutcome(result) {
  if (!result) return "";
  if (result.escalated || result.status === "Escalated") {
    return "Your ticket has been passed to a human engineer.";
  }
  if (result.band === "SELF_HEAL") {
    return "It is now an exact match and can be fixed automatically.";
  }
  if (result.band === "OVERRIDE") {
    return "An analyst will review it and approve the fix.";
  }
  return "The analyst may come back with a few more questions.";
}

function UserPortal({ onBack }) {
  // ---------- form ----------
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [description, setDescription] = useState("");

  const [departments, setDepartments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ---------- result ----------
  const [createdTicket, setCreatedTicket] = useState(null);
  const [matching, setMatching] = useState(false);
  const [myTickets, setMyTickets] = useState([]);

  // token from the last successful verification, kept in memory only so this
  // can never be mistaken for a staff session
  const tokenRef = useRef(null);
  const pollRef = useRef(null);
  const myTicketsRef = useRef(null);

  const [showNotice, setShowNotice] = useState(false);   // "tickets are below"

  // ---------- view an already-raised ticket ----------
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewId, setViewId] = useState("");
  const [viewPassword, setViewPassword] = useState("");
  const [viewing, setViewing] = useState(false);
  const [viewError, setViewError] = useState("");
  const [fromView, setFromView] = useState(false);   // panel shows an existing ticket
  const [signedInAs, setSignedInAs] = useState("");

  // ---------- Ask More: answering the analyst's questions ----------
  const mineRef = useRef(null);
  const [answerResult, setAnswerResult] = useState({});   // ticketUid -> result

  // departments load without a login (public endpoint)
  useEffect(() => {
    getPublicDepartments()
      .then((rows) => setDepartments(rows || []))
      .catch((err) => console.error("Failed to load departments:", err));
  }, []);

  // stop polling when the page goes away
  useEffect(
    () => () => {
      clearInterval(pollRef.current);
      clearInterval(mineRef.current);
    },
    []
  );

  // while signed in, keep the ticket list live so questions an analyst
  // asks (Ask More) show up here without a refresh
  const startMinePolling = useCallback((token) => {
    clearInterval(mineRef.current);
    mineRef.current = setInterval(async () => {
      try {
        const rows = (await getMyTickets(token)) || [];
        setMyTickets(rows);
        setCreatedTicket((prev) =>
          prev ? rows.find((t) => t.ticketUid === prev.ticketUid) || prev : prev
        );
      } catch (err) {
        if (err.status === 401) {
          // the sign-in expired: stop and ask them to sign in again
          clearInterval(mineRef.current);
          tokenRef.current = null;
          setSignedInAs("");
        }
      }
    }, MINE_POLL_INTERVAL);
  }, []);

  // the complainant answers the analyst's questions -> the ticket is re-scored
  const handleAnswers = async (ticket, responses) => {
    const updated = await submitAnswers(ticket.ticketUid, responses, tokenRef.current);
    setAnswerResult((prev) => ({ ...prev, [ticket.ticketUid]: updated.result }));
    setMyTickets((rows) =>
      rows.map((r) => (r.ticketUid === updated.ticketUid ? updated : r))
    );
    setCreatedTicket((prev) =>
      prev && prev.ticketUid === updated.ticketUid ? updated : prev
    );
  };

  const loadMine = useCallback((token) => {
    getMyTickets(token)
      .then((rows) => setMyTickets(rows || []))
      .catch((err) => console.error("Failed to load your tickets:", err));
  }, []);

  // watch a new ticket until the background matcher moves it off "New"
  const watchTicket = useCallback(
    (uid, token) => {
      clearInterval(pollRef.current);
      setMatching(true);

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const rows = await getMyTickets(token);
          setMyTickets(rows || []);

          const fresh = (rows || []).find((t) => t.ticketUid === uid);
          if (fresh) {
            setCreatedTicket(fresh);
            if (fresh.status !== "New") {
              clearInterval(pollRef.current);
              setMatching(false);
              return;
            }
          }
        } catch (err) {
          console.error("Status check failed:", err);
        }

        if (attempts >= POLL_LIMIT) {
          clearInterval(pollRef.current);
          setMatching(false);
        }
      }, POLL_INTERVAL);
    },
    []
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const cleanId = userId.trim();

    // credentials are mandatory
    if (!cleanId || !password) {
      setError("Your user ID and password are required to register a complaint.");
      return;
    }
    if (!departmentId) {
      setError("Choose the department your complaint belongs to.");
      return;
    }
    if (description.trim().length < 10) {
      setError("Describe the issue in at least 10 characters.");
      return;
    }

    setSubmitting(true);
    try {
      // 1. verify the complainant
      const identity = await verifyEndUser({
        username: cleanId,
        password,
      });
      tokenRef.current = identity.token;

      // 2. create the ticket - comes back as "New" with its SHA-256 id
      const ticket = await createTicket(
        Number(departmentId),
        description.trim(),
        identity.token
      );

      setCreatedTicket(ticket);
      setFromView(false);
      setSignedInAs(cleanId);
      setPassword("");
      setDescription("");
      setDepartmentId("");
      loadMine(identity.token);
      setShowNotice(true);
      startMinePolling(identity.token);

      // 3. follow the status until the matcher has finished
      watchTicket(ticket.ticketUid, identity.token);
    } catch (err) {
      console.error("Complaint failed:", err);
      if (err.status === 401) {
        setError("Invalid user ID or password.");
      } else {
        setError(err.message || "Could not register the complaint.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // once "My Requests" has rendered, scroll down to it
  const [scrollToMine, setScrollToMine] = useState(false);
  useEffect(() => {
    if (!scrollToMine) return;
    setScrollToMine(false);
    myTicketsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToMine, myTickets]);

  // sign in and load the tickets raised earlier with these credentials.
  // Returns an error message, or "" on success.
  const loadExistingTickets = async (id, pass) => {
    setViewing(true);
    try {
      const identity = await verifyEndUser({ username: id, password: pass });
      tokenRef.current = identity.token;
      setSignedInAs(id);

      const rows = (await getMyTickets(identity.token)) || [];
      setMyTickets(rows);

      // the most recent ticket goes in the panel; the rest are listed below
      const latest = [...rows].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      )[0];
      clearInterval(pollRef.current);
      setMatching(false);
      setCreatedTicket(latest || null);
      setFromView(Boolean(latest));
      if (latest && latest.status === "New") {
        watchTicket(latest.ticketUid, identity.token);
      }

      setShowNotice(true);
      startMinePolling(identity.token);
      // questions waiting at the top take priority over scrolling away
      if (rows.length > 0 && !rows.some((r) => r.awaitingAnswers)) {
        setScrollToMine(true);
      }
      return "";
    } catch (err) {
      return err.status === 401
        ? "Invalid user ID or password."
        : err.message || "Could not load your tickets.";
    } finally {
      setViewing(false);
    }
  };

  // the sign-in window
  const handleView = async (event) => {
    event.preventDefault();
    setViewError("");

    const cleanId = viewId.trim();
    if (!cleanId || !viewPassword) {
      setViewError("Enter your user ID and password.");
      return;
    }

    const problem = await loadExistingTickets(cleanId, viewPassword);
    if (problem) {
      setViewError(problem);
    } else {
      setViewPassword("");
      setShowViewModal(false);
    }
  };

  const score = createdTicket?.matchScore;

  return (
    <div className="app">

      <header className="header">
        <div className="brand">Self-Healing Controller</div>

        <div className="header-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            <ArrowLeft size={16} />
            Home
          </button>
        </div>
      </header>

      <div className="user-layout">

        {/* heads-up: submitted tickets are listed at the bottom of the page */}
        {showNotice && (
          <div className="user-notice" role="status">
            <div className="user-notice-icon">
              <BellRing size={18} />
            </div>

            <div className="user-notice-text">
              <strong>Your tickets will be shown at the bottom</strong>
              <span>
                {myTickets.length > 0
                  ? `${myTickets.length} ${
                      myTickets.length === 1 ? "ticket" : "tickets"
                    } raised with your credentials ${
                      myTickets.length === 1 ? "is" : "are"
                    } listed under `
                  : "No tickets found yet. Once you raise one it appears under "}
                <em>My Requests</em> below.
              </span>
            </div>

            <button
              type="button"
              className="user-notice-close"
              aria-label="Dismiss"
              onClick={() => setShowNotice(false)}
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="page-header">
          <div>
            <h1>Register a Complaint</h1>
            <p>
              Enter your credentials and the complaint details. The ticket ID,
              status, match score and time are generated for you.
            </p>
          </div>
        </div>

        {/* returning users: sign in to see tickets raised earlier */}
        <div className="signin-bar">
          {signedInAs ? (
            <span>
              <CheckCircle2 size={16} />
              Signed in as <strong>{signedInAs}</strong>
            </span>
          ) : (
            <>
              <span>
                <strong>Already raised a ticket?</strong> Sign in to view
                your tickets.
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setViewError("");
                  setShowViewModal(true);
                }}
              >
                <LogIn size={16} />
                Sign in
              </button>
            </>
          )}
        </div>

        {/* ---------------- Ask More: questions from the analyst ---------------- */}
        {myTickets
          .filter((t) => t.awaitingAnswers)
          .map((ticket) => (
            <section className="answer-card" key={ticket.ticketUid}>
              <div className="answer-card-head">
                <MessageCircle size={20} />
                <div>
                  <strong>The analyst needs a little more detail</strong>
                  <span>
                    {ticketRef(ticket)} · round {ticket.clarifyRound} of{" "}
                    {ticket.maxRounds || 3}
                  </span>
                </div>
              </div>

              <p className="answer-card-desc">{ticket.description}</p>

              <ClarificationAnswers
                key={`${ticket.ticketUid}:${ticket.clarifyRound}`}
                questions={ticket.pendingQuestions || []}
                onSubmit={(responses) => handleAnswers(ticket, responses)}
              />
            </section>
          ))}

        {Object.entries(answerResult).map(([uid, result]) => (
          <div className="read-only-notice answer-done" key={uid}>
            <CheckCircle2 size={17} />
            <span>
              Thank you. Your answers for{" "}
              <strong>{ticketRef({ ticketUid: uid })}</strong> were checked:
              the match moved from {result.scoreBefore ?? "—"}% to{" "}
              {result.scoreAfter ?? "—"}% (status: {result.status}).{" "}
              {answerOutcome(result)}
            </span>
            <button
              type="button"
              className="user-notice-close"
              aria-label="Dismiss"
              onClick={() =>
                setAnswerResult((prev) => {
                  const next = { ...prev };
                  delete next[uid];
                  return next;
                })
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}

        <div className="user-grid">

          {/* ---------------- complaint form ---------------- */}
          <section className="user-panel">

            <form onSubmit={handleSubmit}>

              {/* credentials - mandatory */}
              <div className="form-block">
                <div className="form-block-title">
                  <ShieldCheck size={16} />
                  Your credentials (required)
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="user-id">User ID *</label>
                    <input
                      id="user-id"
                      type="text"
                      value={userId}
                      placeholder="e.g. user1"
                      autoComplete="username"
                      onChange={(event) => setUserId(event.target.value)}
                      disabled={submitting}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="user-password">Password *</label>
                    <input
                      id="user-password"
                      type="password"
                      value={password}
                      placeholder="Your password"
                      autoComplete="current-password"
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={submitting}
                    />
                  </div>
                </div>

                <p className="form-hint">
                  Checked against the user directory before the ticket is
                  created. Sample accounts: user1 / user2 / user3, password
                  user@123.
                </p>
              </div>

              {/* ticket fields the user fills in */}
              <div className="form-block">
                <div className="form-block-title">
                  <Inbox size={16} />
                  Complaint details
                </div>

                <div className="form-group">
                  <label htmlFor="complaint-department">
                    Department * <span className="field-key">department_id</span>
                  </label>
                  <select
                    id="complaint-department"
                    value={departmentId}
                    onChange={(event) => setDepartmentId(event.target.value)}
                    disabled={submitting}
                  >
                    <option value="">Select the department</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {departmentLabel(dept.name)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="complaint-description">
                    Complaint message *{" "}
                    <span className="field-key">description</span>
                  </label>
                  <textarea
                    id="complaint-description"
                    rows={6}
                    value={description}
                    placeholder="Describe the issue in your own words. Mention an SOP number if you know it."
                    onChange={(event) => setDescription(event.target.value)}
                    disabled={submitting}
                  />
                </div>

                <p className="form-hint">
                  Generated automatically: ticket id (SHA-256), status,
                  match_score, matched_article_id and created_at.
                </p>
              </div>

              {error && <div className="error-message">{error}</div>}

              <button type="submit" className="primary-button" disabled={submitting}>
                <Send size={17} />
                {submitting ? "Registering..." : "Submit complaint"}
              </button>

            </form>

          </section>

          {/* ---------------- generated ticket ---------------- */}
          <section className="user-panel">

            {createdTicket ? (
              <>
                <div className="ticket-created-banner">
                  <CheckCircle2 size={20} />
                  <div>
                    <strong>
                      {fromView ? "Your ticket" : "Ticket generated"}
                    </strong>
                    <span>
                      {createdTicket.status === "New"
                        ? "Logged. The AI match is running now."
                        : bandDescription(score)}
                    </span>
                  </div>
                </div>

                <div className="generated-id">
                  <span>Your ticket ID</span>
                  <strong>{ticketRef(createdTicket)}</strong>
                  <code className="hash-block">{createdTicket.ticketUid}</code>
                  <small>SHA-256, stored in the tickets table</small>
                </div>

                <div className="generated-score">
                  <span>Match percentage</span>
                  {createdTicket.matchScore === null ||
                  createdTicket.matchScore === undefined ? (
                    <strong className="match-score score-pending">
                      {matching ? "Matching..." : "Pending"}
                    </strong>
                  ) : (
                    <strong className={`match-score ${scoreClass(score)}`}>
                      {score}%
                    </strong>
                  )}
                </div>

                {matching && (
                  <div className="matching-strip">
                    <Loader2 size={16} className="spin" />
                    Status is <strong>New</strong> — it updates here the moment
                    the matcher finishes.
                  </div>
                )}

                {/* the row exactly as it is stored in the tickets table */}
                <div className="record-table">
                  <div className="record-row">
                    <span>ticket_uid</span>
                    <strong className="wrap-hash">{createdTicket.ticketUid}</strong>
                  </div>
                  <div className="record-row">
                    <span>department_id</span>
                    <strong>
                      {createdTicket.department_id} ·{" "}
                      {departmentLabel(createdTicket.department)}
                    </strong>
                  </div>
                  <div className="record-row">
                    <span>description</span>
                    <strong>{createdTicket.description}</strong>
                  </div>
                  <div className="record-row">
                    <span>status</span>
                    <strong>
                      <span className={`status-badge ${statusClass(createdTicket.status)}`}>
                        {createdTicket.status}
                      </span>
                    </strong>
                  </div>
                  <div className="record-row">
                    <span>created_at</span>
                    <strong>{formatDateTime(createdTicket.created_at)}</strong>
                  </div>
                  <div className="record-row">
                    <span>match_score</span>
                    <strong>
                      {createdTicket.matchScore === null ||
                      createdTicket.matchScore === undefined
                        ? "—"
                        : `${createdTicket.matchScore}%`}
                    </strong>
                  </div>
                  <div className="record-row">
                    <span>matched_article_id</span>
                    <strong>
                      {createdTicket.matchedArticleId ?? "—"}
                      {createdTicket.matchedArticle
                        ? ` · ${createdTicket.matchedArticle.code}`
                        : ""}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="secondary-button full"
                  onClick={() => {
                    clearInterval(pollRef.current);
                    setMatching(false);
                    setCreatedTicket(null);
                    setFromView(false);
                  }}
                >
                  <RefreshCcw size={16} />
                  Register another complaint
                </button>
              </>
            ) : (
              <div className="empty-state tall">
                <Inbox size={30} />
                <strong>No ticket generated yet</strong>
                <span>
                  Submit the form and your hashed ticket ID and match
                  percentage appear here.
                </span>
              </div>
            )}

          </section>

        </div>


        {/* ---------------- my requests ---------------- */}
        {myTickets.length > 0 && (
          <section className="queue-section" ref={myTicketsRef}>

            <div className="queue-header">
              <div>
                <h2>My Requests</h2>
                <p>Every complaint raised with these credentials.</p>
              </div>

              <div className="ticket-count">{myTickets.length} Tickets</div>
            </div>

            <div className="table-container">
              <table className="ticket-table">
                <thead>
                  <tr>
                    <th>Ticket ID</th>
                    <th>Description</th>
                    <th>Department</th>
                    <th>Match Score</th>
                    <th>Status</th>
                    <th>Raised</th>
                  </tr>
                </thead>

                <tbody>
                  {myTickets.map((ticket) => (
                    <tr
                      key={ticket.ticketUid || ticket.id}
                      className="clickable-row"
                      title="Show this ticket in the panel above"
                      onClick={() => {
                        clearInterval(pollRef.current);
                        setMatching(false);
                        setCreatedTicket(ticket);
                        setFromView(true);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      <td>
                        <span className="ticket-id">{ticketRef(ticket)}</span>
                      </td>
                      <td>
                        <span className="ticket-description">
                          {ticket.description}
                        </span>
                      </td>
                      <td>{departmentLabel(ticket.department)}</td>
                      <td>
                        <span className={`match-score ${scoreClass(ticket.matchScore)}`}>
                          {ticket.matchScore === null ||
                          ticket.matchScore === undefined
                            ? "Pending"
                            : `${ticket.matchScore}%`}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${statusClass(ticket.status)}`}>
                          {ticket.status}
                        </span>
                      </td>
                      <td>{formatDateTime(ticket.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </section>
        )}

      </div>

      {/* ---------------- sign in to view existing tickets ---------------- */}
      {showViewModal && (
        <div className="modal-overlay" onClick={() => !viewing && setShowViewModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>

            <div className="modal-header">
              <div>
                <h2>View my tickets</h2>
                <p>Sign in to see the tickets you have already raised.</p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowViewModal(false)}
                disabled={viewing}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleView}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="view-user-id">User ID</label>
                    <input
                      id="view-user-id"
                      type="text"
                      placeholder="e.g. user1"
                      autoComplete="username"
                      value={viewId}
                      onChange={(event) => setViewId(event.target.value)}
                      disabled={viewing}
                      autoFocus
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="view-password">Password</label>
                    <input
                      id="view-password"
                      type="password"
                      placeholder="Your password"
                      autoComplete="current-password"
                      value={viewPassword}
                      onChange={(event) => setViewPassword(event.target.value)}
                      disabled={viewing}
                    />
                  </div>
                </div>

                {viewError && <div className="error-message">{viewError}</div>}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowViewModal(false)}
                  disabled={viewing}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={viewing}>
                  {viewing ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
                  {viewing ? "Loading..." : "View my tickets"}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}
    </div>
  );
}

export default UserPortal;
