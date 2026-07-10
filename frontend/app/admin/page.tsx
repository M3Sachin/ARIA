"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { getMe, logout, getDocuments, deleteDocument } from "@/lib/api";
import { useInactivityLogout } from "@/lib/useInactivityLogout";
import UploadDock from "@/components/UploadDock";

interface Doc {
  id: number;
  filename: string;
  file_type: string;
  status: string;
  uploaded_at: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  useEffect(() => {
    getMe()
      .then((u) => {
        if (u.role !== "admin") router.replace("/agent");
        else setUser(u);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const fetchDocs = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const data = await getDocuments();
      setDocs(data);
    } catch {
      // silently ignore
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  async function handleDelete(id: number) {
    await deleteDocument(id);
    fetchDocs();
  }

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  const handleAutoLogout = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [router]);

  useInactivityLogout({ timeoutMs: (parseInt(process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES || "15", 10)) * 60 * 1000, onLogout: handleAutoLogout });

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <span className="font-mono text-rim/30 text-sm animate-pulse">Loading…</span>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-10 max-w-3xl mx-auto flex flex-col gap-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-sans font-light text-rim">Aria</h1>
          <p className="font-mono text-[11px] text-rim/30 tracking-widest uppercase mt-0.5">
            Admin · {user.username}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="font-mono text-xs text-rim/40 hover:text-rim/70 transition-colors border border-white/8 rounded-lg px-4 py-2"
        >
          Log out
        </button>
      </div>

      {/* Upload */}
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-rim/40">Ingest documents</h2>
        <UploadDock onUploaded={fetchDocs} />
      </section>

      {/* Document list */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-widest text-rim/40">
            Indexed documents
          </h2>
          <button
            onClick={fetchDocs}
            className="font-mono text-[11px] text-rim/30 hover:text-rim/60 transition-colors"
          >
            ↺ Refresh
          </button>
        </div>

        {loadingDocs ? (
          <p className="font-mono text-sm text-rim/20 animate-pulse">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="font-mono text-sm text-rim/20">No documents ingested yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {docs.map((doc) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-4"
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-mono text-sm text-rim/80 truncate">{doc.filename}</span>
                  <span className="font-mono text-[11px] text-rim/30 mt-0.5">
                    {doc.file_type.toUpperCase()} ·{" "}
                    <span
                      className={
                        doc.status === "ready"
                          ? "text-cyan"
                          : doc.status === "error"
                          ? "text-red-400"
                          : "text-amber-voice"
                      }
                    >
                      {doc.status}
                    </span>{" "}
                    · {new Date(doc.uploaded_at).toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="shrink-0 font-mono text-xs text-rim/20 hover:text-red-400/70 transition-colors"
                >
                  Delete
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
