import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptText = async (name: string) => readFile(
  new URL(`../scripts/${name}`, import.meta.url),
  "utf8",
);

test("Windows service scripts choose one node.exe when PowerShell returns multiple matches", async () => {
  for (const name of ["install-windows-service.ps1", "verify-windows-service.ps1"]) {
    const source = await scriptText(name);
    assert.match(
      source,
      /@\(Get-Command node\.exe[^\r\n]+\)\[0\]/,
      `${name} must use one deterministic node.exe path`,
    );
  }
});
