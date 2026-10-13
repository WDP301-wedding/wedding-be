import { ProviderError } from '../../core/errors/app-error.js';
/** Known rejected requests may retry; transport loss and accepted-but-unreadable
 * receipts remain unknown. Existing provider HTTP error codes stay stable. */
export class EmailDeliveryError extends ProviderError {
  constructor(
    readonly deliveryOutcome: 'RETRYABLE_FAILED' | 'DEAD_LETTER' | 'UNKNOWN',
    kind?: 'failure' | 'unavailable',
  ) {
    super(kind ?? (deliveryOutcome === 'DEAD_LETTER' ? 'failure' : 'unavailable'));
  }
}
