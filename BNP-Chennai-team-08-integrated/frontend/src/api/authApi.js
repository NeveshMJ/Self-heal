// src/api/authApi.js
// Self-service signup has been removed. Only two staff logins exist:
//   admin   / admin@123
//   analyst / analyst@123
// End users never "log in" - they verify their credentials when raising a
// complaint from the public User portal.
import { apiRequest } from "./client";

// staff login: stores the JWT + user, returns the token payload
export async function login(credentials) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });

  if (data && data.access_token) {
    localStorage.setItem("token", data.access_token);
    localStorage.setItem("currentUser", JSON.stringify(data.user));
  }
  return data;
}

// end-user verification for the complaint form.
// Validates id + password against the backend WITHOUT creating a staff session.
export async function verifyEndUser(credentials) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
  return { token: data.access_token, user: data.user };
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("currentUser");
}
