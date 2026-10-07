/** Tool restrictions are shared by execution and the no-generation health probe. */
export const codexExecFeatures = {
  enable: ["skip_host_skill_discovery"],
  disable: [
    "shell_tool", "unified_exec", "apps", "browser_use", "browser_use_external",
    "computer_use", "in_app_browser", "in_app_chat", "in_app_local_automation",
    "hooks", "plugins", "remote_plugin", "multi_agent", "multi_agent_v2",
    "code_mode", "code_mode_host", "image_generation", "view_image",
    "skill_search", "standalone_web_search", "memories", "workspace_dependencies",
  ],
} as const;

export const codexUpdateAdvice = "请更新 ChatGPT 或 Codex 桌面应用";

export const codexCapabilityError = (message: string): string | undefined => {
  const flag = message.match(/Unknown feature flag:\s*['"`]?([\w-]+)/iu)?.[1];
  return flag ? `Codex CLI 不支持功能开关 ${flag}；${codexUpdateAdvice}。` : undefined;
};
