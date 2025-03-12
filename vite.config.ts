import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import istanbulPlugin from 'vite-plugin-istanbul'

// https://vitejs.dev/config/
export default defineConfig( {
    plugins: [
      // 使用标准 React 插件
      react(),
      
      // 始终启用 Istanbul 插件，不再根据环境变量条件启用
      istanbulPlugin({
        include: 'src/*',
        exclude: ['node_modules', 'test/', '**/*.test.tsx', '**/*.spec.tsx'],
        extension: ['.js', '.jsx', '.ts', '.tsx'],
        requireEnv: false, // 允许在任何环境下收集覆盖率数据
      }),
    ],
    
    build: {
      sourcemap: true, // 确保构建时包含sourcemap，这对代码覆盖率很重要
      target: 'es2015', // 确保 ESM 模块在构建过程中正确处理
    },
    
    define: {
      // 注入环境变量
      'process.env.COLLECT_COVERAGE': JSON.stringify(process.env.COLLECT_COVERAGE || 'false'),
      'process.env.PR_NUMBER': JSON.stringify(process.env.PR_NUMBER || ''),
      'process.env.BRANCH_NAME': JSON.stringify(process.env.BRANCH_NAME || 'main'),
      'process.env.COMMIT_SHA': JSON.stringify(process.env.COMMIT_SHA || ''),
    },
    
    optimizeDeps: {
      // 确保依赖项被正确处理为 ESM
      esbuildOptions: {
        target: 'es2020',
        supported: { 
          bigint: true 
        },
      }
    },
    // 添加解析选项以确保使用 ESM
    resolve: {
      mainFields: ['module', 'browser', 'main'],
    },
    
    // esbuild 选项以保持 ESM 格式
    esbuild: {
      keepNames: true,
      format: 'esm'
    }
})