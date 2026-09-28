// src/components/tickets/AskMoreModal.jsx
//
// 81-94% path for analysts / admins.
//   mode "enable": asks the backend to open a clarification round. The
//                  fine-tuned T5 writes up to 3 questions, which then wait for
//                  the user in the User portal.
//   mode "answer": answers the open round on the user's behalf.
// After answering, the ticket is re-scored and the new score is shown.

import { useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  MessageCircle,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import { askMoreTicket, submitAnswers } from "../../api/ticketApi";
import { ticketRef } from "../../utils/format";
import ClarificationAnswers from "./ClarificationAnswers";

function AskMoreModal({ ticket, mode = "enable", onClose }) {
  const ref = ticket.ticketUid || ticket.id;

  const [view, setView] = useState(mode === "answer" ? "answer" : "loading");
  const [questions, setQuestions] = useState(
    mode === "answer" ? ticket.pendingQuestions || [] : []
  );
  const [round, setRound] = useState(ticket.clarifyRound || 1);
  const [source, setSource] = useState(null); // "t5" | "templates" | "existing"
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // open the round once (React StrictMode runs effects twice in dev)
  const started = useRef(false);
  useEffect(() => {
    if (mode !== "enable" || started.current) return;
    started.current = true;

    askMoreTicket(ref)
      .then((res) => {
        setQuestions(res.questions || []);
        setRound(res.round);
        setSource(res.alreadyOpen ? "existing" : res.used_t5 ? "t5" : "templates");
        setView("sent");
      })
      .catch((err) => {
        setError(err.message || "Could not generate the questions.");
        setView("error");
      });
  }, [mode, ref]);

  const handleAnswers = async (responses) => {
    const updated = await submitAnswers(ref, responses);
    setResult(updated.result);
    setView("done");
  };

  const busy = view === "loading";

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal ask-more-modal" onClick={(event) => event.stopPropagation()}>

        <div className="modal-header">
          <div>
            <h2>
              <MessageCircle size={20} /> Ask More
            </h2>
            <p>
              {ticketRef(ticket)} · round {round} of {ticket.maxRounds || 3}
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">

          {view === "loading" && (
            <div className="matching-strip">
              <Loader2 size={16} className="spin" />
              The T5 model is writing clarifying questions...
            </div>
          )}

          {view === "error" && <div className="error-message">{error}</div>}

          {view === "sent" && (
            <>
              <div className={`question-source ${source}`}>
                <Sparkles size={15} />
                {source === "t5" && "Written by the fine-tuned T5 model"}
                {source === "templates" &&
                  "T5 could not produce usable questions, so template questions were used"}
                {source === "existing" &&
                  "These questions are already waiting for the user"}
              </div>

              <ol className="ask-more-questions">
                {questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>

              <div className="read-only-notice">
                <CheckCircle2 size={16} />
                <span>
                  Sent to the user. They see these questions in the User
                  portal when they sign in, and the ticket is re-scored when
                  they answer. You can also answer for them now.
                </span>
              </div>
            </>
          )}

          {view === "answer" && (
            <>
              <p className="form-hint">
                Answer on the user's behalf, for example with details they
                gave you by phone or email. The answers are recorded as yours.
              </p>
              <ClarificationAnswers
                questions={questions}
                onSubmit={handleAnswers}
                submitLabel="Submit and re-score"
              />
            </>
          )}

          {view === "done" && result && (
            <div
              className={`ask-more-result ${
                result.escalated ? "escalated" : "improved"
              }`}
            >
              {result.escalated ? (
                <AlertTriangle size={20} />
              ) : (
                <CheckCircle2 size={20} />
              )}
              <div>
                <strong>
                  Re-scored: {result.scoreBefore ?? "—"}% → {result.scoreAfter ?? "—"}%
                </strong>
                <span>
                  New status: {result.status}.
                  {result.escalated &&
                    " All clarification rounds are used, so the ticket was escalated."}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {view === "sent" && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setView("answer")}
            >
              <MessageCircle size={16} />
              Answer on the user's behalf
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            onClick={onClose}
            disabled={busy}
          >
            {view === "sent" ? "Done, wait for the user" : "Close"}
          </button>
        </div>

      </div>
    </div>
  );
}

export default AskMoreModal;
