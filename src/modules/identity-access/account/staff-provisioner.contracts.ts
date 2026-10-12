export type StaffProvisioningContext = Readonly<{
  actorId: string;
  accessToken: string;
  requestId: string;
}>;
/** Identity owns normalized account reuse, Staff role and session revocation. */
export interface StaffAccountProvisioner {
  provision(
    email: string,
    key: string,
    context: StaffProvisioningContext,
  ): Promise<{ accountId: string; credentialSetupRequired: boolean }>;
  setOperationalAccess(
    accountId: string,
    input: { enabled: boolean; reason: string },
    key: string,
    context: StaffProvisioningContext,
  ): Promise<{ accountId: string; enabled: boolean }>;
}
