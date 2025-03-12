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
  
  // 处理OPTIONS请求（预检请求）
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
        // 不要因为PR评论更新失败而使整个请求失败
      }
    } else {
      console.log(`跳过PR评论更新：prNumber=${prNumber}, hasToken=${!!GITHUB_TOKEN}`);
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        message: `${incremental ? 'Incremental' : 'Initial'} coverage data received`,
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
  
  // 如果是204 No Content，直接返回null
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
    // 获取PR的文件差异信息，包含行号
    const prFiles = await getPRDiffInfo(prNumber);
    
    if (!prFiles || Object.keys(prFiles).length === 0) {
      console.warn(`未找到PR #${prNumber}的文件差异信息`);
    } else {
      console.log(`PR #${prNumber}包含 ${Object.keys(prFiles).length} 个更改的文件`);
    }
    
    // 检查PR目录中的覆盖率文件
    const coverageFiles = readdirSync(prDir)
      .filter(file => file.startsWith('coverage-'))
      .map(file => join(prDir, file));
      
    if (coverageFiles.length === 0) {
      console.warn(`未找到PR #${prNumber}的覆盖率文件`);
      return;
    }
    
    console.log(`找到${coverageFiles.length}个覆盖率文件`);
    
    // 合并所有覆盖率数据
    const mergedCoverage = {};
    
    // 处理所有覆盖率文件
    coverageFiles.forEach(file => {
      try {
        const coverageData = JSON.parse(readFileSync(file, 'utf-8'));
        Object.keys(coverageData).forEach(filePath => {
          if (!mergedCoverage[filePath]) {
            mergedCoverage[filePath] = coverageData[filePath];
          } else {
            // 合并语句覆盖率
            if (coverageData[filePath].s) {
              Object.keys(coverageData[filePath].s).forEach(stmtId => {
                if (mergedCoverage[filePath].s[stmtId] === 0 && coverageData[filePath].s[stmtId] > 0) {
                  mergedCoverage[filePath].s[stmtId] = coverageData[filePath].s[stmtId];
                }
              });
            }
            
            // 合并分支覆盖率
            if (coverageData[filePath].b) {
              Object.keys(coverageData[filePath].b).forEach(branchId => {
                if (Array.isArray(coverageData[filePath].b[branchId])) {
                  coverageData[filePath].b[branchId].forEach((count, idx) => {
                    if (mergedCoverage[filePath].b[branchId][idx] === 0 && count > 0) {
                      mergedCoverage[filePath].b[branchId][idx] = count;
                    }
                  });
                }
              });
            }
            
            // 合并函数覆盖率
            if (coverageData[filePath].f) {
              Object.keys(coverageData[filePath].f).forEach(fnId => {
                if (mergedCoverage[filePath].f[fnId] === 0 && coverageData[filePath].f[fnId] > 0) {
                  mergedCoverage[filePath].f[fnId] = coverageData[filePath].f[fnId];
                }
              });
            }
          }
        });
      } catch (error) {
        console.error(`处理文件 ${file} 时出错:`, error);
      }
    });
    
    // 分析未覆盖的行
    const uncoveredLines = findUncoveredLines(mergedCoverage, prFiles);
    
    // 计算覆盖率统计
    const fileStats = generateFileStats(mergedCoverage);
    
    // 生成评论内容
    const commentBody = `## 📊 PR增量代码覆盖率报告 (${branchName})
提交: ${commitSha ? commitSha.substring(0, 7) : 'unknown'}

### 文件详细覆盖率

| 文件 | 语句覆盖 | 分支覆盖 | 函数覆盖 |
|------|----------|----------|----------|
${fileStats}

### 未覆盖的PR修改

${generateUncoveredReport(uncoveredLines)}

> 本报告基于实际用户访问页面的交互生成，仅统计PR修改的文件
> 上次更新时间: ${getChineseTimeString()}`;

      try {
        // 先尝试创建新评论
        await githubFetch(
          `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${parseInt(prNumber, 10)}/comments`,
          'POST',
          { body: commentBody }
        );
        console.log(`在PR #${prNumber}上创建了覆盖率评论`);
      } catch (createError) {
        console.error('创建评论失败，尝试查找并更新现有评论:', createError);
        
        try {
          // 查找现有评论
          const comments = await githubFetch(
            `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${parseInt(prNumber, 10)}/comments`
          );
          
          const coverageComment = comments.find(comment => 
            comment.body && comment.body.includes('📊 PR增量代码覆盖率报告')
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
            console.warn(`未找到PR #${prNumber}上的覆盖率评论，无法更新`);
          }
        } catch (listError) {
          console.error('查找评论失败:', listError);
        }
      }
  } catch (error) {
    console.error(`处理PR #${prNumber}的覆盖率数据时出错:`, error);
    throw error;
  }
}

// 获取PR的文件差异信息
async function getPRDiffInfo(prNumber) {
  try {
    // 获取PR的文件列表
    const files = await githubFetch(
      `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/files`
    );
    
    // 创建文件差异信息对象
    const prFiles = {};
    
    for (const file of files) {
      // 只处理添加或修改的文件（排除删除的文件）
      if (file.status !== 'removed') {
        // 解析补丁信息以获取修改的行号
        const changedLines = parsePatchHunks(file.patch);
        
        prFiles[file.filename] = {
          status: file.status,
          changedLines
        };
      }
    }
    
    return prFiles;
  } catch (error) {
    console.error(`获取PR #${prNumber}的文件差异信息时出错:`, error);
    return {};
  }
}

// 解析Git补丁信息以提取修改的行号
function parsePatchHunks(patch) {
  if (!patch) return { additions: [], deletions: [] };
  
  const additions = [];
  const deletions = [];
  
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
    
    // 处理正常行、添加行和删除行
    if (line.startsWith('+')) {
      // 添加的行
      additions.push(lineNumber);
      lineNumber++;
    } else if (line.startsWith('-')) {
      // 删除的行
      deletions.push(lineNumber);
      // 删除行不会增加目标文件的行号
    } else if (!line.startsWith('\\')) {
      // 上下文行（不是特殊行，如 "\ No newline at end of file"）
      lineNumber++;
    }
  }
  
  return { additions, deletions };
}

// 在覆盖率数据中查找匹配的文件路径
function findMatchingCoverageFile(coverage, prFilePath) {
  // 尝试直接匹配
  if (coverage[prFilePath]) return prFilePath;
  
  // 尝试标准化路径后匹配
  const normalizedPRPath = prFilePath.replace(/^\//, ''); // 移除开头的斜杠
  
  // 遍历覆盖率文件查找匹配
  for (const coverageFile of Object.keys(coverage)) {
    const normalizedCoverageFile = coverageFile.replace(/^\//, '');
    
    if (normalizedCoverageFile === normalizedPRPath ||
        normalizedCoverageFile.endsWith(normalizedPRPath) ||
        normalizedPRPath.endsWith(normalizedCoverageFile) ||
        normalizedPRPath.includes('/src/') && normalizedCoverageFile.includes('/src/') && 
        normalizedPRPath.split('/').pop() === normalizedCoverageFile.split('/').pop()) {
      return coverageFile;
    }
  }
  
  // 没有找到匹配的文件
  return null;
}

// 查找未覆盖的行
function findUncoveredLines(coverage, prFiles) {
  const result = {};
  
  // 遍历PR的修改文件
  Object.keys(prFiles).forEach(prFilePath => {
    const fileInfo = prFiles[prFilePath];
    const addedLines = fileInfo.changedLines.additions;
    
    if (addedLines.length === 0) return; // 跳过没有新增行的文件
    
    // 查找覆盖率数据中匹配的文件
    const coverageFile = findMatchingCoverageFile(coverage, prFilePath);
    
    if (!coverageFile) {
      // 如果没有找到匹配的覆盖率文件，则整个文件都未覆盖
      result[prFilePath] = {
        totalChanges: addedLines.length,
        uncoveredLines: [...addedLines],
        coverageFile: null
      };
      return;
    }
    
    // 获取文件的覆盖率数据
    const fileCoverage = coverage[coverageFile];
    
    // 检查哪些添加的行没有被覆盖
    const uncoveredLines = [];
    
    // istanbul生成的覆盖率数据中，statementMap记录了语句的位置信息
    if (fileCoverage.statementMap && fileCoverage.s) {
      // 创建一个行号到语句ID的映射
      const lineToStatements = {};
      
      // 构建行号到语句ID的映射
      Object.keys(fileCoverage.statementMap).forEach(stmtId => {
        const stmt = fileCoverage.statementMap[stmtId];
        if (stmt.start) {
          const line = stmt.start.line;
          if (!lineToStatements[line]) {
            lineToStatements[line] = [];
          }
          lineToStatements[line].push(stmtId);
        }
      });
      
      // 检查每一个添加的行是否有覆盖
      addedLines.forEach(lineNum => {
        // 如果这一行有语句
        if (lineToStatements[lineNum]) {
          // 检查该行的所有语句是否都未被覆盖
          const stmtIds = lineToStatements[lineNum];
          const allUncovered = stmtIds.every(stmtId => fileCoverage.s[stmtId] === 0);
          
          if (allUncovered) {
            uncoveredLines.push(lineNum);
          }
        } else {
          // 如果这一行没有语句（如空行、注释等），也标记为未覆盖
          uncoveredLines.push(lineNum);
        }
      });
    } else {
      // 如果没有语句映射，则假设所有行都未覆盖
      uncoveredLines.push(...addedLines);
    }
    
    // 只在有未覆盖行的情况下记录
    if (uncoveredLines.length > 0) {
      result[prFilePath] = {
        totalChanges: addedLines.length,
        uncoveredLines,
        coverageFile
      };
    }
  });
  
  return result;
}

// 将连续的数字分组
function groupConsecutiveNumbers(numbers) {
  if (numbers.length === 0) return [];
  
  // 确保数字是排序的
  const sortedNumbers = [...numbers].sort((a, b) => a - b);
  
  const groups = [];
  let currentGroup = [sortedNumbers[0]];
  
  for (let i = 1; i < sortedNumbers.length; i++) {
    if (sortedNumbers[i] === sortedNumbers[i-1] + 1) {
      // 如果是连续的，添加到当前组
      currentGroup.push(sortedNumbers[i]);
    } else {
      // 否则创建新组
      groups.push(currentGroup);
      currentGroup = [sortedNumbers[i]];
    }
  }
  
  groups.push(currentGroup);
  return groups;
}

// 生成文件覆盖率统计
function generateFileStats(coverage) {
  // 确保覆盖率对象非空
  if (!coverage || Object.keys(coverage).length === 0) {
    return "*没有发现PR修改文件的覆盖率数据*";
  }
  
  let fileStats = '';
  
  // 对文件路径排序
  const sortedFiles = Object.keys(coverage).sort();
  
  sortedFiles.forEach(filePath => {
    const fileCoverage = coverage[filePath];
    const simplifiedPath = filePath.replace(/^.*\/src\//, 'src/');
    
    // 计算语句覆盖率
    let stmtCovered = 0;
    let stmtTotal = 0;
    if (fileCoverage.s) {
      const statements = Object.values(fileCoverage.s);
      stmtTotal = statements.length;
      stmtCovered = statements.filter(hit => hit > 0).length;
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
      const functions = Object.values(fileCoverage.f);
      fnTotal = functions.length;
      fnCovered = functions.filter(hit => hit > 0).length;
    }
    const fnPct = fnTotal > 0 ? ((fnCovered / fnTotal) * 100).toFixed(2) : '0.00';
    
    // 添加到统计中
    fileStats += `| \`${simplifiedPath}\` | ${stmtCovered}/${stmtTotal} (${stmtPct}%) | ${branchCovered}/${branchTotal} (${branchPct}%) | ${fnCovered}/${fnTotal} (${fnPct}%) |\n`;
  });
  
  return fileStats;
}

// 生成未覆盖的行报告
function generateUncoveredReport(uncoveredLines) {
  if (Object.keys(uncoveredLines).length === 0) {
    return "*所有修改的代码行都已被覆盖* ✅";
  }
  
  let report = "以下是PR中修改的代码行未被测试覆盖到的部分：\n\n";
  
  // 对文件排序
  const sortedFiles = Object.keys(uncoveredLines).sort();
  
  // 构建详细报告
  for (const file of sortedFiles) {
    const info = uncoveredLines[file];
    const simplifiedPath = file.replace(/^.*\/src\//, 'src/');
    
    // 计算覆盖百分比
    const coveredCount = info.totalChanges - info.uncoveredLines.length;
    const coveragePercent = (coveredCount / info.totalChanges * 100).toFixed(2);
    
    report += `#### \`${simplifiedPath}\`\n`;
    report += `* 修改行数: ${info.totalChanges}\n`;
    report += `* 未覆盖行数: ${info.uncoveredLines.length}\n`;
    report += `* 覆盖率: ${coveragePercent}%\n`;
    
    // 列出未覆盖的行号
    if (info.uncoveredLines.length > 0) {
      const groupedLines = groupConsecutiveNumbers(info.uncoveredLines);
      report += `* 未覆盖的行号: `;
      
      groupedLines.forEach((group, index) => {
        if (index > 0) report += ', ';
        
        if (group.length === 1) {
          report += `${group[0]}`;
        } else {
          report += `${group[0]}-${group[group.length - 1]}`;
        }
      });
      
      report += '\n\n';
    }
  }
  
  return report;
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