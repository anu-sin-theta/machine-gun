import { describe, expect, it } from "vitest";
import { createZeroG } from "@/adapters/zerog";
import { loadConfig } from "@/config/env";

const config = loadConfig(process.env);
const ready = Boolean(config.zeroG.apiKey && config.zeroG.modelText);

describe.skipIf(!ready)(
  "0G Private Computer (live): needs ZG_API_KEY and ZG_MODEL_TEXT",
  () => {
    it("extracts and judges a scam-looking message in the configured trust mode", async () => {
      const zg = createZeroG(config.zeroG);
      const extraction = await zg.extract({
        kind: "text",
        text: "URGENT: your SBI KYC expires today. Pay Rs 1 to sbi-secure-login.top/verify or your account is blocked. Do not tell anyone.",
      });
      expect(extraction.requestId).toBeTruthy();
      expect(extraction.value.pressureTactics.length).toBeGreaterThan(0);

      const verdict = await zg.judge(extraction.value, []);
      expect(verdict.requestId).toBeTruthy();
      expect(verdict.value.level).not.toBe("low");
    });

    it("does not rate an ordinary bill as high risk", async () => {
      const zg = createZeroG(config.zeroG);
      const extraction = await zg.extract({
        kind: "text",
        text: "Mumbai Power Co: your November electricity bill is 1.5 HBAR. Pay to account 0.0.5001 by Friday. Reference MPC-4471.",
      });
      const verdict = await zg.judge(extraction.value, []);
      expect(verdict.value.level).not.toBe("high");
    });
  },
);
