'use client'

import { useWorldStore } from '@/store/useWorld'
import InventorySlot from '../../InventorySlot'

interface Props { computerId: number }

export default function TurtleInventory({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const sendCommand = useWorldStore(s => s.sendCommand)
  if (!computer?.inv) return null

  return (
    <div style={{ backgroundColor: '#383e42', color: 'darkgray', display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
      <div style={{ width: '100%', maxWidth: 256, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, backgroundColor: '#383e42' }}>
        {computer.inv.map((slot, index) => (
          <InventorySlot
            key={index + 1}
            computerId={computerId}
            invSlot={slot ?? undefined}
            slotNum={index + 1}
            isSelected={index === computer.selectedSlot - 1}
            onClick={() => sendCommand(computerId, `tapi.select(${index + 1})`)}
          />
        ))}
      </div>
    </div>
  )
}
