import { useState } from 'react'
import { Counter } from './components/Counter'
import './App.css'
import { reportCurrentCoverage } from './utils/coverageCollector'

function App() {
  const [showCoverage, setShowCoverage] = useState(false)
  
  // 一些可能不会被执行的代码，用于测试覆盖率
  const handleShowCoverage = () => {
    setShowCoverage(prev => !prev)
    
    // 主动上报覆盖率
    if (process.env.COLLECT_COVERAGE === 'true') {
      console.log('process.env.COLLECT_COVERAGE:', process.env.COLLECT_COVERAGE)
      reportCurrentCoverage().catch(console.error)
    }
  }

  return (
    <div className="App">
      <h1>代码覆盖率实时收集演示</h1>
      
      <div className="card">
        <Counter initialValue={5} />
        
        <button onClick={handleShowCoverage}>
          {showCoverage ? '隐藏' : '显示'}覆盖率信息
        </button>
        
        {showCoverage && (
          <div className="coverage-info">
            <h3>覆盖率收集信息</h3>
            <p>
              PR编号: {process.env.PR_NUMBER || '未知'}
              <br />
              分支: {process.env.BRANCH_NAME || 'main'}
              <br />
              提交: {process.env.COMMIT_SHA || '未知'}
            </p>
            <p>
              覆盖率数据正在实时收集中...
              <br />
              当你点击页面上的按钮和交互元素时，
              <br />
              覆盖率数据会自动上报到服务器。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App