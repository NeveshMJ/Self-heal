// src/components/tickets/TicketQueue.jsx

import { scoreClass, statusClass, departmentLabel, ticketRef } from "../../utils/format";

function TicketQueue({
  ticketList,
  onSelectTicket,
  title = "Ticket Queue",
  subtitle = "Review incoming IT support tickets.",
}) {
  return (
    <section className="queue-section">

      <div className="queue-header">

        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>

        <div className="ticket-count">
          {ticketList.length} {ticketList.length === 1 ? "Ticket" : "Tickets"}
        </div>

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
              <th>Action</th>
            </tr>
          </thead>

          <tbody>

            {ticketList.map((ticket) => (

              <tr key={ticket.id}>

                <td>
                  <span className="ticket-id">
                    {ticketRef(ticket)}
                  </span>
                </td>

                <td>
                  <span className="ticket-description">
                    {ticket.description}
                  </span>
                </td>

                <td>
                  {departmentLabel(ticket.department)}
                </td>

                <td>
                  {ticket.matchScore === null || ticket.matchScore === undefined ? (
                    <span className="match-score score-pending">
                      Pending
                    </span>
                  ) : (
                    <span className={`match-score ${scoreClass(ticket.matchScore)}`}>
                      {ticket.matchScore}%
                    </span>
                  )}
                </td>

                <td>
                  <div className="status-cell">

                    {ticket.status === "New" && (
                      <span className="new-indicator" />
                    )}

                    <span className={`status-badge ${statusClass(ticket.status)}`}>
                      {ticket.status}
                    </span>

                  </div>
                </td>

                <td>
                  <button
                    className="view-button"
                    onClick={() => onSelectTicket(ticket)}
                  >
                    View
                  </button>
                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </section>
  );
}

export default TicketQueue;
