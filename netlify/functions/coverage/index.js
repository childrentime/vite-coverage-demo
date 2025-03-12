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
    // 获取PR的diff信息
    const diffFiles = await getDiffFiles(prNumber);
    
    if (!diffFiles || diffFiles.length === 0) {
      console.warn(`未找到PR #${prNumber}的diff信息`);
    } else {
      console.log(`PR #${prNumber}包含 ${diffFiles.length} 个更改的文件`);
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
    
    // 合并所有覆盖率数据，优先合并增量数据
    const initialCoverageFiles = coverageFiles.filter(file => !file.includes('-incremental'));
    const incrementalCoverageFiles = coverageFiles.filter(file => file.includes('-incremental'));
    
    // 先处理初始覆盖率文件
    const mergedCoverage = {};
    initialCoverageFiles.forEach(file => {
      try {
        const coverageData = JSON.parse(readFileSync(file, 'utf-8'));
        mergeCoverageData(mergedCoverage, coverageData);
      } catch (error) {
        console.error(`处理文件 ${file} 时出错:`, error);
      }
    });
    
    // 再处理增量覆盖率文件（增量数据优先级更高）
    incrementalCoverageFiles.forEach(file => {
      try {
        const coverageData = JSON.parse(readFileSync(file, 'utf-8'));
        mergeCoverageData(mergedCoverage, coverageData);
      } catch (error) {
        console.error(`处理文件 ${file} 时出错:`, error);
      }
    });
    
    // 保存合并后的覆盖率数据
    const mergedFilePath = join(prDir, 'merged-coverage.json');
    writeFileSync(mergedFilePath, JSON.stringify(mergedCoverage, null, 2));
    
    // 筛选只与PR相关的文件的覆盖率
    const prCoverage = filterPRCoverage(mergedCoverage, diffFiles);
    
    // 计算PR相关文件的覆盖率统计信息
    const stats = calculateCoverageStats(prCoverage);
    
    // 更新GitHub PR评论
    try {
      // 生成每个文件的覆盖率报告
      const fileReports = generateFileReports(prCoverage);
      
      // 生成评论内容
      const commentBody = `## 📊 PR增量代码覆盖率报告 (${branchName})
提交: ${commitSha ? commitSha.substring(0, 7) : 'unknown'}

### 增量覆盖率统计

| 指标 | 覆盖 | 总数 | 覆盖率 |
|------|------|------|--------|
| 语句 | ${stats.statements.covered} | ${stats.statements.total} | ${stats.statements.pct}% |
| 分支 | ${stats.branches.covered} | ${stats.branches.total} | ${stats.branches.pct}% |
| 函数 | ${stats.functions.covered} | ${stats.functions.total} | ${stats.functions.pct}% |

### 文件详细覆盖率

${fileReports}

> 本报告基于实际用户访问页面的交互生成，仅统计PR修改的文件
> 上次更新时间: ${new Date().toISOString()}`;

      console.log('准备更新GitHub评论');
      
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
      console.error('更新GitHub PR评论时出错:', error);
      // 抛出错误以便上层函数可以捕获
      throw error;
    }
  } catch (error) {
    console.error(`处理PR #${prNumber}的覆盖率数据时出错:`, error);
    throw error;
  }
}

// 获取PR的差异文件
async function getDiffFiles(prNumber) {
  try {
    // 获取PR的文件列表
    const files = await githubFetch(
      `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/files`
    );
    
    // 只返回添加或修改的文件路径（排除删除的文件）
    return files
      .filter(file => file.status !== 'removed')
      .map(file => file.filename);
  } catch (error) {
    console.error(`获取PR #${prNumber}的差异文件时出错:`, error);
    return [];
  }
}

// 合并覆盖率数据
function mergeCoverageData(targetCoverage, sourceCoverage) {
  Object.keys(sourceCoverage).forEach(filePath => {
    if (!targetCoverage[filePath]) {
      targetCoverage[filePath] = sourceCoverage[filePath];
    } else {
      // 合并覆盖率数据（这里简化处理，实际应该使用专业工具）
      const existingCoverage = targetCoverage[filePath];
      const newCoverage = sourceCoverage[filePath];
      
      // 合并语句覆盖率
      if (existingCoverage.s && newCoverage.s) {
        Object.keys(newCoverage.s).forEach(key => {
          if (existingCoverage.s[key] === 0 && newCoverage.s[key] > 0) {
            existingCoverage.s[key] = newCoverage.s[key];
          }
        });
      }
      
      // 合并分支覆盖率
      if (existingCoverage.b && newCoverage.b) {
        Object.keys(newCoverage.b).forEach(key => {
          if (existingCoverage.b[key] && newCoverage.b[key]) {
            newCoverage.b[key].forEach((count, idx) => {
              if (existingCoverage.b[key][idx] === 0 && count > 0) {
                existingCoverage.b[key][idx] = count;
              }
            });
          }
        });
      }
      
      // 合并函数覆盖率
      if (existingCoverage.f && newCoverage.f) {
        Object.keys(newCoverage.f).forEach(key => {
          if (existingCoverage.f[key] === 0 && newCoverage.f[key] > 0) {
            existingCoverage.f[key] = newCoverage.f[key];
          }
        });
      }
    }
  });
}

// 筛选只与PR相关的文件的覆盖率
function filterPRCoverage(coverage, diffFiles) {
  if (!diffFiles || diffFiles.length === 0) {
    return coverage; // 如果没有diff信息，返回所有覆盖率数据
  }
  
  const prCoverage = {};
  
  Object.keys(coverage).forEach(filePath => {
    // 检查覆盖率文件路径是否在PR的diff文件中
    // 注意：这里需要处理路径差异，覆盖率中的路径可能与GitHub返回的路径格式不同
    const normalizedPath = filePath.replace(/^\//, ''); // 移除开头的斜杠
    
    // 检查文件是否在diff中
    const isInDiff = diffFiles.some(diffFile => {
      // 进行一些基本的路径标准化比较
      // 这可能需要根据实际情况进行调整
      return diffFile.endsWith(normalizedPath) || 
             normalizedPath.endsWith(diffFile) ||
             normalizedPath.includes(diffFile);
    });
    
    if (isInDiff) {
      prCoverage[filePath] = coverage[filePath];
    }
  });
  
  return prCoverage;
}

// 计算覆盖率统计信息
function calculateCoverageStats(coverage) {
  let totalStatements = 0;
  let coveredStatements = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  
  Object.values(coverage).forEach(fileCoverage => {
    // 语句覆盖率
    if (fileCoverage.s) {
      const statements = Object.values(fileCoverage.s);
      totalStatements += statements.length;
      coveredStatements += statements.filter(hit => hit > 0).length;
    }
    
    // 分支覆盖率
    if (fileCoverage.b) {
      Object.values(fileCoverage.b).forEach(branches => {
        if (Array.isArray(branches)) {
          totalBranches += branches.length;
          coveredBranches += branches.filter(hit => hit > 0).length;
        }
      });
    }
    
    // 函数覆盖率
    if (fileCoverage.f) {
      const functions = Object.values(fileCoverage.f);
      totalFunctions += functions.length;
      coveredFunctions += functions.filter(hit => hit > 0).length;
    }
  });
  
  return {
    statements: {
      total: totalStatements,
      covered: coveredStatements,
      pct: totalStatements > 0 ? (coveredStatements / totalStatements * 100).toFixed(2) : '0.00'
    },
    branches: {
      total: totalBranches,
      covered: coveredBranches,
      pct: totalBranches > 0 ? (coveredBranches / totalBranches * 100).toFixed(2) : '0.00'
    },
    functions: {
      total: totalFunctions,
      covered: coveredFunctions,
      pct: totalFunctions > 0 ? (coveredFunctions / totalFunctions * 100).toFixed(2) : '0.00'
    }
  };
}

// 生成每个文件的覆盖率报告
function generateFileReports(coverage) {
  if (Object.keys(coverage).length === 0) {
    return "*没有发现PR修改文件的覆盖率数据*";
  }
  
  let fileReports = '| 文件 | 语句覆盖 | 分支覆盖 | 函数覆盖 |\n';
  fileReports += '|------|----------|----------|----------|\n';
  
  // 对文件路径排序，使报告更加有序
  const sortedFiles = Object.keys(coverage).sort();
  
  sortedFiles.forEach(filePath => {
    const fileCoverage = coverage[filePath];
    
    // 计算该文件的语句覆盖率
    let stmtCovered = 0;
    let stmtTotal = 0;
    if (fileCoverage.s) {
      const statements = Object.values(fileCoverage.s);
      stmtTotal = statements.length;
      stmtCovered = statements.filter(hit => hit > 0).length;
    }
    const stmtPct = stmtTotal > 0 ? ((stmtCovered / stmtTotal) * 100).toFixed(2) : '0.00';
    
    // 计算该文件的分支覆盖率
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
    
    // 计算该文件的函数覆盖率
    let fnCovered = 0;
    let fnTotal = 0;
    if (fileCoverage.f) {
      const functions = Object.values(fileCoverage.f);
      fnTotal = functions.length;
      fnCovered = functions.filter(hit => hit > 0).length;
    }
    const fnPct = fnTotal > 0 ? ((fnCovered / fnTotal) * 100).toFixed(2) : '0.00';
    
    // 获取简化的文件路径，去除前缀路径
    const simplifiedPath = filePath.replace(/^.*\/src\//, 'src/');
    
    // 添加到报告中
    fileReports += `| \`${simplifiedPath}\` | ${stmtCovered}/${stmtTotal} (${stmtPct}%) | ${branchCovered}/${branchTotal} (${branchPct}%) | ${fnCovered}/${fnTotal} (${fnPct}%) |\n`;
  });
  
  return fileReports;
}