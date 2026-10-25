import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext.jsx";
import { sendProblemReport } from "../remoteLog.js";

const S = {
  link: {
    background: "none", border: "none", padding: "4px 2px", cursor: "pointer",
    color: "#a07840", fontSize: 12, fontFamily: "Georgia, serif", textDecoration: "underline",
    flexShrink: 0,
  },
  dialog: {
    background: "#3a1a00", color: "#e8b86d", border: "1px solid #6b3a10", borderRadius: 12,
    padding: 0, width: "min(440px, calc(100vw - 32px))", boxSizing: "border-box",
    fontFamily: "Georgia, serif",
  },
  body:    { padding: "20px 22px" },
  title:   { margin: "0 0 8px", fontSize: 20 },
  intro:   { margin: "0 0 12px", color: "#a07840", fontSize: 14, lineHeight: 1.4 },
  textarea: {
    width: "100%", boxSizing: "border-box", minHeight: 110, resize: "vertical",
    background: "#2a1400", color: "#f5e6c8", border: "1px solid #6b3a10", borderRadius: 6,
    padding: 8, fontSize: 14, fontFamily: "inherit",
  },
  error:   { color: "#e07a5f", fontSize: 13, margin: "8px 0 0" },
  done:    { margin: "0 0 4px", fontSize: 15, lineHeight: 1.4 },
  buttons: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 },
  btn: {
    background: "#2a1400", color: "#e8b86d", border: "1px solid #6b3a10", borderRadius: 6,
    padding: "7px 14px", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
  },
  btnPrimary: { background: "#6b3a10", borderColor: "#a06030" },
};

const MAX_NOTE = 2000;

/**
 * "Report a problem" link and dialog (issue #141). Sends the player's note
 * with what the page showed and the recent client log lines, and shows the
 * short report ID to quote.
 */
export default function ReportProblem({ style }) {
  const { t, serverError } = useI18n();
  const titleId = useId();
  const dialogRef = useRef(null);
  // Bumped on each opening, so a report still sending from an earlier opening
  // cannot replace the new form with its result.
  const openingRef = useRef(0);
  const pressedBackdropRef = useRef(false);
  const [open, setOpen]         = useState(false);
  const [note, setNote]         = useState("");
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState(null);
  const [reportId, setReportId] = useState(null);

  // A native modal dialog: focus trap and Escape come for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function openDialog() {
    openingRef.current += 1;
    setSending(false);
    setNote("");
    setError(null);
    setReportId(null);
    setOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    const text = note.trim();
    if (!text || sending) return;
    const opening = openingRef.current;
    setSending(true);
    setError(null);
    try {
      const id = await sendProblemReport(text);
      if (opening === openingRef.current) setReportId(id);
    } catch (err) {
      if (opening === openingRef.current) {
        setError(err?.serverError ? serverError(err.serverError) : t("error.network"));
      }
    } finally {
      if (opening === openingRef.current) setSending(false);
    }
  }

  // Closes on a click on the backdrop. Only when the press started there too:
  // a text selection dragged out of the textarea also ends in a click on the
  // dialog element. A click on the dialog element can also be on its border
  // or its scrollbar (a short screen), so it must be outside its box as well.
  function onBackdrop(e) {
    if (e.target !== e.currentTarget) return false;
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientX < box.left || e.clientX >= box.right || e.clientY < box.top || e.clientY >= box.bottom;
  }
  function onBackdropPointerDown(e) {
    pressedBackdropRef.current = onBackdrop(e);
  }
  function onBackdropClick(e) {
    if (pressedBackdropRef.current && onBackdrop(e)) setOpen(false);
    pressedBackdropRef.current = false;
  }

  return (
    <>
      <button type="button" style={{ ...S.link, ...style }} onClick={openDialog} aria-haspopup="dialog">
        {t("report.link")}
      </button>
      <dialog
        ref={dialogRef}
        style={S.dialog}
        aria-labelledby={titleId}
        // Escape or the form's close: keep React state in step.
        onClose={() => setOpen(false)}
        onPointerDown={onBackdropPointerDown}
        onClick={onBackdropClick}
      >
        <div style={S.body}>
          <h2 id={titleId} style={S.title}>{t("report.title")}</h2>
          {reportId ? (
            <>
              <p style={S.done} role="status">{t("report.sent", { id: reportId })}</p>
              <div style={S.buttons}>
                <button type="button" style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setOpen(false)} autoFocus>
                  {t("report.close")}
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={submit}>
              <p style={S.intro}>{t("report.intro")}</p>
              <textarea
                style={S.textarea}
                value={note}
                onChange={e => setNote(e.target.value.slice(0, MAX_NOTE))}
                placeholder={t("report.placeholder")}
                aria-label={t("report.title")}
                maxLength={MAX_NOTE}
                autoFocus
              />
              {error && <p style={S.error} role="alert">{error}</p>}
              <div style={S.buttons}>
                <button type="button" style={S.btn} onClick={() => setOpen(false)}>
                  {t("report.cancel")}
                </button>
                <button type="submit" style={{ ...S.btn, ...S.btnPrimary }} disabled={sending || !note.trim()}>
                  {sending ? t("report.sending") : t("report.send")}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
