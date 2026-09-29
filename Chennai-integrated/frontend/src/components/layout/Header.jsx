import {
  Bell,
  ChevronDown,
} from "lucide-react";

import {
  getRoleLabel,
} from "../../auth";

function Header({ user, onLogout }) {
  return (
    <header className="header">

      <div className="brand">
        Self-Healing Controller
      </div>

      <div className="header-actions">

        <button className="icon-button">
          <Bell size={21} />
        </button>

        <div className="user-menu">

          <div className="avatar">
            {user?.username?.charAt(0).toUpperCase()}
          </div>

          <div className="user-details">
            <span className="user-name">
              {user?.username}
            </span>

            <span className="user-role">
              {getRoleLabel(user?.role)}
            </span>
          </div>

          <ChevronDown size={17} />

          <button
            className="logout-button"
            onClick={onLogout}
          >
            Logout
          </button>

        </div>

      </div>

    </header>
  );
}

export default Header;