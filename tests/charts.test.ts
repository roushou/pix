import { describe, expect, test } from "bun:test";
import {
  barChart,
  flowDiagram,
  histogram,
  lineChart,
  parseEdges,
  scatterPlot,
  sparkline,
  treeDiagram,
} from "../extensions/charts.ts";

describe("barChart", () => {
  test("empty values render a placeholder", () => {
    expect(barChart([], [])).toBe("(no data)");
  });

  test("vertical bars render block glyphs and labels", () => {
    const out = barChart([2, 4], ["a", "b"], { height: 4, width: 8 });
    expect(out).toContain("█");
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  test("horizontal bars render the │ separator and values", () => {
    const out = barChart([3, 6], ["x", "y"], { horizontal: true, width: 10 });
    expect(out).toContain("│");
    expect(out).toContain("█");
    expect(out).toContain("3");
    expect(out).toContain("6");
  });

  test("all-zero values do not divide by zero", () => {
    expect(barChart([0, 0], ["a", "b"], { height: 3 })).not.toBe("(no data)");
  });
});

describe("sparkline", () => {
  test("empty values render a placeholder", () => {
    expect(sparkline([])).toBe("(no data)");
  });

  test("renders a block row with min/max range", () => {
    const out = sparkline([1, 5, 3, 8]);
    expect(out).toContain("▁");
    expect(out).toContain("1 … 8");
  });

  test("flat data renders without division by zero", () => {
    const out = sparkline([7, 7, 7]);
    expect(out).toContain("7 … 7");
  });
});

describe("histogram", () => {
  test("empty values render a placeholder", () => {
    expect(histogram([])).toBe("(no data)");
  });

  test("flat data is padded so it still buckets", () => {
    const out = histogram([5, 5, 5], 4, 3);
    expect(out).toContain("█");
  });

  test("spread data produces labelled buckets", () => {
    const out = histogram([1, 1, 9, 9], 2, 4);
    expect(out).toContain("█");
  });
});

describe("lineChart", () => {
  test("needs at least two points", () => {
    expect(lineChart([3])).toBe("(need ≥2 points)");
  });

  test("renders a braille canvas", () => {
    const out = lineChart([1, 4, 2, 7, 3], 20, 6);
    // Braille cells start at U+2800; blank cells are spaces.
    expect([...out].some((c) => c.charCodeAt(0) >= 0x2800 && c.charCodeAt(0) <= 0x28ff)).toBe(true);
  });
});

describe("scatterPlot", () => {
  test("requires equal-length series", () => {
    expect(scatterPlot([1, 2], [1])).toBe("(need equal-length x,y)");
    expect(scatterPlot([], [])).toBe("(need equal-length x,y)");
  });

  test("renders points on a braille canvas", () => {
    const out = scatterPlot([1, 2, 3], [3, 1, 2], 20, 6);
    expect([...out].some((c) => c.charCodeAt(0) >= 0x2800)).toBe(true);
  });
});

describe("parseEdges", () => {
  test("parses a single arrow", () => {
    expect(parseEdges(["App -> API"])).toEqual([["App", "API"]]);
  });

  test("supports arrow spellings", () => {
    expect(parseEdges(["a --> b", "c => d", "e → f"])).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  test("splits semicolon-separated edges on one line", () => {
    expect(parseEdges(["App -> API; API -> DB"])).toEqual([
      ["App", "API"],
      ["API", "DB"],
    ]);
  });

  test("strips inline comments", () => {
    expect(parseEdges(["App -> API # the gateway"])).toEqual([["App", "API"]]);
  });

  test("skips blank and comment-only lines", () => {
    expect(parseEdges(["", "# note", "   "])).toEqual([]);
  });
});

describe("flowDiagram", () => {
  test("empty edge list renders a placeholder", () => {
    expect(flowDiagram([])).toBe("(no edges)");
  });

  test("renders boxes containing node names", () => {
    const out = flowDiagram(parseEdges(["App -> API", "API -> DB"]));
    expect(out).toContain("App");
    expect(out).toContain("API");
    expect(out).toContain("DB");
  });

  test("self-loops are skipped without crashing", () => {
    const out = flowDiagram([["A", "A"]]);
    expect(out).toContain("A");
  });
});

describe("treeDiagram", () => {
  test("empty input renders a placeholder", () => {
    expect(treeDiagram([])).toBe("(no input)");
  });

  test("renders a root then children with branch glyphs", () => {
    const out = treeDiagram(["root", "  child1", "  child2", "    grand"]);
    expect(out.split("\n")[0]).toBe("root");
    expect(out).toContain("├── child1");
    expect(out).toContain("└── child2");
    expect(out).toContain("└── grand");
  });

  test("skips blank lines and treats tabs as two spaces", () => {
    const out = treeDiagram(["root", "", "\tchild"]);
    expect(out.split("\n").length).toBe(2);
    expect(out).toContain("└── child");
  });
});
