// tests/verification.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, buffCV, stringUtf8CV } from "@stacks/transactions";

interface VerifiedProof {
  epoch: number;
  submitter: string;
  verifiedAt: number;
}

interface SubmissionHash {
  hash: Buffer;
}

class VerificationContractMock {
  state: {
    verifiedProofs: Map<string, VerifiedProof>;
    submissionHashes: Map<string, Buffer>;
  } = {
    verifiedProofs: new Map(),
    submissionHashes: new Map(),
  };

  blockHeight = 200;
  caller = "ST1SUBMITTER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      verifiedProofs: new Map(),
      submissionHashes: new Map(),
    };
    this.blockHeight = 200;
    this.caller = "ST1SUBMITTER";
  }

  private proofKey(proof: Buffer): string {
    return proof.toString("hex");
  }

  private subKey(epoch: number, principal: string): string {
    return `${epoch}-${principal}`;
  }

  private hashSubmission(
    category: number,
    value: number,
    location: string,
    ageRange: number
  ): Buffer {
    const cat = Buffer.from(category.toString(16).padStart(64, "0"), "hex");
    const val = Buffer.from(value.toString(16).padStart(64, "0"), "hex");
    const loc = Buffer.from(location, "utf8");
    const age = Buffer.from(ageRange.toString(16).padStart(64, "0"), "hex");
    return require("crypto")
      .createHash("sha256")
      .update(Buffer.concat([cat, val, loc, age]))
      .digest();
  }

  registerSubmissionHash(
    epoch: number,
    submitter: string,
    category: number,
    value: number,
    location: string,
    ageRange: number
  ): { ok: boolean; value: Buffer | number } {
    if (this.caller !== submitter) return { ok: false, value: 100 };
    const key = this.subKey(epoch, submitter);
    if (this.state.submissionHashes.has(key)) return { ok: false, value: 104 };
    const hash = this.hashSubmission(category, value, location, ageRange);
    this.state.submissionHashes.set(key, hash);
    return { ok: true, value: hash };
  }

  verifySubmission(
    epoch: number,
    submitter: string,
    category: number,
    value: number,
    location: string,
    ageRange: number,
    proofHash: Buffer
  ): { ok: boolean; value: boolean | number } {
    if (this.caller !== submitter) return { ok: false, value: 100 };
    if (proofHash.length !== 32) return { ok: false, value: 102 };
    const proofKey = this.proofKey(proofHash);
    if (this.state.verifiedProofs.has(proofKey))
      return { ok: false, value: 103 };
    if (category >= 10) return { ok: false, value: 106 };
    if (value <= 0) return { ok: false, value: 107 };

    const subKey = this.subKey(epoch, submitter);
    const storedHash = this.state.submissionHashes.get(subKey);
    if (!storedHash) return { ok: false, value: 109 };

    const expectedHash = this.hashSubmission(
      category,
      value,
      location,
      ageRange
    );
    if (!expectedHash.equals(storedHash)) return { ok: false, value: 108 };

    this.state.verifiedProofs.set(proofKey, {
      epoch,
      submitter,
      verifiedAt: this.blockHeight,
    });

    return { ok: true, value: true };
  }

  isProofVerified(proofHash: Buffer): VerifiedProof | null {
    return this.state.verifiedProofs.get(this.proofKey(proofHash)) || null;
  }

  getSubmissionHash(epoch: number, submitter: string): Buffer | null {
    return (
      this.state.submissionHashes.get(this.subKey(epoch, submitter)) || null
    );
  }
}

describe("VerificationContract", () => {
  let contract: VerificationContractMock;

  beforeEach(() => {
    contract = new VerificationContractMock();
    contract.reset();
  });

  it("registers and verifies submission hash correctly", () => {
    const reg = contract.registerSubmissionHash(
      0,
      "ST1SUBMITTER",
      3,
      500,
      "Downtown",
      2
    );
    expect(reg.ok).toBe(true);
    const hash = reg.value as Buffer;

    const proof = Buffer.alloc(32, 7);
    const verify = contract.verifySubmission(
      0,
      "ST1SUBMITTER",
      3,
      500,
      "Downtown",
      2,
      proof
    );
    expect(verify.ok).toBe(true);

    const verified = contract.isProofVerified(proof);
    expect(verified?.epoch).toBe(0);
    expect(verified?.submitter).toBe("ST1SUBMITTER");
    expect(verified?.verifiedAt).toBe(200);
  });

  it("rejects verification by non-submitter", () => {
    contract.caller = "ST2ATTACKER";
    const reg = contract.registerSubmissionHash(
      0,
      "ST1SUBMITTER",
      1,
      100,
      "North",
      1
    );
    expect(reg.ok).toBe(false);
    expect(reg.value).toBe(100);
  });

  it("rejects reused proof", () => {
    contract.registerSubmissionHash(0, "ST1SUBMITTER", 1, 100, "North", 1);
    const proof = Buffer.alloc(32, 1);
    contract.verifySubmission(0, "ST1SUBMITTER", 1, 100, "North", 1, proof);
    const result = contract.verifySubmission(
      0,
      "ST1SUBMITTER",
      1,
      100,
      "North",
      1,
      proof
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(103);
  });

  it("rejects invalid proof length", () => {
    contract.registerSubmissionHash(0, "ST1SUBMITTER", 1, 100, "North", 1);
    const result = contract.verifySubmission(
      0,
      "ST1SUBMITTER",
      1,
      100,
      "North",
      1,
      Buffer.alloc(31, 1)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(102);
  });

  it("rejects mismatched proof data", () => {
    contract.registerSubmissionHash(0, "ST1SUBMITTER", 1, 100, "North", 1);
    const result = contract.verifySubmission(
      0,
      "ST1SUBMITTER",
      1,
      200,
      "North",
      1,
      Buffer.alloc(32, 1)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(108);
  });

  it("rejects verification without registered hash", () => {
    const result = contract.verifySubmission(
      0,
      "ST1SUBMITTER",
      1,
      100,
      "North",
      1,
      Buffer.alloc(32, 1)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(109);
  });

  it("prevents re-registration of hash", () => {
    contract.registerSubmissionHash(0, "ST1SUBMITTER", 1, 100, "North", 1);
    const result = contract.registerSubmissionHash(
      0,
      "ST1SUBMITTER",
      2,
      200,
      "South",
      2
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(104);
  });

  it("validates category bounds", () => {
    contract.registerSubmissionHash(0, "ST1SUBMITTER", 5, 100, "Center", 1);
    const result = contract.verifySubmission(
      0,
      "ST1SUBMITTER",
      10,
      100,
      "Center",
      1,
      Buffer.alloc(32, 1)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(106);
  });

  it("validates value > 0", () => {
    contract.registerSubmissionHash(0, "ST1SUBMITTER", 1, 100, "East", 1);
    const result = contract.verifySubmission(
      0,
      "ST1SUBMITTER",
      1,
      0,
      "East",
      1,
      Buffer.alloc(32, 1)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(107);
  });

  it("correctly hashes submission data", () => {
    const hash1 = contract.hashSubmission(1, 100, "City", 3);
    const hash2 = contract.hashSubmission(1, 100, "City", 3);
    expect(hash1.equals(hash2)).toBe(true);

    const hash3 = contract.hashSubmission(1, 200, "City", 3);
    expect(hash1.equals(hash3)).toBe(false);
  });
});
