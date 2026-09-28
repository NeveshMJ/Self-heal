import { can } from "../../auth";

function RoleGuard({
  user,
  permission,
  children,
}) {
  if (!can(user, permission)) {
    return null;
  }

  return children;
}

export default RoleGuard;