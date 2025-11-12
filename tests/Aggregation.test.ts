import { describe, it, expect, beforeEach } from "vitest";
import { Cl, ClarityValue, uintCV, buffCV, tupleCV, listCV, someCV, noneCV } from "@stacks/transactions";

interface Submission {
  category: number;
  value: number;
  proofHash: Buffer;
}

interface CategoryTotal {
  sum: bigint;
  count: number;
}

interface FinalAggregate {
  totalSubmissions: number;
  averages: number[];
}

class AggregationContractMock {
  state: {
    currentEpoch: number;
    epochStartBlock: number;
    isEpochClosed: boolean;
    aggregator: string;
    submissions: Map<string, Submission>;
    categoryTotals: Map<string, CategoryTotal>;
    finalAggregates: Map<number, FinalAggregate>;
  } = {
    currentEpoch: 0,
    epochStartBlock: 0,
    isEpochClosed: false,
    aggregator: "ST1AGGREGATOR",
    submissions: new Map(),
    categoryTotals: new Map(),
    finalAggregates: new Map(),
  };

  blockHeight = 0;
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
      categoryTotals: new Map(),
      finalAggregates: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1SUBMITTER";
  }

  private key(epoch: number, principal: string) {
    return `${epoch}-${principal}`;
  }

  private catKey(epoch: number, category: number) {
    return `${epoch}-${category}`;
  }

  submitData(category: number, value: number, proofHash: Buffer): { ok: boolean; value: boolean | number } {
    if (!this.state.isEpochClosed && this.blockHeight < this.state.epochStartBlock + 100) {
      if (category >= 0 && category < 10 && value > 0 && proofHash.length === 32 && proofHash.some(b => b !== 0)) {
        const subKey = this.key(this.state.currentEpoch, this.caller);
        if (this.state.submissions.has(subKey)) return { ok: false, value: 103 };
        this.state.submissions.set(subKey, { category, value, proofHash });
        const catKey = this.catKey(this.state.currentEpoch, category);
        const current = this.state.categoryTotals.get(catKey) || { sum: 0n, count: 0 };
        this.state.categoryTotals.set(catKey, {
          sum: current.sum + BigInt(value),
          count: current.count + 1,
        });
        return { ok: true, value: true };
      }
      return { ok: false, value: category >= 10 ? 105 : value <= 0 ? 106 : 104 };
    }
    return { ok: false, value: 101 };
  }

  closeEpoch(): { ok: boolean; value: boolean | number } {
    if (this.caller !== this.state.aggregator) return { ok: false, value: 100 };
    if (this.state.isEpochClosed) return { ok: false, value: 101 };
    if (this.blockHeight < this.state.epochStartBlock + 100) return { ok: false, value: 102 };
    this.state.isEpochClosed = true;
    return { ok: true, value: true };
  }

  finalizeEpoch(): { ok: boolean; value: boolean | FinalAggregate | number } {
    if (this.caller !== this.state.aggregator) return { ok: false, value: 100 };
    if (!this.state.isEpochClosed) return { ok: false, value: 102 };
    if (this.state.finalAggregates.has(this.state.currentEpoch)) return { ok: false, value: 110 };
    const totals: CategoryTotal[] = [];
    let totalSubs = 0;
    for (let c = 0; c < 10; c++) {
      const cat = this.state.categoryTotals.get(this.catKey(this.state.currentEpoch, c));
      if (cat && cat.count > 0) {
        totals.push(cat);
        totalSubs += cat.count;
      }
    }
    if (totalSubs === 0) return { ok: false, value: 108 };
    const averages = totals.map(t => Number(t.sum / BigInt(t.count)));
    const result: FinalAggregate = {
      totalSubmissions: totalSubs,
      averages: averages.length <= 10 ? averages : averages.slice(0, 10),
    };
    this.state.finalAggregates.set(this.state.currentEpoch, result);
    this.state.currentEpoch++;
    this.state.epochStartBlock = this.blockHeight;
    this.state.isEpochClosed = false;
    return { ok: true, value: result };
  }

  updateAggregator(newAgg: string): { ok: boolean; value: boolean | number } {
    if (this.caller !== this.state.aggregator) return { ok: false, value: 100 };
    this.state.aggregator = newAgg;
    return { ok: true, value: true };
  }

  getCurrentEpoch(): number {
    return this.state.currentEpoch;
  }

  getSubmission(epoch: number, principal: string): Submission | null {
    return this.state.submissions.get(this.key(epoch, principal)) || null;
  }

  getFinalAggregate(epoch: number): FinalAggregate | null {
    return this.state.finalAggregates.get(epoch) || null;
  }
}

describe("AggregationContract", () => {
  let contract: AggregationContractMock;

  beforeEach(() => {
    contract = new AggregationContractMock();
    contract.reset();
    contract.blockHeight = 50;
  });

  it("submits valid data successfully", () => {
    const result = contract.submitData(0, 25, Buffer.alloc(32, 1));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const sub = contract.getSubmission(0, "ST1SUBMITTER");
    expect(sub?.category).toBe(0);
    expect(sub?.value).toBe(25);
  });

  it("rejects submission after epoch closed", () => {
    contract.state.isEpochClosed = true;
    const result = contract.submitData(0, 25, Buffer.alloc(32, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(101);
  });

  it("rejects invalid category", () => {
    const result = contract.submitData(10, 25, Buffer.alloc(32, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(105);
  });

  it("rejects zero or negative value", () => {
    const result = contract.submitData(0, 0, Buffer.alloc(32, 1));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(106);
  });

  it("rejects zero proof hash", () => {
    const result = contract.submitData(0, 25, Buffer.alloc(32, 0));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(104);
  });

  it("prevents duplicate submissions", () => {
    contract.submitData(0, 25, Buffer.alloc(32, 1));
    const result = contract.submitData(1, 30, Buffer.alloc(32, 2));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(103);
  });

  it("aggregator can close epoch after duration", () => {
    contract.blockHeight = 150;
    contract.caller = "ST1AGGREGATOR";
    const result = contract.closeEpoch();
    expect(result.ok).toBe(true);
    expect(contract.state.isEpochClosed).toBe(true);
  });

  it("non-aggregator cannot close epoch", () => {
    contract.blockHeight = 150;
    const result = contract.closeEpoch();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(100);
  });

  it("cannot close epoch before duration", () => {
    contract.caller = "ST1AGGREGATOR";
    const result = contract.closeEpoch();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(102);
  });

  it("prevents finalization if not closed", () => {
    contract.caller = "ST1AGGREGATOR";
    const result = contract.finalizeEpoch();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(102);
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
});