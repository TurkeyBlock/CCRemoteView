'use client'

import dynamic from 'next/dynamic'

const CCRemoteController = dynamic(() => import('@/components/CCRemoteController'), { ssr: false })

export default function Home() {
  return <CCRemoteController />
}
