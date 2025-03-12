import { v4 as uuidv4 } from "uuid";

// 覆盖率收集服务的URL
const COVERAGE_API_URL = 
  import.meta.env.VITE_COVERAGE_API_URL || "/.netlify/functions/coverage";

// 会话ID，用于标识单个用户的浏览会话
const SESSION_ID = uuidv4();

// 是否启用覆盖率收集
const COLLECT_COVERAGE = import.meta.env.VITE_COLLECT_COVERAGE === "true";
console.log("COVERAGE_API_URL:", COVERAGE_API_URL);
console.log("COLLECT_COVERAGE:", COLLECT_COVERAGE);

// PR和分支信息
const PR_NUMBER = import.meta.env.VITE_PR_NUMBER || "";
const BRANCH_NAME = import.meta.env.VITE_BRANCH_NAME || "main";
const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA || "";

// 存储键名
const COVERAGE_STORAGE_KEY = "coverage_data";

interface CoverageMetadata {
  prNumber: string;
  branchName: string;
  commitSha: string;
  sessionId: string;
  timestamp: number;
  incremental: boolean; // 标记是否为增量覆盖率数据
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
  console.log("环境信息:", {
    PR_NUMBER,
    BRANCH_NAME,
    COMMIT_SHA,
    SESSION_ID
  });

  // 检查是否有未上报的覆盖率数据
  const pendingCoverage = getItem<any>(COVERAGE_STORAGE_KEY);
  if (pendingCoverage) {
    removeItem(COVERAGE_STORAGE_KEY);
  }

  const reportIfVisible = () => {
    if (document.visibilityState === 'visible') {
      console.log("页面可见，准备上报覆盖率数据");
      
      // 延迟上报，确保是真实用户访问
      setTimeout(() => {
        reportCurrentCoverage(false).catch(err => {
          console.error("初始上报失败:", err);
        });
      }, 3000);
      
      // 已完成初始上报，不再需要监听visibilitychange事件
      document.removeEventListener('visibilitychange', reportIfVisible);
    }
  };

  document.addEventListener('visibilitychange', reportIfVisible);

  console.log("覆盖率收集器初始化完成，会话ID:", SESSION_ID);
  
  // 检查覆盖率对象
  if (window.__coverage__) {
    console.log("检测到覆盖率对象，包含键数量:", Object.keys(window.__coverage__).length);
  } else {
    console.warn("未检测到覆盖率对象! 插桩可能未成功");
  }
}


/**
 * 上报当前覆盖率数据
 * @param incremental 是否为增量覆盖率（用户交互后的数据）
 */
export async function reportCurrentCoverage(incremental: boolean = false) {
  console.log(`尝试上报${incremental ? '增量' : '初始'}覆盖率数据, COLLECT_COVERAGE:`, COLLECT_COVERAGE, 'window.__coverage__:', !!window.__coverage__);
  
  if (!COLLECT_COVERAGE) {
    console.log("覆盖率收集未启用，跳过上报");
    return;
  }

  if (!window.__coverage__) {
    console.warn("警告: 无法找到覆盖率数据对象");
    return;
  }

  // 获取当前覆盖率数据
  const coverage = window.__coverage__;
  const coverageKeys = Object.keys(coverage);
  console.log(`覆盖率对象包含 ${coverageKeys.length} 个文件/模块的数据`);

  // 上报覆盖率数据
  try {
    console.log(`正在上报${incremental ? '增量' : '初始'}覆盖率数据...`);
    await reportCoverage(coverage, incremental);
    removeItem(COVERAGE_STORAGE_KEY);
    console.log("覆盖率数据上报成功");
  } catch (error) {
    console.error("覆盖率数据上报失败:", error);
    // 保存到本地存储，下次页面加载时重试
    setItem(COVERAGE_STORAGE_KEY, coverage);
  }
}

/**
 * 上报覆盖率数据到服务器
 * @param coverage 覆盖率数据
 * @param incremental 是否为增量覆盖率
 */
async function reportCoverage(coverage: any, incremental: boolean) {
  const metadata: CoverageMetadata = {
    prNumber: PR_NUMBER,
    branchName: BRANCH_NAME,
    commitSha: COMMIT_SHA,
    sessionId: SESSION_ID,
    timestamp: Date.now(),
    incremental // 标记是否为增量覆盖率
  };

  console.log(`发送${incremental ? '增量' : '初始'}覆盖率数据到 ${COVERAGE_API_URL}, PR: ${PR_NUMBER}, 分支: ${BRANCH_NAME}`);
  
  try {
    // 使用fetch替代axios
    const response = await fetch(COVERAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        coverage,
        metadata,
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("服务器响应:", response.status, data);
    return data;
  } catch (error) {
    console.error("发送覆盖率数据失败:", error);
    throw error;
  }
}

/**
 * 声明window上的全局变量
 */
declare global {
  interface Window {
    __coverage__: any;
  }
}