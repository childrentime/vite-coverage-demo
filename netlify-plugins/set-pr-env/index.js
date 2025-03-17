import fs from 'fs';

export default {
  onPreBuild: ({ utils }) => {
    // 获取Netlify环境变量
    const isPR = process.env.CONTEXT === 'deploy-preview';
    
    // 获取当前部署的URL - 使用当前预览URL而不是主站点URL
    const currentDeployUrl = process.env.DEPLOY_URL || process.env.NETLIFY_DEPLOY_URL || '';
    
    if (isPR) {
      // 从部署URL中解析PR号码
      let prNumber = '';
      if (currentDeployUrl) {
        const match = currentDeployUrl.match(/deploy-preview-(\d+)/);
        if (match && match[1]) {
          prNumber = match[1];
        }
      }
      
      // 备用方案
      if (!prNumber && process.env.REVIEW_ID) {
        prNumber = process.env.REVIEW_ID;
      }
      
      if (!prNumber) {
        prNumber = `unknown-${Date.now()}`;
        console.log('⚠️ 无法从环境变量中获取PR号码，使用时间戳代替');
      }
      
      const commitSha = process.env.COMMIT_REF || '';
      const branchName = process.env.HEAD || '';
      
      // 非常重要：使用相对URL或当前部署的完整URL
      // 方案1：使用相对URL（推荐）
      const coverageApiUrl = '/.netlify/functions/coverage';
      
      // 方案2：如果需要绝对URL，确保使用当前预览的域名
      // 先移除末尾的斜杠（如果有）
      const baseUrl = currentDeployUrl.replace(/\/$/, '');
      const absoluteCoverageApiUrl = `${baseUrl}/.netlify/functions/coverage`;
      
      console.log(`检测到PR #${prNumber}，分支: ${branchName}，提交: ${commitSha}`);
      console.log(`当前部署URL: ${currentDeployUrl}`);
      console.log(`覆盖率API相对路径: ${coverageApiUrl}`);
      console.log(`覆盖率API绝对路径: ${absoluteCoverageApiUrl} (仅供参考)`);
      
      // 设置环境变量用于构建
      process.env.PR_NUMBER = prNumber;
      process.env.BRANCH_NAME = branchName;
      process.env.COMMIT_SHA = commitSha;
      
      // 修改.env文件，确保这些环境变量在构建时可用
      utils.status.show({
        title: 'PR环境变量设置',
        summary: `设置PR #${prNumber}的环境变量`
      });
      
      // 使用相对URL避免跨域问题
      const envContent = `
VITE_PR_NUMBER=${prNumber}
VITE_BRANCH_NAME=${branchName}
VITE_COMMIT_SHA=${commitSha}
VITE_COLLECT_COVERAGE=true
VITE_COVERAGE_API_URL=${coverageApiUrl}
      `.trim();
      
      fs.writeFileSync('.env.production', envContent);
      
      console.log('环境变量设置：', {
        VITE_PR_NUMBER: prNumber,
        VITE_BRANCH_NAME: branchName,
        VITE_COMMIT_SHA: commitSha,
        VITE_COLLECT_COVERAGE: 'true',
        VITE_COVERAGE_API_URL: coverageApiUrl
      });
    } else {
      console.log('不是PR构建，跳过设置PR环境变量');
      
      // 即使不是PR构建，也设置覆盖率API地址
      // 同样使用相对URL避免跨域问题
      const coverageApiUrl = '/.netlify/functions/coverage';
      
      const envContent = `
VITE_COLLECT_COVERAGE=false
VITE_COVERAGE_API_URL=${coverageApiUrl}
      `.trim();
      
      fs.writeFileSync('.env.production', envContent);
      
      console.log('为主分支设置了覆盖率API地址（但未启用覆盖率收集）');
    }
  }
}