import type { Vec } from '@/types/world'
import { FS } from '@/utils/fontSize'

interface Props {
  loc?: Vec | null
  showUnavailable?: boolean
}

export default function ComputerLocation({ loc, showUnavailable = false }: Props) {
  if (loc) {
    return (
      <span className="coord">
        <span><span className="coord-ax">X</span>{loc.x}</span>
        <span><span className="coord-ax">Y</span>{loc.y}</span>
        <span><span className="coord-ax">Z</span>{loc.z}</span>
      </span>
    )
  }
  if (showUnavailable) {
    return <span className="muted" style={{ fontStyle: 'italic', fontSize: FS['12'] }}>GPS unavailable</span>
  }
  return null
}
