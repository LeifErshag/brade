import { useEffect, useRef, useCallback } from "react";

// Reconnect backoff: 1s, 2s, 4s, 8s, 16s, then capped at 30s (plus jitter).
// The cap stays well under the server's 60s disconnect-forfeit grace, so a
// reconnect always lands before the player is forfeited.
const BASE_DELAY = 1000;
const MAX_DELAY  = 30000;

// Close codes the server uses to reject a connection for good (see ws/server.js).
// Retrying these just loops forever, so we surface the failure instead.
const TERMINAL_CODES = new Set([4001, 4002, 4003]); // bad token / bad room / room not found

export function useSocket({ roomId, token, onMessage, onOpen, onClose, onReconnecting }) {
  const ws          = useRef(null);
  const onMsgRef    = useRef(onMessage);
  const onOpenRef   = useRef(onOpen);
  const onCloseRef  = useRef(onClose);
  const onReconnRef = useRef(onReconnecting);
  onMsgRef.current    = onMessage;
  onOpenRef.current   = onOpen;
  onCloseRef.current  = onClose;
  onReconnRef.current = onReconnecting;

  const attempts       = useRef(0);
  const reconnectTimer = useRef(null);
  const connectedAt    = useRef(null);

  const send = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
      return true;
    }
    console.warn(`[ws] send dropped — socket not open (readyState=${ws.current?.readyState ?? "null"}, type=${msg?.type})`);
    return false;
  }, []);

  useEffect(() => {
    if (!roomId || !token) return;

    const base = import.meta.env.VITE_API_URL || window.location.origin;
    const url  = `${base.replace(/^http/, "ws")}/ws?room=${roomId}&token=${token}`;

    function scheduleReconnect() {
      const delay  = Math.min(BASE_DELAY * 2 ** (attempts.current - 1), MAX_DELAY);
      const jitter = Math.round(delay * 0.25 * Math.random());
      const wait   = delay + jitter;
      console.warn(`[ws] reconnecting in ${wait}ms (next attempt ${attempts.current + 1})`);
      onReconnRef.current?.();
      reconnectTimer.current = setTimeout(connect, wait);
    }

    function connect() {
      attempts.current += 1;
      const attempt   = attempts.current;
      const startedAt = Date.now();
      console.info(`[ws] connecting — attempt ${attempt}, room ${roomId}, ${new Date().toISOString()}`);

      let socket;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        console.error(`[ws] WebSocket constructor threw (attempt ${attempt}):`, err?.message ?? err);
        scheduleReconnect();
        return;
      }
      ws.current = socket;

      socket.onopen = () => {
        connectedAt.current = Date.now();
        console.info(`[ws] connected in ${connectedAt.current - startedAt}ms (attempt ${attempt})`);
        attempts.current = 0; // reset backoff after a successful connection
        onOpenRef.current?.();
      };

      socket.onmessage = (e) => {
        try {
          onMsgRef.current(JSON.parse(e.data));
        } catch (err) {
          console.error(`[ws] could not parse message:`, err?.message ?? err, String(e.data).slice(0, 200));
        }
      };

      socket.onerror = () => {
        // Browsers expose almost no detail on the error event; the close event
        // that follows carries the code/reason, logged in onclose below.
        console.error(`[ws] socket error (attempt ${attempt}, room ${roomId}) — see following close event for code/reason`);
      };

      socket.onclose = (e) => {
        const liveMs = connectedAt.current ? Date.now() - connectedAt.current : 0;
        connectedAt.current = null;
        console.warn(`[ws] closed — code=${e.code} reason="${e.reason || "(none)"}" wasClean=${e.wasClean} liveMs=${liveMs} attempt=${attempt}`);
        onCloseRef.current?.();

        if (TERMINAL_CODES.has(e.code)) {
          console.error(`[ws] giving up — server rejected with terminal code ${e.code} (${e.reason || "no reason"})`);
          return;
        }
        scheduleReconnect();
      };
    }

    connect();

    // Cleanup on unmount / dependency change: null the handlers first so the
    // intentional close doesn't trigger a reconnect, then close the socket.
    return () => {
      clearTimeout(reconnectTimer.current);
      const s = ws.current;
      if (s) {
        s.onopen = s.onmessage = s.onerror = s.onclose = null;
        s.close();
      }
      ws.current = null;
      attempts.current = 0;
    };
  }, [roomId, token]);

  return { send };
}
