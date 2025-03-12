import fs from 'fs';

export default {
  onPreBuild: ({ utils }) => {
    // 获取Netlify环境变量
    const isPR = process.env.CONTEXT === 'deploy-preview';
    
    if (isPR) {
      // 从 NETLIFY_DEPLOY_URL 或 DEPLOY_URL 中解析 PR 号码
      // Netlify 的 deploy-preview URL 通常格式为: deploy-preview-[PR号].netlify.app
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
      
      console.log(`检测到PR #${prNumber}，分支: ${branchName}，提交: ${commitSha}`);
      
      // 设置环境变量用于构建
      process.env.PR_NUMBER = prNumber;
      process.env.BRANCH_NAME = branchName;
      process.env.COMMIT_SHA = commitSha;
      
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
      `.trim();
      
      fs.writeFileSync('.env.production', envContent);
      
      // 输出更多调试信息
      console.log('环境变量设置：', {
        VITE_PR_NUMBER: prNumber,
        VITE_BRANCH_NAME: branchName,
        VITE_COMMIT_SHA: commitSha,
        VITE_COLLECT_COVERAGE: 'true'
      });
      
      // 打印所有可能包含PR信息的环境变量，用于调试
      console.log('所有相关环境变量：');
      [
        'CONTEXT', 'DEPLOY_URL', 'NETLIFY_DEPLOY_URL', 'PULL_REQUEST', 
        'REVIEW_ID', 'BRANCH', 'HEAD', 'COMMIT_REF'
      ].forEach(key => {
        console.log(`${key}: ${process.env[key]}`);
      });
    } else {
      console.log('不是PR构建，跳过设置PR环境变量');
    }
  }
}