// src/components/admin/KnowledgeBase.jsx
//
// Admin screen for adding knowledge-base articles. An article submitted here
// is written to the articles table, split into sentences, embedded, and the
// matcher is reloaded - so the next ticket in that department can match it.

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Plus,
} from "lucide-react";

import {
  createArticle,
  getArticles,
  uploadKnowledgeBaseFiles,
} from "../../api/articleApi";
import { getDepartments } from "../../api/ticketApi";
import { departmentLabel, formatDateTime } from "../../utils/format";

const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
const MAX_KB_ZIP_BYTES = 50 * 1024 * 1024;

function KnowledgeBase() {
  const [departments, setDepartments] = useState([]);
  const [articles, setArticles] = useState([]);
  const [filter, setFilter] = useState("");

  // paste-an-article form
  const [departmentId, setDepartmentId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [articleCode, setArticleCode] = useState("");
  const [sopId, setSopId] = useState("");
  const [blockAuto, setBlockAuto] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // knowledge-base batch upload
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const loadArticles = useCallback((deptId) => {
    getArticles(deptId || undefined)
      .then((rows) => setArticles(rows || []))
      .catch((err) => console.error("Failed to load articles:", err));
  }, []);

  useEffect(() => {
    getDepartments()
      .then((rows) => setDepartments(rows || []))
      .catch((err) => console.error("Failed to load departments:", err));
  }, []);

  useEffect(() => {
    loadArticles(filter);
  }, [filter, loadArticles]);

  const resetForm = () => {
    setTitle("");
    setBody("");
    setArticleCode("");
    setSopId("");
    setBlockAuto(false);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setError("");
    setResult(null);

    if (!departmentId) {
      setError("Choose the department this article belongs to.");
      return;
    }
    if (title.trim().length < 3 || body.trim().length < 10) {
      setError("A title and an article body are required.");
      return;
    }

    setSaving(true);
    try {
      const saved = await createArticle({
        department_id: Number(departmentId),
        title: title.trim(),
        body_text: body.trim(),
        article_code: articleCode.trim() || null,
        sop_id: sopId.trim() || null,
        no_auto_execute: blockAuto,
      });

      setResult(saved);
      resetForm();
      loadArticles(filter);
    } catch (err) {
      console.error("Save failed:", err);
      setError(err.message || "Could not store the article.");
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async () => {
    setError("");
    setResult(null);

    if (!files.length) {
      setError("Choose one or more article files, or one ZIP archive.");
      return;
    }
    if (files.length > 1 && files.some((f) => f.name.toLowerCase().endsWith(".zip"))) {
      setError("Upload either one ZIP archive or one/more individual article files, not both together.");
      return;
    }
    const hasZip = files.some((f) => f.name.toLowerCase().endsWith(".zip"));
    if (!hasZip && !departmentId) {
      setError("Choose a category/department before uploading individual article files.");
      return;
    }

    for (const file of files) {
      const lower = file.name.toLowerCase();
      const limit = lower.endsWith(".zip") ? MAX_KB_ZIP_BYTES : MAX_ARTICLE_BYTES;
      if (file.size > limit) {
        setError(`${file.name} exceeds the ${lower.endsWith(".zip") ? "50 MB ZIP" : "2 MB article"} limit.`);
        return;
      }
      if (!lower.endsWith(".zip") && !lower.endsWith(".md") && !lower.endsWith(".txt") && !lower.endsWith(".csv")) {
        setError(`${file.name}: only .md, .txt, .csv or .zip files are supported.`);
        return;
      }
    }

    setUploading(true);
    try {
      const response = await uploadKnowledgeBaseFiles(files, departmentId);
      const stored = response.results.reduce((sum, item) => sum + Number(item.stored || 0), 0);
      const errors = [...response.errors, ...response.results.flatMap((item) => item.errors || [])];
      setResult({ stored, errors });
      setFiles([]);
      loadArticles(filter);
    } catch (err) {
      console.error("Knowledge-base upload failed:", err);
      setError(err.message || "Knowledge-base upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="section-page">

      <div className="page-header">
        <div>
          <h1>Knowledge Base</h1>
          <p>
            Add remediation articles. Each one is stored in the articles table,
            embedded sentence by sentence, and made available to the matcher.
          </p>
        </div>

        <div className="audit-summary">
          <BookOpen size={18} />
          <span>{articles.length} articles</span>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {result && (
        <div className="ticket-created-banner">
          <CheckCircle2 size={20} />
          <div>
            <strong>
              {result.stored > 1
                ? `${result.stored} articles stored`
                : result.replaced
                ? `${result.article_code} updated`
                : `${result.article_code || "Article"} stored`}
            </strong>
            <span>
              {result.stored != null
                ? `${result.stored} article${result.stored === 1 ? "" : "s"} loaded and embedded.`
                : result.sentences
                ? `${result.sentences} sentences embedded` +
                  (result.matcher_reloaded ? " · matcher reloaded" : "")
                : "Stored, but no sentences were embedded."}
              {result.errors?.length ? ` ${result.errors.length} item(s) reported an error.` : ""}
              {result.embed_error ? ` · ${result.embed_error}` : ""}
            </span>
          </div>
        </div>
      )}

      <div className="admin-content-grid">

        {/* ---------------- paste an article ---------------- */}
        <div className="admin-panel">
          <div className="panel-title">
            <Plus size={20} />
            <div>
              <h2>New Article</h2>
              <p>Type or paste the remediation procedure.</p>
            </div>
          </div>

          <form onSubmit={handleSave}>

            <div className="form-group">
              <label htmlFor="kb-department">Department *</label>
              <select
                id="kb-department"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                disabled={saving}
              >
                <option value="">Select the department</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {departmentLabel(dept.name)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="kb-title">Title *</label>
              <input
                id="kb-title"
                type="text"
                value={title}
                placeholder="e.g. Reset corporate banking credentials"
                onChange={(event) => setTitle(event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label htmlFor="kb-body">Article body *</label>
              <textarea
                id="kb-body"
                rows={8}
                value={body}
                placeholder="Describe the procedure. Every sentence is embedded, so write it in full sentences. Mention the SOP number if there is one."
                onChange={(event) => setBody(event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="kb-code">
                  Article code <span className="field-key">optional</span>
                </label>
                <input
                  id="kb-code"
                  type="text"
                  value={articleCode}
                  placeholder="ART-XXXXXXXX (generated if blank)"
                  onChange={(event) => setArticleCode(event.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label htmlFor="kb-sop">
                  SOP number <span className="field-key">optional</span>
                </label>
                <input
                  id="kb-sop"
                  type="text"
                  value={sopId}
                  placeholder="Read from the text if blank"
                  onChange={(event) => setSopId(event.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={blockAuto}
                onChange={(event) => setBlockAuto(event.target.checked)}
                disabled={saving}
              />
              <span>
                Exclusion list — never allow automated self-healing for this
                article
              </span>
            </label>

            <button type="submit" className="primary-button" disabled={saving}>
              <BookOpen size={17} />
              {saving ? "Storing and embedding..." : "Store article"}
            </button>

            <p className="form-hint">
              Reusing an existing article code replaces that article and
              re-embeds it as a new version.
            </p>

          </form>
        </div>

        {/* ---------------- knowledge-base upload ---------------- */}
        <div className="admin-panel">
          <div className="panel-title">
            <Upload size={20} />
            <div>
              <h2>Knowledge Base Upload</h2>
              <p>Choose a category for individual files, or upload a ZIP whose folders are the categories.</p>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="kb-upload-department">Category / Department</label>
            <select
              id="kb-upload-department"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              disabled={uploading}
            >
              <option value="">Not required for category-folder ZIP</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{departmentLabel(dept.name)}</option>
              ))}
            </select>
          </div>

          <label className="upload-area">
            <Upload size={26} />
            <strong>Select article files</strong>
            <span>Multiple .md, .txt or .csv files · 2 MB each</span>
            <input
              type="file"
              multiple
              accept=".md,.txt,.csv,.zip"
              onChange={(event) => setFiles(Array.from(event.target.files || []))}
            />
          </label>

          {files.length > 0 && (
            <div className="selected-file-list">
              {files.map((item) => (
                <div className="selected-file" key={`${item.name}-${item.lastModified}`}>
                  <FileText size={20} />
                  <div>
                    <strong>{item.name}</strong>
                    <span>{(item.size / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              ))}
              <button type="button" className="secondary-button" onClick={() => setFiles([])}>Clear selection</button>
            </div>
          )}

          <button type="button" className="primary-button" onClick={handleUpload} disabled={uploading}>
            <Upload size={17} />
            {uploading ? "Uploading and embedding..." : "Load into Knowledge Base"}
          </button>

          <div className="requirements-list">
            <div className="requirement-item">
              <FileText size={15} />
              <span><strong>Option 1:</strong> choose a category, then select one or many article files. Every selected file is stored under that category.</span>
            </div>
            <div className="requirement-item">
              <FileText size={15} />
              <span><strong>Option 2:</strong> upload one ZIP. Each first-level category folder is mapped to the matching department, including ZIPs wrapped in a top-level folder.</span>
            </div>
            <div className="requirement-item">
              <AlertTriangle size={15} />
              <span>Individual articles are limited to 2 MB. A ZIP is limited to 50 MB and is validated for safe extraction before database ingestion.</span>
            </div>
          </div>
        </div>

      </div>

      {/* ---------------- stored articles ---------------- */}
      <section className="queue-section">
        <div className="queue-header">
          <div>
            <h2>Stored Articles</h2>
            <p>What the matcher can currently reach.</p>
          </div>

          <div className="filter-box">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {departmentLabel(dept.name)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-container">
          <table className="ticket-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Department</th>
                <th>SOP</th>
                <th>Sentences</th>
                <th>Added</th>
              </tr>
            </thead>

            <tbody>
              {articles.map((article) => (
                <tr key={article.id}>
                  <td>
                    <span className="ticket-id">{article.article_code}</span>
                  </td>
                  <td>
                    <span className="ticket-description">{article.title}</span>
                  </td>
                  <td>{departmentLabel(article.department)}</td>
                  <td>{article.sop_id ? `SOP-${article.sop_id}` : "—"}</td>
                  <td>
                    <span
                      className={`match-score ${
                        article.sentences > 0 ? "score-perfect" : "score-low"
                      }`}
                    >
                      {article.sentences}
                    </span>
                  </td>
                  <td>{formatDateTime(article.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {articles.length === 0 && (
            <div className="empty-state">
              <BookOpen size={30} />
              <strong>No articles yet</strong>
              <span>Add one above, or run load_and_embed.py.</span>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}

export default KnowledgeBase;
