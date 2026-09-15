import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import type { ScopeConfiguration } from "../configuration.ts";

export interface ScopeExtensionBundle { js: string; css: string; inputs: string[] }

const runtimePlugin: Plugin = {
  name: "scope-shared-react-runtime",
  setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "scope-runtime" }));
    builder.onResolve({ filter: /^react\/(jsx-runtime|jsx-dev-runtime)$/ }, args => ({ path: args.path.slice(6), namespace: "scope-runtime" }));
    builder.onLoad({ filter: /^react$/, namespace: "scope-runtime" }, () => ({ loader: "js", contents: `
      const R=globalThis.__SCOPE_REACT_RUNTIME__?.React;
      if(!R) throw new Error("Scope extension React runtime is unavailable");
      export default R;
      export const {Children,Component,Fragment,PureComponent,StrictMode,Suspense,act,cache,cloneElement,createContext,createElement,createRef,forwardRef,isValidElement,lazy,memo,startTransition,use,useActionState,useCallback,useContext,useDebugValue,useDeferredValue,useEffect,useEffectEvent,useId,useImperativeHandle,useInsertionEffect,useLayoutEffect,useMemo,useOptimistic,useReducer,useRef,useState,useSyncExternalStore,useTransition,version}=R;
    ` }));
    builder.onLoad({ filter: /^(jsx-runtime|jsx-dev-runtime)$/, namespace: "scope-runtime" }, () => ({ loader: "js", contents: `
      const J=globalThis.__SCOPE_REACT_RUNTIME__?.jsxRuntime;
      if(!J) throw new Error("Scope extension JSX runtime is unavailable");
      export const {Fragment,jsx,jsxs,jsxDEV}=J;
    ` }));
  },
};

/** Bundle project presentation code without executing it in the host process. */
export async function bundleScopeExtensions(configuration: ScopeConfiguration, projectRoot?: string): Promise<ScopeExtensionBundle> {
  if (!configuration.extensions.length) return { js: "", css: "", inputs: [] };
  if (!projectRoot) throw new Error("Scope extensions require a project root when rendering HTML");
  const root = await realpath(projectRoot);
  const entries: string[] = [];
  for (const [index, specifier] of configuration.extensions.entries()) {
    const candidate = resolve(root, specifier);
    let entry: string;
    try { entry = await realpath(candidate); }
    catch (error) { throw new Error(`Scope extension extensions[${index}] ${specifier}: ${(error as Error).message}`); }
    const fromRoot = relative(root, entry);
    if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`Scope extension extensions[${index}] ${specifier}: resolved outside the project root`);
    entries.push(entry);
  }
  const imports = entries.map((entry, index) => `import extension${index} from ${JSON.stringify(entry)};`).join("\n");
  const contents = `${imports}\nglobalThis.__SCOPE_EXTENSIONS__=[${entries.map((_, index) => `extension${index}`).join(",")}];`;
  try {
    const result = await build({ absWorkingDir: root, stdin: { contents, resolveDir: root, sourcefile: "scope-extensions-entry.js", loader: "js" }, bundle: true,
      write: false, outfile: "scope-extension-bundle.js", format: "iife", platform: "browser", jsx: "automatic", minify: true, legalComments: "inline",
      define: { "process.env.NODE_ENV": '"production"' }, plugins: [runtimePlugin], metafile: true, logLevel: "silent",
      supported: { "template-literal": false }, loader: { ".css": "css", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".webp": "dataurl", ".svg": "dataurl", ".woff": "dataurl", ".woff2": "dataurl" } });
    const js = result.outputFiles.find(file => file.path.endsWith(".js"))?.text ?? "";
    const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
    if (!js) throw new Error("bundler produced no JavaScript");
    const inputs = Object.keys(result.metafile.inputs)
      .filter(path => path !== "scope-extensions-entry.js" && !path.startsWith("scope-runtime:"))
      .map(path => relative(root, isAbsolute(path) ? path : resolve(root, path)));
    return { js, css, inputs: [...new Set(inputs)].sort() };
  } catch (error) {
    throw new Error(`Scope extension bundle failed: ${(error as Error).message}`);
  }
}
