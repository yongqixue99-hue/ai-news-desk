import { Ajv, type ValidateFunction } from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
const validators = new Map<string, ValidateFunction>();

/** The same fail-closed boundary is applied after every model transport. */
export const parseProviderJson = <T = unknown>(output: string, schema: object): T => {
  let value: unknown;
  try {
    value = JSON.parse(output.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""));
  } catch {
    throw new Error("模型输出结构校验失败：不是完整 JSON");
  }
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    if (validators.size >= 64) { validators.clear(); ajv.removeSchema(); }
    validators.set(key, validate);
  }
  if (!validate(value)) {
    const details = (validate.errors ?? []).slice(0, 5).map((error) => `${error.instancePath || "/"} ${error.keyword}`).join("；");
    throw new Error(`模型输出结构校验失败：${details}`);
  }
  return value as T;
};
