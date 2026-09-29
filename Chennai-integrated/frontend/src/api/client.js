// src/api/client.js
// Central API client. Attaches the JWT saved at login, or an explicit token
// (used by the public User portal, which authenticates per complaint and never
// stores a staff session).

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function getToken() {
  return localStorage.getItem("token");
}

export async function apiRequest(endpoint, options = {}) {
  // `token` is ours, not fetch's - pull it out before spreading the rest
  const { token: explicitToken, headers, ...rest } = options;
  const token = explicitToken || getToken();

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
      ...rest,
    });
  } catch {
    // network / server-down: give the UI something it can explain to the user
    const err = new Error(
      `Cannot reach the API at ${API_BASE_URL}. Start the backend and try again.`
    );
    err.offline = true;
    throw err;
  }

  // some endpoints (204) have no body
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = new Error((data && data.detail) || "API request failed");
    err.status = response.status;
    throw err;
  }
  return data;
}

export { API_BASE_URL };
