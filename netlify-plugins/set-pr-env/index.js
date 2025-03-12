export default {
  onPreBuild: ({ utils }) => {
    // 获取Netlify环境变量
    const isPR = process.env.CONTEXT === 'deploy-preview';
    
    if (isPR) {
      const prNumber = process.env.PULL_REQUEST;
      const commitSha = process.env.COMMIT_REF;
      const branchName = process.env.HEAD;
      
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
      
      require('fs').writeFileSync('.env.production', envContent);
    } else {
      console.log('不是PR构建，跳过设置PR环境变量');
    }
  }
}