import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// 获取环境变量
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'default-owner';
const REPO_NAME = process.env.REPO_NAME || 'default-repo';

// 创建临时目录用于存储覆盖率数据
const coverageDir = join('/tmp', 'coverage-data');
if (!existsSync(coverageDir)) {
  mkdirSync(coverageDir, { recursive: true });
}

export async function handler(event, context) {
  // 允许跨域请求
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  
  // 处理OPTIONS请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }
  
  // 确保是POST请求
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }) 
    };
  }
  
  try {
    // 解析请求体
    let body;
    try {
      body = JSON.parse(event.body);
    } catch (e) {
      console.error('Failed to parse request body:', e);
      return { 
        statusCode: 400, 
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }) 
      };
    }
    
    const { coverage, metadata } = body;
    
    if (!coverage || !metadata) {
      return { 
        statusCode: 400, 
        headers,
        body: JSON.stringify({ error: 'Coverage data or metadata missing' }) 
      };
    }
    
    // 提取元数据
    const { prNumber, branchName, commitSha, sessionId, incremental } = metadata;
    
    console.log(`接收到${incremental ? '增量' : '初始'}覆盖率数据：PR=${prNumber}, 分支=${branchName}, 会话=${sessionId}`);
    
    // 为每个PR创建单独的目录
    const prDir = join(coverageDir, `pr-${prNumber || 'main'}`);
    if (!existsSync(prDir)) {
      mkdirSync(prDir, { recursive: true });
    }
    
    // 保存该会话的覆盖率数据
    const timestamp = Date.now();
    const filename = `coverage-${sessionId}-${timestamp}${incremental ? '-incremental' : ''}.json`;
    writeFileSync(
      join(prDir, filename),
      JSON.stringify(coverage, null, 2)
    );
    
    console.log(`保存${incremental ? '增量' : '初始'}覆盖率数据到 ${filename}`);
    
    // 如果是PR，且有GitHub Token，尝试更新PR评论
    if (prNumber && GITHUB_TOKEN) {
      try {
        await updatePullRequestComment(prNumber, branchName, commitSha, prDir);
        console.log(`已更新PR #${prNumber}的评论`);
      } catch (error) {
        console.error('更新PR评论时出错:', error);
      }
    } else {
      console.log(`跳过PR评论更新：prNumber=${prNumber}, hasToken=${!!GITHUB_TOKEN}`);
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        savedTo: filename,
        filesCount: coverage ? Object.keys(coverage).length : 0
      })
    };
  } catch (error) {
    console.error('处理覆盖率数据时出错:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to process coverage data', details: error.message })
    };
  }
}

// GitHub API调用辅助函数
async function githubFetch(endpoint, method = 'GET', body = null) {
  const url = `https://api.github.com${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API 请求失败: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  if (response.status === 204) {
    return null;
  }
  
  return await response.json();
}

// 更新GitHub PR评论
async function updatePullRequestComment(prNumber, branchName, commitSha, prDir) {
  if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.warn('GitHub token或仓库信息未设置，跳过PR评论更新');
    return;
  }
  
  console.log(`准备更新PR #${prNumber}的评论，仓库: ${REPO_OWNER}/${REPO_NAME}`);
  
  try {
    // 1. 获取PR的文件差异信息
    const prDiffInfo = await getPRDiffInfo(prNumber);
    
    if (!prDiffInfo || Object.keys(prDiffInfo).length === 0) {
      console.warn(`未找到PR #${prNumber}的文件差异信息`);
      return;
    }
    
    console.log(`PR #${prNumber}包含 ${Object.keys(prDiffInfo).length} 个更改的文件`);
    
    // 2. 获取覆盖率数据
    const coverageData = await getCombinedCoverageData(prDir);
    
    if (!coverageData || Object.keys(coverageData).length === 0) {
      console.warn(`未找到PR #${prNumber}的覆盖率数据`);
      return;
    }
    
    // 3. 获取覆盖率文件和PR文件的交集
    const intersectionFiles = findIntersectionFiles(coverageData, prDiffInfo);
    
    if (intersectionFiles.length === 0) {
      console.warn(`PR #${prNumber}的文件与覆盖率数据没有交集`);
      return;
    }
    
    console.log(`找到 ${intersectionFiles.length} 个PR文件与覆盖率数据有交集`);
    
    // 4. 对于交集文件，找出未覆盖的函数
    const uncoveredFunctions = findUncoveredFunctions(coverageData, prDiffInfo, intersectionFiles);
    
    // 5. 生成文件覆盖率表
    const fileStatsTable = generateFileStatsTable(coverageData, intersectionFiles);
    
    // 6. 生成未覆盖函数报告
    const uncoveredReport = generateUncoveredFunctionsReport(uncoveredFunctions, commitSha);
    
    // 7. 生成评论内容
    const commentBody = `## 📊 PR函数代码覆盖率报告 (${branchName})
提交: ${commitSha ? commitSha.substring(0, 7) : 'unknown'}

### 文件详细覆盖率

| 文件 | 语句覆盖 | 分支覆盖 | 函数覆盖 |
|------|----------|----------|----------|
${fileStatsTable}

### 未覆盖的函数

${uncoveredReport}

> 本报告基于实际用户访问页面的交互生成，仅统计PR修改的文件中未覆盖的函数
> 上次更新时间: ${getChineseTimeString()}`;
    
    // 8. 更新或创建PR评论
    await updateOrCreateComment(prNumber, commentBody);
    
  } catch (error) {
    console.error(`处理PR #${prNumber}的覆盖率数据时出错:`, error);
    throw error;
  }
}

// 获取PR的文件差异信息
async function getPRDiffInfo(prNumber) {
  try {
    const files = await githubFetch(
      `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/files`
    );
    
    const diffInfo = {};
    
    for (const file of files) {
      // 只处理添加或修改的文件（排除删除的文件）
      if (file.status !== 'removed') {
        const changedLines = parsePatchHunks(file.patch);
        
        diffInfo[file.filename] = {
          status: file.status,
          changedLines,
          // 保存原始路径，方便后续匹配
          originalPath: file.filename
        };
      }
    }
    
    return diffInfo;
  } catch (error) {
    console.error(`获取PR #${prNumber}的文件差异信息时出错:`, error);
    return {};
  }
}

// 解析Git补丁信息以提取修改的行号
function parsePatchHunks(patch) {
  if (!patch) return { additions: [] };
  
  const additions = [];
  
  // 分割补丁为行
  const lines = patch.split('\n');
  let lineNumber = 0;
  
  // 循环处理每一行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 查找补丁块头（如 @@ -1,7 +1,9 @@）
    if (line.startsWith('@@')) {
      // 解析补丁块头以获取行号信息
      const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
      if (match) {
        lineNumber = parseInt(match[3], 10);
      }
      continue;
    }
    
    // 处理添加的行
    if (line.startsWith('+')) {
      // 添加的行
      additions.push(lineNumber);
      lineNumber++;
    } else if (line.startsWith('-')) {
      // 删除的行 - 不影响目标文件的行号
    } else if (!line.startsWith('\\')) {
      // 上下文行（不是特殊行，如 "\ No newline at end of file"）
      lineNumber++;
    }
  }
  
  return { additions };
}

// 获取并合并所有覆盖率数据
async function getCombinedCoverageData(prDir) {
  try {
    const coverageFiles = readdirSync(prDir)
      .filter(file => file.startsWith('coverage-'))
      .map(file => join(prDir, file));
    
    if (coverageFiles.length === 0) {
      return null;
    }
    
    // 合并所有覆盖率数据
    const mergedCoverage = {};
    
    for (const file of coverageFiles) {
      try {
        const fileContent = readFileSync(file, 'utf-8');
        const coverageData = JSON.parse(fileContent);
        
        // 合并到主覆盖率对象
        Object.keys(coverageData).forEach(filePath => {
          if (!mergedCoverage[filePath]) {
            mergedCoverage[filePath] = coverageData[filePath];
          } else {
            mergeCoverageData(mergedCoverage[filePath], coverageData[filePath]);
          }
        });
      } catch (error) {
        console.error(`处理覆盖率文件 ${file} 时出错:`, error);
      }
    }
    
    return mergedCoverage;
  } catch (error) {
    console.error('合并覆盖率数据时出错:', error);
    return null;
  }
}

// 合并两个文件的覆盖率数据
function mergeCoverageData(targetCoverage, sourceCoverage) {
  // 合并语句覆盖率
  if (targetCoverage.s && sourceCoverage.s) {
    Object.keys(sourceCoverage.s).forEach(key => {
      if (targetCoverage.s[key] === 0 && sourceCoverage.s[key] > 0) {
        targetCoverage.s[key] = sourceCoverage.s[key];
      }
    });
  }
  
  // 合并分支覆盖率
  if (targetCoverage.b && sourceCoverage.b) {
    Object.keys(sourceCoverage.b).forEach(key => {
      if (targetCoverage.b[key] && sourceCoverage.b[key]) {
        sourceCoverage.b[key].forEach((count, idx) => {
          if (targetCoverage.b[key][idx] === 0 && count > 0) {
            targetCoverage.b[key][idx] = count;
          }
        });
      }
    });
  }
  
  // 合并函数覆盖率
  if (targetCoverage.f && sourceCoverage.f) {
    Object.keys(sourceCoverage.f).forEach(key => {
      if (targetCoverage.f[key] === 0 && sourceCoverage.f[key] > 0) {
        targetCoverage.f[key] = sourceCoverage.f[key];
      }
    });
  }
}

// 找出覆盖率数据和PR文件的交集
function findIntersectionFiles(coverageData, prDiffInfo) {
  const intersectionFiles = [];
  
  // 遍历PR的文件
  Object.keys(prDiffInfo).forEach(prFile => {
    // 尝试找到匹配的覆盖率文件
    const coverageFile = findMatchingCoverageFile(coverageData, prFile);
    
    if (coverageFile) {
      // 保存交集信息
      intersectionFiles.push({
        prFile,
        coverageFile,
        prInfo: prDiffInfo[prFile]
      });
    }
  });
  
  return intersectionFiles;
}

// 查找匹配的覆盖率文件
function findMatchingCoverageFile(coverageData, prFile) {
  // 1. 直接匹配
  if (coverageData[prFile]) {
    return prFile;
  }
  
  // 2. 尝试标准化路径后匹配
  const normalizedPRFile = prFile.replace(/^\//, '');
  
  for (const coverageFile of Object.keys(coverageData)) {
    const normalizedCoverageFile = coverageFile.replace(/^\//, '');
    
    // 多种匹配策略
    if (normalizedCoverageFile === normalizedPRFile ||
        normalizedCoverageFile.endsWith(normalizedPRFile) ||
        normalizedPRFile.endsWith(normalizedCoverageFile)) {
      return coverageFile;
    }
    
    // 尝试匹配包含"src/"的文件名部分
    if (normalizedPRFile.includes('/src/') && normalizedCoverageFile.includes('/src/')) {
      const prFilename = normalizedPRFile.split('/').pop();
      const coverageFilename = normalizedCoverageFile.split('/').pop();
      
      if (prFilename === coverageFilename) {
        return coverageFile;
      }
    }
    
    // 匹配文件路径的最后两部分（例如：utils/coverageCollector.ts）
    const prParts = normalizedPRFile.split('/');
    const coverageParts = normalizedCoverageFile.split('/');
    
    if (prParts.length >= 2 && coverageParts.length >= 2) {
      const prLastTwoParts = prParts.slice(-2).join('/');
      const coverageLastTwoParts = coverageParts.slice(-2).join('/');
      
      if (prLastTwoParts === coverageLastTwoParts) {
        return coverageFile;
      }
    }
  }
  
  return null;
}

// 查找未覆盖的函数
function findUncoveredFunctions(coverageData, prDiffInfo, intersectionFiles) {
  const result = [];
  
  // 遍历有交集的文件
  intersectionFiles.forEach(({ prFile, coverageFile, prInfo }) => {
    const fileCoverage = coverageData[coverageFile];
    const addedLines = prInfo.changedLines.additions;
    
    if (addedLines.length === 0 || !fileCoverage.fnMap || !fileCoverage.f) {
      return; // 跳过没有新增行或没有函数映射的文件
    }
    
    // 查找未覆盖的函数
    const uncoveredFunctions = [];
    
    // 检查每个函数是否未被覆盖
    Object.keys(fileCoverage.fnMap).forEach(fnId => {
      // 如果函数未被调用
      if (fileCoverage.f[fnId] === 0) {
        const fnInfo = fileCoverage.fnMap[fnId];
        
        // 获取函数的开始和结束行
        const startLine = fnInfo.loc ? fnInfo.loc.start.line : 
                         (fnInfo.decl ? fnInfo.decl.start.line : null);
        const endLine = fnInfo.loc ? fnInfo.loc.end.line : 
                       (fnInfo.line ? fnInfo.line : startLine);
        
        if (startLine && endLine) {
          // 检查函数是否与PR改动有交集
          const hasIntersection = addedLines.some(line => 
            line >= startLine && line <= endLine
          );
          
          if (hasIntersection) {
            uncoveredFunctions.push({
              name: fnInfo.name || `匿名函数 #${fnId}`,
              startLine,
              endLine
            });
          }
        }
      }
    });
    
    // 只在有未覆盖函数的情况下添加到结果
    if (uncoveredFunctions.length > 0) {
      result.push({
        prFile,
        coverageFile,
        uncoveredFunctions,
        totalFunctions: Object.keys(fileCoverage.fnMap).length,
        uncoveredCount: uncoveredFunctions.length
      });
    }
  });
  
  return result;
}

// 生成文件覆盖率统计表格
function generateFileStatsTable(coverageData, intersectionFiles) {
  if (intersectionFiles.length === 0) {
    return "*没有发现PR修改文件的覆盖率数据*";
  }
  
  let fileStats = '';
  
  // 处理每个文件
  intersectionFiles.forEach(({ prFile, coverageFile }) => {
    const fileCoverage = coverageData[coverageFile];
    // 简化路径显示
    const simplifiedPath = prFile.replace(/^.*\/src\//, 'src/');
    
    // 计算语句覆盖率
    let stmtCovered = 0;
    let stmtTotal = 0;
    if (fileCoverage.s) {
      stmtTotal = Object.keys(fileCoverage.s).length;
      stmtCovered = Object.values(fileCoverage.s).filter(hit => hit > 0).length;
    }
    const stmtPct = stmtTotal > 0 ? ((stmtCovered / stmtTotal) * 100).toFixed(2) : '0.00';
    
    // 计算分支覆盖率
    let branchCovered = 0;
    let branchTotal = 0;
    if (fileCoverage.b) {
      Object.values(fileCoverage.b).forEach(branches => {
        if (Array.isArray(branches)) {
          branchTotal += branches.length;
          branchCovered += branches.filter(hit => hit > 0).length;
        }
      });
    }
    const branchPct = branchTotal > 0 ? ((branchCovered / branchTotal) * 100).toFixed(2) : '0.00';
    
    // 计算函数覆盖率
    let fnCovered = 0;
    let fnTotal = 0;
    if (fileCoverage.f) {
      fnTotal = Object.keys(fileCoverage.f).length;
      fnCovered = Object.values(fileCoverage.f).filter(hit => hit > 0).length;
    }
    const fnPct = fnTotal > 0 ? ((fnCovered / fnTotal) * 100).toFixed(2) : '0.00';
    
    // 添加到表格
    fileStats += `| \`${simplifiedPath}\` | ${stmtCovered}/${stmtTotal} (${stmtPct}%) | ${branchCovered}/${branchTotal} (${branchPct}%) | ${fnCovered}/${fnTotal} (${fnPct}%) |\n`;
  });
  
  return fileStats;
}

// 生成未覆盖的函数报告
function generateUncoveredFunctionsReport(uncoveredFunctions, commitSha) {
  if (uncoveredFunctions.length === 0) {
    return "*所有修改的函数都已被覆盖* ✅";
  }
  
  let report = "";
  
  uncoveredFunctions.forEach(fileInfo => {
    const simplifiedPath = fileInfo.prFile.replace(/^.*\/src\//, 'src/');
    
    report += `#### \`${simplifiedPath}\`\n`;
    report += `* 未覆盖函数: ${fileInfo.uncoveredCount}/${fileInfo.totalFunctions}\n\n`;
    
    fileInfo.uncoveredFunctions.forEach(fn => {
      // 使用GitHub文件引用格式
      report += `* \`${fn.name}\` (行 ${fn.startLine}-${fn.endLine}): `;
      report += `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${commitSha}/${fileInfo.prFile}#L${fn.startLine}-L${fn.endLine}\n\n`;
    });
  });
  
  return report;
}

// 更新或创建PR评论
async function updateOrCreateComment(prNumber, commentBody) {
  try {
    // 先尝试查找现有评论
    const comments = await githubFetch(
      `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${parseInt(prNumber, 10)}/comments`
    );
    
    const coverageComment = comments.find(comment => 
      comment.body && comment.body.includes('📊 PR函数代码覆盖率报告')
    );
    
    if (coverageComment) {
      // 更新现有评论
      await githubFetch(
        `/repos/${REPO_OWNER}/${REPO_NAME}/issues/comments/${coverageComment.id}`,
        'PATCH',
        { body: commentBody }
      );
      console.log(`更新了PR #${prNumber}上的覆盖率评论`);
    } else {
      // 创建新评论
      await githubFetch(
        `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${parseInt(prNumber, 10)}/comments`,
        'POST',
        { body: commentBody }
      );
      console.log(`在PR #${prNumber}上创建了覆盖率评论`);
    }
  } catch (error) {
    console.error('更新或创建评论失败:', error);
    throw error;
  }
}

function getChineseTimeString() {
  const now = new Date();
  
  // 转换为中国时间 (UTC+8)
  const options = { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  
  return new Intl.DateTimeFormat('zh-CN', options).format(now);
}