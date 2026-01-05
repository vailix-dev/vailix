// Optional attestation verifier
// Apps can implement their own verification logic (e.g., Firebase App Check)
// Set to null to disable attestation requirement

export type AttestVerifier = (token: string | undefined) => Promise<boolean>;

// Default: no attestation required (set to null)
// To enable, implement a verifier function (e.g., Firebase App Check)
export const attestVerifier: AttestVerifier | undefined = undefined;
