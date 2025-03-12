import axios from 'axios';
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

// 配置axios实例，用于GitHub API请求
const githubAPI = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  }
});

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
    const { prNumber, branchName, commitSha, sessionId } = metadata;
    
    console.log(`接收到覆盖率数据：PR=${prNumber}, 分支=${branchName}, 会话=${sessionId}`);
    
    // 为每个PR创建单独的目录
    const prDir = join(coverageDir, `pr-${prNumber || 'main'}`);
    if (!existsSync(prDir)) {
      mkdirSync(prDir, { recursive: true });
    }
    
    // 保存该会话的覆盖率数据
    const timestamp = Date.now();
    const filename = `coverage-${sessionId}-${timestamp}.json`;
    writeFileSync(
      join(prDir, filename),
      JSON.stringify(coverage, null, 2)
    );
    
    console.log(`保存覆盖率数据到 ${filename}`);
    
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
        message: 'Coverage data received',
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

// 更新GitHub PR评论
async function updatePullRequestComment(prNumber, branchName, commitSha, prDir) {
  if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.warn('GitHub token或仓库信息未设置，跳过PR评论更新');
    return;
  }
  
  console.log(`准备更新PR #${prNumber}的评论，仓库: ${REPO_OWNER}/${REPO_NAME}`);
  
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
  
  coverageFiles.forEach(file => {
    try {
      const coverageData = JSON.parse(readFileSync(file, 'utf-8'));
      Object.keys(coverageData).forEach(filePath => {
        if (!mergedCoverage[filePath]) {
          mergedCoverage[filePath] = coverageData[filePath];
        } else {
          // 合并覆盖率数据（这里简化处理，实际应该使用专业工具）
          const existingCoverage = mergedCoverage[filePath];
          const newCoverage = coverageData[filePath];
          
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
    } catch (error) {
      console.error(`处理文件 ${file} 时出错:`, error);
    }
  });
  
  // 保存合并后的覆盖率数据
  const mergedFilePath = join(prDir, 'merged-coverage.json');
  writeFileSync(mergedFilePath, JSON.stringify(mergedCoverage, null, 2));
  
  // 计算覆盖率统计信息
  const stats = calculateCoverageStats(mergedCoverage);
  
  // 更新GitHub PR评论
  try {
    // 生成评论内容
    const commentBody = `## 📊 代码覆盖率报告 (${branchName})
提交: ${commitSha ? commitSha.substring(0, 7) : 'unknown'}

### 覆盖率统计

| 指标 | 覆盖 | 总数 | 覆盖率 |
|------|------|------|--------|
| 语句 | ${stats.statements.covered} | ${stats.statements.total} | ${stats.statements.pct}% |
| 分支 | ${stats.branches.covered} | ${stats.branches.total} | ${stats.branches.pct}% |
| 函数 | ${stats.functions.covered} | ${stats.functions.total} | ${stats.functions.pct}% |

> 本报告基于实际用户访问页面的交互生成
> 上次更新时间: ${new Date().toISOString()}`;

    console.log('准备更新GitHub评论');
    
    try {
      // 先尝试创建新评论
      await githubAPI.post(
        `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${parseInt(prNumber, 10)}/comments`,
        { body: commentBody }
      );
      console.log(`在PR #${prNumber}上创建了覆盖率评论`);
    } catch (createError) {
      console.error('创建评论失败，尝试查找并更新现有评论:', createError);
      
      try {
        // 查找现有评论
        const response = await githubAPI.get(
          `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${parseInt(prNumber, 10)}/comments`
        );
        
        const comments = response.data;
        const coverageComment = comments.find(comment => 
          comment.body && comment.body.includes('📊 代码覆盖率报告')
        );
        
        if (coverageComment) {
          // 更新现有评论
          await githubAPI.patch(
            `/repos/${REPO_OWNER}/${REPO_NAME}/issues/comments/${coverageComment.id}`,
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