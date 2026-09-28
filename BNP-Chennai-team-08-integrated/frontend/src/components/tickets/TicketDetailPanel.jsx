// src/components/tickets/TicketDetailPanel.jsx
//
// Full ticket view for admin / analyst, including HOW the AI reached its
// match: the matched knowledge-base article, the confidence band, and the
// individual article sentences that scored highest against the complaint.

import {
  X,
  ShieldCheck,
  AlertTriangle,
  MessageCircle,
  RotateCcw,
  ArrowUpRight,
  Sparkles,
  FileText,
  Loader2,
} from "lucide-react";

import { can } from "../../auth";
import {
  departmentLabel,
  formatDateTime,
  scoreClass,
  statusClass,
  ticketRef,
  titleCase,
} from "../../utils/format";

function TicketDetailPanel({
  ticket,
  user,
  loading,
  healing = false,
  onClose,
  onSelfHeal,
  onOverride,
  onAskMore,
  onAnswerForUser,
  onEscalate,
}) {
  if (!ticket) {
    return null;
  }

  const score = ticket.matchScore;
  const isClosed =
    ticket.status === "Resolved" ||
    ticket.status === "Overridden" ||
    ticket.status === "Escalated";

  const hasScore = score !== null && score !== undefined;

  // score-driven actions (only while the ticket is open)
  const canSelfHeal = can(user, "selfHeal") && !isClosed && score === 100;
  const canOverride =
    can(user, "override") && !isClosed && hasScore && score >= 95 && score < 100;
  // Ask More: a round is open while its questions wait for answers
  const awaiting = Boolean(ticket.awaitingAnswers);
  const roundsLeft = (ticket.clarifyRound || 0) < (ticket.maxRounds || 3);
  const canAskMore =
    can(user, "override") && !isClosed && hasScore && score >= 81 && score < 95 &&
    !awaiting && roundsLeft;
  const canEscalate =
    can(user, "override") && !isClosed && hasScore &&
    (score < 81 || (score < 95 && !roundsLeft && !awaiting));

  const article = ticket.matchedArticle;
  const sentences = ticket.topSentences || [];

  // the open round is shown in its own "waiting" block, not in the history
  const history = (ticket.clarifications || []).filter(
    (round) => !(awaiting && round.round === ticket.clarifyRound && !round.answers)
  );

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div
        className="ticket-detail-panel"
        onClick={(event) => event.stopPropagation()}
      >

        {/* ================= HEADER ================= */}

        <div className="detail-header">
          <div>
            <div className="detail-ticket-id">{ticketRef(ticket)}</div>
            <h2>Ticket Details</h2>
          </div>

          <button
            type="button"
            className="detail-close"
            onClick={onClose}
            disabled={healing}
          >
            <X size={21} />
          </button>
        </div>

        <div className="detail-body">

          {/* ================= COMPLAINT ================= */}

          <div className="detail-section">
            <div className="detail-section-title">Complaint</div>
            <div className="ticket-description-large">{ticket.description}</div>
          </div>

          <div className="detail-grid">

            <div className="detail-field">
              <span className="detail-label">Department</span>
              <strong>{departmentLabel(ticket.department)}</strong>
            </div>

            <div className="detail-field">
              <span className="detail-label">Status</span>
              <span className={`status-badge ${statusClass(ticket.status)}`}>
                {ticket.status || "Unknown"}
              </span>
            </div>

            <div className="detail-field">
              <span className="detail-label">AI Match Score</span>
              <span className={`match-score ${scoreClass(score)}`}>
                {hasScore ? `${score}%` : "Pending"}
              </span>
            </div>

            <div className="detail-field">
              <span className="detail-label">Confidence Band</span>
              <strong>{titleCase(ticket.band) || "—"}</strong>
            </div>

            <div className="detail-field">
              <span className="detail-label">Cosine Similarity</span>
              <strong>{ticket.cosine ?? "—"}</strong>
            </div>

            <div className="detail-field">
              <span className="detail-label">Raised</span>
              <strong>{formatDateTime(ticket.created_at)}</strong>
            </div>

          </div>

          {/* ================= HOW THE MATCH WAS MADE ================= */}

          <div className="detail-section">
            <div className="detail-section-title">
              <Sparkles size={15} /> How this was matched
            </div>

            {loading && sentences.length === 0 && (
              <div className="matching-strip">
                <Loader2 size={16} className="spin" />
                Loading the match explanation...
              </div>
            )}

            {/* the rule that produced the score */}
            {ticket.matchReason && (
              <div className="match-reason">
                {ticket.matchReason === "sop_exact" ? (
                  <>
                    <strong>Exact SOP rule.</strong> The complaint names an SOP
                    number that maps to exactly one article in this department,
                    so the score is forced to 100%.
                  </>
                ) : ticket.matchReason === "no_articles" ? (
                  <>
                    <strong>No knowledge base.</strong> This department has no
                    embedded articles, so nothing could be matched. Run
                    load_and_embed.py.
                  </>
                ) : (
                  <>
                    <strong>Semantic similarity.</strong> The complaint was
                    embedded with all-mpnet-base-v2 and compared against every
                    article sentence in this department. The best cosine
                    similarity became the score.
                  </>
                )}
              </div>
            )}

            {/* the matched article */}
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
                  {String(article.body_text || "").slice(0, 420)}
                  {String(article.body_text || "").length > 420 ? "…" : ""}
                </p>

                {article.no_auto_execute && (
                  <div className="read-only-notice">
                    <AlertTriangle size={16} />
                    <span>
                      This article is on the exclusion list, so automated
                      self-healing is blocked for it.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* the sentences that scored highest */}
            {sentences.length > 0 && (
              <div className="evidence-list">
                <div className="evidence-title">
                  Top matching sentences
                </div>

                {sentences.map((sentence, index) => (
                  <div className="evidence-row" key={index}>
                    <div className="evidence-head">
                      <span className="evidence-rank">#{index + 1}</span>
                      <span className="evidence-code">
                        {sentence.article_code}
                      </span>
                      <span className={`match-score ${scoreClass(sentence.score)}`}>
                        {sentence.score}%
                      </span>
                    </div>

                    <p className="evidence-text">{sentence.text}</p>

                    {sentence.shared_words && sentence.shared_words.length > 0 && (
                      <div className="shared-words">
                        {sentence.shared_words.slice(0, 10).map((word) => (
                          <span className="shared-word" key={word}>
                            {word}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ================= ASK MORE: waiting for answers ================= */}

          {awaiting && (
            <div className="detail-section ask-more-waiting">
              <div className="detail-section-title">
                <MessageCircle size={15} /> Ask More: waiting for the user's
                answers (round {ticket.clarifyRound} of {ticket.maxRounds || 3})
              </div>

              <ol className="ask-more-questions">
                {(ticket.pendingQuestions || []).map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ol>

              <p className="form-hint">
                The user sees these questions in the User portal. When they
                answer, the ticket is scored again and its status updates on
                its own.
              </p>

              {can(user, "override") && (
                <button
                  type="button"
                  className="detail-action secondary"
                  onClick={() => onAnswerForUser && onAnswerForUser(ticket)}
                >
                  <MessageCircle size={17} />
                  Answer on the user's behalf
                </button>
              )}
            </div>
          )}

          {/* ================= CLARIFICATION HISTORY ================= */}

          {history.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title">
                <MessageCircle size={15} /> Clarification rounds
              </div>

              {history.map((round) => (
                <div className="evidence-row" key={round.round}>
                  <div className="evidence-head">
                    <span className="evidence-rank">Round {round.round}</span>
                    <span className="evidence-code">
                      {round.score_before ?? "—"}% → {round.score_after ?? "—"}%
                    </span>
                  </div>

                  <ul className="question-list">
                    {round.questions.map((question, i) => (
                      <li key={i}>{question}</li>
                    ))}
                  </ul>

                  {round.answers && (
                    <p className="evidence-text">
                      Answer
                      {round.answeredBy === "user"
                        ? " (from the user)"
                        : round.answeredBy
                        ? ` (by ${round.answeredBy})`
                        : ""}
                      : {round.answers}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ================= OVERRIDE NOTE ================= */}

          {ticket.overrideNote && (
            <div className="read-only-notice">
              <span>
                <strong>Override note: </strong>
                {ticket.overrideNote}
              </span>
            </div>
          )}

          {/* ================= ACTIONS ================= */}

          <div className="detail-actions">

            {canSelfHeal && (
              <button
                type="button"
                className="detail-action primary"
                disabled={healing}
                onClick={() => onSelfHeal && onSelfHeal(ticket)}
              >
                {healing ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <ShieldCheck size={17} />
                )}
                {healing ? "Running self-heal..." : "Self-Heal"}
              </button>
            )}

            {canOverride && (
              <button
                type="button"
                className="detail-action secondary"
                onClick={() => onOverride && onOverride(ticket)}
              >
                <RotateCcw size={17} />
                Override
              </button>
            )}

            {canAskMore && (
              <button
                type="button"
                className="detail-action secondary"
                onClick={() => onAskMore && onAskMore(ticket)}
              >
                <MessageCircle size={17} />
                Ask More
              </button>
            )}

            {canEscalate && (
              <button
                type="button"
                className="detail-action danger"
                onClick={() => onEscalate && onEscalate(ticket)}
              >
                <ArrowUpRight size={17} />
                Escalate
              </button>
            )}

            {ticket.status === "New" && (
              <div className="read-only-notice" style={{ width: "100%" }}>
                <Loader2 size={16} className="spin" />
                <span>
                  The AI match is still running for this ticket. Actions appear
                  once it has a score.
                </span>
              </div>
            )}

            {isClosed && (
              <div className="read-only-notice" style={{ width: "100%" }}>
                <ShieldCheck size={17} />
                <span>
                  This ticket is {String(ticket.status).toLowerCase()} and closed.
                </span>
              </div>
            )}

          </div>

          {/* the full hash, for reference */}
          <div className="detail-section">
            <div className="detail-section-title">Ticket hash (SHA-256)</div>
            <code className="hash-block">{ticket.ticketUid || "—"}</code>
          </div>

        </div>
      </div>
    </div>
  );
}

export default TicketDetailPanel;
