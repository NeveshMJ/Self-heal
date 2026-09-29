
import { useState } from "react";

import {
  Clock,
  Save,
  Database,
  FileText,
  Activity,
} from "lucide-react";

function RetentionPolicies() {

  const [ticketRetention, setTicketRetention] =
    useState(365);

  const [auditRetention, setAuditRetention] =
    useState(730);

  const [datasetRetention, setDatasetRetention] =
    useState(180);

  const [saved, setSaved] =
    useState(false);

  const handleSave = () => {
    const policies = {
      ticketRetention,
      auditRetention,
      datasetRetention,
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(
      "retentionPolicies",
      JSON.stringify(policies)
    );

    setSaved(true);

    setTimeout(() => {
      setSaved(false);
    }, 2500);
  };

  return (
    <div className="section-page">

      <div className="page-header">

        <div>
          <h1>Retention Policies</h1>

          <p>
            Configure how long system data is retained.
          </p>
        </div>

        <button
          type="button"
          className="primary-small-button"
          onClick={handleSave}
        >
          <Save size={16} />
          Save Policies
        </button>

      </div>


      {saved && (
        <div className="success-message">

          Policies saved successfully.

        </div>
      )}


      <div className="retention-list">

        {/* TICKETS */}

        <RetentionCard
          icon={<FileText size={21} />}
          title="Ticket Data"
          description="How long resolved and closed tickets are retained."
          value={ticketRetention}
          onChange={setTicketRetention}
        />


        {/* AUDIT */}

        <RetentionCard
          icon={<Activity size={21} />}
          title="Audit Logs"
          description="How long system audit events are retained."
          value={auditRetention}
          onChange={setAuditRetention}
        />


        {/* DATASETS */}

        <RetentionCard
          icon={<Database size={21} />}
          title="Uploaded Datasets"
          description="How long uploaded datasets are retained."
          value={datasetRetention}
          onChange={setDatasetRetention}
        />

      </div>


      <div className="retention-note">

        <Clock size={18} />

        <div>

          <strong>
            Retention policy note
          </strong>

          <p>
            These settings define the intended retention
            period. Actual deletion should be performed
            by the backend data-retention service.
          </p>

        </div>

      </div>

    </div>
  );
}


function RetentionCard({
  icon,
  title,
  description,
  value,
  onChange,
}) {
  return (
    <div className="retention-card">

      <div className="retention-icon">
        {icon}
      </div>

      <div className="retention-info">

        <h2>{title}</h2>

        <p>{description}</p>

      </div>

      <div className="retention-control">

        <input
          type="number"
          min="1"
          value={value}
          onChange={(event) =>
            onChange(
              Number(event.target.value)
            )
          }
        />

        <span>
          days
        </span>

      </div>

    </div>
  );
}

export default RetentionPolicies;
