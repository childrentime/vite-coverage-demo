# Vite 实时代码覆盖率收集

这个项目演示了如何在基于Vite的React应用中实现实时代码覆盖率收集，并在GitHub PR中展示覆盖率报告。与传统的测试覆盖率不同，此方案收集的是用户实际访问页面时的代码覆盖率。

## 功能特点

1. **实时覆盖率收集**：在用户实际访问页面时收集代码覆盖率数据
2. **增量覆盖率分析**：针对PR中修改的代码进行覆盖率分析
3. **PR自动评论**：在GitHub PR中自动更新覆盖率报告
4. **Netlify部署集成**：支持Netlify预览部署，每个PR都有单独的预览环境

## 技术架构

- **前端**：Vite + React + TypeScript
- **代码覆盖率**：babel-plugin-istanbul + vite-plugin-istanbul
- **数据存储**：LocalForage (浏览器端) + Express (服务器端)
- **CI/CD**：Netlify + GitHub Actions

## 工作原理

1. 通过Babel插件和Vite插件在源代码中注入覆盖率收集逻辑
2. 用户访问页面时，覆盖率数据会在浏览器中实时收集
3. 页面定期或在用户交互后将覆盖率数据发送到后端服务
4. 后端服务合并多个用户的覆盖率数据，生成总体报告
5. 针对PR，后端会自动更新GitHub评论，显示增量覆盖率

## 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器（带覆盖率收集）
npm run dev:with-coverage

# 启动后端服务（接收覆盖率数据）
npm run start:server
```

### 生产构建

```bash
# 构建生产版本（不带覆盖率收集）
npm run build

# 构建生产版本（带覆盖率收集）
npm run build:with-coverage
```

## 环境变量设置

- `COLLECT_COVERAGE`: 是否启用覆盖率收集 (true/false)
- `PR_NUMBER`: PR编号，自动从CI环境获取
- `BRANCH_NAME`: 分支名称，自动从CI环境获取
- `COMMIT_SHA`: 提交哈希，自动从CI环境获取
- `VITE_COVERAGE_API_URL`: 覆盖率数据上报API的URL

## Netlify部署配置

项目包含Netlify配置，支持自动部署PR预览版本。对于每个PR，Netlify会自动:

1. 构建并部署带覆盖率收集的预览版本
2. 通过插件设置PR相关环境变量
3. 将覆盖率数据发送到指定的API服务

## GitHub PR集成

当用户访问PR的预览版本时，覆盖率数据会被收集并上报。后端服务会:

1. 接收并存储各用户的覆盖率数据
2. 合并多个用户的覆盖率数据
3. 计算整体覆盖率和增量覆盖率
4. 在GitHub PR中创建或更新评论，显示覆盖率报告

## 覆盖率服务部署

覆盖率服务需要单独部署，建议使用:

- Vercel
- Heroku
- AWS Lambda

部署后需要设置以下环境变量:

- `GITHUB_TOKEN`: 用于更新PR评论的GitHub Token
- `REPO_OWNER`: GitHub仓库所有者
- `REPO_NAME`: GitHub仓库名称

## 注意事项

- 代码覆盖率收集会增加应用体积和运行开销，仅建议在开发环境或PR预览环境启用
- 生产环境通常应关闭覆盖率收集功能
- 确保覆盖率服务安全部署，防止未授权访问

## 扩展建议

- 添加覆盖率阈值检查，确保PR不会降低覆盖率
- 集成到CI流程，在覆盖率不达标时阻止合并
- 添加覆盖率趋势图，跟踪项目覆盖率变化
- 实现更精细的增量覆盖率分析，只关注实际修改的代码行