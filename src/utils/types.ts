export interface CoverageMetadata {
  prNumber: string;
  branchName: string;
  commitSha: string;
  sessionId: string;
  timestamp: number;
  incremental: boolean; // 标记是否为增量覆盖率数据
}
