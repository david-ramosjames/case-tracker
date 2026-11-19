import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasContactRole,
  normalizeContactRoles,
  withToggledContactRole,
} from "./roles";

describe("contact multi-roles", () => {
  it("falls back to primary when roles empty", () => {
    assert.equal(hasContactRole({ role: "paralegal", roles: [] }, "paralegal"), true);
    assert.equal(hasContactRole({ role: "paralegal", roles: [] }, "legal_assistant"), false);
  });

  it("matches secondary roles for Valeria-style contacts", () => {
    const contact = { role: "legal_assistant", roles: ["legal_assistant", "paralegal"] };
    assert.equal(hasContactRole(contact, "legal_assistant"), true);
    assert.equal(hasContactRole(contact, "paralegal"), true);
    assert.equal(hasContactRole(contact, "attorney"), false);
  });

  it("keeps primary inside roles when toggling", () => {
    const next = withToggledContactRole(
      { role: "legal_assistant", roles: ["legal_assistant"] },
      "paralegal",
      true,
    );
    assert.equal(next.role, "legal_assistant");
    assert.deepEqual(next.roles.sort(), ["legal_assistant", "paralegal"]);
  });

  it("normalizes missing primary from roles", () => {
    const normalized = normalizeContactRoles(["paralegal", "legal_assistant"], null);
    assert.equal(normalized.role, "paralegal");
    assert.deepEqual(normalized.roles, ["paralegal", "legal_assistant"]);
  });
});
