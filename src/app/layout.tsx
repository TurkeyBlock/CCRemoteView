import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'CC Turtle Remote Controller',
}

// Runs synchronously before first paint: sets data-theme + data-text-size on <html> without flash.
const initScript = `(function(){try{
  var s=localStorage.getItem('cc-theme');
  var t=s==='organic'||s==='neutral'?s:(window.matchMedia('(prefers-color-scheme:light)').matches?'organic':'neutral');
  document.documentElement.setAttribute('data-theme',t);
  if(t==='organic')document.documentElement.setAttribute('data-palette','clay');
  var ts=localStorage.getItem('cc-text-size');
  if(ts)document.documentElement.setAttribute('data-text-size',ts);
}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
        <link rel="stylesheet" href="/themes/theme.css" />
      </head>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
