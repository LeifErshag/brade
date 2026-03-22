import { useParams } from "react-router-dom";
// Full game board will be wired in here in Phase 10
export default function Game() {
  const { roomId } = useParams();
  return (
    <div style={{ background: "#2a1400", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#e8b86d",
      fontFamily: "Georgia, serif" }}>
      <p>Game room: {roomId} — coming in Phase 10</p>
    </div>
  );
}
