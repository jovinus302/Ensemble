import { describe, expect, it } from "vitest";
import type { NewLedgerEvent } from "../src/index.ts";

describe("core scaffold", () => {
  it("accepts a new ledger event without store-assigned fields", () => {
    const event: NewLedgerEvent = {
      type: "claim_recorded",
      projectId: "p1",
      targetProductId: "tp1",
      actor: { kind: "human", id: "designer" },
      payload: {},
    };
    expect(event.type).toBe("claim_recorded");
  });
});
