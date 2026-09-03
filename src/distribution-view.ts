export type DistributionTargetId = "wechat" | "xiaoheihe";
export type DistributionTargetStatus = "current" | "stale" | "ready" | "setup";

export interface DistributionTarget {
  id: DistributionTargetId;
  label: string;
  operation: "同步草稿箱" | "填入编辑器";
  status: DistributionTargetStatus;
  statusLabel: string;
  finalPublish: "manual";
}

interface DistributionDraftSnapshot {
  id: string;
  updatedAt: string;
  wechatDraft?: {
    localDraftUpdatedAt: string;
  };
  publisherReceipt?: {
    outcome: "blocked" | "failed" | "partial" | "filled";
  };
}

interface BuildDistributionTargetsInput {
  draft: DistributionDraftSnapshot;
  dirty: boolean;
  publisherReady: boolean;
  wechatConfigured: boolean;
}

const wechatStatusFor = (
  draft: DistributionDraftSnapshot,
  dirty: boolean,
  configured: boolean,
): DistributionTargetStatus => {
  if (draft.wechatDraft) {
    return !dirty && draft.wechatDraft.localDraftUpdatedAt === draft.updatedAt ? "current" : "stale";
  }
  return configured ? "ready" : "setup";
};

const xiaoheiheStatusFor = (
  draft: DistributionDraftSnapshot,
  dirty: boolean,
  publisherReady: boolean,
): DistributionTargetStatus => {
  if (draft.publisherReceipt?.outcome === "filled") return dirty ? "stale" : "current";
  return publisherReady ? "ready" : "setup";
};

const statusLabels: Record<DistributionTargetStatus, string> = {
  current: "当前版本已送达",
  stale: "正文已改，需更新",
  ready: "可以准备",
  setup: "需要连接",
};

export const buildDistributionTargets = ({
  draft,
  dirty,
  publisherReady,
  wechatConfigured,
}: BuildDistributionTargetsInput): DistributionTarget[] => {
  const wechatStatus = wechatStatusFor(draft, dirty, wechatConfigured);
  const xiaoheiheStatus = xiaoheiheStatusFor(draft, dirty, publisherReady);
  return [
    {
      id: "wechat",
      label: "微信公众号",
      operation: "同步草稿箱",
      status: wechatStatus,
      statusLabel: statusLabels[wechatStatus],
      finalPublish: "manual",
    },
    {
      id: "xiaoheihe",
      label: "小黑盒",
      operation: "填入编辑器",
      status: xiaoheiheStatus,
      statusLabel: statusLabels[xiaoheiheStatus],
      finalPublish: "manual",
    },
  ];
};
