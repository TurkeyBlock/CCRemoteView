interface Props {
  message: string
  subMessage?: string
  action?: { label: string; onClick: () => void }
}

export default function ModalOverlay({ message, subMessage, action }: Props) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 20 }}>
      <div className="canvas-overlay" style={{ minWidth: 'unset', padding: '14px 24px', textAlign: 'center' }}>
        <div className="overlay-value">{message}</div>
        {subMessage && <div className="overlay-title" style={{ paddingTop: 6, paddingBottom: 0 }}>{subMessage}</div>}
        {action && (
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-compact" onClick={action.onClick}>{action.label}</button>
          </div>
        )}
      </div>
    </div>
  )
}
