import {
  Database,
  AlertCircle,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";

import StatCard from "./StatCard";

function StatsGrid({ ticketList }) {

  const totalTickets = ticketList.length;

  const newTickets = ticketList.filter(
    (ticket) => ticket.status === "New"
  ).length;

  const selfHealReady = ticketList.filter(
    (ticket) =>
      ticket.matchScore === 100 &&
      ticket.status !== "Escalated"
  ).length;

  const escalated = ticketList.filter(
    (ticket) => ticket.status === "Escalated"
  ).length;

  return (
    <div className="stats-grid">

      <StatCard
        icon={<Database size={22} />}
        iconClass="blue"
        label="Total Tickets"
        value={totalTickets}
        description="Active support tickets"
      />

      <StatCard
        icon={<AlertCircle size={22} />}
        iconClass="amber"
        label="New Tickets"
        value={newTickets}
        description="Awaiting analysis"
      />

      <StatCard
        icon={<ShieldCheck size={22} />}
        iconClass="green"
        label="Self-Heal Ready"
        value={selfHealReady}
        description="100% confidence"
      />

      <StatCard
        icon={<ArrowUpRight size={22} />}
        iconClass="red"
        label="Escalated"
        value={escalated}
        description="Require attention"
      />

    </div>
  );
}

export default StatsGrid;