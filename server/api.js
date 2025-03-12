// 这是一个简单的Express服务器，用于接收覆盖率数据
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { execSync } = require('child_process');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

// 创建目录用于存储覆盖率数据
const coverageDir = path.join(__dirname, 'coverage-data');
if (!fs.existsSync(coverageDir)) {
  fs.mkdirSync(coverageDir, { recursive: true });
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// 接收覆盖率数据的端点
app.post('/api/coverage', async (req, res) => {
  try {
    const { coverage, metadata } = req.body;
    
    if (!coverage || !metadata) {
      return res.status(400).send({ error: 'Coverage data or metadata missing' });
    }
    
    const { prNumber, branchName, commitSha, sessionId } = metadata;
    
    // 为每个PR创建单独的目录
    const prDir = path.join(coverageDir, `pr-${prNumber || 'main'}`);
    if (!fs.existsSync(prDir)) {
      fs.mkdirSync(prDir, { recursive: true });
    }
    
    // 保存该会话的覆盖率数据
    const filename = `coverage-${sessionId}-${Date.now()}.json`;
    fs.writeFileSync(
      path.join(prDir, filename),
      JSON.stringify(coverage, null, 2)
    );

    // 如果是PR，可以尝试更新PR评论
    if (prNumber && GITHUB_TOKEN) {
      await updatePullRequestComment(prNumber, branchName, commitSha);
    }
    
    res.status(200).send({ success: true, message: 'Coverage data received' });
  } catch (error) {
    console.error('Error handling coverage data:', error);
    res.status(500).send({ error: 'Failed to process coverage data' });
  }
});

// 手动触发PR评论更新的端点
app.post('/api/update-pr-comment/:prNumber', async (req, res) => {
  try {
    const { prNumber } = req.params;
    const { branchName, commitSha } = req.body;
    
    if (!prNumber) {
      return res.status(400).send({ error: 'PR number is required' });
    }
    
    await updatePullRequestComment(prNumber, branchName, commitSha);
    res.status(200).send({ success: true, message: 'PR comment updated' });
  } catch (error) {
    console.error('Error updating PR comment:', error);
    res.status(500).send({ error: 'Failed to update PR comment' });
  }
});

// 合并该PR的所有覆盖率数据并更新GitHub PR评论
async function updatePullRequestComment(prNumber, branchName, commitSha) {
  if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.warn('GitHub token or repo info not set, skipping PR comment update');
    return;
  }
  
  // 合并该PR的所有覆盖率数据
  const prDir = path.join(coverageDir, `pr-${prNumber}`);
  if (!fs.existsSync(prDir)) {
    console.warn(`No coverage data found for PR #${prNumber}`);
    return;
  }
  
  // 使用Istanbul CLI合并覆盖率报告
  const coverageFiles = fs.readdirSync(prDir)
    .filter(file => file.startsWith('coverage-'))
    .map(file => path.join(prDir, file));
    
  if (coverageFiles.length === 0) {
    console.warn(`No coverage files found for PR #${prNumber}`);
    return;
  }
  
  // 合并所有覆盖率数据
  const mergedCoverage = {};
  
  coverageFiles.forEach(file => {
    try {
      const coverageData = JSON.parse(fs.readFileSync(file, 'utf-8'));
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
      console.error(`Error processing file ${file}:`, error);
    }
  });
  
  // 保存合并后的覆盖率数据
  const mergedFilePath = path.join(prDir, 'merged-coverage.json');
  fs.writeFileSync(mergedFilePath, JSON.stringify(mergedCoverage, null, 2));
  
  // 计算覆盖率统计信息
  const stats = calculateCoverageStats(mergedCoverage);
  
  // 更新GitHub PR评论
  await updateGitHubPRComment(prNumber, branchName, commitSha, stats);
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
    const statements = Object.values(fileCoverage.s || {});
    totalStatements += statements.length;
    coveredStatements += statements.filter(hit => hit > 0).length;
    
    // 分支覆盖率
    if (fileCoverage.b) {
      Object.values(fileCoverage.b).forEach(branches => {
        totalBranches += branches.length;
        coveredBranches += branches.filter(hit => hit > 0).length;
      });
    }
    
    // 函数覆盖率
    const functions = Object.values(fileCoverage.f || {});
    totalFunctions += functions.length;
    coveredFunctions += functions.filter(hit => hit > 0).length;
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

// 更新GitHub PR评论
async function updateGitHubPRComment(prNumber, branchName, commitSha, stats) {
  try {
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    
    // 生成评论内容
    const commentBody = `## 📊 代码覆盖率报告 (${branchName})
提交: ${commitSha}

### 覆盖率统计

| 指标 | 覆盖 | 总数 | 覆盖率 |
|------|------|------|--------|
| 语句 | ${stats.statements.covered} | ${stats.statements.total} | ${stats.statements.pct}% |
| 分支 | ${stats.branches.covered} | ${stats.branches.total} | ${stats.branches.pct}% |
| 函数 | ${stats.functions.covered} | ${stats.functions.total} | ${stats.functions.pct}% |

> 本报告基于实际用户访问页面的交互生成
> 上次更新时间: ${new Date().toISOString()}`;

    // 检查PR是否已有覆盖率评论
    const { data: comments } = await octokit.issues.listComments({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      issue_number: parseInt(prNumber)
    });
    
    const coverageComment = comments.find(comment => 
      comment.body.includes('📊 代码覆盖率报告')
    );
    
    if (coverageComment) {
      // 更新已有评论
      await octokit.issues.updateComment({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        comment_id: coverageComment.id,
        body: commentBody
      });
      console.log(`Updated coverage comment on PR #${prNumber}`);
    } else {
      // 创建新评论
      await octokit.issues.createComment({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        issue_number: parseInt(prNumber),
        body: commentBody
      });
      console.log(`Created coverage comment on PR #${prNumber}`);
    }
  } catch (error) {
    console.error('Error updating GitHub PR comment:', error);
  }
}

app.listen(PORT, () => {
  console.log(`Coverage server listening on port ${PORT}`);
});