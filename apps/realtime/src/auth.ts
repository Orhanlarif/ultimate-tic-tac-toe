import type { RealtimeTokenPayload } from "@uttt/contracts";
import { RealtimeTokenPayloadSchema } from "@uttt/contracts";
import { jwtVerify } from "jose";

export async function verifyRealtimeToken(
  token: string,
  secret: string,
): Promise<RealtimeTokenPayload> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return RealtimeTokenPayloadSchema.parse(payload);
}
