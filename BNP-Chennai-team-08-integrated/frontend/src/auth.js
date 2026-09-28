// src/auth.js

// Only two accounts can sign in to the workspace:
//     admin   / admin@123
//     analyst / analyst@123
// End users never reach this workspace - they use the public User portal,
// which verifies their id + password when a complaint is raised. Their
// internal role string stays "viewer" so the backend/JWT keep working.
export const ROLES = {
  ADMIN: "admin",
  ANALYST: "analyst",
  USER: "viewer", // shown as "User"
};

export const PERMISSIONS = {
  [ROLES.ADMIN]: {
    dashboard: true,
    insights: true,
    tickets: true,

    knowledgeBase: true,
    retentionPolicies: true,
    auditLogs: true,

    selfHeal: true,   // admin can also act
    override: true,
    createTicket: false,
  },

  [ROLES.ANALYST]: {
    dashboard: true,
    insights: true,
    tickets: true,

    knowledgeBase: false,
    retentionPolicies: false,
    auditLogs: false,

    selfHeal: true,
    override: true,
    createTicket: false,
  },

  [ROLES.USER]: {
    dashboard: true,
    insights: false,
    tickets: false,        // cannot see the analyst queue

    knowledgeBase: false,
    retentionPolicies: false,
    auditLogs: false,

    selfHeal: false,
    override: false,
    createTicket: true,     // raises complaints from the public User portal
  },
};

export function can(user, permission) {
  if (!user || !user.role) {
    return false;
  }
  return PERMISSIONS[user.role]?.[permission] === true;
}

export function getRoleLabel(role) {
  switch (role) {
    case ROLES.ADMIN:
      return "Admin";
    case ROLES.ANALYST:
      return "Analyst";
    case ROLES.USER:       // "viewer" internally
      return "User";
    default:
      return "Unknown";
  }
}
