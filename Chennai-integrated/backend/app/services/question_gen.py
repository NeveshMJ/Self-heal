"""
Ask-More question generation.

Uses the fine-tuned T5 (backend/models/t5-ask-more.pt, a state dict for
t5-small) to write up to 3 clarifying questions from the complaint and the
matched article. If the model is missing or produces too few usable
questions, reliable template questions built from the article fill the gap.
The model loads lazily, once, on the first Ask More.
"""
import re
import threading
from pathlib import Path

from app.core.config import settings

MAX_QUESTIONS = 3
BACKEND_DIR = Path(__file__).resolve().parents[2]

# the prompt format the model was fine-tuned on
PROMPT = "generate a clarifying question: {complaint} context: {title}. {body}"

_lock = threading.Lock()
_model = None
_tokenizer = None
_load_error = None


def model_path() -> Path:
    p = Path(settings.t5_model_path)
    return p if p.is_absolute() else BACKEND_DIR / p


def import_libraries():
    """Import torch + transformers on the calling thread. Call this from the
    main thread at startup: transformers' lazy imports are not thread-safe,
    and a background thread importing it while the matcher loads its model
    fails with "cannot import name ...". """
    import torch  # noqa: F401
    from transformers import AutoTokenizer, T5ForConditionalGeneration  # noqa: F401


def _load():
    """Load t5-small's architecture + tokenizer, then the fine-tuned weights."""
    global _model, _tokenizer, _load_error
    with _lock:
        if _model is not None:
            return
        path = model_path()
        if not path.exists():
            # permanent until the file is added: don't retry on every click
            _load_error = f"T5 model not found at {path}"
            print(f"WARNING: {_load_error}; Ask More uses template questions")
            return
        try:
            import torch
            from transformers import AutoTokenizer, T5ForConditionalGeneration

            tokenizer = AutoTokenizer.from_pretrained("t5-small")
            model = T5ForConditionalGeneration.from_pretrained("t5-small")
            state = torch.load(path, map_location="cpu")
            model.load_state_dict(state)
            model.eval()
            _tokenizer, _model = tokenizer, model
            _load_error = None
            print(f"Ask More: fine-tuned T5 loaded from {path}")
        except Exception as exc:
            # may be temporary (e.g. first download): retried on the next call
            _load_error = str(exc)
            print(f"WARNING: fine-tuned T5 unavailable, using templates: {exc}")


def t5_status() -> dict:
    return {"enabled": settings.t5_enabled, "path": str(model_path()),
            "loaded": _model is not None, "error": _load_error}


def _clean(q: str) -> str:
    q = re.sub(r"\s+", " ", q or "").strip()
    if q and not q.endswith("?"):
        q = q.rstrip(".") + "?"
    return q[:1].upper() + q[1:] if q else q


def _t5_questions(complaint, title, body) -> list[str]:
    _load()
    if _model is None:
        return []

    import torch

    prompt = PROMPT.format(complaint=complaint or "", title=title or "",
                           body=body or "")
    ids = _tokenizer(prompt, return_tensors="pt", truncation=True,
                     max_length=384).input_ids
    with torch.no_grad():
        out = _model.generate(ids, max_length=64, num_beams=8,
                              num_return_sequences=6,
                              no_repeat_ngram_size=3, early_stopping=True)

    questions = []
    for seq in out:
        raw = _tokenizer.decode(seq, skip_special_tokens=True).strip()
        # the model sometimes echoes the complaint, or copies an article
        # bullet ("- Document the action ..."), instead of asking: only keep
        # output that is itself a question
        if raw.startswith(("-", "*", "•")) or not raw.endswith("?"):
            continue
        q = _clean(raw)
        if len(q) > 12 and q.lower().rstrip("?") not in (complaint or "").lower():
            questions.append(q)
    return questions


def _template_questions(sop_id, department) -> list[str]:
    qs = []
    if sop_id:
        qs.append(f"Does your request relate to procedure SOP-{sop_id}? "
                  "If you know the SOP number, please provide it.")
    if department:
        qs.append(f"Which {str(department).replace('_', ' ')} portal or "
                  "system is affected?")
    qs.append("Can you describe what you are trying to do, and what happens "
              "when you try it?")
    return qs


_FILLER = {"the", "a", "an", "you", "your", "have", "has", "been", "was", "is",
           "that", "can", "confirm", "in", "to", "of", "for", "according",
           "appropriate", "specified", "required", "user", "it"}


def _words(q: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", q.lower()) if w not in _FILLER}


def _dedupe(questions: list[str]) -> list[str]:
    """Drop exact repeats and near-copies (beam search often returns the same
    question with one word swapped)."""
    final = []
    for q in questions:
        words = _words(q)
        if not words:
            continue
        near_copy = any(
            len(words & _words(kept)) / len(words | _words(kept)) >= 0.6
            for kept in final
        )
        if not near_copy:
            final.append(q)
    return final


def generate_questions(complaint=None, title=None, body=None, sop_id=None,
                       department=None) -> dict:
    t5 = []
    if settings.t5_enabled:
        try:
            t5 = _t5_questions(complaint, title, body)
        except Exception as exc:
            print(f"WARNING: T5 generation failed, using templates: {exc}")

    t5 = _dedupe(t5)[:MAX_QUESTIONS]
    final = _dedupe(t5 + _template_questions(sop_id, department))[:MAX_QUESTIONS]
    return {"questions": final, "used_t5": bool(t5),
            "t5_count": len(t5)}
