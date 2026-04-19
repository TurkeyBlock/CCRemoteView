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

      const send = (cmd: string) => useWorldStore.getState().sendCommand(selectedId, cmd)
      const clear = () => useWorldStore.getState().clearCommandQueue(selectedId)

      switch (e.key) {
        case 'w': send('return tapi.forward()'); break
        case 's': send('return tapi.back()');    break
        case 'a': send('return tapi.left()');    break
        case 'd': send('return tapi.right()');   break
        case 'q': send('return tapi.down()');    break
        case 'e': send('return tapi.up()');      break
        case 'Delete': clear();                  break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return null
}
