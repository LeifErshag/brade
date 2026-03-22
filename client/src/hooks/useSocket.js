import { useEffect, useRef, useCallback } from "react";

// WebSocket hook — connects to game room, handles reconnection
export function useSocket({ roomId, token, onMessage }) {
  const ws      = useRef(null);
  const onMsgRef = useRef(onMessage);
  onMsgRef.current = onMessage;

  const send = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!roomId || !token) return;
    const url = `${import.meta.env.VITE_API_URL.replace("http", "ws")}/ws?room=${roomId}&token=${token}`;
    ws.current = new WebSocket(url);
    ws.current.onmessage = (e) => {
      try { onMsgRef.current(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    ws.current.onclose = () => console.log("WS closed");
    ws.current.onerror = (e) => console.error("WS error", e);
    return () => ws.current?.close();
  }, [roomId, token]);

  return { send };
}
