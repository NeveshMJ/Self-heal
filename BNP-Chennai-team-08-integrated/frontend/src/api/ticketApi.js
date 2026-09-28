// src/api/ticketApi.js
import { apiRequest } from "./client";

export function getTickets() {
  return apiRequest("/tickets");
}

// accepts the SHA-256 ticket hash (or the internal id) and returns the full
// record, including how the AI match was made
export function getTicket(ref, token) {
  return apiRequest(`/tickets/${ref}`, token ? { token } : {});
}

// `token` is optional: the User portal passes the token it got when the
// complainant's id + password were verified.
export function getMyTickets(token) {
  return apiRequest("/tickets/mine/list", token ? { token } : {});
}

export function selfHealTicket(ref) {
  return apiRequest(`/tickets/${ref}/self-heal`, { method: "POST" });
}

// what the analyst needs before approving a 95-99% match
export function getOverrideContext(ref) {
  return apiRequest(`/tickets/${ref}/override-context`);
}

// 95-99% path: mandatory justification note, optionally applying the
// matched article's remediation as part of the approval
export function overrideTicket(ref, note, applyFix = false) {
  return apiRequest(`/tickets/${ref}/override`, {
    method: "POST",
    body: JSON.stringify({ note, apply_fix: applyFix }),
  });
}

// ask more -> the fine-tuned T5 writes up to 3 questions and the ticket waits
// for answers (81-94% path)
export function askMoreTicket(ref) {
  return apiRequest(`/tickets/${ref}/ask-more`, { method: "POST" });
}

// answer the open Ask More round -> re-matches and returns the updated
// ticket plus `result` (score before/after). `responses` is one answer per
// question. `token` is passed by the User portal (the complainant); staff
// answering on the user's behalf use their own session.
export function submitAnswers(ref, responses, token) {
  const body = Array.isArray(responses)
    ? { responses }
    : { answers: responses };
  return apiRequest(`/tickets/${ref}/answers`, {
    method: "POST",
    body: JSON.stringify(body),
    ...(token ? { token } : {}),
  });
}

export function escalateTicket(ref) {
  return apiRequest(`/tickets/${ref}/escalate`, { method: "POST" });
}

// create a ticket (runs the matcher immediately, returns id + score + band)
export function createTicket(departmentId, description, token) {
  return apiRequest("/tickets", {
    method: "POST",
    body: JSON.stringify({ department_id: departmentId, description }),
    ...(token ? { token } : {}),
  });
}

export function getDepartments(token) {
  return apiRequest("/departments", token ? { token } : {});
}

// no login needed - used by the public complaint form
export function getPublicDepartments() {
  return apiRequest("/departments/public");
}

// admin: audit trail
export function getAuditLogs() {
  return apiRequest("/admin/audit-logs");
}

export function getAuditLog(auditId) {
  return apiRequest(`/admin/audit-logs/${auditId}`);
}
