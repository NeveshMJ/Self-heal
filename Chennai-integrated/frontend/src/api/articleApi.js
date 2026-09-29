// src/api/articleApi.js
// Admin knowledge-base calls. A new article is stored in the articles table
// and embedded, so the matcher can use it immediately.
import { apiRequest } from "./client";

export function getArticles(departmentId) {
  const query = departmentId ? `?department_id=${departmentId}` : "";
  return apiRequest(`/admin/articles${query}`);
}

export function createArticle(article) {
  return apiRequest("/admin/articles", {
    method: "POST",
    body: JSON.stringify(article),
  });
}

// Knowledge-base ingestion supports a single file, a batch of files, or a ZIP
// containing category folders. Non-ZIP files are uploaded one by one so the
// browser can show a useful per-file result.
export async function uploadArticleFile(file, departmentId) {
  const token = localStorage.getItem("token");
  const base = import.meta.env.VITE_API_URL || "http://localhost:8000";

  const form = new FormData();
  form.append("file", file);
  if (departmentId) form.append("department_id", departmentId);

  const res = await fetch(`${base}/admin/articles/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.detail) || "Upload failed");
  return data;
}


export async function uploadKnowledgeBaseFiles(files, departmentId) {
  const list = Array.from(files || []);
  if (!list.length) throw new Error("Choose at least one file.");

  const results = [];
  const errors = [];
  for (const file of list) {
    try {
      const result = await uploadArticleFile(file, departmentId);
      results.push(result);
    } catch (err) {
      errors.push(`${file.name}: ${err.message || "Upload failed"}`);
    }
  }

  if (!results.length && errors.length) throw new Error(errors.join("; "));
  return { results, errors };
}
