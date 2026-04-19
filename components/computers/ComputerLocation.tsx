import type { Vec } from '@/types/types'

interface Props {
  loc?: Vec | null
  showUnavailable?: boolean
}

const style: React.CSSProperties = { fontSize: '0.85em', padding: '2px 4px' }

export default function ComputerLocation({ loc, showUnavailable = false }: Props) {
  if (loc) {
    return <div style={{ ...style, color: 'darkgray' }}>📍 {loc.x}, {loc.y}, {loc.z}</div>
  }
  if (showUnavailable) {
    return <div style={{ ...style, color: 'rgb(160,100,100)', fontStyle: 'italic' }}>GPS unavailable</div>
  }
  return null
}
