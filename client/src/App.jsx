import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Game from "./pages/Game.jsx";
import Profile from "./pages/Profile.jsx";
import Leaderboard from "./pages/Leaderboard.jsx";
import AuthCallback from "./pages/AuthCallback.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/"                element={<Home />} />
      <Route path="/game/:roomId"    element={<Game />} />
      <Route path="/profile"         element={<Profile />} />
      <Route path="/leaderboard"     element={<Leaderboard />} />
      <Route path="/auth/callback"   element={<AuthCallback />} />
    </Routes>
  );
}
