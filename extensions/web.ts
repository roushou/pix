/**
 * web — web_fetch and web_search tools for the agent.
 *
 * Registers two zero-dependency tools so the agent can ground itself in
 * current information instead of guessing:
 *
 *   web_fetch  — fetch a URL, strip HTML to readable text, pretty-print JSON,
 *                and truncate to context-safe limits. Binary content is
 *                summarized (content-type + size) rather than dumped.
 *   web_search — search the web and return a numbered list of results.
 *
 * Search backends, resolved in order:
 *   1. settings.json `web.searchProvider` if set to a specific provider
 *   2. TAVILY_API_KEY, then BRAVE_API_KEY, then SERPER_API_KEY (auto-detect)
 *   3. DuckDuckGo HTML (no key required) as the fallback
 *
 * Config (optional, best-effort) — read from `~/.pi/agent/settings.json` and
 * `<project>/.pi/settings.json` under a `web` key:
 *
 *   {
 *     "web": {
 *       "userAgent": "pi-web/1.0",
 *       "searchProvider": "auto",   // auto | duckduckgo | tavily | brave | serper
 *       "maxResults": 8,
 *       "timeoutMs": 15000
 *     }
 *   }
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_USER_AGENT = "pi-web/1.0";

type SearchProvider = "auto" | "duckduckgo" | "tavily" | "brave" | "serper";

interface WebConfig {
  userAgent: string;
  searchProvider: SearchProvider;
  maxResults: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: WebConfig = {
  userAgent: DEFAULT_USER_AGENT,
  searchProvider: "auto",
  maxResults: DEFAULT_MAX_RESULTS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

function loadConfig(cwd: string): WebConfig {
  const paths = [join(getAgentDir(), "settings.json"), join(cwd, CONFIG_DIR_NAME, "settings.json")];
  let merged: Record<string, unknown> = {};

  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as { web?: Record<string, unknown> };
      if (parsed.web) Object.assign(merged, parsed.web);
    } catch {
      // Settings are best-effort; fall back to defaults on any parse error.
    }
  }

  const provider = merged.searchProvider;
  const isProvider =
    provider === "duckduckgo" ||
    provider === "tavily" ||
    provider === "brave" ||
    provider === "serper";

  return {
    userAgent: typeof merged.userAgent === "string" ? merged.userAgent : DEFAULT_CONFIG.userAgent,
    searchProvider: isProvider ? provider : DEFAULT_CONFIG.searchProvider,
    maxResults:
      typeof merged.maxResults === "number" && merged.maxResults > 0
        ? merged.maxResults
        : DEFAULT_CONFIG.maxResults,
    timeoutMs:
      typeof merged.timeoutMs === "number" && merged.timeoutMs > 0
        ? merged.timeoutMs
        : DEFAULT_CONFIG.timeoutMs,
  };
}

// --------------------------------------------------------------------------- //
// HTML / text helpers
// --------------------------------------------------------------------------- //

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, " ");
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return undefined;
  return (
    decodeEntities(stripTags(match[1] ?? ""))
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

function htmlToText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|ul|ol|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ");

  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function truncateBytes(text: string, max: number): string {
  if (Buffer.byteLength(text, "utf8") <= max) return text;
  let out = text.slice(0, max);
  while (Buffer.byteLength(out, "utf8") > max) out = out.slice(0, -1);
  return out;
}

function truncateOutput(text: string): string {
  const lines = text.split("\n");
  let note = "";
  if (lines.length > MAX_OUTPUT_LINES) {
    lines.length = MAX_OUTPUT_LINES;
    note = `\n\n[Truncated: showing first ${MAX_OUTPUT_LINES} lines]`;
  }
  let out = lines.join("\n");
  if (Buffer.byteLength(out, "utf8") > MAX_OUTPUT_BYTES) {
    out = truncateBytes(out, MAX_OUTPUT_BYTES);
    note = `\n\n[Truncated to ${MAX_OUTPUT_BYTES} bytes]`;
  }
  return out + note;
}

// --------------------------------------------------------------------------- //
// Fetch plumbing
// --------------------------------------------------------------------------- //

interface FetchHandle {
  signal: AbortSignal;
  timedOut: boolean;
  cleanup: () => void;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): FetchHandle {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

// --------------------------------------------------------------------------- //
// Search backends
// --------------------------------------------------------------------------- //

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function extractUddg(href: string): string {
  const match = /uddg=([^&]+)/.exec(href);
  if (!match) return href.startsWith("//") ? `https:${href}` : href;
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return match[1] ?? href;
  }
}

function extractDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetRe.exec(html)) !== null) {
    snippets.push(
      decodeEntities(stripTags(snippetMatch[1] ?? ""))
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = titleRe.exec(html)) !== null) {
    const title = decodeEntities(stripTags(match[2] ?? ""))
      .replace(/\s+/g, " ")
      .trim();
    const url = extractUddg(match[1] ?? "");
    if (!title || !url) continue;
    results.push({ title, url, snippet: snippets[i] ?? "" });
    i += 1;
  }
  return results;
}

async function searchDuckDuckGo(
  query: string,
  max: number,
  signal: AbortSignal,
  userAgent: string,
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "user-agent": userAgent, accept: "text/html" },
    signal,
  });
  if (!res.ok) {
    throw new Error(
      `DuckDuckGo search failed (HTTP ${res.status}). Set TAVILY_API_KEY, BRAVE_API_KEY, or SERPER_API_KEY for a keyed search backend.`,
    );
  }
  const html = await res.text();
  return extractDuckDuckGoResults(html).slice(0, max);
}

async function searchTavily(
  query: string,
  max: number,
  signal: AbortSignal,
  apiKey: string,
): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: max, search_depth: "basic", include_answer: false }),
    signal,
  });
  if (!res.ok) throw new Error(`Tavily search failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? [])
    .map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }))
    .filter((r) => r.url);
}

async function searchBrave(
  query: string,
  max: number,
  signal: AbortSignal,
  apiKey: string,
): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "x-subscription-token": apiKey },
    signal,
  });
  if (!res.ok) throw new Error(`Brave search failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (data.web?.results ?? [])
    .map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? "" }))
    .filter((r) => r.url);
}

async function searchSerper(
  query: string,
  max: number,
  signal: AbortSignal,
  apiKey: string,
): Promise<SearchResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ q: query, num: max }),
    signal,
  });
  if (!res.ok) throw new Error(`Serper search failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return (data.organic ?? [])
    .map((r) => ({ title: r.title ?? "", url: r.link ?? "", snippet: r.snippet ?? "" }))
    .filter((r) => r.url);
}

function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No results found for "${query}".`;
  const lines = [`Search results for "${query}":`, ""];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. **${r.title}**`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function resolveProvider(cfg: WebConfig): Exclude<SearchProvider, "auto"> {
  if (cfg.searchProvider !== "auto") return cfg.searchProvider;
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BRAVE_API_KEY) return "brave";
  if (process.env.SERPER_API_KEY) return "serper";
  return "duckduckgo";
}

// --------------------------------------------------------------------------- //
// Extension
// --------------------------------------------------------------------------- //

const FetchParams = Type.Object({
  url: Type.String({ description: "The URL to fetch (http:// or https://)" }),
  raw: Type.Optional(
    Type.Boolean({
      description: "Return raw HTML/text instead of extracted plain text. Default: false.",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description: `Request timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}.`,
    }),
  ),
});

const SearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  maxResults: Type.Optional(
    Type.Number({
      description: `Maximum number of results (1-20). Default: ${DEFAULT_MAX_RESULTS}.`,
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  let config: WebConfig | undefined;

  const getConfig = (ctx: ExtensionContext): WebConfig => {
    if (!config) config = loadConfig(ctx.cwd);
    return config;
  };

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and return its content. HTML is converted to readable plain text, JSON is pretty-printed, and output is truncated to context-safe limits. Binary content is summarized rather than dumped.",
    promptSnippet: "Fetch a URL and return extracted text (HTML stripped, JSON pretty-printed)",
    promptGuidelines: [
      "Use web_fetch to read documentation, API responses, or pages when you need up-to-date information that is not in the local codebase.",
    ],
    parameters: FetchParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cfg = getConfig(ctx);
      const timeoutMs = params.timeoutMs ?? cfg.timeoutMs;
      const handle = withTimeout(signal, timeoutMs);
      try {
        const res = await fetch(params.url, {
          signal: handle.signal,
          redirect: "follow",
          headers: {
            "user-agent": cfg.userAgent,
            accept:
              "text/html,application/xhtml+xml,application/json,text/plain,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        const isText =
          /text|json|html|xml|javascript|yaml|x-www-form-urlencoded/.test(contentType) ||
          contentType === "";

        if (!isText) {
          const length = res.headers.get("content-length") ?? "?";
          const text =
            `Fetched ${res.url} — binary content not shown.\n` +
            `Status: ${res.status} ${res.statusText}`.trim() +
            `\nContent-Type: ${contentType || "unknown"}\nSize: ${length} bytes`;
          return {
            content: [{ type: "text", text }],
            details: {
              url: res.url,
              status: res.status,
              contentType,
              binary: true,
            },
          };
        }

        const body = await res.text();
        let content: string;
        let title: string | undefined;
        if (contentType.includes("json")) {
          content = prettyJson(body);
        } else if (contentType.includes("html") || contentType.includes("xml")) {
          title = extractTitle(body);
          content = params.raw ? body : htmlToText(body);
        } else {
          content = body;
        }

        const statusLine = res.statusText
          ? `Status: ${res.status} ${res.statusText}`
          : `Status: ${res.status}`;
        const header = [`URL: ${res.url}`, statusLine];
        if (title && !params.raw) header.push(`Title: ${title}`);

        const text =
          (title && !params.raw ? `# ${title}\n\n` : "") +
          header.join(" · ") +
          "\n\n" +
          truncateOutput(content);

        return {
          content: [{ type: "text", text }],
          details: { url: res.url, status: res.status, contentType, title },
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (handle.timedOut) {
          throw new Error(`web_fetch timed out after ${timeoutMs}ms`, { cause: error });
        }
        throw new Error(`web_fetch failed for ${params.url}: ${message}`, { cause: error });
      } finally {
        handle.cleanup();
      }
    },
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web and return a numbered list of results (title, URL, snippet). Uses a keyed backend when available (Tavily, Brave, or Serper via env vars); otherwise falls back to DuckDuckGo.",
    promptSnippet: "Search the web and return a list of results (title, URL, snippet)",
    promptGuidelines: [
      "Use web_search to find current information, then web_fetch the most relevant result for full details.",
    ],
    parameters: SearchParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cfg = getConfig(ctx);
      const max = Math.min(params.maxResults ?? cfg.maxResults, 20);
      const provider = resolveProvider(cfg);
      const handle = withTimeout(signal, cfg.timeoutMs);
      try {
        let results: SearchResult[];
        switch (provider) {
          case "tavily": {
            const key = process.env.TAVILY_API_KEY;
            if (!key) throw new Error("TAVILY_API_KEY is not set");
            results = await searchTavily(params.query, max, handle.signal, key);
            break;
          }
          case "brave": {
            const key = process.env.BRAVE_API_KEY;
            if (!key) throw new Error("BRAVE_API_KEY is not set");
            results = await searchBrave(params.query, max, handle.signal, key);
            break;
          }
          case "serper": {
            const key = process.env.SERPER_API_KEY;
            if (!key) throw new Error("SERPER_API_KEY is not set");
            results = await searchSerper(params.query, max, handle.signal, key);
            break;
          }
          default:
            results = await searchDuckDuckGo(params.query, max, handle.signal, cfg.userAgent);
        }

        const text = formatSearchResults(params.query, results);
        return {
          content: [{ type: "text", text }],
          details: { query: params.query, provider, count: results.length, results },
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (handle.timedOut) {
          throw new Error(`web_search timed out after ${cfg.timeoutMs}ms`, { cause: error });
        }
        throw new Error(`web_search failed: ${message}`, { cause: error });
      } finally {
        handle.cleanup();
      }
    },
  });
}
