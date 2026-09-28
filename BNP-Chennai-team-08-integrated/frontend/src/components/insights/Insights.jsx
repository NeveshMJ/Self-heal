
import {
  BarChart3,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Activity,
} from "lucide-react";

function Insights({ ticketList = [] }) {
  const totalTickets = ticketList.length;

  const resolvedTickets = ticketList.filter(
    (ticket) =>
      ticket.status === "Resolved" ||
      ticket.status === "Self-Healed"
  ).length;

  const escalatedTickets = ticketList.filter(
    (ticket) => ticket.status === "Escalated"
  ).length;

  const selfHealReady = ticketList.filter(
    (ticket) => ticket.matchScore === 100
  ).length;

  const averageMatchScore =
    ticketList.length > 0
      ? Math.round(
          ticketList.reduce(
            (total, ticket) =>
              total +
              (Number(ticket.matchScore) || 0),
            0
          ) / ticketList.length
        )
      : 0;

  const resolutionRate =
    totalTickets > 0
      ? Math.round(
          (resolvedTickets / totalTickets) * 100
        )
      : 0;

  return (
    <div className="section-page">

      {/* PAGE HEADER */}

      <div className="page-header">
        <div>
          <h1>Insights</h1>

          <p>
            Monitor ticket trends, AI performance,
            and self-healing activity.
          </p>
        </div>
      </div>


      {/* SUMMARY CARDS */}

      <div className="insights-grid">

        <InsightCard
          icon={<Activity size={21} />}
          title="Total Tickets"
          value={totalTickets}
          description="Tickets processed"
          className="blue"
        />

        <InsightCard
          icon={<CheckCircle2 size={21} />}
          title="Resolution Rate"
          value={`${resolutionRate}%`}
          description="Tickets resolved"
          className="green"
        />

        <InsightCard
          icon={<TrendingUp size={21} />}
          title="AI Match Score"
          value={`${averageMatchScore}%`}
          description="Average confidence"
          className="purple"
        />

        <InsightCard
          icon={<AlertTriangle size={21} />}
          title="Escalated"
          value={escalatedTickets}
          description="Require attention"
          className="red"
        />

      </div>


      {/* TICKET STATUS */}

      <div className="insights-columns">

        <div className="insight-panel">

          <div className="panel-title">
            <BarChart3 size={19} />

            <div>
              <h2>Ticket Status</h2>
              <p>Current ticket distribution</p>
            </div>
          </div>

          <div className="status-bars">

            <StatusBar
              label="New"
              value={countStatus(ticketList, "New")}
              total={totalTickets}
            />

            <StatusBar
              label="Matched"
              value={countStatus(
                ticketList,
                "Matched"
              )}
              total={totalTickets}
            />

            <StatusBar
              label="Self-Heal Ready"
              value={selfHealReady}
              total={totalTickets}
            />

            <StatusBar
              label="Escalated"
              value={escalatedTickets}
              total={totalTickets}
            />

            <StatusBar
              label="Resolved"
              value={resolvedTickets}
              total={totalTickets}
            />

          </div>

        </div>


        {/* AI PERFORMANCE */}

        <div className="insight-panel">

          <div className="panel-title">
            <TrendingUp size={19} />

            <div>
              <h2>AI Performance</h2>
              <p>Knowledge matching performance</p>
            </div>
          </div>

          <div className="performance-list">

            <PerformanceRow
              label="Average Match Score"
              value={`${averageMatchScore}%`}
            />

            <PerformanceRow
              label="100% Confidence Matches"
              value={selfHealReady}
            />

            <PerformanceRow
              label="Tickets Requiring Escalation"
              value={escalatedTickets}
            />

            <PerformanceRow
              label="Resolved Tickets"
              value={resolvedTickets}
            />

          </div>

        </div>

      </div>


      {/* REPORT */}

      <div className="insight-panel">

        <div className="panel-title">

          <BarChart3 size={19} />

          <div>
            <h2>Operational Report</h2>

            <p>
              Current system performance overview.
            </p>
          </div>

        </div>

        <div className="report-grid">

          <ReportItem
            label="Tickets Processed"
            value={totalTickets}
          />

          <ReportItem
            label="Self-Heal Candidates"
            value={selfHealReady}
          />

          <ReportItem
            label="Resolution Rate"
            value={`${resolutionRate}%`}
          />

          <ReportItem
            label="Escalation Count"
            value={escalatedTickets}
          />

        </div>

      </div>

    </div>
  );
}


/* =========================================================
   COMPONENTS
========================================================= */

function InsightCard({
  icon,
  title,
  value,
  description,
  className,
}) {
  return (
    <div className="insight-card">

      <div className={`insight-card-icon ${className}`}>
        {icon}
      </div>

      <div>
        <span>{title}</span>

        <strong>{value}</strong>

        <small>{description}</small>
      </div>

    </div>
  );
}


function StatusBar({
  label,
  value,
  total,
}) {
  const percentage =
    total > 0
      ? Math.round((value / total) * 100)
      : 0;

  return (
    <div className="status-bar-row">

      <div className="status-bar-header">
        <span>{label}</span>

        <strong>
          {value}
        </strong>
      </div>

      <div className="status-bar-track">

        <div
          className="status-bar-fill"
          style={{
            width: `${percentage}%`,
          }}
        />

      </div>

    </div>
  );
}


function PerformanceRow({
  label,
  value,
}) {
  return (
    <div className="performance-row">

      <span>{label}</span>

      <strong>{value}</strong>

    </div>
  );
}


function ReportItem({
  label,
  value,
}) {
  return (
    <div className="report-item">

      <span>{label}</span>

      <strong>{value}</strong>

    </div>
  );
}


/* =========================================================
   HELPERS
========================================================= */

function countStatus(tickets, status) {
  return tickets.filter(
    (ticket) => ticket.status === status
  ).length;
}

export default Insights;

