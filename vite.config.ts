import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { babel } from '@rollup/plugin-babel'
import istanbulPlugin from 'vite-plugin-istanbul'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    istanbulPlugin({
      include: 'src/*',
      exclude: ['node_modules', 'test/', '**/*.test.tsx', '**/*.spec.tsx'],
      extension: ['.js', '.jsx', '.ts', '.tsx'],
      requireEnv: false, // 允许在任何环境下收集覆盖率数据
    }),
    babel({
      babelHelpers: 'bundled',
      presets: [
        '@babel/preset-env',
        ['@babel/preset-react', { runtime: 'automatic' }],
        '@babel/preset-typescript'
      ],
      plugins: [
        ['istanbul', {
          exclude: [
            'node_modules/**',
            '**/*.test.{ts,tsx}',
            '**/*.spec.{ts,tsx}',
          ]
        }]
      ],
      extensions: ['.js', '.jsx', '.ts', '.tsx']
    })
  ],
  build: {
    sourcemap: true, // 确保构建时包含sourcemap，这对代码覆盖率很重要
  },
  define: {
    // 注入环境变量以便根据不同环境决定是否启用覆盖率收集
    'process.env.COLLECT_COVERAGE': JSON.stringify(process.env.COLLECT_COVERAGE || 'false'),
    'process.env.PR_NUMBER': JSON.stringify(process.env.PR_NUMBER || ''),
    'process.env.BRANCH_NAME': JSON.stringify(process.env.BRANCH_NAME || 'main'),
    'process.env.COMMIT_SHA': JSON.stringify(process.env.COMMIT_SHA || ''),
  }
})