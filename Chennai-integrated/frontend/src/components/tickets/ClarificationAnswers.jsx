// src/components/tickets/ClarificationAnswers.jsx
//
// One answer box per Ask More question. Shared by the User portal (the
// complainant answers) and the analyst's Ask More dialog (answering on the
// user's behalf). `onSubmit(responses)` must return a promise; its error is
// shown under the form.

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

function ClarificationAnswers({ questions, onSubmit, submitLabel = "Submit answers" }) {
  const [answers, setAnswers] = useState(() => questions.map(() => ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!answers.some((a) => a.trim())) {
      setError("Answer at least one question.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(answers.map((a) => a.trim()));
    } catch (err) {
      setError(err.message || "Could not submit the answers.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="clarify-form" onSubmit={handleSubmit}>
      {questions.map((question, i) => (
        <div className="form-group" key={i}>
          <label htmlFor={`clarify-${i}`}>
            {i + 1}. {question}
          </label>
          <textarea
            id={`clarify-${i}`}
            rows={2}
            value={answers[i]}
            placeholder="Your answer"
            disabled={submitting}
            onChange={(event) => {
              const next = [...answers];
              next[i] = event.target.value;
              setAnswers(next);
            }}
          />
        </div>
      ))}

      {error && <div className="error-message">{error}</div>}

      <button type="submit" className="primary-button" disabled={submitting}>
        {submitting ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        {submitting ? "Checking your answers..." : submitLabel}
      </button>
    </form>
  );
}

export default ClarificationAnswers;
