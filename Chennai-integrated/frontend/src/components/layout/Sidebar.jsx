// src/components/layout/Sidebar.jsx

import {
  LayoutDashboard,
  Ticket,
  BarChart3,
  BookOpen,
  ShieldCheck,
  Clock,
} from "lucide-react";

import { can } from "../../auth";

function Sidebar({
  user,
  activeSection,
  onSectionChange,
}) {
  // --------------------------------------------------
  // Main menu
  // --------------------------------------------------

  const mainItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      permission: "dashboard",
    },
    {
      id: "tickets",
      label: "Tickets",
      icon: Ticket,
      permission: "tickets",
    },
    {
      id: "insights",
      label: "Insights",
      icon: BarChart3,
      permission: "insights",
    },
  ];

  // --------------------------------------------------
  // Administration menu
  // --------------------------------------------------

  const adminItems = [
    {
      id: "knowledge-base",
      label: "Knowledge Base",
      icon: BookOpen,
      permission: "knowledgeBase",
    },
    {
      id: "retention",
      label: "Retention Policies",
      icon: Clock,
      permission: "retentionPolicies",
    },
    {
      id: "audit-logs",
      label: "Audit Logs",
      icon: ShieldCheck,
      permission: "auditLogs",
    },
  ];

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <aside className="sidebar">

      {/* ==================================================
          MAIN MENU
      ================================================== */}

      <div className="menu-section">

        <div className="section-title">
          MAIN MENU
        </div>

        {mainItems.map((item) => {
          if (!can(user, item.permission)) {
            return null;
          }

          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${
                activeSection === item.id ? "active" : ""
              }`}
              onClick={() => onSectionChange(item.id)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}

      </div>


      {/* ==================================================
          ADMINISTRATION
      ================================================== */}

      {user?.role === "admin" && (
        <div className="system-menu">

          <div className="section-title">
            ADMINISTRATION
          </div>

          {adminItems.map((item) => {
            if (!can(user, item.permission)) {
              return null;
            }

            const Icon = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${
                  activeSection === item.id
                    ? "active"
                    : ""
                }`}
                onClick={() =>
                  onSectionChange(item.id)
                }
              >
                <Icon size={20} />

                <span>
                  {item.label}
                </span>

              </button>
            );
          })}

        </div>
      )}

    </aside>
  );
}

export default Sidebar;