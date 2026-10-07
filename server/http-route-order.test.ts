import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { parseSync } from "rolldown/utils";

type AstStatement = ReturnType<typeof parseSync>["program"]["body"][number];
type Route = { method: string; path: string; domain: string };
const parse = (file: string, text: string) => {
 const result = parseSync(file, text);
 assert.deepEqual(result.errors, []);
 return result.program.body;
};
const statementRoute = (node: AstStatement): { method: string; path: string } | undefined => {
 if (node.type !== "ExpressionStatement" || node.expression.type !== "CallExpression") return;
 const expression=node.expression,callee=expression.callee,first=expression.arguments[0];
 if(callee.type!=="MemberExpression"||callee.object.type!=="Identifier"||callee.object.name!=="app"||callee.property.type!=="Identifier"||first?.type!=="Literal")return;
 const method=callee.property.name,url=first.value;
 if (["get", "post", "put", "patch", "delete"].includes(method) && typeof url === "string") return { method, path: url };
};
test("every original route and pre-existing registrar retains its registration order", async () => {
 const baseline = JSON.parse(await readFile("docs/architecture/http-route-baseline.json", "utf8")) as Route[];
 const expansions = new Map<string, Array<{ method: string; path: string }>>();
 for (const file of (await readdir("server")).filter(name => name.endsWith("-http-routes.ts"))) {
  for (const node of parse(file, await readFile("server/" + file, "utf8"))) {
   if (node.type !== "ExportNamedDeclaration" || node.declaration?.type !== "FunctionDeclaration") continue;
   const declaration = node.declaration;
   expansions.set(declaration.id!.name, (declaration.body?.body ?? []).flatMap(statement => { const route = statementRoute(statement); return route ? [route] : []; }));
  }
 }
 const actual: Array<{ method: string; path: string }> = [];
 const oldRegistrars = new Set(baseline.filter(item => item.method === "register").map(item => item.path));
 for (const node of parse("server/index.ts", await readFile("server/index.ts", "utf8"))) {
  const route = statementRoute(node);
  if (route) { actual.push(route); continue; }
  if (node.type !== "ExpressionStatement" || node.expression.type !== "CallExpression" || node.expression.callee.type !== "Identifier") continue;
  const name = node.expression.callee.name;
  if (oldRegistrars.has(name)) actual.push({ method: "register", path: name });
  else if (expansions.has(name)) actual.push(...expansions.get(name)!);
 }
 const key = (item: { method: string; path: string }) => item.method + " " + item.path;
 const known = new Set(baseline.map(key));
 // Future endpoints may be added; every original route must still occur once,
 // in the same position relative to the other originals and existing registrars.
 assert.deepEqual(actual.filter(item => known.has(key(item))).map(key), baseline.map(key));
 assert.equal(baseline.filter(item => item.method !== "register").length, 126);
});

