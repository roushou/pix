import { describe, expect, test } from "bun:test";
import { resolveConfigObject } from "../extensions/shared/config.ts";
import {
  WEB_CONFIG_SPEC,
  decodeEntities,
  extractDuckDuckGoResults,
  extractTitle,
  extractUddg,
  htmlToText,
} from "../extensions/web.ts";

describe("decodeEntities", () => {
  test("decodes named entities", () => {
    expect(decodeEntities("a &amp; b &lt; c &gt; d &quot;e&quot;")).toBe('a & b < c > d "e"');
  });

  test("decodes numeric and hex entities", () => {
    expect(decodeEntities("&#65;&#x42;&#x1F600;")).toBe("AB😀");
  });

  test("decodes nbsp to space", () => {
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });
});

describe("extractTitle", () => {
  test("extracts and cleans the title", () => {
    expect(extractTitle("<html><title>  My &amp; Page  </title></html>")).toBe("My & Page");
  });

  test("returns undefined without a title", () => {
    expect(extractTitle("<html><body>no title</body></html>")).toBeUndefined();
  });
});

describe("htmlToText", () => {
  test("strips script, style, noscript, and comments", () => {
    const html =
      "<script>var x = 1;</script><style>.a{}</style><noscript>nope</noscript><!-- c --><p>hi</p>";
    expect(htmlToText(html)).toBe("hi");
  });

  test("converts block elements to line breaks", () => {
    expect(htmlToText("<div>a</div><p>b</p><li>c</li><br>")).toBe("a\nb\nc");
  });

  test("collapses whitespace and trims each line", () => {
    expect(htmlToText("<p>  a   b  </p><p>  c  </p>")).toBe("a b\nc");
  });

  test("drops the head section entirely", () => {
    expect(htmlToText("<head><title>t</title></head><body>x</body>")).toBe("x");
  });
});

describe("extractUddg", () => {
  test("decodes the uddg redirect parameter", () => {
    expect(extractUddg("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1")).toBe(
      "https://example.com/a?x=1",
    );
  });

  test("prepends https to protocol-relative URLs", () => {
    expect(extractUddg("//example.com/page")).toBe("https://example.com/page");
  });

  test("leaves plain absolute URLs alone", () => {
    expect(extractUddg("https://example.com/page")).toBe("https://example.com/page");
  });
});

describe("extractDuckDuckGoResults", () => {
  test("parses titled results with snippets", () => {
    const html = [
      '<a class="result__a" href="//x/?uddg=https%3A%2F%2Fa.com">Result A</a>',
      '<a class="result__snippet">snippet for A</a>',
      '<a class="result__a" href="//x/?uddg=https%3A%2F%2Fb.com">Result B</a>',
      '<a class="result__snippet">snippet for B</a>',
    ].join("");
    expect(extractDuckDuckGoResults(html)).toEqual([
      { title: "Result A", url: "https://a.com", snippet: "snippet for A" },
      { title: "Result B", url: "https://b.com", snippet: "snippet for B" },
    ]);
  });

  test("returns empty for a page with no results", () => {
    expect(extractDuckDuckGoResults("<html>nothing here</html>")).toEqual([]);
  });
});

describe("WEB_CONFIG_SPEC", () => {
  const env = {} as Record<string, string | undefined>;

  test("absent settings resolve to defaults", () => {
    expect(resolveConfigObject(WEB_CONFIG_SPEC, {}, env)).toEqual({
      userAgent: "pi-web/1.0",
      searchProvider: "auto",
      maxResults: 8,
      timeoutMs: 15_000,
    });
  });

  test("explicit values override", () => {
    expect(
      resolveConfigObject(
        WEB_CONFIG_SPEC,
        {
          userAgent: "custom/1.0",
          searchProvider: "tavily",
          maxResults: 12,
          timeoutMs: 5000,
        },
        env,
      ),
    ).toEqual({
      userAgent: "custom/1.0",
      searchProvider: "tavily",
      maxResults: 12,
      timeoutMs: 5000,
    });
  });

  test("invalid values fall back per key", () => {
    expect(
      resolveConfigObject(
        WEB_CONFIG_SPEC,
        {
          userAgent: "",
          searchProvider: "google",
          maxResults: -3,
          timeoutMs: 0,
        },
        env,
      ),
    ).toEqual({
      userAgent: "pi-web/1.0",
      searchProvider: "auto",
      maxResults: 8,
      timeoutMs: 15_000,
    });
  });

  test("non-integer maxResults falls back", () => {
    expect(resolveConfigObject(WEB_CONFIG_SPEC, { maxResults: 3.5 }, env).maxResults).toBe(8);
  });
});
