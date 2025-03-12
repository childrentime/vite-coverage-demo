import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initCoverageCollector } from './utils/coverageCollector.ts'

// 初始化覆盖率收集器
if (process.env.COLLECT_COVERAGE === 'true') {
  initCoverageCollector().catch(err => {
    console.error('初始化覆盖率收集器失败:', err)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)