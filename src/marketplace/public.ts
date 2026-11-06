import { formatAmount } from "@/core";
import type { AgentListing } from "./types";

/** A listing as shown to the outside world: plain JSON, money as an exact decimal string. */
export interface PublicAgent {
  id: string;
  role: AgentListing["role"];
  name: string;
  description: string;
  endpoint: string;
  input: AgentListing["input"];
  /** Workers only. */
  model: string | null;
  skills: string[];
  payTo: string;
  /** Tinybars, as a decimal string (a number could lose precision). */
  priceTinybars: string;
  /** For people, e.g. "0.05 HBAR". */
  price: string;
  evidenceSource: string;
  status: AgentListing["status"];
  builtIn: boolean;
  createdAt: number;
}

export function toPublic(listing: AgentListing): PublicAgent {
  return {
    id: listing.id,
    role: listing.role,
    name: listing.name,
    description: listing.description,
    endpoint: listing.endpoint,
    input: listing.input,
    model: listing.model,
    skills: listing.skills,
    payTo: listing.payTo,
    priceTinybars: listing.priceTinybars.toString(),
    price: formatAmount({
      asset: { kind: "HBAR" },
      units: listing.priceTinybars,
    }),
    evidenceSource: listing.evidenceSource,
    status: listing.status,
    builtIn: listing.builtIn,
    createdAt: listing.createdAt,
  };
}
