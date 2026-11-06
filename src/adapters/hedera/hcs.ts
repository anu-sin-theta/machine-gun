/**
 * Thin wrapper over the Hiero SDK. Kept free of logic so everything testable
 * lives in messages.ts; this file is exercised by the live test only.
 */

import {
  AccountId,
  Client,
  PrivateKey,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";
import { HederaError, type SubmitResult, type TopicSubmitter } from "./types";

export interface SdkSubmitterConfig {
  network: "testnet" | "mainnet";
  accountId: string;
  privateKey: string;
}

export function createSdkSubmitter(config: SdkSubmitterConfig): TopicSubmitter {
  const client =
    config.network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(config.accountId),
    PrivateKey.fromStringDer(config.privateKey),
  );

  return {
    async submit(topicId, message): Promise<SubmitResult> {
      try {
        const response = await new TopicMessageSubmitTransaction()
          .setTopicId(TopicId.fromString(topicId))
          .setMessage(message)
          .execute(client);
        const receipt = await response.getReceipt(client);
        return {
          topicId,
          sequenceNumber: Number(receipt.topicSequenceNumber),
          transactionId: response.transactionId.toString(),
        };
      } catch (e) {
        throw new HederaError(
          "SUBMIT_FAILED",
          e instanceof Error ? e.message : String(e),
        );
      }
    },
  };
}
