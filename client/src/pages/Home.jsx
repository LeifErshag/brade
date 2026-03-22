import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

const S = {
  page: {
    background: "#2a1400", minHeight: "100vh", display: "flex",
    alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif",
  },
  center: { textAlign: "center" },
  title: { color: "#e8b86d", fontSize: 48, letterSpacing: 4, margin: 0 },
  subtitle: { color: "#a07840", fontSize: 16, marginTop: 8 },
  row: { marginTop: 32, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" },
  btnPrimary: {
    background: "#6b3a10", color: "#e8b86d", padding: "10px 24px",
    borderRadius: 8, textDecoration: "none", fontSize: 14, border: "none", cursor: "pointer",
  },
  btnSecondary: {
    background: "#3a1a00", color: "#a07840", padding: "10px 24px",
    borderRadius: 8, textDecoration: "none", fontSize: 14, border: "none", cursor: "pointer",
  },
  avatar: { width: 56, height: 56, borderRadius: "50%", border: "2px solid #6b3a10" },
  avatarPlaceholder: {
    width: 56, height: 56, borderRadius: "50%", border: "2px solid #6b3a10",
    background: "#6b3a10", display: "inline-flex", alignItems: "center", justifyContent: "center",
    color: "#e8b86d", fontSize: 22, fontFamily: "Georgia, serif",
  },
  name: { color: "#e8b86d", fontSize: 18, marginTop: 12 },
  elo: { color: "#a07840", fontSize: 13, marginTop: 4 },
};

export default function Home() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div style={S.page}>
        <p style={{ color: "#a07840" }}>…</p>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.center}>
        <h1 style={S.title}>Bräde</h1>
        <p style={S.subtitle}>Svenskt Brädspel</p>

        {user ? (
          <>
            <div style={{ marginTop: 28 }}>
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" style={S.avatar} />
                : <span style={S.avatarPlaceholder}>{user.display_name[0].toUpperCase()}</span>
              }
              <p style={S.name}>{user.display_name}</p>
              <p style={S.elo}>ELO {user.elo} · {user.wins}W {user.losses}L</p>
            </div>
            <div style={S.row}>
              <Link to="/profile" style={S.btnPrimary}>Profile</Link>
              <button style={S.btnSecondary} onClick={logout}>Sign out</button>
            </div>
          </>
        ) : (
          <div style={S.row}>
            <a href="/auth/google" style={S.btnPrimary}>Sign in with Google</a>
            <a href="/auth/github" style={S.btnSecondary}>Sign in with GitHub</a>
          </div>
        )}
      </div>
    </div>
  );
}
