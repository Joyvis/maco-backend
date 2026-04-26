import { BaseEvent } from "./base-event";

class TestEvent extends BaseEvent {
  constructor(
    tenant_id: string,
    source_command: string,
    correlation_id: string,
  ) {
    super(tenant_id, source_command, correlation_id);
  }
}

describe("BaseEvent", () => {
  it("sets all fields on valid construction", () => {
    const evt = new TestEvent(
      "tenant-uuid",
      "CreateTenantCommand",
      "corr-uuid",
    );
    expect(evt.tenant_id).toBe("tenant-uuid");
    expect(evt.source_command).toBe("CreateTenantCommand");
    expect(evt.correlation_id).toBe("corr-uuid");
    expect(evt.timestamp).toBeInstanceOf(Date);
  });

  it("throws when tenant_id is missing", () => {
    expect(() => new TestEvent("", "CreateTenantCommand", "corr-uuid")).toThrow(
      "tenant_id is required",
    );
  });

  it("throws when source_command is missing", () => {
    expect(() => new TestEvent("tenant-uuid", "", "corr-uuid")).toThrow(
      "source_command is required",
    );
  });

  // AC5
  it("throws when correlation_id is missing", () => {
    expect(
      () => new TestEvent("tenant-uuid", "CreateTenantCommand", ""),
    ).toThrow("correlation_id is required");
  });
});
