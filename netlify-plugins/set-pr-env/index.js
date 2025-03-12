import fs from 'fs';

export default {
  onPreBuild: ({ utils }) => {
    // 获取Netlify环境变量
    const isPR = process.env.CONTEXT === 'deploy-preview';
    
    if (isPR) {
      // 从 NETLIFY_DEPLOY_URL 或 DEPLOY_URL 中解析 PR 号码
      let prNumber = '';
      const deployUrl = process.env.NETLIFY_DEPLOY_URL || process.env.DEPLOY_URL || '';
      
      if (deployUrl) {
        const match = deployUrl.match(/deploy-preview-(\d+)/);
        if (match && match[1]) {
          prNumber = match[1];
        }
      }
      
      // 如果上面的方法无法获取，尝试从 REVIEW_ID 获取
      if (!prNumber && process.env.REVIEW_ID) {
        prNumber = process.env.REVIEW_ID;
      }
      
      // 如果还是无法获取，使用时间戳作为标识
      if (!prNumber) {
        prNumber = `unknown-${Date.now()}`;
        console.log('⚠️ 无法从环境变量中获取PR号码，使用时间戳代替');
      }
      
      const commitSha = process.env.COMMIT_REF || '';
      const branchName = process.env.HEAD || '';
      
      // 设置正确的覆盖率API地址
      // 使用当前站点的URL作为基础，指向Netlify函数
      const siteUrl = process.env.URL || deployUrl;
      const coverageApiUrl = `${siteUrl}/.netlify/functions/coverage`;
      
      console.log(`检测到PR #${prNumber}，分支: ${branchName}，提交: ${commitSha}`);
      console.log(`覆盖率API地址: ${coverageApiUrl}`);
      
      // 设置环境变量用于构建
      process.env.PR_NUMBER = prNumber;
      process.env.BRANCH_NAME = branchName;
      process.env.COMMIT_SHA = commitSha;
      process.env.COVERAGE_API_URL = coverageApiUrl;
      
      // 修改.env文件，确保这些环境变量在构建时可用
      utils.status.show({
        title: 'PR环境变量设置',
        summary: `设置PR #${prNumber}的环境变量`
      });
      
      // 创建或更新.env文件
      const envContent = `
VITE_PR_NUMBER=${prNumber}
VITE_BRANCH_NAME=${branchName}
VITE_COMMIT_SHA=${commitSha}
VITE_COLLECT_COVERAGE=true
VITE_COVERAGE_API_URL=${coverageApiUrl}
      `.trim();
      
      fs.writeFileSync('.env.production', envContent);
      
      // 输出更多调试信息
      console.log('环境变量设置：', {
        VITE_PR_NUMBER: prNumber,
        VITE_BRANCH_NAME: branchName,
        VITE_COMMIT_SHA: commitSha,
        VITE_COLLECT_COVERAGE: 'true',
        VITE_COVERAGE_API_URL: coverageApiUrl
      });
    } else {
      console.log('不是PR构建，跳过设置PR环境变量');
      
      // 即使不是PR构建，也设置覆盖率API地址（用于主分支覆盖率收集）
      const siteUrl = process.env.URL || '';
      if (siteUrl) {
        const coverageApiUrl = `${siteUrl}/.netlify/functions/coverage`;
        
        // 更新.env文件，但不启用覆盖率收集
        const envContent = `
VITE_COLLECT_COVERAGE=false
VITE_COVERAGE_API_URL=${coverageApiUrl}
        `.trim();
        
        fs.writeFileSync('.env.production', envContent);
        
        console.log('为主分支设置了覆盖率API地址（但未启用覆盖率收集）');
      }
    }
  }
}