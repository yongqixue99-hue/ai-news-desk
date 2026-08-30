import { randomUUID } from "node:crypto";
import type { SourceConfig, SourcePreset, WorkflowState } from "./types.js";

export interface SourceBatchPatch {
  enabled?: boolean;
  selected?: boolean;
}

export const batchUpdateSources = (
  state: WorkflowState,
  sourceIds: string[],
  patch: SourceBatchPatch,
) => {
  const requested = new Set(sourceIds);
  const changed: SourceConfig[] = [];
  for (const source of state.sources) {
    if (!requested.has(source.id)) continue;
    if (typeof patch.enabled === "boolean") source.enabled = patch.enabled;
    if (typeof patch.selected === "boolean") source.selected = patch.selected;
    changed.push(source);
  }
  return changed;
};

export interface CreateSourcePresetInput {
  name: string;
  sourceIds: string[];
}

export interface CreateSourcePresetOptions {
  id?: string;
  now?: () => Date;
}

export const createSourcePreset = (
  state: WorkflowState,
  input: CreateSourcePresetInput,
  options: CreateSourcePresetOptions = {},
): SourcePreset => {
  const name = input.name.trim();
  if (!name) throw new Error("来源组合名称不能为空");
  if (state.sourcePresets.some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error("已有同名来源组合");
  }
  const available = new Set(state.sources.map((source) => source.id));
  const sourceIds = [...new Set(input.sourceIds)].filter((sourceId) => available.has(sourceId));
  if (!sourceIds.length) throw new Error("来源组合至少包含一个现有新闻源");
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const preset: SourcePreset = {
    id: options.id ?? `source_preset_${randomUUID().slice(0, 8)}`,
    name,
    sourceIds,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.sourcePresets.push(preset);
  return preset;
};

export const applySourcePreset = (state: WorkflowState, presetId: string) => {
  const preset = state.sourcePresets.find((entry) => entry.id === presetId);
  if (!preset) throw new Error("来源组合不存在");
  const selectedIds = new Set(preset.sourceIds);
  for (const source of state.sources) source.selected = selectedIds.has(source.id);
  preset.updatedAt = new Date().toISOString();
  return state.sources.filter((source) => source.selected);
};

export const deleteSourcePreset = (state: WorkflowState, presetId: string) => {
  const index = state.sourcePresets.findIndex((entry) => entry.id === presetId);
  if (index < 0) return false;
  state.sourcePresets.splice(index, 1);
  return true;
};
