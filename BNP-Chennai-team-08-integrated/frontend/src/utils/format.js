// src/utils/format.js
// Small shared display helpers.

// "Corporate_Banking" -> "Corporate Banking"
export function departmentLabel(name) {
  if (!name) return "Unassigned";
  return String(name).replace(/_/g, " ");
}

// "SELF_HEAL" -> "Self Heal"
export function titleCase(value) {
  if (!value) return "";
  return String(value)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Tickets are identified by a SHA-256 hash stored in the tickets table.
// Screens show the short form; the full hash is on the detail panel.
export function ticketRef(ticket) {
  if (!ticket) return "—";

  // a whole ticket object
  if (typeof ticket === "object") {
    if (ticket.ticketRef) return ticket.ticketRef;
    if (ticket.ticketUid) return `TCK-${ticket.ticketUid.slice(0, 10).toUpperCase()}`;
    return ticket.id !== undefined ? `#${ticket.id}` : "—";
  }

  // a bare hash string
  const value = String(ticket);
  if (value.length >= 10 && /^[0-9a-f]+$/i.test(value)) {
    return `TCK-${value.slice(0, 10).toUpperCase()}`;
  }
  return value;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (sameDay) return `Today, ${time}`;

  return `${date.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}, ${time}`;
}

// the confidence band the matcher assigned, described in plain words
export function bandDescription(score) {
  if (score === null || score === undefined) return "Awaiting AI match.";
  if (score >= 100) return "Exact match — eligible for automated self-healing.";
  if (score >= 95) return "High confidence — an analyst can override and apply the fix.";
  if (score >= 81) return "Medium confidence — the analyst will ask you for more detail.";
  return "Low confidence — the ticket is escalated to a human engineer.";
}

export function scoreClass(score) {
  if (score === null || score === undefined) return "score-pending";
  if (score >= 100) return "score-perfect";
  if (score >= 95) return "score-high";
  if (score >= 81) return "score-medium";
  return "score-low";
}

export function statusClass(status) {
  switch (status) {
    case "Self-Heal Ready":
    case "Resolved":
      return "status-self-heal";
    case "Ask More":
      return "status-ask-more";
    case "Escalated":
      return "status-escalated";
    case "New":
      return "status-new";
    default:
      return "status-matched";
  }
}

// canonical departments, so the picker still works on an empty database
export const DEFAULT_DEPARTMENTS = [
  "Corporate_Banking",
  "Data_Center",
  "Insurance",
  "Investment_Banking",
  "Laptop_Assets",
  "Retail_Banking",
];
