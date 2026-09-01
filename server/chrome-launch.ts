import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const executableCandidates = process.platform === "win32"
  ? [
    process.env.PROGRAMFILES ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` : "",
    process.env["PROGRAMFILES(X86)"] ? `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe` : "",
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : "",
  ]
  : process.platform === "darwin"
    ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ]
    : [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ];

export const findChromeExecutable = async () => {
  for (const candidate of executableCandidates.filter(Boolean)) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  throw new Error("没有找到 Google Chrome；请先安装 Chrome，或确认它位于系统默认安装目录");
};

const detached = (command: string, args: string[]) => {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
};

export const openRegularChrome = async (url: string) => {
  if (process.platform === "darwin") detached("open", ["-a", "Google Chrome", url]);
  else detached(await findChromeExecutable(), [url]);
};

export const openDebugChrome = async (
  url: string,
  port: number,
  userDataDirectory: string,
) => {
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDirectory}`,
    url,
  ];
  if (process.platform === "darwin") {
    detached("open", ["-na", "Google Chrome", "--args", ...chromeArgs]);
  } else {
    detached(await findChromeExecutable(), chromeArgs);
  }
};
