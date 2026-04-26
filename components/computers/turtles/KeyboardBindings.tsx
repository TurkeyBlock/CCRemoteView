'use client'

import { useEffect } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'

export default function KeyboardBindings() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

      const selectedId = useWorldViewStore.getState().selectedComputerId
      if (selectedId < 0) return

      const invoke = (command: string) => useWorldStore.getState().invokeCommand(selectedId, command)
      const clear = () => useWorldStore.getState().clearCommandQueue(selectedId)

      switch (e.key) {
        case 'w': invoke('forward'); break
        case 's': invoke('back');    break
        case 'a': invoke('left');    break
        case 'd': invoke('right');   break
        case 'q': invoke('down');    break
        case 'e': invoke('up');      break
        case 'Delete': clear();      break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return null
}
