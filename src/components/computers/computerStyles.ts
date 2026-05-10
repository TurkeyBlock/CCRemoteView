import type { CSSProperties } from 'react'

export const colors = {
  bg:          '#383e42',
  bgDeep:      '#2a2e32',
  text:        'darkgray'           as const,
  textLight:   'lightgray'          as const,
  textBlue:    'rgb(120,180,240)',
  textName:    'rgb(180,180,220)',
  activeBg:    'rgb(50,100,50)',
  activeText:  'rgb(150,220,150)',
  missingBg:   'rgba(140,30,30,0.6)',
  missingText: 'rgb(255,110,110)',
}

export const btn: CSSProperties = {
  padding: '8px 0',
  borderRadius: 4,
  backgroundColor: colors.bg,
  color: colors.text,
  border: 'none',
  cursor: 'pointer',
}

export const activeBtn: CSSProperties = {
  ...btn,
  backgroundColor: colors.activeBg,
  color: colors.activeText,
}

export const missingBtn: CSSProperties = {
  ...btn,
  backgroundColor: colors.missingBg,
  color: colors.missingText,
}

export const inputStyle: CSSProperties = {
  padding: '4px 6px',
  borderRadius: 4,
  backgroundColor: colors.bgDeep,
  color: colors.textLight,
  border: '1px solid #4a5060',
  width: '100%',
  boxSizing: 'border-box',
}

export const sectionLabel: CSSProperties = {
  fontSize: '0.75em',
  color: 'gray',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
