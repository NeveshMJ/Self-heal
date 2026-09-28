// src/components/admin/AuditLogs.jsx
//
// Real audit trail from the backend. Clicking any row opens the full record
// for that event: who did it, which ticket it touched, the raw details the
// engine recorded, and the ticket hash at that moment.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Search,
  Filter,
  User,
  Activity,
  Clock,
  X,
  Hash,
  FileText,
  RefreshCcw,
} from "lucide-react";

import { getAuditLog, getAuditLogs } from "../../api/ticketApi";
import {
  departmentLabel,
  formatDateTime,
  scoreClass,
  statusClass,
  ticketRef,
  titleCase,
} from "../../utils/format";

function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  // the event opened in the detail drawer
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchLogs = useCallback(() => {
    return getAuditLogs()
      .then((rows) => {
        setLogs(rows || []);
        setLoadError("");
      })
      .catch((err) => {
        console.error("Failed to load audit logs:", err);
        setLoadError(err.message || "Could not load the audit trail.");
      })
      .finally(() => setLoading(false));
  }, []);

  // first load
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // manual refresh from the toolbar
  const load = () => {
    setLoading(true);
    setLoadError("");
    fetchLogs();
  };

  const openLog = async (log) => {
    // show what we already have straight away, then enrich it
    setSelected(log);
    setDetailLoading(true);
    try {
      const full = await getAuditLog(log.audit_id ?? log.id);
      setSelected(full);
    } catch (err) {
      console.error("Failed to load audit detail:", err);
    } finally {
      setDetailLoading(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return logs.filter((log) => {
      const matchesSearch =
        !needle ||
        [log.user, log.action, log.resource, log.details, log.department]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));

      const matchesFilter =
        actionFilter === "all" || log.type === actionFilter;

      return matchesSearch && matchesFilter;
    });
  }, [logs, search, actionFilter]);

  return (
    <div className="section-page">

      <div className="page-header">
        <div>
          <h1>Audit Logs</h1>
          <p>Review activity across the Self-Healing Controller.</p>
        </div>

        <div className="audit-summary">
          <ShieldCheck size={18} />
          <span>{logs.length} events</span>

          <button type="button" className="ghost-button" onClick={load}>
            <RefreshCcw size={15} />
            Refresh
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="audit-toolbar">

        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="filter-box">
          <Filter size={17} />
          <select
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
          >
            <option value="all">All Activity</option>
            <option value="authentication">Authentication</option>
            <option value="ticket">Ticket Actions</option>
            <option value="dataset">Dataset</option>
            <option value="configuration">Configuration</option>
          </select>
        </div>

      </div>

      {loadError && <div className="error-message">{loadError}</div>}

      {/* LOG TABLE */}
      <div className="audit-panel">
        <div className="audit-table-wrapper">

          <table className="audit-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Details</th>
                <th>Time</th>
              </tr>
            </thead>

            <tbody>
              {filteredLogs.map((log) => (
                <tr
                  key={log.audit_id ?? log.id}
                  className="clickable-row"
                  onClick={() => openLog(log)}
                >
                  <td>
                    <span className="audit-id">#{log.audit_id ?? log.id}</span>
                  </td>

                  <td>
                    <div className="audit-user">
                      <div className="audit-user-icon">
                        <User size={15} />
                      </div>
                      <strong>{log.user}</strong>
                    </div>
                  </td>

                  <td>
                    <span className={`audit-action audit-${log.type}`}>
                      {titleCase(log.action)}
                    </span>
                  </td>

                  <td>
                    <span className="audit-resource">{log.resource}</span>
                  </td>

                  <td>
                    <span className="audit-details">{log.details}</span>
                  </td>

                  <td>
                    <div className="audit-time">
                      <Clock size={14} />
                      {formatDateTime(log.timestamp)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && filteredLogs.length === 0 && (
            <div className="empty-state">
              <Activity size={30} />
              <strong>No audit events found</strong>
              <span>
                {logs.length === 0
                  ? "Activity appears here as soon as tickets are raised and acted on."
                  : "Try changing your search or filter."}
              </span>
            </div>
          )}

          {loading && (
            <div className="empty-state">
              <Activity size={30} />
              <strong>Loading audit trail...</strong>
            </div>
          )}

        </div>
      </div>

      {selected && (
        <AuditDetail
          log={selected}
          loading={detailLoading}
          onClose={() => setSelected(null)}
        />
      )}

    </div>
  );
}

/* =========================================================
   DETAIL DRAWER
========================================================= */

function AuditDetail({ log, loading, onClose }) {
  const details = log.detailsJson || {};
  const ticket = log.ticket;

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div
        className="ticket-detail-panel"
        onClick={(event) => event.stopPropagation()}
      >

        <div className="detail-header">
          <div>
            <div className="detail-ticket-id">
              Event #{log.audit_id ?? log.id}
            </div>
            <h2>{titleCase(log.action)}</h2>
          </div>

          <button type="button" className="detail-close" onClick={onClose}>
            <X size={21} />
          </button>
        </div>

        <div className="detail-body">

          <div className="detail-section">
            <div className="detail-section-title">What happened</div>
            <div className="ticket-description-large">{log.details}</div>
          </div>

          <div className="detail-grid">

            <div className="detail-field">
              <span className="detail-label">Performed by</span>
              <strong>
                {log.user}
                {log.role ? ` (${titleCase(log.role)})` : ""}
              </strong>
            </div>

            <div className="detail-field">
              <span className="detail-label">Category</span>
              <strong>{titleCase(log.type)}</strong>
            </div>

            <div className="detail-field">
              <span className="detail-label">Resource</span>
              <strong>{log.resource || ticketRef(log.ticketUid)}</strong>
            </div>

            <div className="detail-field">
              <span className="detail-label">Department</span>
              <strong>{departmentLabel(log.department)}</strong>
            </div>

            <div className="detail-field">
              <span className="detail-label">Timestamp</span>
              <strong>{formatDateTime(log.timestamp)}</strong>
            </div>

            <div className="detail-field">
              <span className="detail-label">User ID</span>
              <strong>{log.user_id}</strong>
            </div>

          </div>

          {/* raw engine details */}
          {Object.keys(details).length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title">Recorded details</div>

              <div className="record-table">
                {Object.entries(details).map(([key, value]) => (
                  <div className="record-row" key={key}>
                    <span>{key}</span>
                    <strong>
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* the ticket this event touched */}
          {loading && !ticket && (
            <div className="read-only-notice">
              <span>Loading the full record...</span>
            </div>
          )}

          {ticket && (
            <div className="detail-section">
              <div className="detail-section-title">
                <FileText size={15} /> Ticket {ticketRef(ticket)}
              </div>

              <div className="ticket-description-large">
                {ticket.description}
              </div>

              <div className="detail-grid" style={{ marginTop: 14 }}>

                <div className="detail-field">
                  <span className="detail-label">Status</span>
                  <span className={`status-badge ${statusClass(ticket.status)}`}>
                    {ticket.status}
                  </span>
                </div>

                <div className="detail-field">
                  <span className="detail-label">Match score</span>
                  <span className={`match-score ${scoreClass(ticket.match_score)}`}>
                    {ticket.match_score === null || ticket.match_score === undefined
                      ? "Pending"
                      : `${ticket.match_score}%`}
                  </span>
                </div>

                <div className="detail-field">
                  <span className="detail-label">Band</span>
                  <strong>{titleCase(ticket.match_band) || "—"}</strong>
                </div>

                <div className="detail-field">
                  <span className="detail-label">Matched article</span>
                  <strong>{ticket.matched_article_id ?? "—"}</strong>
                </div>

                <div className="detail-field">
                  <span className="detail-label">Raised</span>
                  <strong>{formatDateTime(ticket.created_at)}</strong>
                </div>

                <div className="detail-field">
                  <span className="detail-label">Clarification rounds</span>
                  <strong>{ticket.clarify_round ?? 0}</strong>
                </div>

              </div>

              {ticket.override_note && (
                <div className="read-only-notice" style={{ marginTop: 14 }}>
                  <span>
                    <strong>Override note: </strong>
                    {ticket.override_note}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* integrity hash */}
          <div className="detail-section">
            <div className="detail-section-title">
              <Hash size={15} /> Integrity hash
            </div>
            <code className="hash-block">{log.ticket_hash}</code>
            <p className="hash-note">
              SHA-256 of the ticket at the moment this event was recorded.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

export default AuditLogs;
