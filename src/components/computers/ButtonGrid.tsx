interface Props {
  columns?: 2 | 3
  children: React.ReactNode
}

export default function ButtonGrid({ columns = 2, children }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 2 }}>
      {children}
    </div>
  )
}
