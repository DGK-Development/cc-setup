/**
 * Tests for mapResult (CCS-036.12 AC#1/#2):
 * Verifies that usage and durationMs are correctly forwarded through WorkerResult.
 */
import { describe, it, expect } from "bun:test";
import { mapResult } from "./cc-dispatch.ts";

describe("mapResult", () => {
  it("maps usage fields from resultMsg", () => {
    const fakeMsg = {
      subtype: "success",
      result: "OK",
      is_error: false,
      total_cost_usd: 0.001,
      num_turns: 2,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    };
    const r = mapResult(fakeMsg, 1234, "");
    expect(r.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    });
    expect(r.durationMs).toBe(1234);
    expect(r.is_error).toBe(false);
    expect(r.total_cost_usd).toBe(0.001);
    expect(r.num_turns).toBe(2);
    expect(r.result).toBe("OK");
  });

  it("returns undefined usage when resultMsg has no usage field", () => {
    const fakeMsg = {
      subtype: "success",
      result: "Hello",
      is_error: false,
      total_cost_usd: 0,
      num_turns: 1,
    };
    const r = mapResult(fakeMsg, 500, "");
    expect(r.usage).toBeUndefined();
    expect(r.durationMs).toBe(500);
  });

  it("returns error result when resultMsg is null", () => {
    const r = mapResult(null, 200, "some stderr");
    expect(r.is_error).toBe(true);
    expect(r.usage).toBeUndefined();
    expect(r.durationMs).toBe(200);
    expect(r.stderr).toBe("some stderr");
    expect(r.exitCode).toBe(1);
  });

  it("omits cache fields when absent", () => {
    const fakeMsg = {
      subtype: "success",
      result: "done",
      is_error: false,
      total_cost_usd: 0.002,
      num_turns: 3,
      usage: {
        input_tokens: 200,
        output_tokens: 80,
      },
    };
    const r = mapResult(fakeMsg, 3000, "");
    expect(r.usage?.cache_read_input_tokens).toBeUndefined();
    expect(r.usage?.cache_creation_input_tokens).toBeUndefined();
    expect(r.usage?.input_tokens).toBe(200);
    expect(r.usage?.output_tokens).toBe(80);
  });

  it("marks error when subtype is not success", () => {
    const fakeMsg = {
      subtype: "error",
      result: "",
      is_error: true,
      errors: ["Something went wrong"],
      total_cost_usd: 0,
      num_turns: 0,
    };
    const r = mapResult(fakeMsg, 100, "");
    expect(r.is_error).toBe(true);
    expect(r.exitCode).toBe(1);
    expect(r.error).toBe("Something went wrong");
  });
});
