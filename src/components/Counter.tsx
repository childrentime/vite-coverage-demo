import { useState } from 'react';
import { reportCurrentCoverage } from '../utils/coverageCollector';

interface CounterProps {
  initialValue?: number;
}

export function Counter({ initialValue = 0 }: CounterProps) {
  const [count, setCount] = useState(initialValue);

  const increment = () => {
    setCount(count + 1);
    // 每次交互后主动上报覆盖率数据
    if (process.env.COLLECT_COVERAGE === 'true') {
      reportCurrentCoverage().catch(console.error);
    }
  };
  
  const decrement = () => {
    setCount(count - 1);
    if (process.env.COLLECT_COVERAGE === 'true') {
      reportCurrentCoverage().catch(console.error);
    }
  };
  
  const reset = () => {
    setCount(initialValue);
    if (process.env.COLLECT_COVERAGE === 'true') {
      reportCurrentCoverage().catch(console.error);
    }
  };

  // 这个函数是为了演示覆盖率收集的一些分支逻辑
  const getCountStatus = () => {
    if (count > 10) {
      return "高值";
    } else if (count < 0) {
      return "负值";
    } else if (count === 0) {
      return "零值";
    } else {
      return "正常值";
    }
  };

  return (
    <div className="counter">
      <h2>计数器: {count}</h2>
      <p>状态: {getCountStatus()}</p>
      <div>
        <button onClick={decrement} data-testid="decrement-btn">减少</button>
        <button onClick={increment} data-testid="increment-btn">增加</button>
        <button onClick={reset} data-testid="reset-btn">重置</button>
      </div>
    </div>
  );
}