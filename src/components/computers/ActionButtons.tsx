'use client'

import { Section } from '@/components/ui'
import { useComputerPanel } from './useComputerPanel'

interface Props {
  computerId: number
  hasScanner?: boolean
  hasSensor?: boolean
}

export default function ActionButtons({ computerId, hasScanner, hasSensor }: Props) {
  const { invokeCommand, sendStopSignal, focusOnComputer, followComputer, isFollowing } = useComputerPanel(computerId)

  return (
    <Section label="Actions">
      <div className="btn-row-2">
        {hasScanner !== undefined && (
          <button
            className={`btn btn-compact${hasScanner ? '' : ' btn-disabled'}`}
            onClick={() => invokeCommand(computerId, 'scan')}
          >Block Scan</button>
        )}
        {hasSensor !== undefined && (
          <button
            className={`btn btn-compact${hasSensor ? '' : ' btn-disabled'}`}
            onClick={() => invokeCommand(computerId, 'sense')}
          >Entity Scan</button>
        )}
        <button className="btn btn-compact" onClick={() => focusOnComputer(computerId)}>Focus</button>
        <button
          className={`btn btn-compact${isFollowing ? ' btn-toggled' : ''}`}
          onClick={() => followComputer(computerId)}
        >{isFollowing ? 'Unfollow' : 'Follow'}</button>
        <button className="btn btn-compact btn-danger" onClick={() => sendStopSignal(computerId)}>Stop</button>
      </div>
    </Section>
  )
}
