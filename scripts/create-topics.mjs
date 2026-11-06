#!/usr/bin/env node
// One-off: creates the two HCS topics and prints the lines to paste into .env.
//
//   pnpm setup:hedera        (reads HEDERA_AGENT_* from .env)
//
// Topics have no submit key, so anyone can report to the reputation topic and
// the audit topic is public. Both only ever hold hashes and ids.

import {
  AccountId,
  Client,
  PrivateKey,
  TopicCreateTransaction,
} from "@hiero-ledger/sdk";

const {
  HEDERA_NETWORK = "testnet",
  HEDERA_AGENT_ACCOUNT_ID,
  HEDERA_AGENT_PRIVATE_KEY,
} = process.env;

if (!HEDERA_AGENT_ACCOUNT_ID || !HEDERA_AGENT_PRIVATE_KEY) {
  console.error(
    "Set HEDERA_AGENT_ACCOUNT_ID and HEDERA_AGENT_PRIVATE_KEY in .env first.",
  );
  process.exit(1);
}

const client =
  HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
client.setOperator(
  AccountId.fromString(HEDERA_AGENT_ACCOUNT_ID),
  PrivateKey.fromStringDer(HEDERA_AGENT_PRIVATE_KEY),
);

async function createTopic(memo) {
  const response = await new TopicCreateTransaction()
    .setTopicMemo(memo)
    .execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.topicId.toString();
}

try {
  const audit = await createTopic("Kavach402 audit log");
  const reputation = await createTopic("Kavach402 payee reputation");
  console.log(`HEDERA_HCS_AUDIT_TOPIC_ID=${audit}`);
  console.log(`HEDERA_HCS_REPUTATION_TOPIC_ID=${reputation}`);
} finally {
  client.close();
}
