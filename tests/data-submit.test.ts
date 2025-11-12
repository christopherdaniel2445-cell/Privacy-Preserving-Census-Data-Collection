import { describe, it, expect, beforeEach } from "vitest";

interface Submission {
  category: number;
  value: number;
  location: string;
  ageRange: number;
  proofHash: Buffer;
  submittedAt: number;
}

interface LocationTotal {
  count: number;
}

class DataSubmitContractMock {
  state: {
    currentEpoch: number;
    epochStartBlock: number;
    isEpochClosed: boolean;
    aggregator: string;
    submissions: Map<string, Submission>;
    locationTotals: Map<string, LocationTotal>;
  } = {
    currentEpoch: 0,
    epochStartBlock: 0,
    isEpochClosed: false,
    aggregator: "ST1AGGREGATOR",
    submissions: new Map(),
    locationTotals: new Map(),
  };

  blockHeight = 100;
  caller = "ST1SUBMITTER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      currentEpoch: 0,
      epochStartBlock: 0,
      isEpochClosed: false,
      aggregator: "ST1AGGREGATOR",
      submissions: new Map(),
      locationTotals: new Map(),
    };
    this.blockHeight = 100;
    this.caller = "ST1SUBMITTER";
  }

  private subKey(epoch: number, principal: string): string {
    return `${epoch}-${principal}`;
  }

  private locKey(epoch: number, location: string): string {
    return `${epoch}-${location}`;
  }

  submitData(
    category: number,
    value: number,
    location: string,
    ageRange: number,
    proofHash: Buffer
  ): { ok: boolean; value: boolean | number } {
    if (this.state.isEpochClosed) return { ok: false, value: 101 };
    if (category >= 10) return { ok: false, value: 103 };
    if (value < 1 || value > 1000) return { ok: false, value: 104 };
    if (!location || location.length > 50) return { ok: false, value: 107 };
    if (ageRange > 5) return { ok: false, value: 108 };
    if (proofHash.length !== 32 || proofHash.every((b) => b === 0))
      return { ok: false, value: 109 };
    const key = this.subKey(this.state.currentEpoch, this.caller);
    if (this.state.submissions.has(key)) return { ok: false, value: 105 };

    this.state.submissions.set(key, {
      category,
      value,
      location,
      ageRange,
      proofHash,
      submittedAt: this.blockHeight,
    });

    const locKey = this.locKey(this.state.currentEpoch, location);
    const current = this.state.locationTotals.get(locKey) || { count: 0 };
    this.state.locationTotals.set(locKey, { count: current.count + 1 });

    return { ok: true, value: true };
  }

  closeEpoch(): { ok: boolean; value: boolean | number } {
    if (this.caller !== this.state.aggregator) return { ok: false, value: 100 };
    if (this.state.isEpochClosed) return { ok: false, value: 101 };
    this.state.isEpochClosed = true;
    return { ok: true, value: true };
  }

  updateAggregator(newAgg: string): { ok: boolean; value: boolean | number } {
    if (this.caller !== this.state.aggregator) return { ok: false, value: 100 };
    this.state.aggregator = newAgg;
    return { ok: true, value: true };
  }

  forceNewEpoch(): { ok: boolean; value: number | boolean } {
    if (this.caller !== this.state.aggregator) return { ok: false, value: 100 };
    this.state.currentEpoch++;
    this.state.epochStartBlock = this.blockHeight;
    this.state.isEpochClosed = false;
    return { ok: true, value: this.state.currentEpoch };
  }

  getSubmission(epoch: number, principal: string): Submission | null {
    return this.state.submissions.get(this.subKey(epoch, principal)) || null;
  }

  getLocationTotal(epoch: number, location: string): LocationTotal | null {
    return this.state.locationTotals.get(this.locKey(epoch, location)) || null;
  }

  getCurrentEpoch(): number {
    return this.state.currentEpoch;
  }
}

describe("DataSubmitContract", () => {
  let contract: DataSubmitContractMock;

  beforeEach(() => {
    contract = new DataSubmitContractMock();
    contract.reset();
  });

  it("submits valid data successfully", () => {
    const proof = Buffer.alloc(32, 1);
    const result = contract.submitData(2, 150, "Downtown", 3, proof);
    expect(result.ok).toBe(true);
    const sub = contract.getSubmission(0, "ST1SUBMITTER");
    expect(sub?.category).toBe(2);
    expect(sub?.value).toBe(150);
    expect(sub?.location).toBe("Downtown");
    expect(sub?.ageRange).toBe(3);
    expect(sub?.submittedAt).toBe(100);
  });

  it("rejects submission after epoch closed", () => {
    contract.state.isEpochClosed = true;
    const result = contract.submitData(
      1,
      100,
      "Suburb",
      2,
      Buffer.alloc(32, 1)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(101);
  });

  it("rejects invalid category", () => {
    const result = contract.submitData(15, 100, "City", 1, Buffer.alloc(32, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(103);
  });

  it("rejects value below minimum", () => {
    const result = contract.submitData(1, 0, "Rural", 1, Buffer.alloc(32, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(104);
  });

  it("rejects value above maximum", () => {
    const result = contract.submitData(
      1,
      1001,
      "Urban",
      1,
      Buffer.alloc(32, 1)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(104);
  });

  it("rejects empty location", () => {
    const result = contract.submitData(1, 100, "", 1, Buffer.alloc(32, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(107);
  });

  it("rejects long location", () => {
    const longLoc = "A".repeat(51);
    const result = contract.submitData(1, 100, longLoc, 1, Buffer.alloc(32, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(107);
  });

  it("rejects invalid age range", () => {
    const result = contract.submitData(1, 100, "Town", 6, Buffer.alloc(32, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(108);
  });

  it("rejects zero proof hash", () => {
    const result = contract.submitData(
      1,
      100,
      "Village",
      1,
      Buffer.alloc(32, 0)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(109);
  });

  it("rejects incorrect proof length", () => {
    const result = contract.submitData(1, 100, "City", 1, Buffer.alloc(31, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(109);
  });

  it("prevents duplicate submissions", () => {
    const proof = Buffer.alloc(32, 1);
    contract.submitData(1, 100, "City", 1, proof);
    const result = contract.submitData(
      2,
      200,
      "Suburb",
      2,
      Buffer.alloc(32, 2)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(105);
  });

  it("aggregator can close epoch", () => {
    contract.caller = "ST1AGGREGATOR";
    const result = contract.closeEpoch();
    expect(result.ok).toBe(true);
    expect(contract.state.isEpochClosed).toBe(true);
  });

  it("non-aggregator cannot close epoch", () => {
    const result = contract.closeEpoch();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(100);
  });

  it("aggregator can update itself", () => {
    contract.caller = "ST1AGGREGATOR";
    const result = contract.updateAggregator("ST2NEW");
    expect(result.ok).toBe(true);
    expect(contract.state.aggregator).toBe("ST2NEW");
  });

  it("non-aggregator cannot update aggregator", () => {
    const result = contract.updateAggregator("ST2NEW");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(100);
  });

  it("force new epoch advances state", () => {
    contract.caller = "ST1AGGREGATOR";
    contract.state.currentEpoch = 5;
    const result = contract.forceNewEpoch();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(6);
    expect(contract.state.isEpochClosed).toBe(false);
  });
});
