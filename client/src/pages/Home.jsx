// Setup screen / lobby — game UI will move here from the artifact in Phase 10
export default function Home() {
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ color: "#e8b86d", fontSize: 48, letterSpacing: 4 }}>Bräde</h1>
        <p style={{ color: "#a07840", fontSize: 16 }}>Svenskt Brädspel</p>
        <div style={{ marginTop: 32, display: "flex", gap: 16, justifyContent: "center" }}>
          <a href="/auth/google" style={{ background: "#6b3a10", color: "#e8b86d",
            padding: "10px 24px", borderRadius: 8, textDecoration: "none", fontSize: 14 }}>
            Sign in with Google
          </a>
          <a href="/auth/github" style={{ background: "#3a1a00", color: "#a07840",
            padding: "10px 24px", borderRadius: 8, textDecoration: "none", fontSize: 14 }}>
            Sign in with GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
