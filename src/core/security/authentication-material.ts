/** Recognise credentials without retaining or echoing their values. */
export function containsAuthenticationMaterial(value: string): boolean {
  return [
    /\bwi[ar]_[A-Za-z0-9_-]{43}\b/u,
    /\b(?:access[_ -]?token|refresh[_ -]?token|password|passcode|one[- ]time password|otp|api[_ -]?key|bearer)\b/iu,
    /\beyJ[A-Za-z\d_-]{2,}\.[A-Za-z\d_-]{2,}\.[A-Za-z\d_-]{2,}\b/u,
  ].some((pattern) => pattern.test(value));
}
