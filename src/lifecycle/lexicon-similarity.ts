/** Optional, offline embedding suggestions. Exact coverage never depends on this module being available. */
import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  openSync,
  closeSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { confined } from "./lexicon-maintain.ts";
import { digest, lexiconCoverage } from "./lexicon-coverage.ts";
import { loadProjectLexicons } from "./project.ts";

export const MODEL_SHA =
  "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";
export const MODEL_URL =
  "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/d32f8c040ea3b516330eeb75b72bcc2d3a780ab7/bge-small-en-v1.5-q8_0.gguf";
const SETTINGS = {
  package: "node-llama-cpp",
  version: "3.21.1",
  backend: "metal-prebuilt/cpu-layers-0",
  gpuLayers: 0,
  batchSize: 512,
  threads: 1,
  contextSize: 512,
};
interface ModelConfig {
  file: string;
  sha256: string;
  settings: typeof SETTINGS;
}
interface LocalContext {
  getEmbeddingFor(text: string): Promise<{ vector: readonly number[] }>;
  calculateInputLength(text: string): number;
  dispose(): Promise<void>;
}
interface LocalModel {
  createEmbeddingContext(
    options: Record<string, unknown>,
  ): Promise<LocalContext>;
  dispose(): Promise<void>;
}
interface LocalLlama {
  loadModel(options: Record<string, unknown>): Promise<LocalModel>;
  dispose(): Promise<void>;
}
async function shaFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function put(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, JSON.stringify(value));
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
export async function configureModel(
  root: string,
  file: string,
  sha: string,
): Promise<ModelConfig> {
  const path = resolve(root, file);
  if (!/^[a-f0-9]{64}$/i.test(sha))
    throw new Error("model needs its complete SHA-256");
  if (statSync(path).size > 512 * 1024 * 1024)
    throw new Error("local lexicon models are bounded to 512 MiB");
  if ((await shaFile(path)) !== sha.toLowerCase())
    throw new Error("model SHA-256 does not match; configuration is unchanged");
  const config: ModelConfig = {
    file: path,
    sha256: sha.toLowerCase(),
    settings: SETTINGS,
  };
  put(confined(root, ".coherence/lexicon/model.json"), config);
  return config;
}
/** The only network operation, explicitly requested; suggestions themselves never download anything. */
export async function downloadModel(root: string): Promise<ModelConfig> {
  const path = confined(root, ".coherence/models/bge-small-en-v1.5-q8_0.gguf");
  if (existsSync(path)) return configureModel(root, path, MODEL_SHA);
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  let fd: number | undefined;
  try {
    const response = await fetch(MODEL_URL, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`model download failed: HTTP ${response.status}`);
    fd = openSync(temp, "wx", 0o600);
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bytes += chunk.length;
        if (bytes > 36_806_944)
          throw new Error("model download exceeds its pinned size");
        writeSync(fd, chunk);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    closeSync(fd);
    fd = undefined;
    if (bytes !== 36_806_944 || (await shaFile(temp)) !== MODEL_SHA)
      throw new Error("model size or SHA-256 mismatch; nothing configured");
    renameSync(temp, path);
    return configureModel(root, path, MODEL_SHA);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}
export function normalized(vector: readonly number[]): number[] {
  if (!vector.length || vector.some((v) => !Number.isFinite(v)))
    throw new Error("invalid embedding vector");
  const length = Math.sqrt(vector.reduce((n, v) => n + v * v, 0));
  if (length === 0) throw new Error("zero embedding vector");
  return vector.map((v) => v / length);
}
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length)
    throw new Error("vectors from different models cannot be compared");
  return a.reduce((n, v, i) => n + v * b[i]!, 0);
}
export async function similarTerms(
  root: string,
  text: string,
): Promise<Record<string, unknown>> {
  const started = performance.now();
  let llama: LocalLlama | undefined,
    model: LocalModel | undefined,
    context: LocalContext | undefined;
  try {
    const path = confined(root, ".coherence/lexicon/model.json");
    if (!existsSync(path))
      return {
        available: false,
        reason:
          "No local model configured. Run lexicon model --download explicitly; exact coverage remains available.",
        suggestions: [],
      };
    if (process.platform !== "darwin" || process.arch !== "arm64")
      throw new Error(
        "local embeddings support Apple Silicon only; exact coverage is still available",
      );
    const config = JSON.parse(readFileSync(path, "utf8")) as ModelConfig;
    if (digest(config.settings) !== digest(SETTINGS))
      throw new Error(
        "embedding settings changed; explicitly configure the model again",
      );
    if ((await shaFile(config.file)) !== config.sha256)
      throw new Error(
        "configured model changed; old vectors will not be reused",
      );
    const { coherence, project } = await loadProjectLexicons(root);
    const concepts = [
      ...new Map(
        [...coherence.concepts, ...(project?.concepts ?? [])].map((c) => [
          c.name,
          c,
        ]),
      ).values(),
    ];
    const report = await lexiconCoverage(root);
    const term = report.terms.find((t) => t.term === text.toLowerCase());
    const examples = (term?.contexts ?? []).slice(0, 12).map((c) => ({
      component: c.component,
      text: term!.uses
        .filter((u) => u.component === c.component)
        .slice(0, 2)
        .map((u) => u.text)
        .join("\n"),
    }));
    const descriptions = concepts.map(
      (c) => `${c.name}: ${c.definition} ${JSON.stringify(c.properties)}`,
    );
    const texts = [text, ...descriptions, ...examples.map((e) => e.text)];
    const cachePath = confined(
      root,
      `.coherence/lexicon/vectors/${digest({ sha: config.sha256, settings: SETTINGS })}.json`,
    );
    let cache: Record<string, number[]> = {};
    if (existsSync(cachePath)) {
      try {
        cache = JSON.parse(readFileSync(cachePath, "utf8")) as Record<
          string,
          number[]
        >;
      } catch {
        cache = {};
      }
    }
    const vectors: number[][] = [];
    let computed = 0;
    for (const value of texts) {
      const key = digest(value);
      let vector = cache[key];
      if (
        !Array.isArray(vector) ||
        vector.length !== 384 ||
        vector.some((v) => !Number.isFinite(v))
      ) {
        if (!context) {
          const moduleName = "node-llama-cpp";
          const lib = (await import(moduleName)) as {
            getLlama: (options: Record<string, unknown>) => Promise<LocalLlama>;
          };
          llama = await lib.getLlama({
            gpu: "metal",
            build: "never",
            skipDownload: true,
            logLevel: "disabled",
            maxThreads: 1,
          });
          model = await llama.loadModel({
            modelPath: config.file,
            gpuLayers: 0,
          });
          context = await model.createEmbeddingContext({
            contextSize: 512,
            batchSize: 512,
            threads: 1,
          });
        }
        if (context.calculateInputLength(value) > 512)
          throw new Error(
            "context exceeds 512 model tokens; supply a shorter review excerpt",
          );
        vector = normalized((await context.getEmbeddingFor(value)).vector);
        cache[key] = vector;
        computed++;
      }
      vectors.push(vector);
    }
    if (computed) put(cachePath, cache);
    const query = vectors[0]!;
    const suggestions = concepts
      .map((c, i) => ({
        concept: c.name,
        definition: c.definition,
        similarity: cosine(query, vectors[i + 1]!),
      }))
      .sort(
        (a, b) =>
          b.similarity - a.similarity || a.concept.localeCompare(b.concept),
      )
      .slice(0, 5);
    const contexts: unknown[] = [];
    for (let a = 0; a < examples.length; a++)
      for (let b = a + 1; b < examples.length; b++)
        contexts.push({
          left: examples[a],
          right: examples[b],
          similarity: cosine(
            vectors[1 + concepts.length + a]!,
            vectors[1 + concepts.length + b]!,
          ),
        });
    return {
      available: true,
      model: { sha256: config.sha256, ...SETTINGS },
      latencyMs: Math.round(performance.now() - started),
      computed,
      cached: texts.length - computed,
      suggestions,
      contextComparisons: contexts,
      limits: [
        "Similarity nominates questions; it never settles meaning, changes lexicon entries or affects enforcement verdicts.",
        "Context comparisons sample at most two excerpts from each of twelve contexts; low similarity is not proof of overload.",
        "Pinned small English model; other languages and long inputs need separate evaluation.",
      ],
    };
  } catch (e) {
    return {
      available: false,
      reason: e instanceof Error ? e.message : String(e),
      suggestions: [],
      limits: [
        "Exact coverage and human review remain available. No semantic ruling was made.",
      ],
    };
  } finally {
    await context?.dispose();
    await model?.dispose();
    await llama?.dispose();
  }
}
