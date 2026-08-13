import { contract } from "./contracts.js";
import { FIXTURE_SCENARIO_ID, type FixtureDescriptor } from "./fixture-media.js";

export const SCENARIO = contract("OperationalPilotScenarioV1", {
  scenarioId: FIXTURE_SCENARIO_ID,
  organizationId: "6d91cee6-91c1-52ea-937a-77c1ddc51c63",
  orderId: "61000000-0000-5000-8000-000000000001",
  propertyHubId: "71000000-0000-5000-8000-000000000001",
  orderItemId: "67000000-0000-5000-8000-000000000001",
  lane: "PHOTO", timezone: "America/New_York", fixtureNamespace: "M16A_OPERATIONAL_PILOT",
  decisions: ["ACCEPT", "ACCEPT", "ACCEPT", "ACCEPT", "QUICK_EDIT"],
});

export function platformToMediaPacket(ids: Record<string, string>) {
  return contract("PlatformToMediaPacketV1", { operation: "CAPTURE_AND_CULL_LOCAL_FIXTURE", fixtureNamespace: "M16A_OPERATIONAL_PILOT", ...ids });
}

export function mediaToPlatformResult(descriptors: readonly FixtureDescriptor[], canonicalIds: readonly string[]) {
  return contract("MediaToPlatformResultV1", { status: "VERIFIED_LOCAL_FIXTURE", items: descriptors.map((item, index) => ({
    canonicalId: canonicalIds[index], objectIdentifier: item.objectIdentifier, observedFilename: item.observedFilename,
    byteSize: item.byteSize, checksumSha256: item.checksumSha256, mediaType: item.mediaType,
  })) });
}
