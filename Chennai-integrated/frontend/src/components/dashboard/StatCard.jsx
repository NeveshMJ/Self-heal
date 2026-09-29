function StatCard({
  icon,
  iconClass,
  label,
  value,
  description,
}) {
  return (
    <div className="stat-card">

      <div className={`stat-icon ${iconClass}`}>
        {icon}
      </div>

      <div className="stat-content">

        <span className="stat-label">
          {label}
        </span>

        <strong>
          {value}
        </strong>

        <span className="stat-description">
          {description}
        </span>

      </div>

    </div>
  );
}

export default StatCard;