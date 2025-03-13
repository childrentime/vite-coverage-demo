import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initCoverageCollector } from './utils/coverageCollector.ts'

function errFunc(err: any) {
  console.error('初始化覆盖率收集器失败:', err)
}

// 初始化覆盖率收集器
if (process.env.COLLECT_COVERAGE === 'true') {
  initCoverageCollector().catch(errFunc)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function unusedFunction() {
  console.log('这是一个未被调用的函数')
}