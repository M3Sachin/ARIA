"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";

function EyeOpen() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosed() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

const CYAN = "#00d4ff";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  function playSound(src: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const audio = new Audio(src);
        audio.addEventListener("ended", () => resolve());
        audio.addEventListener("error", () => resolve());
        audio.play().catch(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(username, password);
      const timeout = new Promise<void>(r => setTimeout(r, 1000));
      await Promise.race([playSound("/access-granted.mp3"), timeout]);
      router.replace(data.role === "admin" ? "/admin" : "/agent");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      const isLocked = msg.toLowerCase().includes("locked");
      playSound(isLocked ? "/initiating-shutdown.mp3" : "/access-denied.mp3");
      setError(isLocked ? msg : "ACCESS DENIED — invalid credentials");
      setErrorKey(k => k + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        @keyframes scanline {
          0%   { transform: translateY(-10px); }
          100% { transform: translateY(100vh); }
        }
        @keyframes card-in {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes corner-blink {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1; }
        }
        @keyframes error-shake {
          0%,100% { transform: translateX(0); }
          20%     { transform: translateX(-5px); }
          40%     { transform: translateX(5px); }
          60%     { transform: translateX(-3px); }
          80%     { transform: translateX(3px); }
        }
        @keyframes btn-sweep {
          0%   { left: -60%; }
          100% { left: 120%; }
        }
        @keyframes status-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 4px #22dd88; }
          50%       { opacity: 0.5; box-shadow: 0 0 10px #22dd88; }
        }
        .login-card  { animation: card-in 0.55s cubic-bezier(0.16,1,0.3,1) forwards; }
        .login-error { animation: error-shake 0.4s ease; }
        .corner      { animation: corner-blink 2.5s ease-in-out infinite; }
        .corner:nth-child(2) { animation-delay: 0.4s; }
        .corner:nth-child(3) { animation-delay: 0.8s; }
        .corner:nth-child(4) { animation-delay: 1.2s; }
        .status-dot  { animation: status-pulse 2s ease-in-out infinite; }
        input:-webkit-autofill,
        input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 100px #05070a inset;
          -webkit-text-fill-color: #e0e8f0;
          caret-color: #e0e8f0;
        }
      `}</style>

      <main style={{
        minHeight: "100vh",
        background: "#05070a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        position: "relative",
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
      }}>

        {/* Grid */}
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none",
          backgroundImage: `
            linear-gradient(rgba(0,212,255,0.028) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,212,255,0.028) 1px, transparent 1px)
          `,
          backgroundSize: "44px 44px",
        }} />

        {/* Radial glow */}
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 70% 55% at 50% 44%, rgba(0,212,255,0.07) 0%, transparent 65%)",
        }} />

        {/* Scan line */}
        <div style={{
          position: "fixed", left: 0, right: 0, height: 80, pointerEvents: "none",
          background: "linear-gradient(to bottom, transparent, rgba(0,212,255,0.04), transparent)",
          animation: "scanline 7s linear infinite",
        }} />

        {/* Card wrapper — holds corner brackets */}
        <div className="login-card" style={{ width: "100%", maxWidth: 400, position: "relative" }}>

          {/* Corner brackets */}
          <div className="corner" style={{ position:"absolute", top:0, left:0, width:18, height:18, borderTop:`1px solid ${CYAN}`, borderLeft:`1px solid ${CYAN}` }} />
          <div className="corner" style={{ position:"absolute", top:0, right:0, width:18, height:18, borderTop:`1px solid ${CYAN}`, borderRight:`1px solid ${CYAN}` }} />
          <div className="corner" style={{ position:"absolute", bottom:0, left:0, width:18, height:18, borderBottom:`1px solid ${CYAN}`, borderLeft:`1px solid ${CYAN}` }} />
          <div className="corner" style={{ position:"absolute", bottom:0, right:0, width:18, height:18, borderBottom:`1px solid ${CYAN}`, borderRight:`1px solid ${CYAN}` }} />

          <div style={{
            background: "rgba(5,7,10,0.94)",
            border: "1px solid rgba(0,212,255,0.25)",
            padding: "40px 36px",
            backdropFilter: "blur(18px)",
          }}>

            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              {/* Mini waveform */}
              <div style={{ display:"flex", justifyContent:"center", gap:3, marginBottom:16 }}>
                {[4,7,12,8,14,9,11,6,9,5].map((h, i) => (
                  <div key={i} style={{
                    width: 2, height: h * 2.2, borderRadius: 1,
                    background: CYAN, opacity: 0.25 + (i % 4) * 0.18,
                  }} />
                ))}
              </div>

              <div style={{ fontSize: 30, fontWeight: 300, letterSpacing: "0.55em", color: "#e0e8f0", textTransform: "uppercase" }}>
                ARIA
              </div>
              <div style={{ fontSize: 8.5, letterSpacing: "0.3em", color: "rgba(0,212,255,0.75)", marginTop: 6, textTransform: "uppercase" }}>
                VOICE INTELLIGENCE SYSTEM
              </div>

              <div style={{ marginTop: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(0,212,255,0.35), transparent)` }} />
            </div>


            <form onSubmit={handleSubmit} style={{ display:"flex", flexDirection:"column", gap:22 }}>

              {/* Username field */}
              <div>
                <label style={{
                  display:"block", fontSize:9, letterSpacing:"0.22em",
                  color: focused === "user" ? CYAN : "rgba(224,232,240,0.60)",
                  marginBottom:8, textTransform:"uppercase",
                  transition:"color 0.2s",
                }}>
                  Username
                </label>
                <div style={{ position:"relative", borderBottom:`1px solid ${focused === "user" ? CYAN : "rgba(255,255,255,0.18)"}`, transition:"border-color 0.25s" }}>
                  <input
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    onFocus={() => setFocused("user")}
                    onBlur={() => setFocused(null)}
                    required
                    style={{
                      width:"100%", background:"transparent", border:"none", outline:"none",
                      fontSize:14, color:"#e0e8f0", padding:"8px 0", letterSpacing:"0.04em",
                      fontFamily:"'JetBrains Mono', monospace",
                    }}
                  />
                  {focused === "user" && (
                    <div style={{ position:"absolute", bottom:-1, left:0, right:0, height:1, background:CYAN, boxShadow:`0 0 8px ${CYAN}` }} />
                  )}
                </div>
              </div>

              {/* Password field */}
              <div>
                <label style={{
                  display:"block", fontSize:9, letterSpacing:"0.22em",
                  color: focused === "pass" ? CYAN : "rgba(224,232,240,0.60)",
                  marginBottom:8, textTransform:"uppercase",
                  transition:"color 0.2s",
                }}>
                  Password
                </label>
                <div style={{ position:"relative", borderBottom:`1px solid ${focused === "pass" ? CYAN : "rgba(255,255,255,0.18)"}`, transition:"border-color 0.25s" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onFocus={() => setFocused("pass")}
                    onBlur={() => setFocused(null)}
                    required
                    style={{
                      width:"100%", background:"transparent", border:"none", outline:"none",
                      fontSize:14, color:"#e0e8f0", padding:"8px 28px 8px 0",
                      letterSpacing: showPassword ? "0.04em" : "0.18em",
                      fontFamily:"'JetBrains Mono', monospace",
                    }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setShowPassword(v => !v)}
                    style={{
                      position:"absolute", right:0, top:"50%", transform:"translateY(-50%)",
                      background:"none", border:"none", cursor:"pointer", padding:4,
                      color: showPassword ? CYAN : "rgba(224,232,240,0.22)",
                      display:"flex", alignItems:"center",
                      transition:"color 0.2s",
                    }}
                  >
                    {showPassword ? <EyeOpen /> : <EyeClosed />}
                  </button>
                  {focused === "pass" && (
                    <div style={{ position:"absolute", bottom:-1, left:0, right:0, height:1, background:CYAN, boxShadow:`0 0 8px ${CYAN}` }} />
                  )}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div key={errorKey} className="login-error" style={{
                  fontSize:9.5, letterSpacing:"0.1em", color:"#ff5555",
                  padding:"10px 12px", border:"1px solid rgba(255,85,85,0.22)",
                  background:"rgba(255,85,85,0.05)",
                  display:"flex", alignItems:"center", gap:8,
                }}>
                  <span>&#9888;</span>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop:4, position:"relative", overflow:"hidden",
                  background: "rgba(0,212,255,0.07)",
                  border: `1px solid ${loading ? "rgba(0,212,255,0.18)" : "rgba(0,212,255,0.32)"}`,
                  color: loading ? "rgba(0,212,255,0.45)" : CYAN,
                  fontSize:10.5, letterSpacing:"0.32em", textTransform:"uppercase",
                  padding:"15px", cursor: loading ? "not-allowed" : "pointer",
                  fontFamily:"'JetBrains Mono', monospace",
                  transition:"all 0.2s", outline:"none",
                }}
                onMouseEnter={e => { if (!loading) { const b = e.currentTarget; b.style.background="rgba(0,212,255,0.13)"; b.style.boxShadow="0 0 24px rgba(0,212,255,0.12)"; } }}
                onMouseLeave={e => { const b = e.currentTarget; b.style.background="rgba(0,212,255,0.07)"; b.style.boxShadow="none"; }}
              >
                {loading && (
                  <div style={{
                    position:"absolute", top:0, bottom:0, width:"45%",
                    background:"linear-gradient(90deg,transparent,rgba(0,212,255,0.18),transparent)",
                    animation:"btn-sweep 1.1s ease-in-out infinite",
                  }} />
                )}
                <span style={{ position:"relative", zIndex:1 }}>
                  {loading ? "AUTHENTICATING ···" : "INITIALIZE SESSION"}
                </span>
              </button>

            </form>


          </div>
        </div>
      </main>
    </>
  );
}
