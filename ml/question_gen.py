"""
Generate clarification questions for the Ask More (81-94%) path.
Tries T5-small; falls back to template questions built from the article.
"""
import re
from transformers import T5ForConditionalGeneration, T5Tokenizer

_model = None
_tokenizer = None


def _load():
    global _model, _tokenizer
    if _model is None:
        _tokenizer = T5Tokenizer.from_pretrained("t5-small")
        _model = T5ForConditionalGeneration.from_pretrained("t5-small")


def _template_questions(article: dict) -> list:
    """Reliable fallback questions built from the article's own fields."""
    qs = []
    if article.get("sop_id"):
        qs.append(f"Does your request relate to procedure SOP-{article['sop_id']}? "
                  f"If you know the SOP number, please provide it.")
    dept = article.get("department", "").replace("_", " ")
    if dept:
        qs.append(f"Which {dept} portal or system is affected?")
    qs.append("Can you confirm this is a configuration change request, "
              "or describe what you are trying to do in more detail?")
    return qs[:3]


def _t5_questions(article: dict) -> list:
    """Ask T5 to generate a question from the article body."""
    _load()
    context = f"{article.get('title','')}. {article.get('body_text','')}"
    prompt = f"generate a clarifying question: {context}"
    ids = _tokenizer(prompt, return_tensors="pt", truncation=True, max_length=256).input_ids
    out = _model.generate(ids, max_length=48, num_return_sequences=1,
                          num_beams=4, no_repeat_ngram_size=2)
    q = _tokenizer.decode(out[0], skip_special_tokens=True).strip()
    return [q] if q and q.endswith("?") and len(q) > 10 else []


def generate_questions(article: dict) -> dict:
    """Return up to 3 questions and which method produced them."""
    t5 = []
    try:
        t5 = _t5_questions(article)
    except Exception as e:
        print(f"(T5 failed, using templates: {e})")

    templates = _template_questions(article)

    # combine: T5 question first if it's usable, then templates, dedup
    seen, final = set(), []
    for q in t5 + templates:
        key = re.sub(r"\W+", "", q.lower())
        if key not in seen:
            seen.add(key)
            final.append(q)
    return {"questions": final[:3], "used_t5": bool(t5)}


if __name__ == "__main__":
    demo = {"title": "Insurance procedure", "sop_id": "667",
            "department": "Insurance",
            "body_text": "Apply the configuration change as described in SOP-667. "
                         "Verify the user's identity in the Insurance portal."}
    print(generate_questions(demo))