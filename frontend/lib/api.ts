const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function login(username: string, password: string) {
  return apiFetch("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logout() {
  return apiFetch("/api/logout", { method: "POST" });
}

export async function getMe() {
  return apiFetch("/api/me");
}

export async function getWsTicket(): Promise<string> {
  const data = await apiFetch("/api/ws-ticket");
  return data.ticket as string;
}

export async function getDocuments() {
  return apiFetch("/api/documents");
}

export async function deleteDocument(id: number) {
  return apiFetch(`/api/documents/${id}`, { method: "DELETE" });
}

export async function uploadFile(file: File, onProgress?: (pct: number) => void): Promise<void> {
  const form = new FormData();
  form.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.open("POST", `${BACKEND_URL}/api/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => (xhr.status < 400 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

export interface DbSession {
  id: number;
  created_at: string;
  messages: SessionMessage[];
}

export async function saveSession(messages: SessionMessage[]): Promise<{ id: number }> {
  return apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

export async function getSessions(): Promise<DbSession[]> {
  return apiFetch("/api/sessions");
}

export async function deleteDbSession(id: number): Promise<void> {
  return apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
}

export async function clearDbSessions(): Promise<void> {
  return apiFetch("/api/sessions", { method: "DELETE" });
}

export function buildWsUrl(ticket: string, voice?: string): string {
  const wsBase =
    process.env.NEXT_PUBLIC_BACKEND_WS_URL ??
    (typeof window !== "undefined"
      ? window.location.origin.replace(/^http/, "ws")
      : "ws://localhost:8000");
  let url = `${wsBase}/ws/voice?ticket=${encodeURIComponent(ticket)}`;
  if (voice) url += `&voice=${encodeURIComponent(voice)}`;
  return url;
}
