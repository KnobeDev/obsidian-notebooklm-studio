import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "node:*", ...builtins],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  loader: { ".py": "text" },
  outfile: "main.js"
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
