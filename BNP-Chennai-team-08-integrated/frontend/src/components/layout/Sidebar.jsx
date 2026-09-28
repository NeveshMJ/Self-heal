// src/components/layout/Sidebar.jsx

import { useEffect, useState } from "react";

import {
  LayoutDashboard,
  Ticket,
  BarChart3,
  BookOpen,
  ShieldCheck,
  Clock,
  Building2,
  ChevronDown,
} from "lucide-react";

import { can } from "../../auth";
import {
  DEFAULT_DEPARTMENTS,
  departmentLabel,
} from "../../utils/format";

function Sidebar({
  user,
  activeSection,
  onSectionChange,
  onDepartmentSelect,
  selectedDepartment,
}) {
  // --------------------------------------------------
  // Department dropdown state
  // --------------------------------------------------

  const [departmentsOpen, setDepartmentsOpen] = useState(
    Boolean(selectedDepartment)
  );

  // If a department is selected from elsewhere in the application,
  // automatically open the dropdown so the selected department is visible.
  useEffect(() => {
    if (selectedDepartment) {
      setDepartmentsOpen(true);
    }
  }, [selectedDepartment]);

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
  // Department selection
  // --------------------------------------------------

  const handleDepartmentSelect = (department) => {
    // Pass the selected department to the parent, which also opens the
    // Tickets section (one step, so it is one browser-history entry).
    if (onDepartmentSelect) {
      onDepartmentSelect(department);
    } else {
      onSectionChange("tickets");
    }
  };

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
          DEPARTMENTS
      ================================================== */}

      {user?.role === "admin" && (
        <div className="department-sidebar-section">

          {/* Department dropdown button */}

          <button
            type="button"
            className={`nav-item department-dropdown ${
              activeSection === "tickets" ? "active" : ""
            }`}
            onClick={() =>
              setDepartmentsOpen((open) => !open)
            }
            aria-expanded={departmentsOpen}
            aria-controls="department-dropdown-menu"
          >

            <Building2 size={20} />

            <span>
              Departments
            </span>

            <ChevronDown
              size={18}
              className={`department-chevron ${
                departmentsOpen ? "open" : ""
              }`}
            />

          </button>


          {/* Department options */}

          {departmentsOpen && (
            <div
              id="department-dropdown-menu"
              className="department-dropdown-menu"
            >

              {/* ------------------------------------------
                  ALL DEPARTMENTS
              ------------------------------------------ */}

              <button
                type="button"
                className={`nav-item department-nav-item ${
                  activeSection === "tickets" &&
                  !selectedDepartment
                    ? "active"
                    : ""
                }`}
                onClick={() =>
                  handleDepartmentSelect(null)
                }
              >

                <Building2 size={17} />

                <span>
                  All Departments
                </span>

              </button>


              {/* ------------------------------------------
                  INDIVIDUAL DEPARTMENTS
              ------------------------------------------ */}

              {DEFAULT_DEPARTMENTS.map((department) => (
                <button
                  key={department}
                  type="button"
                  className={`nav-item department-nav-item ${
                    activeSection === "tickets" &&
                    selectedDepartment === department
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    handleDepartmentSelect(department)
                  }
                  title={departmentLabel(department)}
                >

                  <Building2 size={17} />

                  <span>
                    {departmentLabel(department)}
                  </span>

                </button>
              ))}

            </div>
          )}

        </div>
      )}


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