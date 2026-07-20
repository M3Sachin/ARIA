"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe, getWsTicket, buildWsUrl, logout, saveSession, getSessions, deleteDbSession, clearDbSessions } from "@/lib/api";
import { useInactivityLogout } from "@/lib/useInactivityLogout";
import { AudioCapture } from "@/lib/audioCapture";
import { AudioPlayback } from "@/lib/audioPlayback";
import TranscriptPanel, { type Message } from "@/components/TranscriptPanel";
import TranscriptModal from "@/components/TranscriptModal";
import SourcesPanel, { type CitedSource } from "@/components/SourcesPanel";

type SessionState = "disconnected" | "connecting" | "idle" | "listening" | "thinking" | "speaking";

let msgCounter = 0;
const uid = () => String(++msgCounter);

// Yellow/amber when offline — blue in every live state
const COLORS: Record<SessionState, { primary: string; dim: string; glow: string }> = {
  disconnected: { primary: "#ffc200", dim: "#1a1200",  glow: "rgba(255,194,0,0.18)"   },
  connecting:   { primary: "#0099ff", dim: "#001428",  glow: "rgba(0,153,255,0.28)"   },
  idle:         { primary: "#0099ff", dim: "#001428",  glow: "rgba(0,153,255,0.28)"   },
  listening:    { primary: "#00c8ff", dim: "#001c33",  glow: "rgba(0,200,255,0.40)"   },
  thinking:     { primary: "#4488ff", dim: "#000e28",  glow: "rgba(68,136,255,0.35)"  },
  speaking:     { primary: "#00aaff", dim: "#001830",  glow: "rgba(0,170,255,0.48)"   },
};

const STATUS_TEXT: Record<SessionState, string> = {
  disconnected: "SYSTEM STANDBY",
  connecting:   "INITIALIZING NEURAL LINK...",
  idle:         "ARIA ONLINE  ·  SPEAK TO BEGIN",
  listening:    "PROCESSING VOCAL INPUT",
  thinking:     "ANALYZING  ·  QUERYING KNOWLEDGE BASE",
  speaking:     "ARIA RESPONDING",
};

// ── Canvas frequency visualizer ───────────────────────────────────────────────

function OrbVisualizer({
  ampRef,
  activeRef,
  colorRef,
  stateRef,
}: {
  ampRef: React.MutableRefObject<number>;
  activeRef: React.MutableRefObject<boolean>;
  colorRef: React.MutableRefObject<string>;
  stateRef: React.MutableRefObject<SessionState>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const S = 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = S * dpr;
    canvas.height = S * dpr;
    canvas.style.width  = `${S}px`;
    canvas.style.height = `${S}px`;
    ctx.scale(dpr, dpr);

    const cx = S / 2, cy = S / 2;
    const BARS = 96;
    const INNER_R = 98;   // radius where bars start
    const MAX_BAR = 44;   // max bar height px

    const bars = new Float32Array(BARS);
    const pings: { r: number; alpha: number }[] = [];
    let prevState: SessionState = "disconnected";
    let t = 0;
    let frameId: number;

    // Parse a "#rrggbb" hex to [r,g,b]
    const toRGB = (hex: string): [number, number, number] => {
      const h = hex.replace("#", "");
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    };

    const draw = () => {
      t++;
      ctx.clearRect(0, 0, S, S);

      const amp   = ampRef.current;
      const active = activeRef.current;
      const hex   = colorRef.current.length === 7 ? colorRef.current : "#0099ff";
      const state  = stateRef.current;
      const [r, g, b] = toRGB(hex);
      const rgba = (a: number) => `rgba(${r},${g},${b},${a})`;

      // Trigger sonar pings on speaking start or strong mic spike
      if (state === "speaking" && prevState !== "speaking") {
        pings.push({ r: INNER_R + 4, alpha: 0.7 });
        pings.push({ r: INNER_R - 8, alpha: 0.5 });
      }
      if (active && amp > 0.05 && Math.random() < 0.04) {
        pings.push({ r: INNER_R, alpha: 0.45 });
      }
      prevState = state;

      // ── Update frequency bars ──
      for (let i = 0; i < BARS; i++) {
        let target = 0;
        if (active) {
          const w1 = Math.sin(i * 0.38 + t * 0.045) * 0.35;
          const w2 = Math.sin(i * 0.13 + t * 0.072) * 0.25;
          const w3 = Math.cos(i * 0.65 + t * 0.031) * 0.15;
          const variation = Math.max(0, 0.25 + w1 + w2 + w3);
          target = amp * MAX_BAR * variation;
        }
        const decay = active ? 0.78 : 0.92;
        bars[i] = bars[i] * decay + target * (1 - decay);
      }

      // ── Outer rotating arc segments (sci-fi HUD frame, not clock) ──
      const SEG_R = INNER_R + MAX_BAR + 16;
      const SEG_COUNT = 6;
      const SEG_ARC = (Math.PI * 2 / SEG_COUNT) * 0.38;
      for (let i = 0; i < SEG_COUNT; i++) {
        const offset = (i / SEG_COUNT) * Math.PI * 2 + t * 0.007;
        ctx.beginPath();
        ctx.arc(cx, cy, SEG_R, offset, offset + SEG_ARC);
        ctx.strokeStyle = rgba(0.28);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // Thin full outer ring behind segments
      ctx.beginPath();
      ctx.arc(cx, cy, SEG_R, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(0.07);
      ctx.lineWidth = 0.6;
      ctx.stroke();

      // ── Baseline circle ──
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(0.15);
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // ── Frequency bars ──
      ctx.lineCap = "round";
      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const h = Math.max(1.2, bars[i]);
        const x1 = cx + Math.cos(angle) * INNER_R;
        const y1 = cy + Math.sin(angle) * INNER_R;
        const x2 = cx + Math.cos(angle) * (INNER_R + h);
        const y2 = cy + Math.sin(angle) * (INNER_R + h);

        const intensity = bars[i] / MAX_BAR;
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, rgba(0.20 + intensity * 0.30));
        grad.addColorStop(1, rgba(0.55 + intensity * 0.45));

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }

      // ── Sonar ping rings ──
      for (let i = pings.length - 1; i >= 0; i--) {
        const p = pings[i];
        p.r += 1.8;
        p.alpha *= 0.93;
        if (p.alpha < 0.015) { pings.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(cx, cy, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(p.alpha);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // ── 3D SPHERE ──────────────────────────────────────────────────
      const SR = 64; // sphere radius

      // Layer 1 — atmospheric halo
      const halo = ctx.createRadialGradient(cx, cy, SR * 0.85, cx, cy, SR * 2.4);
      halo.addColorStop(0,    rgba(0.32));
      halo.addColorStop(0.30, rgba(0.12));
      halo.addColorStop(0.65, rgba(0.03));
      halo.addColorStop(1,    rgba(0));
      ctx.beginPath();
      ctx.arc(cx, cy, SR * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      // Layer 2 — dark sphere base (gives the sphere its solid body)
      ctx.beginPath();
      ctx.arc(cx, cy, SR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(2,5,12,0.93)";
      ctx.fill();

      // Layer 3 — diffuse light from top-left (main illumination)
      const lx = cx - SR * 0.42, ly = cy - SR * 0.42;
      const diff = ctx.createRadialGradient(lx, ly, 0, cx, cy, SR);
      diff.addColorStop(0,    rgba(0.68));
      diff.addColorStop(0.38, rgba(0.24));
      diff.addColorStop(0.72, rgba(0.05));
      diff.addColorStop(1,    rgba(0));
      ctx.beginPath();
      ctx.arc(cx, cy, SR, 0, Math.PI * 2);
      ctx.fillStyle = diff;
      ctx.fill();

      // Layer 4 — rim light bottom-right (3-point lighting)
      const rimGrd = ctx.createRadialGradient(
        cx + SR * 0.58, cy + SR * 0.52, 0,
        cx + SR * 0.58, cy + SR * 0.52, SR * 0.75
      );
      rimGrd.addColorStop(0,   rgba(0.22));
      rimGrd.addColorStop(0.5, rgba(0.07));
      rimGrd.addColorStop(1,   rgba(0));
      ctx.beginPath();
      ctx.arc(cx, cy, SR, 0, Math.PI * 2);
      ctx.fillStyle = rimGrd;
      ctx.fill();

      // Layer 5 — primary specular highlight (white glint, top-left)
      const sx = cx - SR * 0.33, sy = cy - SR * 0.38;
      const spec = ctx.createRadialGradient(sx, sy, 0, sx, sy, SR * 0.40);
      spec.addColorStop(0,    "rgba(255,255,255,0.52)");
      spec.addColorStop(0.28, "rgba(255,255,255,0.14)");
      spec.addColorStop(0.65, rgba(0.03));
      spec.addColorStop(1,    "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, SR, 0, Math.PI * 2);
      ctx.fillStyle = spec;
      ctx.fill();

      // Layer 6 — secondary soft specular (gives glassy depth)
      const s2x = cx - SR * 0.12, s2y = cy - SR * 0.52;
      const spec2 = ctx.createRadialGradient(s2x, s2y, 0, s2x, s2y, SR * 0.22);
      spec2.addColorStop(0,   "rgba(255,255,255,0.24)");
      spec2.addColorStop(1,   "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, SR, 0, Math.PI * 2);
      ctx.fillStyle = spec2;
      ctx.fill();

      // Orbit ring 1 — slow equatorial ellipse
      const ang1 = t * 0.006;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang1);
      ctx.beginPath();
      ctx.ellipse(0, 0, SR * 1.40, SR * 0.17, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(0.40);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      // Orbit ring 2 — opposite tilt, counter-rotate
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 3.5 - t * 0.004);
      ctx.beginPath();
      ctx.ellipse(0, 0, SR * 1.26, SR * 0.13, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(0.22);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();

      // Sphere border ring (crisp edge)
      ctx.beginPath();
      ctx.arc(cx, cy, SR, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(0.48);
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Central energy hotspot
      const hot = ctx.createRadialGradient(cx, cy, 0, cx, cy, SR * 0.38);
      hot.addColorStop(0,   rgba(0.62));
      hot.addColorStop(0.5, rgba(0.16));
      hot.addColorStop(1,   rgba(0));
      ctx.beginPath();
      ctx.arc(cx, cy, SR * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = hot;
      ctx.fill();
      // ────────────────────────────────────────────────────────────────

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps — intentionally reads from refs

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
      }}
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const router = useRouter();
  const [user, setUser]   = useState<{ username: string; role: string } | null>(null);
  const [state, setState] = useState<SessionState>("disconnected");
  const [micAmp, setMicAmp] = useState(0);
  const [spkAmp, setSpkAmp] = useState(0);
  const [messages,      setMessages]      = useState<Message[]>([]);
  const [savedSessions, setSavedSessions] = useState<{ id: string; dbId?: number; messages: Message[] }[]>([]);
  const [sources,  setSources]  = useState<CitedSource[]>([]);
  const [tick,     setTick]     = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [windowWidth, setWindowWidth] = useState(0);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const [warningCountdown, setWarningCountdown] = useState(60);
  const [selectedVoice, setSelectedVoice] = useState("Aoede");
  const countdownRef = useRef<number | null>(null);
  const sessionIdRef    = useRef(0);
  const messagesRef     = useRef<Message[]>([]);       // always-current snapshot for disconnect()
  const sessionSavedRef = useRef(false);               // prevent double-save in React StrictMode

  const wsRef      = useRef<WebSocket | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const playRef    = useRef<AudioPlayback | null>(null);
  const rafAmpRef  = useRef<number | null>(null);
  const rafRotRef  = useRef<number | null>(null);
  const rotRef     = useRef(0);
  const stateRef   = useRef<SessionState>("disconnected");

  // Refs for canvas visualizer (avoids stale closures)
  const orbAmpRef    = useRef(0);
  const orbActiveRef = useRef(false);
  const orbColorRef  = useRef(COLORS.disconnected.primary);

  // Keep messagesRef in sync so disconnect() always sees fresh messages
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    orbColorRef.current  = COLORS[state].primary;
    orbActiveRef.current = state !== "disconnected" && state !== "connecting";
  }, [state]);
  useEffect(() => {
    orbAmpRef.current = state === "speaking" ? spkAmp : micAmp;
  }, [state, spkAmp, micAmp]);

  useEffect(() => {
    setWindowWidth(window.innerWidth);
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    getMe().then(setUser).catch(() => router.replace("/login"));
  }, [router]);

  // Load persisted sessions from DB on mount
  useEffect(() => {
    getSessions()
      .then(dbSessions => {
        setSavedSessions(dbSessions.map((s, si) => ({
          id: `db-${s.id}`,
          dbId: s.id,
          messages: s.messages.map((m, mi) => ({
            id: `db-${s.id}-${mi}`,
            role: m.role as "user" | "assistant",
            text: m.text,
            ts: m.ts,
          })),
        })));
      })
      .catch(() => {}); // silently skip if not authenticated yet
  }, []);

  // Rotation ticker
  useEffect(() => {
    const run = () => {
      rotRef.current = (rotRef.current + 0.35) % 360;
      setTick(rotRef.current);
      rafRotRef.current = requestAnimationFrame(run);
    };
    rafRotRef.current = requestAnimationFrame(run);
    return () => { if (rafRotRef.current) cancelAnimationFrame(rafRotRef.current); };
  }, []);

  // Speaker amplitude polling
  useEffect(() => {
    const run = () => {
      if (playRef.current) setSpkAmp(playRef.current.getAmplitude());
      rafAmpRef.current = requestAnimationFrame(run);
    };
    rafAmpRef.current = requestAnimationFrame(run);
    return () => { if (rafAmpRef.current) cancelAnimationFrame(rafAmpRef.current); };
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setState("connecting");

    let ticket: string;
    try { ticket = await getWsTicket(); }
    catch { setState("disconnected"); return; }

    const ws = new WebSocket(buildWsUrl(ticket, selectedVoice));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const playback = new AudioPlayback();
    playback.init();
    playRef.current = playback;

    sessionIdRef.current += 1;
    sessionSavedRef.current = false;   // arm the save-guard for this new session
    setMessages([]);
    setSources([]);

    ws.onopen = async () => {
      setState("idle");
      const capture = new AudioCapture();
      captureRef.current = capture;
      try {
        await capture.start({
          onPCMData: (pcm) => {
            if (wsRef.current?.readyState === WebSocket.OPEN && stateRef.current !== "speaking") {
              wsRef.current.send(pcm);
            }
          },
          onAmplitude: (rms) => {
            setMicAmp(rms);
            if (rms > 0.035 && stateRef.current === "idle")      setState("listening");
            if (rms <= 0.02  && stateRef.current === "listening") setState("idle");
          },
        });
      } catch (err) {
        console.error("Mic access denied:", err);
      }
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playRef.current?.enqueue(event.data);
        setState("speaking");
        return;
      }
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(event.data as string); } catch { return; }
      switch (msg.type) {
        case "status":     setState((msg.state as SessionState) || "idle"); break;
        case "transcript": {
          const role = (msg.role as string) === "user" ? "user" : "assistant";
          const text = (msg.text as string) || "";
          if (text.trim()) setMessages(p => [...p, { id: uid(), role, text, ts: Date.now() }]);
          break;
        }
        case "turn_complete": setState("idle"); break;
        case "source_cited": {
          const fn = (msg.filename as string) || "";
          if (fn) setSources(p => p.some(s => s.filename === fn) ? p : [...p, { id: uid(), filename: fn, ts: Date.now() }]);
          break;
        }
        case "tool_call":
          // Clear sources at the start of each new search so only the current
          // query's results are shown — not accumulated from previous questions
          setSources([]);
          setState("thinking");
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      captureRef.current?.stop(); captureRef.current = null;
      playRef.current?.destroy(); playRef.current = null;
      setState("disconnected"); setMicAmp(0); setSpkAmp(0);
    };
  }, [selectedVoice]);

  const disconnect = useCallback(() => {
    // Guard: only save once per session regardless of how many times this
    // callback fires (React StrictMode double-invokes cleanup effects)
    if (!sessionSavedRef.current) {
      sessionSavedRef.current = true;
      const msgs = messagesRef.current;
      if (msgs.length > 0) {
        saveSession(msgs.map(m => ({ role: m.role, text: m.text, ts: m.ts })))
          .then(({ id }) => {
            setSavedSessions(prev => [
              { id: `db-${id}`, dbId: id, messages: msgs },
              ...prev,
            ]);
          })
          .catch(() => {
            // DB save failed — keep in-memory so the user can still see it
            setSavedSessions(prev => [
              { id: `session-${sessionIdRef.current}`, messages: msgs },
              ...prev,
            ]);
          });
      }
    }
    wsRef.current?.close();
  }, []);

  const deleteSession = useCallback((id: string) => {
    if (id === "current") {
      setMessages([]);
      return;
    }
    setSavedSessions(prev => {
      const session = prev.find(s => s.id === id);
      if (session?.dbId != null) {
        deleteDbSession(session.dbId).catch(() => {});
      }
      return prev.filter(s => s.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setMessages([]);
    clearDbSessions().catch(() => {});
    setSavedSessions([]);
  }, []);

  useEffect(() => () => { disconnect(); }, [disconnect]);
  const handleLogout = async () => { disconnect(); await logout(); router.replace("/login"); };

  const handleAutoLogout = useCallback(async () => {
    disconnect();
    await logout();
    router.replace("/login");
  }, [disconnect, router]);

  const handleInactivityWarning = useCallback(() => {
    setInactivityWarning(true);
    setWarningCountdown(60);
    let secs = 60;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = window.setInterval(() => {
      secs--;
      setWarningCountdown(secs);
      if (secs <= 0 && countdownRef.current) clearInterval(countdownRef.current);
    }, 1000);
  }, []);

  const handleInactivityReset = useCallback(() => {
    setInactivityWarning(false);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  useInactivityLogout({
    timeoutMs: (parseInt(process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES || "15", 10)) * 60 * 1000,
    onWarning: handleInactivityWarning,
    onLogout: handleAutoLogout,
    onReset: handleInactivityReset,
  });

  const c        = COLORS[state];
  const isLive   = state !== "disconnected" && state !== "connecting";
  const amp      = state === "speaking" ? spkAmp : micAmp;
  const pulse    = 1 + amp * 0.45;
  const isMobile = windowWidth < 600;
  const orbSize  = Math.min(360, Math.max(220, windowWidth - 60));
  const orbScale = orbSize / 360;
  const totalMsgs = messages.length + savedSessions.reduce((n, s) => n + s.messages.length, 0);

  return (
    <div style={{
      background: "#030508", minHeight: "100vh",
      display: "flex", flexDirection: "column", alignItems: "center",
      fontFamily: "'Courier New', monospace", overflow: "hidden", position: "relative",
    }}>

      {/* Inactivity warning banner */}
      {inactivityWarning && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
          background: "rgba(255,160,0,0.1)",
          borderBottom: "1px solid rgba(255,160,0,0.35)",
          padding: "10px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          fontFamily: "'Courier New', monospace",
          backdropFilter: "blur(10px)",
        }}>
          <span style={{ fontSize: isMobile ? 9 : 11, letterSpacing: "0.1em", color: "#ffaa33" }}>
            ⚠ SESSION EXPIRES IN {warningCountdown}s — INACTIVITY DETECTED
          </span>
          <button
            onClick={handleInactivityReset}
            style={{
              background: "transparent", border: "1px solid rgba(255,160,0,0.5)",
              color: "#ffaa33", fontSize: 9, letterSpacing: "0.14em",
              padding: "4px 14px", cursor: "pointer", flexShrink: 0,
            }}
          >
            STAY LOGGED IN
          </button>
        </div>
      )}

      {/* Dot grid */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: `radial-gradient(${c.primary}30 1px, transparent 1px)`,
        backgroundSize: "28px 28px",
        maskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 20%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 20%, transparent 100%)",
      }} />

      {/* Scan lines */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.05) 3px, rgba(0,0,0,0.05) 4px)",
      }} />

      {/* HUD corners */}
      {(["tl","tr","bl","br"] as const).map(p => <HUDCorner key={p} pos={p} color={c.primary} />)}

      {/* ── Header ── */}
      <header style={{
        width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: isMobile ? "12px 14px" : "16px 28px",
        borderBottom: `1px solid ${c.primary}44`, zIndex: 10, position: "relative",
        gap: 8,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            color: c.primary, fontWeight: 700, letterSpacing: "0.35em",
            fontSize: isMobile ? 18 : 26,
            textShadow: `0 0 24px ${c.primary}66`,
          }}>
            A R I A
          </div>
          {!isMobile && (
            <div style={{ color: "#5a6a7a", fontSize: 9, letterSpacing: "0.16em", marginTop: 3 }}>
              ADAPTIVE RETRIEVAL INTELLIGENCE ASSISTANT
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
          <StatusDot active={isLive} color={c.primary} />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={() => setShowTranscript(true)}
              style={{
                background: "transparent", border: `1px solid ${c.primary}50`,
                color: `${c.primary}cc`, fontSize: 9, letterSpacing: "0.12em",
                padding: isMobile ? "4px 8px" : "4px 12px",
                cursor: "pointer", textTransform: "uppercase" as const,
                position: "relative", borderRadius: 1,
              }}
            >
              {isMobile ? "LOG" : "TRANSCRIPT"}
              {totalMsgs > 0 && (
                <span style={{
                  position: "absolute", top: -5, right: -5,
                  minWidth: 16, height: 16, borderRadius: 8, padding: "0 3px",
                  background: c.primary, color: "#000",
                  fontSize: 8, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {totalMsgs > 99 ? "99" : totalMsgs}
                </span>
              )}
            </button>
            <button onClick={handleLogout} style={{
              background: "transparent", border: "1px solid #334455",
              color: "#6a7a8a", fontSize: 9, letterSpacing: "0.14em",
              padding: isMobile ? "4px 8px" : "4px 14px",
              cursor: "pointer", textTransform: "uppercase" as const, borderRadius: 1,
            }}>
              {isMobile ? "EXIT" : "LOG OUT"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Orb section ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", width: "100%", padding: "12px 0",
        zIndex: 10, position: "relative",
      }}>

        {/* Orb container — outer div sets responsive footprint, inner scales the 360px canvas */}
        <div style={{ position: "relative", width: orbSize, height: orbSize, flexShrink: 0 }}>
        <div style={{
          position: "absolute", width: 360, height: 360,
          left: "50%", top: "50%",
          transform: `translate(-50%, -50%) scale(${orbScale})`,
          transformOrigin: "center",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>

          {/* Ambient glow backdrop */}
          <div style={{
            position: "absolute", width: 360, height: 360, borderRadius: "50%",
            background: `radial-gradient(circle, ${c.glow} 0%, transparent 62%)`,
            transform: `scale(${pulse})`,
            transition: "transform 0.1s ease-out, background 0.7s ease",
          }} />

          {/* Outermost slow dashed ring */}
          <Ring size={348} color={c.primary} opacity={0.22} rotation={tick * 0.12} dashed />

          {/* Canvas frequency visualizer — the hero element */}
          <OrbVisualizer
            ampRef={orbAmpRef}
            activeRef={orbActiveRef}
            colorRef={orbColorRef}
            stateRef={stateRef}
          />

          {/* Counter-rotating dashed mid ring */}
          <Ring size={276} color={c.primary} opacity={0.28} rotation={-tick * 0.52} dashed />

          {/* Pulsing amplitude ring */}
          <div style={{
            position: "absolute", width: 228, height: 228, borderRadius: "50%",
            border: `1px solid ${c.primary}66`,
            transform: `scale(${pulse}) rotate(${tick * 0.85}deg)`,
            transition: "transform 0.06s ease-out",
          }} />

          {/* Inner glowing ring */}
          <div style={{
            position: "absolute", width: 192, height: 192, borderRadius: "50%",
            border: `1.5px solid ${c.primary}99`,
            boxShadow: `0 0 18px ${c.glow}, inset 0 0 18px ${c.glow}`,
            transform: `rotate(${-tick * 1.05}deg)`,
          }} />

          {/* Center state icon */}
          <div style={{
            position: "relative", zIndex: 5, width: 60, height: 60, borderRadius: "50%",
            border: `2px solid ${c.primary}cc`,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `radial-gradient(circle at 34% 30%, ${c.primary}28 0%, transparent 65%)`,
            boxShadow: `0 0 28px ${c.primary}80, inset 0 0 14px ${c.primary}1a`,
            fontSize: 20, color: c.primary,
            textShadow: `0 0 14px ${c.primary}`,
            transition: "all 0.35s ease",
          }}>
            {state === "thinking" ? "⟳" : state === "speaking" ? "◈" : state === "listening" ? "◎" : "◉"}
          </div>
        </div>
        </div>{/* end outer orbSize wrapper */}

        {/* ── Status text ── */}
        <div style={{ marginTop: 28, textAlign: "center", width: "100%" }}>
          <div style={{
            color: c.primary, fontSize: isMobile ? 10 : 12,
            letterSpacing: isMobile ? "0.16em" : "0.28em",
            textTransform: "uppercase",
            textShadow: `0 0 16px ${c.primary}99`,
            padding: "0 12px",
          }}>
            {STATUS_TEXT[state]}
          </div>

          {isLive && (
            <div style={{ marginTop: 14, display: "flex", gap: 26, justifyContent: "center" }}>
              <MeterBar label="MIC INPUT" value={micAmp} color="#00c8ff" />
              <MeterBar label="AUDIO OUT" value={spkAmp} color={c.primary} />
            </div>
          )}

          {isLive && <DataTicker color={c.primary} tick={tick} />}
        </div>

        {/* ── Voice selector ── */}
        {!isLive && (
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 9, color: "#5a6a78", letterSpacing: "0.18em" }}>VOICE</div>
            <select
              value={selectedVoice}
              onChange={e => setSelectedVoice(e.target.value)}
              disabled={state === "connecting"}
              style={{
                background: "#0a0f14",
                border: `1px solid ${c.primary}44`,
                color: c.primary,
                fontSize: 10,
                letterSpacing: "0.18em",
                padding: "6px 14px",
                cursor: "pointer",
                outline: "none",
                borderRadius: 1,
                textTransform: "uppercase" as const,
                appearance: "none" as const,
                WebkitAppearance: "none" as const,
                paddingRight: 28,
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23${c.primary.replace("#", "")}'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 10px center",
              }}
            >
              <option value="Aoede">Aoede ★</option>
              <option value="Puck">Puck ★</option>
              <option value="Charon">Charon</option>
              <option value="Kore">Kore</option>
              <option value="Fenrir">Fenrir</option>
              <option value="Pulcherrima">Pulcherrima</option>
              <option value="Rasalgethi">Rasalgethi</option>
              <option value="Despina">Despina</option>
              <option value="Umbriel">Umbriel</option>
            </select>
          </div>
        )}

        {/* ── CTA ── */}
        <div style={{ marginTop: 14 }}>
          {!isLive ? (
            <button onClick={connect} disabled={state === "connecting"} style={{
              background: "transparent",
              border: `1px solid ${c.primary}`,
              color: c.primary,
              fontSize: 11, letterSpacing: "0.3em", padding: "13px 46px",
              cursor: state === "connecting" ? "not-allowed" : "pointer",
              opacity: state === "connecting" ? 0.55 : 1,
              textTransform: "uppercase" as const,
              boxShadow: `0 0 30px ${c.glow}`,
              textShadow: `0 0 10px ${c.primary}`,
              borderRadius: 1,
            }}>
              {state === "connecting" ? "INITIALIZING..." : "INITIALIZE ARIA"}
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
              <div style={{ fontSize: 9, color: "#5a6a78", letterSpacing: "0.14em" }}>
                MICROPHONE ACTIVE · SPEAK NATURALLY · ARIA DETECTS PAUSES
              </div>
              <button onClick={disconnect} style={{
                background: "transparent", border: "1px solid #cc223344",
                color: "#cc4455bb", fontSize: 9, letterSpacing: "0.18em",
                padding: "6px 22px", cursor: "pointer",
                textTransform: "uppercase" as const, borderRadius: 1,
              }}>
                TERMINATE SESSION
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Inline transcript strip ── */}
      <div style={{ width: "100%", padding: "0 16px 16px", zIndex: 10, position: "relative" }}>
        <TranscriptPanel messages={messages} accentColor={c.primary} />
      </div>

      <SourcesPanel sources={sources} />

      {showTranscript && (
        <TranscriptModal
          messages={messages}
          savedSessions={savedSessions}
          accentColor={c.primary}
          onClose={() => setShowTranscript(false)}
          onDeleteSession={deleteSession}
          onClearAll={clearAll}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Ring({
  size, color, opacity, rotation, dashed, style: extra,
}: {
  size: number; color: string; opacity: number; rotation: number;
  dashed?: boolean; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      position: "absolute", width: size, height: size, borderRadius: "50%",
      border: `1px ${dashed ? "dashed" : "solid"} ${color}`,
      opacity, transform: `rotate(${rotation}deg)`,
      ...extra,
    }} />
  );
}


function HUDCorner({ pos, color }: { pos: "tl" | "tr" | "bl" | "br"; color: string }) {
  const sz = 20;
  const base: React.CSSProperties = {
    position: "fixed", width: sz, height: sz, zIndex: 60,
    borderColor: `${color}66`, borderStyle: "solid", borderWidth: 0,
  };
  const sides: React.CSSProperties =
    pos === "tl" ? { top: 10, left: 10, borderTopWidth: 2, borderLeftWidth: 2 } :
    pos === "tr" ? { top: 10, right: 10, borderTopWidth: 2, borderRightWidth: 2 } :
    pos === "bl" ? { bottom: 10, left: 10, borderBottomWidth: 2, borderLeftWidth: 2 } :
                   { bottom: 10, right: 10, borderBottomWidth: 2, borderRightWidth: 2 };
  return <div style={{ ...base, ...sides }} />;
}

function MeterBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, value * 500);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ fontSize: 8, color: "#4a5a68", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ width: 86, height: 3, background: "#0e1218", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: color,
          borderRadius: 2, transition: "width 0.04s",
          boxShadow: `0 0 6px ${color}`,
        }} />
      </div>
      <div style={{ fontSize: 8, color: "#5a6a78", letterSpacing: "0.06em" }}>
        {Math.round(pct)}%
      </div>
    </div>
  );
}

function StatusDot({ active, color }: { active: boolean; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: active ? color : "#2a3542",
        boxShadow: active ? `0 0 9px ${color}` : "none",
        transition: "all 0.6s",
      }} />
      <span style={{
        fontSize: 9, letterSpacing: "0.1em",
        color: active ? "#8898aa" : "#3a4a58",
      }}>
        {active ? "CONNECTED" : "OFFLINE"}
      </span>
    </div>
  );
}

function DataTicker({ color, tick }: { color: string; tick: number }) {
  const val = (base: number, range: number) =>
    (base + Math.sin(tick * 0.04 + base) * range).toFixed(1);
  return (
    <div style={{
      marginTop: 10, display: "flex", gap: 22, justifyContent: "center",
      fontSize: 8, color: "#3a4a58", letterSpacing: "0.1em",
    }}>
      <span>LATENCY {val(18, 5)}MS</span>
      <span>VAD AUTO</span>
      <span>PCM 16KHZ</span>
      <span>UPTIME {Math.floor(tick / 60)}S</span>
    </div>
  );
}
