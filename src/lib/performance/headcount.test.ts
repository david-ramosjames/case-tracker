import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEmployedDuringWeek, productivityPerHead } from "./headcount";

describe("performance headcount", () => {
  it("counts employee active during week from performance staff dates", () => {
    assert.equal(
      isEmployedDuringWeek(
        { id: "u1", active: true },
        { contactId: "u1", employmentStartDate: "2026-01-01", employmentEndDate: null, updatedAt: "" },
        "2026-11-10",
        "2026-11-16",
      ),
      true,
    );
    assert.equal(
      isEmployedDuringWeek(
        { id: "u1", active: true },
        { contactId: "u1", employmentStartDate: "2026-01-01", employmentEndDate: "2026-11-01", updatedAt: "" },
        "2026-11-10",
        "2026-11-16",
      ),
      false,
    );
  });

  it("treats missing staff dates as employed when active", () => {
    assert.equal(
      isEmployedDuringWeek({ id: "u1", active: true }, null, "2026-11-10", "2026-11-16"),
      true,
    );
  });

  it("normalizes productivity per head", () => {
    assert.equal(productivityPerHead(10, 5), 2);
    assert.equal(productivityPerHead(10, 0), null);
  });
});
