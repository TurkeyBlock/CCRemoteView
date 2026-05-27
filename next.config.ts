import type { NextConfig } from 'next'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const serverConfig = require('./src/server/config')

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd()),
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei'],
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_COMPUTER_POLL_INTERVAL_S: String(serverConfig.COMPUTER_POLL_INTERVAL_S),
  },
}

export default nextConfig
