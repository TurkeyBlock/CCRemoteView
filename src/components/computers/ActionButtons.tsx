'use client'

import { memo, useState } from 'react'
import { Section } from '@/components/ui'
import { useComputerPanel } from './useComputerPanel'
import ConfirmDialog from '@/components/ConfirmDialog'

interface Props {
  computerId: number
  hasScanner?: boolean
  hasSensor?: boolean
  hasRideAlong?: boolean
}

export default memo(function ActionButtons({ computerId, hasScanner, hasSensor, hasRideAlong }: Props) {
  const { invokeCommand, sendStopSignal, focusOnComputer, followComputer, isFollowing, rideAlongComputer, isRideAlong, isLiveView } = useComputerPanel(computerId)
  const [stopOpen, setStopOpen] = useState(false)

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
        <button
          className={`btn btn-compact${isLiveView ? ' btn-disabled' : ''}`}
          onClick={() => { if (!isLiveView) focusOnComputer(computerId) }}
          title={isLiveView ? 'Disabled while Live-view is active' : undefined}
        >Focus</button>
        <button
          className={`btn btn-compact${isFollowing ? ' btn-toggled' : ''}${isLiveView ? ' btn-disabled' : ''}`}
          onClick={() => { if (!isLiveView) followComputer(computerId) }}
          title={isLiveView ? 'Disabled while Live-view is active' : undefined}
        >{isFollowing ? 'Unfollow' : 'Follow'}</button>
        {hasRideAlong && (
          <button
            className={`btn btn-compact${isRideAlong ? ' btn-toggled' : ''}`}
            onClick={() => rideAlongComputer(computerId)}
            title={isRideAlong ? 'Exit ride-along' : 'Ride-along: first-person player viewpoint'}
          >{isRideAlong ? 'Exit Ride-along' : 'Ride-along'}</button>
        )}
        <button className="btn btn-compact btn-danger" onClick={() => setStopOpen(true)}>Stop</button>
      </div>
      <ConfirmDialog
        open={stopOpen}
        title="Stop computer"
        message="In-progress actions will be interrupted."
        confirmLabel="Stop"
        confirmDanger
        onConfirm={() => { setStopOpen(false); sendStopSignal(computerId) }}
        onCancel={() => setStopOpen(false)}
      />
    </Section>
  )
})
