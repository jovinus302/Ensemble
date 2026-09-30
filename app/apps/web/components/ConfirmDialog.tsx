"use client";

import { useEffect, useRef } from "react";

/** 되돌리기 어려운 전환 전에 한 번 묻는다. 열려 있는 동안만 그린다. */
export function ConfirmDialog({ title, message, confirmLabel, pending, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; pending: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return (
    <dialog ref={ref} className="confirm-dialog" aria-labelledby="confirm-title" onCancel={e => { e.preventDefault(); if (!pending) onCancel(); }}>
      <h2 id="confirm-title" className="confirm-title">{title}</h2>
      <p className="confirm-text">{message}</p>
      <div className="card-actions">
        <button type="button" className="btn-text" disabled={pending} onClick={onCancel}>취소</button>
        <button type="button" className="btn-primary" disabled={pending} onClick={onConfirm} autoFocus>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
