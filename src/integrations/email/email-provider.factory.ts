import type { BackendConfig } from '../../config/env.js';
import { BrevoEmailProvider } from './brevo-email-provider.js';
import type { EmailProvider } from './email-provider.js';
import { FakeEmailProvider } from './fake-email-provider.js';
import { createResendEmailProvider } from './resend-email-provider.js';

export function createEmailProvider(config: BackendConfig['email']): EmailProvider {
  if (!config.enabled) return new FakeEmailProvider();
  if (config.provider === 'brevo') {
    return new BrevoEmailProvider({ apiKey: config.apiKey, fromEmail: config.fromEmail });
  }
  return createResendEmailProvider({ apiKey: config.resendApiKey, fromEmail: config.fromEmail });
}
