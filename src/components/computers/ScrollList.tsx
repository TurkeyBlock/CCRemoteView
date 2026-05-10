import { sectionLabel } from './computerStyles'

interface Props {
  label?: string
  count?: number
  maxHeight?: number
  children: React.ReactNode
}

export default function ScrollList({ label, count, maxHeight = 120, children }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label && (
        <div style={sectionLabel}>
          {label}{count !== undefined ? ` (${count})` : ''}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight, overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  )
}
