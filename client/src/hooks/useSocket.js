import { useEffect, useRef, useCallback } from "react";

export function useSocket({ roomId, token, onMessage, onOpen, onClose }) {
  const ws       = useRef(null);
  const onMsgRef = useRef(onMessage);
  onMsgRef.current = onMessage;

  const send = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!roomId || !token) return;
    const base = import.meta.env.VITE_API_URL || window.location.origin;
    const url  = `${base.replace(/^http/, "ws")}/ws?room=${roomId}&token=${token}`;
    ws.current = new WebSocket(url);
    ws.current.onopen    = () => onOpen?.();
    ws.current.onmessage = (e) => {
      try { onMsgRef.current(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    ws.current.onclose = () => onClose?.();
    ws.current.onerror = (e) => console.error("WS error", e);
    return () => ws.current?.close();
  }, [roomId, token]);

  return { send };
}
