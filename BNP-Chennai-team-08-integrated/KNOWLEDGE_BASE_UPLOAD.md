# Knowledge Base upload workflow

The Dataset Upload screen is intentionally removed. Knowledge Base is the single ingestion workflow.

## Option 1: category-first batch
Select a category/department in the Knowledge Base screen, then select one or more `.md`, `.txt`, or `.csv` files. Every selected article is stored against the selected department.

## Option 2: category-folder ZIP
Upload one ZIP containing category folders, for example:

```text
knowledge_base.zip
  Retail_Banking/ART-001.md
  Corporate_Banking/ART-002.md
  Insurance/ART-003.md
```

A single wrapper folder is also supported. The category folder is resolved against the `departments` table, and each article is persisted with the correct `department_id`.

Individual article limit: 2 MB. ZIP envelope limit: 50 MB. ZIP extraction is capped at 100 MB and 500 files, and path traversal is rejected.
