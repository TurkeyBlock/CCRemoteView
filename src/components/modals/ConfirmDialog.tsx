'use client'

import { Modal } from '@/components/modals/Modal'

interface Props {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  confirmDanger?: boolean
}

export default function ConfirmDialog({
  open, title, message, onConfirm, onCancel,
  confirmLabel = 'Confirm', confirmDanger = false,
}: Props) {
  if (!open) return null
  return (
    <Modal layer="confirm" onBackdropClick={onCancel}>
      <div
        className="dropdown"
        style={{ minWidth: 300, maxWidth: 400 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="dropdown-section">
          <div className="heading">{title}</div>
          <p className="explainer" style={{ margin: 0 }}>{message}</p>
        </div>
        <div className="dropdown-divider" />
        <div className="dropdown-section">
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-compact" onClick={onCancel}>Cancel</button>
            <button
              className={`btn btn-compact ${confirmDanger ? 'btn-danger' : 'btn-primary'}`}
              onClick={onConfirm}
            >{confirmLabel}</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
