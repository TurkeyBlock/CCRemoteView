import { useImperativeHandle, type Ref } from 'react'

export interface PanelHandle { setOpen: (v: boolean) => void }

/**
 * Wires a panel's local `setOpen` setter to a forwarded ref so the parent can
 * imperatively open/close the panel. Collapses the repeated
 * `useImperativeHandle(ref, () => ({ setOpen }), [])` boilerplate.
 */
export function usePanelHandle(
  ref: Ref<PanelHandle>,
  setOpen: (v: boolean) => void,
) {
  useImperativeHandle(ref, () => ({ setOpen }), [setOpen])
}
