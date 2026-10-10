import { useEffect, useRef, useState } from "react";
import RulesContent from "./RulesContent.jsx";

// Narrow screens get a bottom sheet instead of a side panel.
const MOBILE_QUERY = "(max-width: 640px)";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(MOBILE_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia?.(MOBILE_QUERY);
    if (!mq) return;
    const onChange = e => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

const S = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 900,
    transition: "opacity 200ms ease",
  },
  panelBase: {
    position: "fixed", zIndex: 901, background: "#3a1a00", display: "flex", flexDirection: "column",
    boxShadow: "0 0 32px #000000aa", boxSizing: "border-box",
    transition: "transform 220ms ease, visibility 220ms",
  },
  panelDesktop: {
    top: 0, right: 0, bottom: 0, width: 440, maxWidth: "100vw",
    borderLeft: "1px solid #6b3a10",
  },
  panelMobile: {
    left: 0, right: 0, bottom: 0, height: "88vh", maxHeight: "88dvh",
    borderTop: "1px solid #6b3a10", borderRadius: "14px 14px 0 0",
  },
  handle: { width: 40, height: 4, borderRadius: 2, background: "#6b3a10", margin: "8px auto 0", flexShrink: 0 },
  header: {
    display: "flex", alignItems: "center", gap: 12, padding: "12px 18px",
    borderBottom: "1px solid #4a2800", flexShrink: 0,
  },
  title: { color: "#e8b86d", fontSize: 20, margin: 0, flex: 1, fontFamily: "Georgia, serif", fontWeight: "normal" },
  close: {
    background: "#2a1400", color: "#e8b86d", border: "1px solid #6b3a10", borderRadius: 6,
    padding: "6px 14px", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif",
  },
  body: { overflowY: "auto", padding: "4px 18px 24px", flex: 1, WebkitOverflowScrolling: "touch" },
};

/**
 * Rules drawer for the game view.
 *
 * Stays mounted while closed (hidden off-screen with visibility:hidden) so the
 * reader's scroll position survives close/reopen. It's a fixed overlay sibling
 * of the game UI and owns no game state, so opening/closing it never re-mounts
 * the board or touches the WebSocket.
 *
 * Props:
 *   open, onClose – controlled visibility
 *   section       – optional rules section id to scroll to when opened
 *                   (e.g. "rules-bearing-off"); see RULES_SECTIONS
 */
export default function RulesDrawer({ open, onClose, section }) {
  const isMobile = useIsMobile();
  const closeBtnRef = useRef(null);
  const bodyRef     = useRef(null);

  function scrollToSection(id) {
    const el = bodyRef.current?.querySelector(`#${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Keep the latest onClose in a ref so parent re-renders (e.g. every
  // ROOM_STATE message) don't re-run the open effect below.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape closes; focus moves into the drawer on open and back out on close.
  useEffect(() => {
    if (!open) return;
    const returnFocusTo = document.activeElement;
    closeBtnRef.current?.focus({ preventScroll: true });
    if (section) scrollToSection(section);
    const onKey = e => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnFocusTo?.focus?.({ preventScroll: true });
    };
  }, [open, section]);

  // Lock background scroll while open (mainly for the mobile bottom sheet).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const hiddenTransform = isMobile ? "translateY(100%)" : "translateX(100%)";

  return (
    <>
      <div
        style={{ ...S.backdrop, opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-drawer-title"
        aria-hidden={!open}
        style={{
          ...S.panelBase,
          ...(isMobile ? S.panelMobile : S.panelDesktop),
          transform: open ? "none" : hiddenTransform,
          visibility: open ? "visible" : "hidden",
        }}
      >
        {isMobile && <div style={S.handle} aria-hidden="true" />}
        <div style={S.header}>
          <h2 id="rules-drawer-title" style={S.title}>Spelregler</h2>
          <button ref={closeBtnRef} type="button" onClick={onClose} style={S.close} aria-label="Stäng reglerna">
            Stäng ✕
          </button>
        </div>
        <div ref={bodyRef} style={S.body}>
          <RulesContent onNavigate={scrollToSection} />
        </div>
      </aside>
    </>
  );
}
