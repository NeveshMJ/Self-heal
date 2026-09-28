// src/components/tickets/OverrideModal.jsx
//
// The 95-99% band: the AI is confident but not certain, so a human approves
// the match with a written justification. The note is mandatory and stored on
// the ticket and in the audit trail. When the matched article has a
// remediation script and is not on the exclusion list, the analyst can apply
// that fix as part of the approval.

import { useEffect, useState } from "react";
import {
  X,
  RotateCcw,
  FileText,
  AlertTriangle,
  ShieldCheck,
  Loader2,
} from "lucide-react";

import { getOverrideContext, overrideTicket } from "../../api/ticketApi";
import { departmentLabel, scoreClass, ticketRef } from "../../utils/format";

const NOTE_MIN = 10;
const NOTE_MAX = 250;

function OverrideModal({ ticket, onClose, onDone }) {
  const [context, setContext] = useState(null);
  const [note, setNote] = useState("");
  const [applyFix, setApplyFix] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ticket) return;

    getOverrideContext(ticket.ticketUid || ticket.id)
      .then((data) => setContext(data))
      .catch((err) => {
        console.error("Failed to load override context:", err);
        setError(err.message || "Could not load the ticket.");
      });
  }, [ticket]);

  if (!ticket) return null;

  const article = context?.ticket?.matchedArticle || ticket.matchedArticle;
  const score = context?.ticket?.matchScore ?? ticket.matchScore;
  const canApplyFix = context?.canApplyFix;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const clean = note.trim();
    if (clean.length < NOTE_MIN) {
      setError(`Explain the decision in at least ${NOTE_MIN} characters.`);
      return;
    }

    setSaving(true);
    try {
      const updated = await overrideTicket(
        ticket.ticketUid || ticket.id,
        clean,
        applyFix && canApplyFix
      );
      onDone(updated);
    } catch (err) {
      console.error("Override failed:", err);
      setError(err.message || "Override failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal override-modal" onClick={(e) => e.stopPropagation()}>

        <div className="modal-header">
          <div>
            <h2>Override AI Recommendation</h2>
            <p>
              {ticketRef(ticket)} · {departmentLabel(ticket.department)}
            </p>
          </div>

          <button type="button" className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body override-body">

            {/* why this ticket is in the override band */}
            <div className="override-info">
              <div>
                <span>AI confidence</span>
                <strong className={`match-score ${scoreClass(score)}`}>
                  {score !== null && score !== undefined ? `${score}%` : "—"}
                </strong>
              </div>

              <p>
                Between 95% and 99% the controller will not act on its own. Your
                approval and the note below are recorded against the ticket.
              </p>
            </div>

            {context && !context.eligible && (
              <div className="read-only-notice">
                <AlertTriangle size={16} />
                <span>{context.reason}</span>
              </div>
            )}

            {/* the complaint and what the AI picked */}
            <div className="detail-section">
              <div className="detail-section-title">Complaint</div>
              <div className="ticket-description-large">{ticket.description}</div>
            </div>

            {article && (
              <div className="matched-article">
                <div className="matched-article-head">
                  <div className="article-icon">
                    <FileText size={18} />
                  </div>
                  <div>
                    <strong>{article.title}</strong>
                    <span>
                      {article.code}
                      {article.sop_id ? ` · SOP-${article.sop_id}` : ""}
                    </span>
                  </div>
                </div>
                <p className="matched-article-body">
                  {String(article.body_text || "").slice(0, 300)}
                  {String(article.body_text || "").length > 300 ? "…" : ""}
                </p>
              </div>
            )}

            {/* the justification */}
            <div className="form-group">
              <label htmlFor="override-note">
                Justification note * <span className="field-key">required</span>
              </label>
              <textarea
                id="override-note"
                rows={4}
                value={note}
                maxLength={NOTE_MAX}
                placeholder="Why are you approving this match? e.g. Verified the SOP applies to this account type; approved after checking the change window."
                onChange={(event) => setNote(event.target.value)}
                disabled={saving}
              />
              <div className="char-counter">
                {note.trim().length < NOTE_MIN
                  ? `${NOTE_MIN - note.trim().length} more characters needed`
                  : `${note.length} / ${NOTE_MAX}`}
              </div>
            </div>

            {/* optionally run the remediation */}
            <label
              className={`checkbox-row ${canApplyFix ? "" : "disabled"}`}
            >
              <input
                type="checkbox"
                checked={applyFix && canApplyFix}
                onChange={(event) => setApplyFix(event.target.checked)}
                disabled={saving || !canApplyFix}
              />
              <span>
                Apply the matched remediation now
                {!canApplyFix && context?.blockedReason && (
                  <em className="checkbox-note">{context.blockedReason}</em>
                )}
              </span>
            </label>

            {error && <div className="error-message">{error}</div>}

          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={saving || (context && !context.eligible)}
            >
              {saving ? <Loader2 size={17} className="spin" /> : <RotateCcw size={17} />}
              {saving
                ? "Recording override..."
                : applyFix && canApplyFix
                ? "Approve and apply fix"
                : "Approve override"}
            </button>
          </div>
        </form>

        <div className="override-footnote">
          <ShieldCheck size={14} />
          Recorded in the audit trail with your username, the score and the note.
        </div>

      </div>
    </div>
  );
}

export default OverrideModal;
