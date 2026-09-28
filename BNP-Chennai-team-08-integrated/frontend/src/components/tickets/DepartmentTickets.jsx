// src/components/tickets/DepartmentTickets.jsx
//
// The "Tickets" section for admin and analyst.
// Clicking Tickets shows the departments first; clicking a department shows
// only the tickets belonging to it.

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ArrowLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock3,
} from "lucide-react";

import TicketQueue from "./TicketQueue";
import { DEFAULT_DEPARTMENTS, departmentLabel } from "../../utils/format";

function DepartmentTickets({ ticketList, user, onSelectTicket, selectedDepartment = null }) {
  const [openDepartment, setOpenDepartment] = useState(selectedDepartment);

  useEffect(() => {
    setOpenDepartment(selectedDepartment);
  }, [selectedDepartment]);

  // one card per department: every canonical department plus anything else
  // that actually appears on a ticket
  const departments = useMemo(() => {
    const names = new Set(DEFAULT_DEPARTMENTS);
    ticketList.forEach((ticket) => {
      if (ticket.department) names.add(ticket.department);
    });

    return [...names].sort().map((name) => {
      const tickets = ticketList.filter((t) => t.department === name);
      return {
        name,
        total: tickets.length,
        escalated: tickets.filter((t) => t.status === "Escalated").length,
        resolved: tickets.filter(
          (t) => t.status === "Resolved" || t.status === "Overridden"
        ).length,
        pending: tickets.filter(
          (t) =>
            t.status !== "Resolved" &&
            t.status !== "Overridden" &&
            t.status !== "Escalated"
        ).length,
      };
    });
  }, [ticketList]);

  // ---------------- department detail ----------------
  if (openDepartment) {
    const tickets = ticketList.filter((t) => t.department === openDepartment);

    return (
      <>
        <div className="page-header">
          <div>
            <button
              type="button"
              className="back-link"
              onClick={() => setOpenDepartment(null)}
            >
              <ArrowLeft size={16} />
              All departments
            </button>

            <h1>{departmentLabel(openDepartment)}</h1>
            <p>Tickets raised against this department.</p>
          </div>
        </div>

        {tickets.length === 0 ? (
          <div className="empty-state tall">
            <Building2 size={30} />
            <strong>No tickets in this department</strong>
            <span>
              Nothing has been raised against{" "}
              {departmentLabel(openDepartment)} yet.
            </span>
          </div>
        ) : (
          <TicketQueue
            ticketList={tickets}
            user={user}
            onSelectTicket={onSelectTicket}
            title={departmentLabel(openDepartment)}
            subtitle="Review the AI match and take action on each ticket."
          />
        )}
      </>
    );
  }

  // ---------------- department list ----------------
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Tickets</h1>
          <p>Select a department to review its tickets.</p>
        </div>
      </div>

      <div className="department-grid">
        {departments.map((dept) => (
          <button
            key={dept.name}
            type="button"
            className="department-card"
            onClick={() => setOpenDepartment(dept.name)}
          >
            <div className="department-card-head">
              <div className="department-icon">
                <Building2 size={20} />
              </div>

              <div>
                <strong>{departmentLabel(dept.name)}</strong>
                <span>
                  {dept.total} {dept.total === 1 ? "ticket" : "tickets"}
                </span>
              </div>

              <ChevronRight size={18} className="department-chevron" />
            </div>

            <div className="department-stats">
              <span className="dept-stat pending">
                <Clock3 size={14} />
                {dept.pending} open
              </span>

              <span className="dept-stat resolved">
                <CheckCircle2 size={14} />
                {dept.resolved} closed
              </span>

              <span className="dept-stat escalated">
                <AlertTriangle size={14} />
                {dept.escalated} escalated
              </span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

export default DepartmentTickets;
