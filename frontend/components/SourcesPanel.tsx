"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface CitedSource {
  id: string;
  filename: string;
  ts: number;
}

interface SourcesPanelProps {
  sources: CitedSource[];
}

export default function SourcesPanel({ sources }: SourcesPanelProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 700);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <AnimatePresence>
      {sources.length > 0 && (
        isMobile ? (
          <motion.aside
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-30 px-3 pb-3 pt-2"
            style={{ background: "rgba(5,7,10,0.85)", backdropFilter: "blur(12px)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            <p className="text-[9px] font-mono uppercase tracking-widest text-rim/30 mb-2">Sources</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sources.map((src) => (
                <motion.div
                  key={src.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="shrink-0 px-3 py-1.5 rounded border border-white/8 bg-surface-2/70 text-[11px] font-mono text-rim/70 max-w-[180px] truncate"
                  style={{ backdropFilter: "blur(10px)" }}
                  title={src.filename}
                >
                  {src.filename}
                </motion.div>
              ))}
            </div>
          </motion.aside>
        ) : (
          <motion.aside
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-4 top-1/2 -translate-y-1/2 w-56 flex flex-col gap-2 z-30"
          >
            <p className="text-[10px] font-mono uppercase tracking-widest text-rim/30 px-1">Sources</p>
            {sources.map((src) => (
              <motion.div
                key={src.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className="px-3 py-2 rounded-md border border-white/8 bg-surface-2/70 text-xs font-mono text-rim/70 truncate"
                style={{ backdropFilter: "blur(10px)" }}
                title={src.filename}
              >
                {src.filename}
              </motion.div>
            ))}
          </motion.aside>
        )
      )}
    </AnimatePresence>
  );
}
