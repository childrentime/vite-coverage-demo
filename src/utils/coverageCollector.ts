import axios from "axios";
import { v4 as uuidv4 } from "uuid";

// 覆盖率收集服务的URL
const COVERAGE_API_URL = 
  import.meta.env.VITE_COVERAGE_API_URL || "/.netlify/functions/coverage";

// 会话ID，用于标识单个用户的浏览会话
const SESSION_ID = uuidv4();

// 是否启用覆盖率收集
const COLLECT_COVERAGE = import.meta.env.VITE_COLLECT_COVERAGE === "true";
console.log("COLLECT_COVERAGE:", COLLECT_COVERAGE);

// PR和分支信息
const PR_NUMBER = import.meta.env.VITE_PR_NUMBER || "";
const BRANCH_NAME = import.meta.env.VITE_BRANCH_NAME || "main";
const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA || "";

// 存储键名
const COVERAGE_STORAGE_KEY = "coverage_data";
const LAST_REPORT_KEY = "last_coverage_report";

interface CoverageMetadata {
  prNumber: string;
  branchName: string;
  commitSha: string;
  sessionId: string;
  timestamp: number;
}

/**
 * localStorage辅助函数，支持JSON序列化和反序列化
 */
function getItem<T>(key: string): T | null {
  const item = localStorage.getItem(key);
  if (item) {
    try {
      return JSON.parse(item) as T;
    } catch (e) {
      console.error("解析存储数据失败:", e);
      return null;
    }
  }
  return null;
}

function setItem(key: string, value: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("存储数据失败:", e);
  }
}

function removeItem(key: string): void {
  localStorage.removeItem(key);
}

/**
 * 初始化覆盖率收集器
 */
export async function initCoverageCollector() {
  if (!COLLECT_COVERAGE) {
    console.log("覆盖率收集未启用，跳过初始化");
    return;
  }

  console.log("初始化覆盖率收集器...");

  // 检查是否有未上报的覆盖率数据
  const pendingCoverage = getItem<any>(COVERAGE_STORAGE_KEY);
  if (pendingCoverage) {
    console.log("发现未上报的覆盖率数据，正在上报...");
    await reportCoverage(pendingCoverage);
    removeItem(COVERAGE_STORAGE_KEY);
  }

  // 设置定期上报
  setupPeriodicReporting();

  // 设置离开页面时上报
  window.addEventListener("beforeunload", () => {
    // 注意：这里不能使用async/await，因为beforeunload事件不会等待异步操作
    reportCurrentCoverageSync();
  });

  console.log("覆盖率收集器初始化完成，会话ID:", SESSION_ID);
}

/**
 * 设置定期上报覆盖率数据
 */
function setupPeriodicReporting() {
  // 每5分钟上报一次
  setInterval(async () => {
    await reportCurrentCoverage();
  }, 5 * 60 * 1000);
}

/**
 * 同步上报当前覆盖率数据（用于beforeunload事件）
 */
function reportCurrentCoverageSync() {
  if (!COLLECT_COVERAGE || !window.__coverage__) {
    return;
  }

  // 获取当前覆盖率数据
  const coverage = window.__coverage__;
  
  // 获取上次报告的时间
  const lastReport = getItem<number>(LAST_REPORT_KEY) || 0;
  const now = Date.now();

  // 如果距离上次报告不到1分钟，则暂存数据等待下次上报
  if (now - lastReport < 60 * 1000) {
    setItem(COVERAGE_STORAGE_KEY, coverage);
    return;
  }

  // 尝试同步上报（使用sendBeacon API，更适合页面卸载时发送数据）
  try {
    const metadata: CoverageMetadata = {
      prNumber: PR_NUMBER,
      branchName: BRANCH_NAME,
      commitSha: COMMIT_SHA,
      sessionId: SESSION_ID,
      timestamp: Date.now(),
    };

    const blob = new Blob([JSON.stringify({ coverage, metadata })], { 
      type: 'application/json' 
    });
    
    const success = navigator.sendBeacon(COVERAGE_API_URL, blob);
    
    if (success) {
      setItem(LAST_REPORT_KEY, now);
      removeItem(COVERAGE_STORAGE_KEY);
    } else {
      setItem(COVERAGE_STORAGE_KEY, coverage);
    }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // 保存到本地存储，稍后重试
    setItem(COVERAGE_STORAGE_KEY, coverage);
  }
}

/**
 * 上报当前覆盖率数据
 */
export async function reportCurrentCoverage() {
  console.log('coverage',COLLECT_COVERAGE, window.__coverage__)
  if (!COLLECT_COVERAGE || !window.__coverage__) {
    return;
  }

  // 获取当前覆盖率数据
  const coverage = window.__coverage__;

  // 获取上次报告的时间
  const lastReport = getItem<number>(LAST_REPORT_KEY) || 0;
  const now = Date.now();

  // 如果距离上次报告不到1分钟，则暂存数据等待下次上报
  if (now - lastReport < 60 * 1000) {
    setItem(COVERAGE_STORAGE_KEY, coverage);
    return;
  }

  // 上报覆盖率数据
  try {
    await reportCoverage(coverage);
    setItem(LAST_REPORT_KEY, now);
    removeItem(COVERAGE_STORAGE_KEY);
    console.log("覆盖率数据上报成功");
  } catch (error) {
    console.error("覆盖率数据上报失败:", error);
    // 保存到本地存储，稍后重试
    setItem(COVERAGE_STORAGE_KEY, coverage);
  }
}

/**
 * 上报覆盖率数据到服务器
 */
async function reportCoverage(coverage: any) {
  const metadata: CoverageMetadata = {
    prNumber: PR_NUMBER,
    branchName: BRANCH_NAME,
    commitSha: COMMIT_SHA,
    sessionId: SESSION_ID,
    timestamp: Date.now(),
  };

  await axios.post(COVERAGE_API_URL, {
    coverage,
    metadata,
  });
}

/**
 * 声明window上的全局变量
 */
declare global {
  interface Window {
    __coverage__: any;
  }
}